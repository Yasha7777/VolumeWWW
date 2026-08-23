import asyncio
import math
import uuid
import logging
from datetime import datetime, timezone
from typing import List, Optional
import json

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..supabase_client import supabase
from ..imaging import make_thumbnail  # 400px JPEG-миниатюры

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analyses", tags=["analyses"])

MAX_FILES = 100
MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 МБ
COLMAP_BUCKET = "colmap"

# ─── ОТБОР КАДРОВ ДЛЯ ЗРИТЕЛЬНОЙ МОДЕЛИ ──────────────────────────────────────
#
# n8n БОЛЬШЕ НЕ ПОЛУЧАЕТ ФОТО БАЙТАМИ. В вебхук уходят analysis_id, id/ссылки
# кадров и EXIF; оригиналы воркфлоу берёт из БД/Storage сам. Раньше пачка из
# 50 оригиналов давала ~250 МБ base64 в теле запроса и столько же в RAM бэка,
# и n8n на этом ложился.
#
# Отбор «какие кадры показать зрительной модели» тоже считается ЗДЕСЬ, а не в
# Code-ноде воркфлоу: EXIF уже приехал с фронта (exifr парсит ОРИГИНАЛ до любой
# конвертации, см. prepareImage.js), так что решение принимается там, где данные
# появились. Формула перенесена из ноды один в один: ISO (чем ниже, тем лучше)
# и BrightnessValue (оптимум 3-7 EV), по половине веса каждому. Нет EXIF →
# нейтральные 0.5: кадр не выигрывает и не проигрывает.
BEST_PHOTOS_FOR_LLM = 2   # сколько кадров уходит в зрительную модель (LLaVA)
ISO_WORST = 3200          # ISO, на котором оценка по шуму падает до нуля

# exifr отдаёт теги как в стандарте (ISO / BrightnessValue), но часть камер
# пишет их под синонимами — перебираем все известные написания.
ISO_KEYS = ("ISO", "iso", "ISOSpeedRatings", "PhotographicSensitivity", "ISOSpeed")
BRIGHTNESS_KEYS = ("BrightnessValue", "brightness", "Brightness")

# Санитайзер EXIF перед укладкой в jsonb: длинные теги (UserComment, MakerNote)
# в базе — мусор, а нулевой байт внутри строки Postgres в jsonb просто не примет.
EXIF_MAX_STR = 512
EXIF_MAX_LIST = 64
EXIF_MAX_DEPTH = 6

# colmap_photos.exif добавляется миграцией supabase/migration_photo_exif.sql.
# Бэкенд может приехать на сервер РАНЬШЕ миграции — тогда insert с этой
# колонкой отобьётся и уронит весь замер. Флаг гасится на первой такой ошибке
# (и только на ней — см. _insert_photo_row), дальше пишем/читаем без EXIF.
_photos_exif_column = True

# Параметры калибровочного куба по умолчанию (стандарт: 4×4 клетки, клетка 17.5 мм).
# Используются, если фронт не прислал/прислал невалидный блок cube.
CUBE_DEFAULT_SQUARES = 4
CUBE_DEFAULT_SIZE_M  = 0.0175


# ─── SUPERADMIN ──────────────────────────────────────────────────────────────
#
# Признак — колонка profiles.is_superadmin (boolean, default false).
# Суперадмин может: смотреть историю любого пользователя (?user_id=<uuid>),
# всех сразу (?user_id=all), открывать и удалять чужие замеры,
# получать список пользователей для селектора (/analyses/admin/users).
# Вся проверка прав — ТОЛЬКО здесь, на бэкенде. Фронтовый селектор — просто UI.

def _cube_block(cube_raw) -> dict:
    """Нормализует блок калибровочного куба к двум полям для n8n.

    Фронт (CubeSettings.jsx) уже переводит сторону клетки в метры и шлёт
    готовый блок. Берём только два обязательных поля; конвертацию из мм не
    дублируем. Панель не трогали / прислали мусор → стандартный куб.
    """
    if not isinstance(cube_raw, dict):
        cube_raw = {}

    try:
        squares = int(cube_raw.get("squares_per_side"))
    except (TypeError, ValueError):
        squares = CUBE_DEFAULT_SQUARES
    try:
        size_m = round(float(cube_raw.get("square_size_m")), 5)
    except (TypeError, ValueError):
        size_m = CUBE_DEFAULT_SIZE_M

    return {"squares_per_side": squares, "square_size_m": size_m}


