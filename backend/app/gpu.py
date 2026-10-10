"""Прямой вызов расчётного сервера (GPU) — без n8n.

До 06.10.2026 бэкенд дёргал вебхук n8n, а тот пересылал запрос на приёмник
`receiver_dust3r.py` и собирал текст результата. Зрительная модель (LLaVA) и
почта в воркфлоу к тому моменту были выключены, так что n8n оставался только
посредником. Здесь — всё, что он делал по существу:

  • нормализация EXIF (нода «EXIF → parse»);
  • запрос на приёмник: analysis_id, photo_ids, exif, cube («Prepare GPU
    Payload» → «dust3r»);
  • ссылки на модель в `analyses` («Сохранить PLY URL»);
  • текст результата («Форматирование текста» + «HTTP-ответ») — формат сохранён
    СТРОКА В СТРОКУ: фронт вынимает из него числа регулярками
    (raschetData.js: «Объём DUSt3R: X м³», «Плотность материала: X кг/м³»).

Новое по сравнению с n8n:

  • адрес приёмника, режим масштаба Cube/VIO и ключ доступа лежат в БД
    (таблица app_settings) и правятся суперадмином в «Профиле», без деплоя;
  • для обхода из приложения на сервер уходят данные ARKit по каждому кадру
    (позы, intrinsics) и путь к scan.json — раньше они до GPU не доходили.

Почта и определение материала/плотности сюда НЕ перенесены: в воркфлоу они
были выключены, и переносить было нечего.
"""
import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

import httpx

from .config import settings
from .supabase_client import supabase

logger = logging.getLogger(__name__)

SETTINGS_TABLE = "app_settings"       # supabase/migration_app_settings.sql
SETTINGS_KEY = "gpu"
MODES = ("cube", "vio")
COLMAP_BUCKET = "colmap"
TOKEN_HEADER = "X-Volmetric-Token"    # его же ждёт receiver_dust3r.py
RECEIVER_SERVICE = "volmetric-receiver"

# ОЖИДАНИЕ РЕЗУЛЬТАТА. Расчёт идёт минуты, а между сайтом и GPU-сервером —
# интернет: одно HTTP-соединение, открытое на всё это время, по дороге рвётся,
# и готовый ответ до бэкенда не доходит (прогон 06.10 21:55: сервер досчитал,
# сайт результата не получил). Поэтому бэкенд просит приёмник ответить сразу
# («принято», поле "wait": false), а результат забирает короткими запросами
# GET /result/<analysis_id>, пока не получит.
POLL_EVERY = 5.0          # с между запросами результата
POLL_FAIL_LIMIT = 300.0   # столько секунд подряд без связи — сдаёмся
JOB_LOST_AFTER = 3        # столько ответов 404 подряд — сервер задачу потерял

MIGRATION_HINT = (
    "Таблица настроек не создана. Выполните supabase/migration_app_settings.sql "
    "в SQL-редакторе Supabase."
)


class SettingsStorageMissing(RuntimeError):
    """Нет таблицы app_settings — миграция не применена."""


# ─── адрес и режим ───────────────────────────────────────────────────────────

def normalize_mode(value) -> str:
    mode = str(value or "").strip().lower()
    return mode if mode in MODES else "cube"


