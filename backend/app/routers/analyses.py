import asyncio
import uuid
import logging
from datetime import datetime, timezone
from typing import List, Optional
import json
import base64

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

from ..auth import get_current_user
from ..config import settings
from ..supabase_client import supabase
from ..imaging import make_thumbnail  # 400px JPEG-миниатюры

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analyses", tags=["analyses"])

MAX_FILES = 100
MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 МБ
COLMAP_BUCKET = "colmap"

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
    photo_ids: list[str],        # ID строк из colmap_photos
    title: str,
    notes: str,
    exif_list: list,
    photo_b64_list: list,        # base64-строки фото для n8n
    user_info: dict,
    cube: dict,                  # параметры калибровочного куба {squares_per_side, square_size_m}
    webhook_url: str,
):
    payload = {
        "title":      title,
        "notes":      notes,
        "exif":       exif_list,
        "photos_b64": photo_b64_list,
        "user":       user_info,
        "cube":       cube,
        "meta": {
            "analysis_id": analysis_id,
            "photo_ids":   photo_ids,
            "photo_count": len(photo_ids),
            "timestamp":   datetime.now(timezone.utc).isoformat(),
        },
    }

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

    try:
        exif_list = json.loads(exif_data)
    except Exception:
        exif_list = []

    # ── Параметры калибровочного куба ────────────────────────────────────────
    #   Фронт (CubeSettings.jsx) уже переводит сторону клетки в метры и шлёт
    #   готовый блок. Берём только два обязательных поля; конвертацию из мм не
    #   дублируем. Панель не трогали / прислали мусор → стандартный куб.
    try:
        cube_raw = json.loads(cube) if cube else None
    except Exception:
        cube_raw = None
    if not isinstance(cube_raw, dict):
        cube_raw = {}

    try:
        cube_squares = int(cube_raw.get("squares_per_side"))
    except (TypeError, ValueError):
        cube_squares = CUBE_DEFAULT_SQUARES
    try:
        cube_size_m = round(float(cube_raw.get("square_size_m")), 5)
    except (TypeError, ValueError):
        cube_size_m = CUBE_DEFAULT_SIZE_M

    cube_block = {
        "squares_per_side": cube_squares,
        "square_size_m":    cube_size_m,
    }

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
    #       {analysis_id}/{uuid}.jpg        — оригинал (для лайтбокса, PDF)
    #       {analysis_id}/{uuid}_thumb.jpg  — 400px JPEG (для карточек истории)
    #     thumbnail_urls в analyses — параллельный массив к photo_urls, тот же
    #     порядок. Если по какой-то причине миниатюра не сделалась (битый файл),
    #     подставляем оригинал — фронт не сломается.
    photo_ids: list[str] = []
    photo_urls: list[str] = []
    thumbnail_urls: list[str] = []
    photo_b64_list: list[str] = []

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

        # Строка в colmap_photos с обоими путями
        res = await asyncio.to_thread(
            supabase.table("colmap_photos").insert(
                {
                    "analyze_id":         analysis_id,
                    "storage_path":       storage_path,
                    "public_url":         public_url,
                    "thumb_storage_path": thumb_storage_path,
                    "thumb_url":          thumb_url,
                    "filename":           safe_filename,
                }
            ).execute
        )

        photo_row_id = res.data[0]["id"]
        photo_ids.append(photo_row_id)
        photo_urls.append(public_url)
        thumbnail_urls.append(thumb_url)

        b64 = base64.b64encode(content).decode("utf-8")
        mime = file.content_type or "image/jpeg"
        photo_b64_list.append(f"data:{mime};base64,{b64}")

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
        photo_ids,
        title or "Без названия",
        notes,
        exif_list,
        photo_b64_list,
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
            "status, created_at, completed_at, result"
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