def _sanitize_exif(value, _depth: int = 0):
    """EXIF из браузера → безопасный для jsonb объект.

    Приезжает он уже как JSON (exifr на фронте), поэтому чинить нужно немного:
    вырезать нулевые байты (Postgres их в jsonb не примет), обрезать простыни
    вроде UserComment/MakerNote и не дать патологической вложенности уехать
    в рекурсию. Числа-нечисла (NaN/Infinity) гасим — json.dumps их пропустит,
    а Postgres на них отобьётся.
    """
    if _depth > EXIF_MAX_DEPTH:
        return None
    if value is None or isinstance(value, bool) or isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        return value.replace("\x00", "")[:EXIF_MAX_STR]
    if isinstance(value, list):
        return [_sanitize_exif(v, _depth + 1) for v in value[:EXIF_MAX_LIST]]
    if isinstance(value, dict):
        return {
            str(k).replace("\x00", "")[:64]: _sanitize_exif(v, _depth + 1)
            for k, v in value.items()
        }
    return str(value).replace("\x00", "")[:EXIF_MAX_STR]


def _exif_number(exif: dict, keys: tuple) -> Optional[float]:
    """Первое осмысленное число под одним из синонимов тега."""
    for key in keys:
        raw = exif.get(key)
        if isinstance(raw, list):                 # ISOSpeedRatings бывает списком
            raw = raw[0] if raw else None
        if isinstance(raw, bool) or raw is None:
            continue
        if isinstance(raw, (int, float)) and math.isfinite(raw):
            return float(raw)
        if isinstance(raw, str):
            try:
                return float(raw.strip())
            except ValueError:
                continue
    return None


def _photo_quality_score(exif) -> float:
    """Оценка кадра 0..1 по EXIF: половина за ISO, половина за яркость.

    Формула — из Code-ноды n8n, где отбор жил раньше. Одно отличие: там
    «крайняя» яркость не срабатывала никогда (условие `b >= 1 || b <= 10`
    истинно всегда), поэтому 0.2 был мёртвой веткой. Здесь она живая:
    3-7 EV → 1.0, 1-10 EV → 0.6, всё остальное (пересвет/темнота) → 0.2.
    """
    if not isinstance(exif, dict):
        return 0.5

    iso = _exif_number(exif, ISO_KEYS)
    brightness = _exif_number(exif, BRIGHTNESS_KEYS)
    if iso is None and brightness is None:
        return 0.5                                # EXIF есть, но не про качество

    if iso is None:
        iso_score = 0.5
    else:
        iso_score = min(1.0, max(0.0, 1.0 - iso / ISO_WORST))

    if brightness is None:
        brightness_score = 0.5
    elif 3 <= brightness <= 7:
        brightness_score = 1.0
    elif 1 <= brightness <= 10:
        brightness_score = 0.6
    else:
        brightness_score = 0.2

    return round(iso_score * 0.5 + brightness_score * 0.5, 4)


def _photo_block(
    index: int,
    photo_id,
    url: str,
    thumb_url: Optional[str],
    filename: str,
    exif,
) -> dict:
    """Один кадр для n8n: чем он является, где лежит и насколько хорош.

    Байтов здесь нет намеренно — только id строки colmap_photos и публичная
    ссылка на ОРИГИНАЛ в бакете. Воркфлоу забирает пиксели по ним сам.
    """
    return {
        "index":         index,
        "id":            photo_id,
        "url":           url,
        "thumb_url":     thumb_url,
        "filename":      filename,
        "exif":          exif,
        "quality_score": _photo_quality_score(exif),
    }


def _pick_best_photos(photos: list[dict], limit: int = BEST_PHOTOS_FOR_LLM) -> list[dict]:
    """Топ-N кадров по quality_score, возвращённых в порядке съёмки.

    Сортировка стабильная и с явным тай-брейком по index: при равных оценках
    (а без EXIF они равны у всех) выбор детерминирован — первые кадры пачки,
    а не «как повезёт».
    """
    best = sorted(photos, key=lambda p: (-p["quality_score"], p["index"]))[:limit]
    return sorted(best, key=lambda p: p["index"])