def normalize_run_url(raw) -> str:
    """Адрес приёмника в каноническом виде: http(s)://хост[:порт]/run.

    В поле админки вводят по-разному — с /run и без, со слешем на конце, без
    схемы. Приводим к одному виду, а не отказываем: «http://1.2.3.4:6007»
    очевидно значит «…:6007/run». Отказ — только там, где угадывать нельзя.
    """
    url = str(raw or "").strip()
    if not url:
        raise ValueError("Укажите адрес расчётного сервера")
    if "://" not in url:
        url = "http://" + url
    try:
        parts = urlsplit(url)
        host, port = parts.hostname, parts.port     # .port бросает ValueError на мусоре
    except ValueError:
        raise ValueError("Адрес расчётного сервера указан с ошибкой")
    if parts.scheme.lower() not in ("http", "https"):
        raise ValueError("Адрес должен начинаться с http:// или https://")
    if not host:
        raise ValueError("В адресе нет имени или IP сервера")
    if parts.username or parts.password:
        raise ValueError("Логин и пароль в адресе не поддерживаются — для доступа есть поле ключа")
    if any(c.isspace() for c in url):
        raise ValueError("В адресе не должно быть пробелов")
    path = parts.path.rstrip("/")
    if not path:
        path = "/run"
    netloc = host if port is None else f"{host}:{port}"
    if ":" in host:                                  # IPv6 в квадратных скобках
        netloc = f"[{host}]" if port is None else f"[{host}]:{port}"
    return urlunsplit((parts.scheme.lower(), netloc, path, parts.query, ""))


def clean_token(raw) -> str:
    """Ключ доступа: печатные символы ASCII без пробелов.

    Он едет HTTP-заголовком, а заголовок с кириллицей или переводом строки
    либо не отправится вовсе, либо станет дырой (подстановка заголовков).
    """
    token = str(raw or "").strip()
    if not token:
        return ""
    if len(token) > 200 or not all(33 <= ord(ch) <= 126 for ch in token):
        raise ValueError("Ключ доступа: только латиница, цифры и знаки без пробелов, до 200 символов")
    return token


def result_url(run_url: str, analysis_id: str) -> str:
    """Адрес результата задачи: тот же сервер, путь /result/<analysis_id>."""
    parts = urlsplit(run_url)
    return urlunsplit((parts.scheme, parts.netloc, f"/result/{analysis_id}", "", ""))


def health_url(run_url: str) -> str:
    """Адрес проверки связи: тот же сервер, путь /health."""
    parts = urlsplit(run_url)
    return urlunsplit((parts.scheme, parts.netloc, "/health", "", ""))


# ─── настройки: БД, а без неё — переменные окружения ─────────────────────────

def _is_missing_table(exc: Exception) -> bool:
    text = str(exc)
    return ("PGRST205" in text or "42P01" in text
            or ("app_settings" in text and ("does not exist" in text or "Could not find" in text)))


def load_gpu_settings() -> dict:
    """{url, mode, token, updated_at, source, storage_ready}.

    Источник — строка app_settings[key='gpu']. Пока её нет (или нет самой
    таблицы), работаем по переменным окружения GPU_SERVER_URL / GPU_MODE /
    GPU_TOKEN: бэкенд может приехать на сервер раньше миграции, и замеры от
    этого падать не должны.
    """
    out = {
        "url": (settings.gpu_server_url or "").strip(),
        "mode": normalize_mode(settings.gpu_mode),
        "token": (settings.gpu_token or "").strip(),
        "updated_at": None,
        "source": "env",
        "storage_ready": True,
    }
    try:
        rows = (
            supabase.table(SETTINGS_TABLE)
            .select("value, updated_at")
            .eq("key", SETTINGS_KEY)
            .limit(1)
            .execute()
        ).data or []
    except Exception as exc:
        out["storage_ready"] = not _is_missing_table(exc)
        logger.warning("app_settings недоступна (%s) — настройки GPU из окружения", exc)
        rows = []

    value = rows[0].get("value") if rows else None
    if isinstance(value, dict):
        if str(value.get("url") or "").strip():
            out["url"] = str(value["url"]).strip()
            out["source"] = "db"
        if value.get("mode"):
            out["mode"] = normalize_mode(value["mode"])
        if "token" in value:                         # пустой ключ в БД = «без ключа»
            out["token"] = str(value.get("token") or "").strip()
        out["updated_at"] = rows[0].get("updated_at")
    if not out["url"]:
        out["source"] = "none"
    return out