def _is_superadmin(user_id: str) -> bool:
    try:
        res = (
            supabase.table("profiles")
            .select("is_superadmin")
            .eq("id", user_id)
            .single()
            .execute()
        )
        return bool(res.data and res.data.get("is_superadmin"))
    except Exception:
        # нет строки в profiles / любая ошибка → точно не админ
        return False


# ─── BACKGROUND TASK ─────────────────────────────────────────────────────────

async def _call_n8n_and_save(
    analysis_id: str,
    photos: list[dict],          # блоки кадров в порядке загрузки (см. _photo_block)
    title: str,
    notes: str,
    user_info: dict,
    cube: dict,                  # параметры калибровочного куба {squares_per_side, square_size_m}
    webhook_url: str,
):
    """Дёргает вебхук n8n ЛЁГКИМ payload и кладёт ответ в analyses.

    Контракт с воркфлоу (менялся 2026-08-23): пикселей в теле запроса НЕТ.
    Уходят analysis_id, id строк colmap_photos, публичные ссылки на оригиналы
    и EXIF — оригиналы n8n тянет из БД/Storage сам. Плюс best_photos: топ-2
    кадра по EXIF, уже отобранные здесь, чтобы воркфлоу не декодировал всю
    пачку ради зрительной модели.
    """
    best = _pick_best_photos(photos)

    payload = {
        "title": title,
        "notes": notes,
        # Параллельные массивы «как раньше»: ноды, читающие body.exif[i] и
        # body.photo_urls[i], продолжают работать без переписывания.
        "exif":       [p["exif"] for p in photos],
        "photo_urls": [p["url"] for p in photos],
        # Всё про кадры одним списком: id строки colmap_photos, ссылка на
        # ОРИГИНАЛ в бакете, EXIF и оценка качества.
        "photos": photos,
        # Кадры для зрительной модели (LLaVA). Отбор — на сайте, где EXIF и
        # появился; n8n от полной пачки перегружался.
        "best_photos": best,
        "user": user_info,
        "cube": cube,
        "meta": {
            "analysis_id":    analysis_id,
            "photo_ids":      [p["id"] for p in photos],
            "photo_count":    len(photos),
            "best_photo_ids": [p["id"] for p in best],
            "timestamp":      datetime.now(timezone.utc).isoformat(),
        },
    }

    # Раньше здесь мерили ДЕСЯТКИ И СОТНИ МЕГАБАЙТ base64. Меряем и теперь —
    # чтобы разбухший EXIF (у некоторых камер он щедрый) не подкрался тихо.
    payload_kb = len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) / 1024
    log_size = logger.warning if payload_kb > 4096 else logger.info
    log_size(
        "n8n payload для %s: %d фото (%d в LLM), %.1f КБ, без байтов фото",
        analysis_id, len(photos), len(best), payload_kb,
    )

    now = lambda: datetime.now(timezone.utc).isoformat()

    try:
        async with httpx.AsyncClient(timeout=settings.n8n_timeout) as client:
            resp = await client.post(webhook_url, json=payload)
            resp.raise_for_status()

        ct = resp.headers.get("content-type", "")
        if "application/json" in ct:
            data = resp.json()
            result = (
                data.get("result")
                or data.get("output")
                or data.get("message")
                or data.get("text")
                or str(data)
            )
        else:
            result = resp.text

        supabase.table("analyses").update(
            {"status": "completed", "result": result, "completed_at": now()}
        ).eq("id", analysis_id).execute()

    except httpx.TimeoutException:
        supabase.table("analyses").update(
            {
                "status": "error",
                "result": "Ошибка: превышено время ожидания. Сервер n8n не ответил.",
                "completed_at": now(),
            }
        ).eq("id", analysis_id).execute()

    except Exception as exc:
        logger.exception("n8n error for analysis %s", analysis_id)
        supabase.table("analyses").update(
            {"status": "error", "result": f"Ошибка: {exc}", "completed_at": now()}
        ).eq("id", analysis_id).execute()


# ─── RERUN (повторный прогон уже загруженного замера) ────────────────────────
#
# Фото повторно НЕ загружаются и БОЛЬШЕ НЕ СКАЧИВАЮТСЯ: они лежат в Storage, а
# в n8n теперь уходят только id/ссылки/EXIF. Раньше здесь качались все
# оригиналы замера, чтобы перегнать их в base64 — то есть трафик Storage → бэк
# → n8n на каждый повтор. Теперь достаточно строк colmap_photos.
# EXIF берётся оттуда же (колонка exif, migration_photo_exif.sql) — у замеров,
# загруженных до этой миграции, он пуст, и все кадры получают нейтральные 0.5.
# Куб в БД не хранится: тот, что прислал клиент, иначе стандартный.