def save_gpu_settings(url: str, mode: str, token: Optional[str], user_id: str) -> dict:
    """Сохраняет настройки. token=None — ключ не трогаем, "" — стираем."""
    current = load_gpu_settings()
    if not current["storage_ready"]:
        raise SettingsStorageMissing(MIGRATION_HINT)
    value = {
        "url": normalize_run_url(url),
        "mode": normalize_mode(mode),
        "token": current["token"] if token is None else clean_token(token),
    }
    try:
        supabase.table(SETTINGS_TABLE).upsert(
            {
                "key": SETTINGS_KEY,
                "value": value,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_by": user_id,
            }
        ).execute()
    except Exception as exc:
        if _is_missing_table(exc):
            raise SettingsStorageMissing(MIGRATION_HINT)
        raise
    return load_gpu_settings()


def public_settings(cfg: dict) -> dict:
    """То же, но без самого ключа: в браузер он не возвращается никогда."""
    token = cfg.get("token") or ""
    return {
        "url": cfg.get("url") or "",
        "mode": cfg.get("mode") or "cube",
        "token_set": bool(token),
        "token_hint": ("…" + token[-4:]) if len(token) >= 12 else "",
        "updated_at": cfg.get("updated_at"),
        "source": cfg.get("source"),
        "storage_ready": bool(cfg.get("storage_ready")),
    }


# ─── запрос на приёмник ──────────────────────────────────────────────────────

def _round(value, digits: int):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return round(v, digits) if v == v and abs(v) != float("inf") else None


def normalize_exif_entry(index: int, exif) -> dict:
    """Одна запись EXIF в том виде, в каком её отдавала нода «EXIF → parse».

    Набор полей и имена исходных тегов перенесены без изменений — по этим
    полям раннер считает фокус (focal_real, focal_35mm, orig_width/height).
    Расширять список синонимов здесь нельзя: чужой тег вроде ImageWidth
    (ширина превью) дал бы неверный фокус, а пустое поле безопасно — тогда
    раннер читает EXIF прямо из файла.
    """
    if not isinstance(exif, dict):       # пустой объект {} нода разворачивала в поля-null
        return {"photo_index": index, "exif": None}
    e = exif
    return {
        "photo_index": index,
        "exif": {
            "lat":           e.get("latitude"),
            "lon":           e.get("longitude"),
            "gps_direction": _round(e.get("GPSImgDirection"), 1) if e.get("GPSImgDirection") else None,
            "gps_accuracy":  _round(e.get("GPSHPositioningError"), 1) if e.get("GPSHPositioningError") else None,
            "focal_35mm":    e.get("FocalLengthIn35mmFormat"),
            "focal_real":    e.get("FocalLength"),
            "f_number":      e.get("FNumber"),
            "brightness":    _round(e.get("BrightnessValue"), 2) if e.get("BrightnessValue") else None,
            "iso":           e.get("ISO"),
            "orig_width":    e.get("ExifImageWidth"),
            "orig_height":   e.get("ExifImageHeight"),
            "make":          e.get("Make"),
            "model":         e.get("Model"),
            "shot_at":       e.get("DateTimeOriginal"),
        },
    }


SCAN_META_KEYS = (
    "id", "title", "frame_count", "lat", "lon", "loc_accuracy_m", "device_model",
    "app_version", "captured_at", "duration_s", "tracking_segments",
    "frames_degraded", "storage_prefix",
)


def scan_block(scan: Optional[dict]) -> Optional[dict]:
    """Сведения об обходе для приёмника + где лежит scan.json."""
    if not isinstance(scan, dict) or not scan.get("id"):
        return None
    block = {k: scan[k] for k in SCAN_META_KEYS if scan.get(k) is not None}
    prefix = scan.get("storage_prefix")
    if prefix:
        # Само тело scan.json не шлём (облако ARKit — мегабайты): приёмник
        # забирает файл из Storage своим service-ключом.
        block["bucket"] = COLMAP_BUCKET
        block["scan_json_path"] = f"{prefix}/scan.json"
    return block