async def _insert_photo_row(row: dict, exif) -> dict:
    """Вставляет строку colmap_photos вместе с EXIF кадра.

    Колонка exif приезжает миграцией, а код может оказаться на сервере раньше
    неё. Тогда PostgREST отобьёт вставку по имени колонки — ловим ИМЕННО этот
    случай, один раз, и дальше пишем без EXIF: замер важнее метаданных. Любая
    другая ошибка (сеть, RLS, битый payload) пусть падает честно, иначе
    молчаливо потеряем EXIF на ровном месте.
    """
    global _photos_exif_column

    if _photos_exif_column:
        try:
            res = await asyncio.to_thread(
                supabase.table("colmap_photos").insert({**row, "exif": exif}).execute
            )
            return res.data[0]
        except Exception as exc:
            if "exif" not in str(exc).lower():
                raise
            _photos_exif_column = False
            logger.warning(
                "colmap_photos.exif недоступна — пишу фото без EXIF. "
                "Накати supabase/migration_photo_exif.sql"
            )

    res = await asyncio.to_thread(supabase.table("colmap_photos").insert(row).execute)
    return res.data[0]


def _fetch_photo_rows(analysis_id: str) -> list[dict]:
    """Строки colmap_photos замера. Без колонки exif (старая БД) — без неё."""
    global _photos_exif_column

    cols = "id, public_url, thumb_url, filename"
    if _photos_exif_column:
        try:
            return (
                supabase.table("colmap_photos")
                .select(cols + ", exif")
                .eq("analyze_id", analysis_id)
                .execute()
            ).data or []
        except Exception as exc:
            if "exif" not in str(exc).lower():
                raise                     # сбой не про колонку — не глушим
            _photos_exif_column = False
            logger.warning(
                "colmap_photos.exif недоступна — читаю фото без EXIF. "
                "Накати supabase/migration_photo_exif.sql"
            )

    return (
        supabase.table("colmap_photos")
        .select(cols)
        .eq("analyze_id", analysis_id)
        .execute()
    ).data or []


async def _rerun_and_save(
    analysis_id: str,
    photo_urls: list[str],
    title: str,
    notes: str,
    user_info: dict,
    cube: dict,
    webhook_url: str,
):
    now = lambda: datetime.now(timezone.utc).isoformat()

    # Порядок фото берём из analyses.photo_urls (это порядок загрузки), а
    # строки colmap_photos подтягиваем по public_url — id самих строк нужны
    # n8n в meta.photo_ids.
    try:
        rows = await asyncio.to_thread(_fetch_photo_rows, analysis_id)
    except Exception:
        logger.warning("colmap_photos недоступна для %s — работаем по ссылкам", analysis_id)
        rows = []

    by_url = {r.get("public_url"): r for r in rows if r.get("public_url")}
    # Кадра нет в colmap_photos (старая запись) — не теряем его: id будет None,
    # но ссылка на оригинал есть, и n8n заберёт пиксели по ней.
    ordered = [by_url.get(u) or {"public_url": u} for u in photo_urls]
    if not ordered:                      # старая запись без photo_urls
        ordered = rows

    ordered = [r for r in ordered if r.get("public_url")]

    photos = [
        _photo_block(
            i,
            row.get("id"),
            row["public_url"],
            row.get("thumb_url"),
            row.get("filename") or f"photo_{i + 1}.jpg",
            row.get("exif"),
        )
        for i, row in enumerate(ordered)
    ]

    if not photos:
        supabase.table("analyses").update(
            {
                "status": "error",
                "result": "Ошибка: не удалось получить фото замера для повторного запуска.",
                "completed_at": now(),
            }
        ).eq("id", analysis_id).execute()
        return

    await _call_n8n_and_save(
        analysis_id,
        photos,
        title,
        notes,
        user_info,
        cube,
        webhook_url,
    )


class RerunRequest(BaseModel):
    is_prod: bool = False
    cube: Optional[dict] = None


# ─── ENDPOINTS ───────────────────────────────────────────────────────────────

@router.post("/", status_code=202)
async def create_analysis(
    background_tasks: BackgroundTasks,
    title: str = Form(""),
    notes: str = Form(""),
    is_prod: bool = Form(False),
    exif_data: str = Form("[]"),
    cube: str = Form(""),        # ← параметры калибровочного куба (JSON), см. CubeSettings.jsx
    client_id: str = Form(""),   # ← идемпотентность: UUID из очереди (queue.js)
    files: List[UploadFile] = File(...),
    current_user: dict = Depends(get_current_user),
):
    if not files:
        raise HTTPException(400, "Нужно хотя бы одно фото")
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"Максимум {MAX_FILES} фото")

    webhook_url = settings.n8n_webhook_url_prod if is_prod else settings.n8n_webhook_url
    if not webhook_url:
        raise HTTPException(500, "Конфигурация n8n URL не найдена")

    # Массив EXIF, параллельный files (см. queue.js). Раньше он просто
    # пересылался в n8n, теперь по нему считается качество кадра и он же едет
    # в БД — поэтому проверяем, что это именно список: `null`/объект/строка от
    # стороннего клиента не должны ронять загрузку на индексации.
    try:
        exif_list = json.loads(exif_data)
    except Exception:
        exif_list = []
    if not isinstance(exif_list, list):
        exif_list = []

    # ── Параметры калибровочного куба ────────────────────────────────────────
    try:
        cube_raw = json.loads(cube) if cube else None
    except Exception:
        cube_raw = None

    cube_block = _cube_block(cube_raw)

    # ── 0. Идемпотентность по client_id ──────────────────────────────────────
    #   Фронт (queue.js) при постановке в очередь генерит UUID и шлёт его как
    #   client_id. Этот же UUID становится id анализа. Тогда повторная отправка
    #   ТОГО ЖЕ замера — двойной сабмит, ретрай очереди, гонка flushAll,
    #   потеря ответа при уже созданной строке — не плодит записи: строка с
    #   этим id уже есть → возвращаем её, второй раз n8n не запускаем и фото
    #   повторно не грузим. client_id битый/пустой → работаем как раньше,
    #   с серверным uuid (обратная совместимость со старым фронтом).
    raw_cid = (client_id or "").strip()
    analysis_id = None
    if raw_cid:
        try:
            analysis_id = str(uuid.UUID(raw_cid))    # валидируем и нормализуем
        except ValueError:
            analysis_id = None                        # мусор → игнорируем

    if analysis_id:
        existing = (
            supabase.table("analyses")
            .select("id, status")
            .eq("id", analysis_id)
            .eq("user_id", current_user["id"])
            .limit(1)
            .execute()
        ).data
        if existing:
            # тот же замер уже создан — отдаём его, не создаём дубль
            return {"id": existing[0]["id"], "status": existing[0]["status"]}

    if not analysis_id:
        analysis_id = str(uuid.uuid4())              # прямой POST без client_id

    now_iso = datetime.now(timezone.utc).isoformat()

    # ── 1. Создаём запись анализа (нужен ID до загрузки фото) ────────────────
    #   Вставка обёрнута в try: при двух ОДНОВРЕМЕННЫХ POST с одним client_id
    #   оба могут пройти проверку выше (строки ещё нет) — тогда первый вставит,
    #   а второй словит конфликт первичного ключа / уникального индекса
    #   analyses_user_client_uniq. Ловим и возвращаем уже созданную строку
    #   вместо 500. Это и есть атомарная гарантия «одна строка на client_id».
    try:
        supabase.table("analyses").insert(
            {
                "id":         analysis_id,
                "client_id":  analysis_id if raw_cid else None,
                "user_id":    current_user["id"],
                "title":      title or "Без названия",
                "notes":      notes,
                "photo_urls": [],   # заполним после загрузки
                "thumbnail_urls": [],
                "status":     "pending",
                "created_at": now_iso,
            }
        ).execute()
    except Exception:
        # гонка: параллельный запрос с тем же id уже вставил строку
        dup = (
            supabase.table("analyses")
            .select("id, status")
            .eq("id", analysis_id)
            .eq("user_id", current_user["id"])
            .limit(1)
            .execute()
        ).data
        if dup:
            return {"id": dup[0]["id"], "status": dup[0]["status"]}
        raise  # не идемпотентный сбой — пусть всплывёт как 500

    # ── 2. Загружаем фото в Storage bucket "colmap" ───────────────────────────
    #     На каждое фото делаем ДВА файла:
    #       {analysis_id}/{uuid}.jpg        — ОРИГИНАЛ как прислал клиент
    #       {analysis_id}/{uuid}_thumb.jpg  — 400px JPEG (для карточек истории)
    #     Оригинал заливается БАЙТ В БАЙТ: никакого Pillow-пересохранения по
    #     дороге. По colmap_photos.public_url расчётный сервер тянет кадр и
    #     читает из него EXIF (фокусное расстояние) — любое пересохранение
    #     убивает EXIF, и масштаб сцены разъезжается. Уменьшенная копия живёт
    #     ОТДЕЛЬНЫМ объектом в thumb_storage_path/thumb_url и оригинал не
    #     подменяет.
    #     thumbnail_urls в analyses — параллельный массив к photo_urls, тот же
    #     порядок. Если по какой-то причине миниатюра не сделалась (битый файл),
    #     подставляем оригинал — фронт не сломается.
    #     EXIF каждого кадра кладём В БАЗУ, в colmap_photos.exif. Он приезжает с
    #     фронта (exifr читает ОРИГИНАЛ до конвертации HEIC) и раньше жил ровно
    #     один запрос — только в теле вебхука. Теперь он часть данных замера:
    #     по нему считается качество кадра, и он же переживает rerun.
    photos: list[dict] = []
    photo_urls: list[str] = []
    thumbnail_urls: list[str] = []

    for i, file in enumerate(files):
        if not (file.content_type or "").startswith("image/"):
            raise HTTPException(400, f"Не изображение: {file.filename}")

        content = await file.read()
        if len(content) > MAX_FILE_BYTES:
            raise HTTPException(
                400,
                f"Файл {file.filename} больше 20 МБ. Сожмите его перед загрузкой.",
            )

        # Генерим миниатюру ДО остальной работы: если файл битый, лучше
        # упасть с понятной ошибкой сейчас, а не после аплоада оригинала.
        # Но не критично — если Pillow не сумел, работаем без миниатюры.
        # supabase-py и Pillow здесь СИНХРОННЫЕ и блокирующие: без to_thread
        # они держат event loop на всё время загрузки пачки (сервер не отвечает
        # другим запросам). Порядок обработки и структура ответа не меняются.
        try:
            thumb_content = await asyncio.to_thread(make_thumbnail, content)
        except Exception:
            logger.warning("Не удалось создать миниатюру для %s", file.filename)
            thumb_content = None

        photo_uuid    = str(uuid.uuid4())
        storage_path  = f"{analysis_id}/{photo_uuid}.jpg"
        safe_filename = file.filename or f"photo_{i+1}.jpg"

        # Загрузка ОРИГИНАЛА
        await asyncio.to_thread(
            supabase.storage.from_(COLMAP_BUCKET).upload,
            storage_path,
            content,
            file_options={"content-type": file.content_type or "image/jpeg"},
        )
        public_url = supabase.storage.from_(COLMAP_BUCKET).get_public_url(storage_path)

        # Загрузка МИНИАТЮРЫ (если сделалась)
        thumb_storage_path = None
        thumb_url = public_url  # fallback: если миниатюры нет — показываем оригинал
        if thumb_content is not None:
            thumb_storage_path = f"{analysis_id}/{photo_uuid}_thumb.jpg"
            await asyncio.to_thread(
                supabase.storage.from_(COLMAP_BUCKET).upload,
                thumb_storage_path,
                thumb_content,
                file_options={"content-type": "image/jpeg"},
            )
            thumb_url = supabase.storage.from_(COLMAP_BUCKET).get_public_url(thumb_storage_path)

        # EXIF этого кадра: массив с фронта параллелен files (см. queue.js).
        # Короче списка / мусор внутри — просто нет EXIF, кадр не теряем.
        photo_exif = _sanitize_exif(exif_list[i]) if i < len(exif_list) else None
        if not isinstance(photo_exif, dict):
            photo_exif = None

        # Строка в colmap_photos: оба пути + EXIF
        row = await _insert_photo_row(
            {
                "analyze_id":         analysis_id,
                "storage_path":       storage_path,
                "public_url":         public_url,
                "thumb_storage_path": thumb_storage_path,
                "thumb_url":          thumb_url,
                "filename":           safe_filename,
            },
            photo_exif,
        )

        photo_urls.append(public_url)
        thumbnail_urls.append(thumb_url)
        photos.append(
            _photo_block(i, row["id"], public_url, thumb_url, safe_filename, photo_exif)
        )

    # ── 3. Обновляем analyses.photo_urls + thumbnail_urls ───────────────────
    supabase.table("analyses").update(
        {"photo_urls": photo_urls, "thumbnail_urls": thumbnail_urls}
    ).eq("id", analysis_id).execute()

    # ── 4. Профиль пользователя для n8n ──────────────────────────────────────
    try:
        profile_res = (
            supabase.table("profiles")
            .select("emails, name, company")
            .eq("id", current_user["id"])
            .single()
            .execute()
        )
        profile = profile_res.data or {}
    except Exception:
        profile = {}

    result_emails: list[str] = list(profile.get("emails") or [])
    if current_user["email"] and current_user["email"] not in result_emails:
        result_emails = [current_user["email"]] + result_emails

    # ── 5. Запускаем n8n в фоне ───────────────────────────────────────────────
    background_tasks.add_task(
        _call_n8n_and_save,
        analysis_id,
        photos,
        title or "Без названия",
        notes,
        {
            "id":      current_user["id"],
            "email":   current_user["email"],
            "emails":  result_emails,
            "name":    profile.get("name", ""),
            "company": profile.get("company", ""),
        },
        cube_block,
        webhook_url,
    )

    return {"id": analysis_id, "status": "pending"}