def frames_block(frames: Optional[list]) -> list[dict]:
    """Данные ARKit по кадрам: поза, intrinsics, трекинг — всё, что в БД."""
    out = []
    for f in frames or []:
        if not isinstance(f, dict) or not f.get("id"):
            continue
        out.append({
            "photo_id":    f["id"],
            "frame_index": f.get("frame_index"),
            "filename":    f.get("filename"),
            "arkit":       f.get("arkit") if isinstance(f.get("arkit"), dict) else None,
        })
    return out


def build_payload(analysis_id: str, photos: list[dict], cube: dict, mode: str,
                  scan: Optional[dict] = None, frames: Optional[list] = None) -> dict:
    """Тело запроса на /run.

    Первые четыре поля — прежний контракт n8n → приёмник, без изменений.
    `mode`, `scan`, `frames` — новые; старый приёмник их просто не читает.
    """
    payload = {
        "analysis_id": analysis_id,
        "photo_ids":   [p["id"] for p in photos],
        "exif":        [normalize_exif_entry(i, p.get("exif")) for i, p in enumerate(photos)],
        "cube":        cube,
        "mode":        normalize_mode(mode),
        "source":      "site",
    }
    block = scan_block(scan)
    if block:
        payload["scan"] = block
        payload["frames"] = frames_block(frames)
    return payload


# ─── текст результата (как его собирал n8n) ──────────────────────────────────

def _fixed(value, digits: int) -> str:
    return f"{float(value):.{digits}f}"


def _int_ru(value) -> str:
    """12345 → «12 345» с неразрывным пробелом, как toLocaleString('ru')."""
    try:
        return f"{int(value or 0):,}".replace(",", " ")
    except (TypeError, ValueError):
        return "0"


def _or(*values):
    """Первое не-None значение — аналог цепочки `a ?? b ?? c`."""
    for v in values:
        if v is not None:
            return v
    return None


def format_result_text(d: dict, material: str = "unknown", density_kg_m3: float = 0) -> str:
    """Текст для analyses.result — перенос нод «Форматирование текста» и «HTTP-ответ».

    Материал и плотность приходили от LLaVA; пока она выключена, это
    «unknown» и 0, и текст выходит ровно таким же, каким его отдавал n8n.
    """
    header = "🔗 Похожие в БД: нет данных"
    block = ""
    status = d.get("status")
    if status in ("success", "partial"):
        model_url = d.get("glb_url") or d.get("ply_url")
        vol = d.get("volume_m3")
        height, width, depth = d.get("height_m"), d.get("width_m"), d.get("depth_m")
        area = d.get("footprint_area_m2")

        dims = ""
        if height is not None and width is not None and depth is not None:
            dims = "\n".join(filter(None, [
                "📏 Размеры кучи",
                f"   Высота: {_fixed(height, 2)} м",
                f"   Ширина: {_fixed(width, 2)} м",
                f"   Длина: {_fixed(depth, 2)} м",
                f"   Площадь основания: {_fixed(area, 2)} м²" if area is not None else "",
            ]))

        mass_t = (vol * density_kg_m3) / 1000 if (vol is not None and density_kg_m3 > 0) else None

        # Масштаб задают позы ARKit из обхода приложения (куба нет с 10.10.2026).
        # Говорим прямо, чем посчитан объём — или почему его нет.
        scale_line = ""
        if vol is None:
            if not d.get("scan_id"):
                why = ("это загрузка фото без обхода, а масштаб дают только позы "
                       "телефона из обхода приложения VolmetricARKit")
            elif d.get("arkit_pose_note"):
                why = f"позы ARKit не применены — {d['arkit_pose_note']}"
            else:
                why = "позы ARKit не применены"
            scale_line = f"   ℹ️ Объём в м³ не рассчитан: {why}"
        elif d.get("scale_mode") == "arkit_pose":
            used, total = d.get("arkit_pose_frames"), d.get("arkit_pose_frames_total")
            scale_line = ("   📐 Масштаб: по позам ARKit"
                          + (f" ({used} кадров из {total})" if used and total else ""))
            ratio = d.get("arkit_depth_ratio_median")
            if ratio is not None:
                near, far = d.get("arkit_depth_ratio_near"), d.get("arkit_depth_ratio_far")
                scale_line += (f"\n   🔎 Глубина модели / точки ARKit: ×{_fixed(ratio, 2)}"
                               + (f" (ближние ×{_fixed(near, 2)}, дальние ×{_fixed(far, 2)})"
                                  if near is not None and far is not None else ""))

        block = "\n".join(filter(None, [
            "\n",
            "📐 3D-реконструкция (DUSt3R)",
            f"   Точек в облаке: {_int_ru(d.get('point_count'))}",
            f"   Объём DUSt3R: {_fixed(vol, 4)} м³" if vol is not None else "   Объём DUSt3R: не определён",
            dims,
            scale_line,
            "⚖️ Масса (DUSt3R × LLaVA)",
            (f"   Плотность материала: {density_kg_m3} кг/м³" if density_kg_m3 > 0
             else "   Плотность: не определена"),
            (f"   Масса: *{_fixed(mass_t, 2)} т* ({round(mass_t * 1000)} кг)" if mass_t is not None
             else "   Масса: не определена (нет объёма или плотности)"),
            f"   3D модель: {model_url}" if model_url else "",
        ]))

    return (
        f'Все проанализированно с помощью gottland.ru для "{material}", где \n'
        f"{header}{block}\n\n:) \nСпасибо, что выбираете нас!"
    )