@router.get("/")
def list_analyses(
    current_user: dict = Depends(get_current_user),
    user_id: Optional[str] = Query(None),  # суперадмин: <uuid> | "all" | None
):
    # thumbnail_urls — параллельный массив к photo_urls, фронт берёт thumb для
    # карточек и оригинал для лайтбокса. У старых записей thumbnail_urls пуст —
    # фронт делает фолбэк на photo_urls (или прогонишь backfill_thumbnails.py).
    #
    # user_id работает ТОЛЬКО для суперадмина. Обычный пользователь с любым
    # значением ?user_id всё равно получит только свои записи.
    admin = _is_superadmin(current_user["id"])

    q = (
        supabase.table("analyses")
        .select(
            "id, user_id, title, notes, photo_urls, thumbnail_urls, "
            "status, created_at, completed_at, result, "
            # Диагностика замера (карта высот / облако точек, сверху и сбоку).
            # Список колонок здесь ЯВНЫЙ — новые поля не приезжают сами, как в
            # GET /{analysis_id} с select("*"). Забудешь дописать — в истории
            # будет пусто, и это выглядит как «пайплайн не отдал картинки».
            "heatmap_top_url, heatmap_side_url, cloud_top_url, cloud_side_url"
        )
        .order("created_at", desc=True)
        .limit(50)
    )

    if admin and user_id == "all":
        pass                                     # без фильтра — все пользователи
    elif admin and user_id:
        q = q.eq("user_id", user_id)             # конкретный пользователь
    else:
        q = q.eq("user_id", current_user["id"])  # обычный режим

    rows = q.execute().data or []

    # Админу подписываем владельца каждой карточки (имя/компания из profiles)
    if admin:
        ids = list({r["user_id"] for r in rows})
        if ids:
            try:
                profs = (
                    supabase.table("profiles")
                    .select("id, name, company")
                    .in_("id", ids)
                    .execute()
                    .data
                    or []
                )
                pmap = {p["id"]: p for p in profs}
                for r in rows:
                    p = pmap.get(r["user_id"]) or {}
                    r["owner_name"] = p.get("name")
                    r["owner_company"] = p.get("company")
            except Exception:
                logger.warning("Не удалось подтянуть профили владельцев")

    return rows