def _first_line(text, limit: int = 300) -> str:
    line = str(text or "").strip().splitlines()[0].strip() if str(text or "").strip() else ""
    return line[:limit]


# ─── отправка и ожидание ─────────────────────────────────────────────────────

class GpuFailure(Exception):
    """Расчёт не получен. Текст исключения — готовая фраза для пользователя."""


async def _submit_and_wait(run_url: str, payload: dict, headers: dict, analysis_id: str) -> dict:
    """Отдаёт замер приёмнику и возвращает его итоговый ответ (dict со status).

    Три исхода отправки:
      • 202 «принято» — приёмник считает в фоне, дальше опрос /result;
      • 200 с итогом — старый приёмник без режима «принято»: он держит
        соединение, пока считает, и ответ уже готов;
      • соединение оборвалось ПОСЛЕ отправки — запрос мог дойти, поэтому не
        сдаёмся, а идём в опрос: приёмник запоминает исход любого расчёта.
    Технические подробности — только в лог; пользователю уходит фраза без
    адресов и кодов возврата раннера.
    """
    deadline = time.monotonic() + settings.gpu_timeout
    target = result_url(run_url, analysis_id)
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=20.0)) as client:
        resp = None
        try:
            # read-таймаут длинный ради старого приёмника; новый отвечает за доли секунды
            resp = await client.post(run_url, json=payload, headers=headers,
                                     timeout=httpx.Timeout(settings.gpu_timeout, connect=20.0))
        except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
            logger.error("GPU %s: нет соединения с %s (%s)", analysis_id, run_url, exc)
            raise GpuFailure("Ошибка: расчётный сервер недоступен — возможно, он выключен. "
                             "Попробуйте позже или сообщите администратору.")
        except httpx.HTTPError as exc:
            logger.warning("GPU %s: соединение оборвалось после отправки (%s: %s) — "
                           "проверяю, принял ли приёмник задачу",
                           analysis_id, type(exc).__name__, exc)

        if resp is not None:
            if resp.status_code == 401:
                logger.error("GPU %s: приёмник отклонил ключ доступа", analysis_id)
                raise GpuFailure("Ошибка: расчётный сервер отклонил ключ доступа. Нужна проверка "
                                 "настроек администратором («Профиль» → расчётный сервер).")
            if resp.status_code >= 400:
                logger.error("GPU %s: HTTP %s: %s", analysis_id, resp.status_code, resp.text[:500])
                raise GpuFailure(f"Ошибка: расчётный сервер ответил с ошибкой (код {resp.status_code}).")
            try:
                first = resp.json()
            except ValueError:
                first = None
            if not isinstance(first, dict):
                logger.error("GPU %s: ответ не JSON: %s", analysis_id, resp.text[:300])
                raise GpuFailure("Ошибка: расчётный сервер вернул непонятный ответ.")
            if first.get("status") != "accepted":
                return first                          # старый приёмник: итог пришёл сразу
            logger.info("GPU %s: принято приёмником, жду результат", analysis_id)

        # ── опрос результата ──
        lost, silent_since, pause = 0, None, min(1.0, POLL_EVERY)
        while True:
            if time.monotonic() > deadline:
                raise GpuFailure(f"Ошибка: превышено время ожидания ({settings.gpu_timeout // 60} мин). "
                                 "Расчётный сервер не ответил.")
            await asyncio.sleep(pause)
            pause = POLL_EVERY
            try:
                r = await client.get(target, headers=headers)
                if r.status_code >= 500:
                    raise httpx.HTTPError(f"HTTP {r.status_code}")
            except httpx.HTTPError as exc:
                # Связь пропала — расчёт на сервере при этом идёт. Ждём, пока вернётся.
                silent_since = silent_since or time.monotonic()
                if time.monotonic() - silent_since > POLL_FAIL_LIMIT:
                    logger.error("GPU %s: нет связи %d с подряд (%s)", analysis_id, POLL_FAIL_LIMIT, exc)
                    raise GpuFailure("Ошибка: связь с расчётным сервером потеряна во время расчёта. "
                                     "Запустите анализ ещё раз.")
                continue
            silent_since = None
            if r.status_code == 401:
                raise GpuFailure("Ошибка: расчётный сервер отклонил ключ доступа. Нужна проверка "
                                 "настроек администратором («Профиль» → расчётный сервер).")
            if r.status_code == 404:
                lost += 1
                if lost >= JOB_LOST_AFTER:
                    logger.error("GPU %s: приёмник не знает о задаче (перезапущен? старая версия?)", analysis_id)
                    raise GpuFailure("Ошибка: расчётный сервер потерял задачу — возможно, он был "
                                     "перезапущен во время расчёта. Запустите анализ ещё раз.")
                continue
            lost = 0
            try:
                state = r.json()
            except ValueError:
                state = None
            if isinstance(state, dict) and state.get("state") == "done" and isinstance(state.get("result"), dict):
                return state["result"]


# ─── фоновая задача: посчитать и записать результат ──────────────────────────

async def run_and_save(analysis_id: str, photos: list[dict], cube: dict,
                       scan: Optional[dict] = None, frames: Optional[list] = None):
    """Отправляет замер на расчётный сервер и кладёт ответ в `analyses`.

    Приёмник принимает задачу сразу и считает в фоне (очередь у него своя, по
    одному прогону за раз); результат забираем опросом — см. `_submit_and_wait`.
    Ошибки связи и ошибки расчёта дают статус error с человеческой причиной в
    `result`; технические подробности (адрес, тело ответа) — только в лог.
    """
    now = lambda: datetime.now(timezone.utc).isoformat()

    def finish(status: str, result: str, extra: Optional[dict] = None):
        supabase.table("analyses").update(
            {"status": status, "result": result, "completed_at": now()}
        ).eq("id", analysis_id).execute()
        if extra:
            try:        # ссылки на модель: колонок может не быть — не теряем результат
                supabase.table("analyses").update(extra).eq("id", analysis_id).execute()
            except Exception:
                logger.warning("analyses %s: ссылки на модель не записались", analysis_id)

    try:
        cfg = await asyncio.to_thread(load_gpu_settings)
        if not cfg["url"]:
            await asyncio.to_thread(
                finish, "error",
                "Ошибка: адрес расчётного сервера не задан. Его указывает "
                "администратор в разделе «Профиль».")
            return
        try:
            run_url = normalize_run_url(cfg["url"])
        except ValueError as exc:
            await asyncio.to_thread(finish, "error", f"Ошибка: {exc} (настройка расчётного сервера).")
            return

        usable = [p for p in photos if p.get("id")]
        if len(usable) < 2:
            await asyncio.to_thread(
                finish, "error",
                "Ошибка: у замера нет кадров в хранилище — расчётному серверу нечего "
                "скачивать. Загрузите фото заново.")
            return
        if len(usable) != len(photos):
            logger.warning("GPU %s: %d кадров без строки colmap_photos пропущено",
                           analysis_id, len(photos) - len(usable))

        payload = build_payload(analysis_id, usable, cube, cfg["mode"], scan, frames)
        headers = {TOKEN_HEADER: cfg["token"]} if cfg["token"] else {}
        logger.info("GPU %s: %d кадров, режим %s, обход %s -> %s",
                    analysis_id, len(usable), payload["mode"],
                    "да" if payload.get("scan") else "нет", run_url)

        payload["wait"] = False       # приёмник ответит сразу, результат заберём опросом
        try:
            data = await _submit_and_wait(run_url, payload, headers, analysis_id)
        except GpuFailure as failure:
            await asyncio.to_thread(finish, "error", str(failure))
            return

        if data.get("status") == "error":
            reason = _first_line(data.get("error_message")) or "причина не указана"
            logger.error("GPU %s: расчёт не удался: %s", analysis_id, data.get("error_message"))
            await asyncio.to_thread(finish, "error", f"Ошибка расчёта: {reason}")
            return

        links = {k: data[k] for k in ("ply_url", "glb_url") if data.get(k)}
        await asyncio.to_thread(finish, "completed", format_result_text(data), links)

    except Exception as exc:
        logger.exception("GPU error for analysis %s", analysis_id)
        try:
            await asyncio.to_thread(finish, "error", f"Ошибка: {exc}")
        except Exception:
            logger.exception("analyses %s: не удалось записать ошибку", analysis_id)