# ВАЖНО: этот роут должен стоять ВЫШЕ "/{analysis_id}", иначе FastAPI
# сматчит /analyses/admin/users как get_analysis(analysis_id="admin").
@router.get("/admin/users")
def admin_list_users(current_user: dict = Depends(get_current_user)):
    """Список пользователей для селектора истории. Только для суперадмина.

    Фронт использует этот эндпоинт ещё и как детектор прав:
    200 → показать селектор, 403 → обычный пользователь.
    """
    if not _is_superadmin(current_user["id"]):
        raise HTTPException(403, "Недостаточно прав")

    res = (
        supabase.table("profiles")
        .select("id, name, company, city")
        .order("name")
        .execute()
    )
    return res.data or []


@router.get("/{analysis_id}")
def get_analysis(analysis_id: str, current_user: dict = Depends(get_current_user)):
    q = supabase.table("analyses").select("*").eq("id", analysis_id)
    if not _is_superadmin(current_user["id"]):
        q = q.eq("user_id", current_user["id"])

    # .single() при нуле строк может кинуть APIError — превращаем в честный 404
    try:
        row = q.single().execute().data
    except Exception:
        row = None
    if not row:
        raise HTTPException(404, "Анализ не найден")
    return row


@router.post("/{analysis_id}/rerun", status_code=202)
def rerun_analysis(
    analysis_id: str,
    body: RerunRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """Повторный прогон замера по уже загруженным фото (TEST/PROD).

    Прежний результат затирается, статус возвращается в pending — History
    подхватит запись своим 10-секундным поллингом. Замер в статусе pending
    перезапустить МОЖНО намеренно: фоновая задача умирает вместе с процессом
    uvicorn, и это единственный способ раскачать зависшую запись.
    """
    webhook_url = settings.n8n_webhook_url_prod if body.is_prod else settings.n8n_webhook_url
    if not webhook_url:
        raise HTTPException(500, "Конфигурация n8n URL не найдена")

    q = (
        supabase.table("analyses")
        .select("id, user_id, title, notes, photo_urls")
        .eq("id", analysis_id)
    )
    if not _is_superadmin(current_user["id"]):
        q = q.eq("user_id", current_user["id"])

    try:
        rec = q.single().execute().data
    except Exception:
        rec = None
    if not rec:
        raise HTTPException(404, "Анализ не найден")

    # Профиль ВЛАДЕЛЬЦА замера, а не того, кто нажал (админ может перезапускать
    # чужие) — иначе n8n отправит письмо не тому человеку.
    owner_id = rec["user_id"]
    try:
        profile = (
            supabase.table("profiles")
            .select("emails, name, company")
            .eq("id", owner_id)
            .single()
            .execute()
        ).data or {}
    except Exception:
        profile = {}

    emails: list[str] = list(profile.get("emails") or [])
    owner_email = current_user["email"] if owner_id == current_user["id"] else None
    if owner_email and owner_email not in emails:
        emails = [owner_email] + emails

    supabase.table("analyses").update(
        {"status": "pending", "result": None, "completed_at": None}
    ).eq("id", analysis_id).execute()

    background_tasks.add_task(
        _rerun_and_save,
        analysis_id,
        list(rec.get("photo_urls") or []),
        rec.get("title") or "Без названия",
        rec.get("notes") or "",
        {
            "id":      owner_id,
            "email":   owner_email or (emails[0] if emails else ""),
            "emails":  emails,
            "name":    profile.get("name", ""),
            "company": profile.get("company", ""),
        },
        _cube_block(body.cube),
        webhook_url,
    )

    return {"id": analysis_id, "status": "pending", "mode": "prod" if body.is_prod else "test"}


@router.delete("/{analysis_id}")
def delete_analysis(analysis_id: str, current_user: dict = Depends(get_current_user)):
    q = supabase.table("analyses").select("id").eq("id", analysis_id)
    if not _is_superadmin(current_user["id"]):
        q = q.eq("user_id", current_user["id"])

    try:
        rec = q.single().execute().data
    except Exception:
        rec = None
    if not rec:
        raise HTTPException(404, "Анализ не найден")

    # Удаляем файлы из Storage bucket "colmap" — И оригиналы, И миниатюры
    photos_res = (
        supabase.table("colmap_photos")
        .select("storage_path, thumb_storage_path")
        .eq("analyze_id", analysis_id)
        .execute()
    )
    paths: list[str] = []
    for row in (photos_res.data or []):
        if row.get("storage_path"):
            paths.append(row["storage_path"])
        if row.get("thumb_storage_path"):
            paths.append(row["thumb_storage_path"])
    if paths:
        try:
            supabase.storage.from_(COLMAP_BUCKET).remove(paths)
        except Exception:
            logger.warning("Не удалось удалить файлы из storage для analysis %s", analysis_id)

    # colmap_photos удалятся каскадом (on delete cascade)
    supabase.table("analyses").delete().eq("id", analysis_id).execute()
    return {"ok": True}