# ─── проверка связи (кнопка в админке) ───────────────────────────────────────

async def check_gpu(url: str, token: str = "") -> dict:
    """Стучится на /health приёмника. Расчёт не запускает."""
    run_url = normalize_run_url(url)             # ValueError — наверх, это 400
    token = clean_token(token)                   # то же
    target = health_url(run_url)
    out = {"ok": False, "run_url": run_url, "ms": None, "error": None}
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=5.0)) as client:
            resp = await client.get(target, headers={TOKEN_HEADER: token} if token else {})
    except (httpx.ConnectError, httpx.ConnectTimeout):
        out["error"] = ("Нет соединения: сервер выключен, приёмник не запущен или порт "
                        "закрыт (ufw / группа безопасности)")
        return out
    except httpx.TimeoutException:
        out["error"] = "Сервер не ответил за 8 секунд"
        return out
    except httpx.HTTPError as exc:
        out["error"] = f"Ошибка запроса: {type(exc).__name__}"
        return out
    out["ms"] = round((time.perf_counter() - started) * 1000)

    try:
        data = resp.json() if resp.status_code == 200 else None
    except ValueError:
        data = None
    if not isinstance(data, dict) or data.get("service") != RECEIVER_SERVICE:
        out["error"] = (
            f"По адресу отвечает не приёмник Volmetric (код {resp.status_code}). "
            "Либо порт не тот, либо там старая версия приёмника без /health"
        )
        return out

    out.update({
        "engine": data.get("engine"),
        "code_edit_msk": data.get("code_edit_msk"),
        "auth_required": bool(data.get("auth_required")),
        "token_ok": data.get("token_ok"),
        "scale_modes_ready": data.get("scale_modes_ready") or [],
    })
    if out["auth_required"] and out["token_ok"] is not True:
        out["error"] = ("Сервер на связи, но ключ доступа не подходит"
                        if token else "Сервер на связи, но требует ключ доступа — он не задан")
        return out
    out["ok"] = True
    return out
