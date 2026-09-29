"""Обходы (scans) из приложения VolmetricARKit.

Приложение снимает обход кучи: кадры + позы ARKit на каждый кадр. В БД это
таблица scans (сам обход) и colmap_photos с scan_id / frame_index / arkit
(кадры). Здесь — то, что нужно странице «Анализ»:

  GET  /api/scans/               список обходов пользователя (+ обложка, автор)
  GET  /api/scans/{id}/track     траектория камеры, вид сверху, в метрах ARKit
  POST /api/scans/{id}/analyze   анализ обхода: строка analyses (scan_id) из
                                 кадров обхода + прогон в n8n, как у «Повторить»

Запись в scans/colmap_photos делает загрузчик обходов, не этот роутер.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

from ..auth import get_current_user
from ..config import settings
from ..supabase_client import supabase
from .analyses import (
    _b64_data_url,
    _call_n8n_and_save,
    _cube_block,
    _download_photo,
    _is_superadmin,
    _photo_block,
    _pick_best_photos,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scans", tags=["scans"])

SCAN_COLS = (
    "id, user_id, title, status, frame_count, lat, lon, loc_accuracy_m, "
    "device_model, app_version, captured_at, duration_s, tracking_segments, frames_degraded"
)
FRAME_COLS = "id, storage_path, public_url, thumb_url, filename, frame_index"


def _get_scan(scan_id: str, current_user: dict, cols: str = SCAN_COLS) -> dict:
    q = supabase.table("scans").select(cols).eq("id", scan_id).is_("deleted_at", "null")
    if not _is_superadmin(current_user["id"]):
        q = q.eq("user_id", current_user["id"])
    try:
        row = q.single().execute().data
    except Exception:
        row = None
    if not row:
        raise HTTPException(404, "Обход не найден")
    return row


def _scan_frames(scan_id: str, with_arkit: bool = False) -> list[dict]:
    """Кадры обхода по порядку съёмки. EXIF и arkit — если колонки есть."""
    extra = ", exif" + (", arkit" if with_arkit else "")
    try:
        return (
            supabase.table("colmap_photos")
            .select(FRAME_COLS + extra)
            .eq("scan_id", scan_id)
            .order("frame_index")
            .execute()
        ).data or []
    except Exception:
        logger.warning("colmap_photos: читаю кадры обхода %s без exif/arkit", scan_id)
        return (
            supabase.table("colmap_photos")
            .select(FRAME_COLS)
            .eq("scan_id", scan_id)
            .order("frame_index")
            .execute()
        ).data or []


# ─── список ──────────────────────────────────────────────────────────────────

@router.get("/")
def list_scans(
    current_user: dict = Depends(get_current_user),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    user_id: Optional[str] = Query(None),   # суперадмин: <uuid> | "all"
):
    admin = _is_superadmin(current_user["id"])
    q = (
        supabase.table("scans")
        .select(SCAN_COLS)
        .is_("deleted_at", "null")
        .order("captured_at", desc=True)
        .limit(100)
    )
    if date_from:
        q = q.gte("captured_at", date_from)
    if date_to:
        q = q.lte("captured_at", date_to)
    if admin and user_id == "all":
        pass
    elif admin and user_id:
        q = q.eq("user_id", user_id)
    else:
        q = q.eq("user_id", current_user["id"])

    rows = q.execute().data or []
    if not rows:
        return []
    ids = [r["id"] for r in rows]

    # обложка — первый кадр обхода (frame_index 0), миниатюра если есть
    covers: dict = {}
    try:
        for p in (
            supabase.table("colmap_photos")
            .select("scan_id, thumb_url, public_url")
            .in_("scan_id", ids)
            .eq("frame_index", 0)
            .execute()
        ).data or []:
            covers[p["scan_id"]] = p.get("thumb_url") or p.get("public_url")
    except Exception:
        logger.warning("Не удалось подтянуть обложки обходов")

    # автор и его город — из profiles
    authors: dict = {}
    try:
        uids = list({r["user_id"] for r in rows})
        for p in (
            supabase.table("profiles").select("id, name, city").in_("id", uids).execute()
        ).data or []:
            authors[p["id"]] = p
    except Exception:
        logger.warning("Не удалось подтянуть авторов обходов")

    # последний анализ по обходу (если уже запускали)
    last: dict = {}
    try:
        for a in (
            supabase.table("analyses")
            .select("id, scan_id, status, created_at")
            .in_("scan_id", ids)
            .order("created_at", desc=True)
            .execute()
        ).data or []:
            last.setdefault(a["scan_id"], {"id": a["id"], "status": a["status"], "created_at": a["created_at"]})
    except Exception:
        logger.warning("Не удалось подтянуть анализы обходов")

    for r in rows:
        prof = authors.get(r["user_id"]) or {}
        r["cover_url"] = covers.get(r["id"])
        r["author_name"] = prof.get("name")
        r["author_city"] = prof.get("city")
        r["last_analysis"] = last.get(r["id"])
    return rows


# ─── траектория ──────────────────────────────────────────────────────────────

def _xz_from_arkit(arkit) -> Optional[list]:
    """Позиция камеры из позы ARKit: cameraTransform 4×4 column-major →
    перенос (m[12], m[13], m[14]). Вид сверху: x вправо, z «вниз» по экрану."""
    if not isinstance(arkit, dict):
        return None
    m = arkit.get("cameraTransform") or arkit.get("transform")
    if not isinstance(m, list) or len(m) != 16:
        return None
    try:
        x, z = float(m[12]), float(m[14])
    except (TypeError, ValueError):
        return None
    if x != x or z != z:          # NaN
        return None
    return [round(x, 3), round(z, 3)]


@router.get("/{scan_id}/track")
def scan_track(scan_id: str, current_user: dict = Depends(get_current_user)):
    _get_scan(scan_id, current_user, cols="id")
    frames = _scan_frames(scan_id, with_arkit=True)
    points = [p for p in (_xz_from_arkit(f.get("arkit")) for f in frames) if p]
    return {"scan_id": scan_id, "points": points, "frames": len(frames)}


# ─── анализ обхода ───────────────────────────────────────────────────────────

class ScanAnalyzeRequest(BaseModel):
    is_prod: bool = False
    cube: Optional[dict] = None
    title: Optional[str] = None
    notes: Optional[str] = None
    client_id: Optional[str] = None   # идемпотентность, как у POST /analyses/


async def _run_scan_analysis(analysis_id, frames, title, notes, user_info, cube, webhook_url):
    photos = [
        _photo_block(i, f.get("id"), f["public_url"], f.get("thumb_url"),
                     f.get("filename") or f"{i:03d}.jpg", f.get("exif"))
        for i, f in enumerate(frames)
    ]
    # байты — только двум лучшим кадрам (нода «b64 → items»), остальные по ссылке
    for photo in _pick_best_photos(photos):
        content = await asyncio.to_thread(_download_photo, frames[photo["index"]])
        if content is not None:
            photo["b64"] = await asyncio.to_thread(_b64_data_url, content, "image/jpeg")
    await _call_n8n_and_save(analysis_id, photos, title, notes, user_info, cube, webhook_url)


@router.post("/{scan_id}/analyze", status_code=202)
def analyze_scan(
    scan_id: str,
    body: ScanAnalyzeRequest,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    webhook_url = settings.n8n_webhook_url_prod if body.is_prod else settings.n8n_webhook_url
    if not webhook_url:
        raise HTTPException(500, "Конфигурация n8n URL не найдена")

    scan = _get_scan(scan_id, current_user)
    if scan.get("status") != "ready":
        raise HTTPException(409, "Обход ещё не загружен полностью")

    frames = [f for f in _scan_frames(scan_id) if f.get("public_url")]
    if len(frames) < 2:
        raise HTTPException(409, "У обхода нет кадров в хранилище")

    analysis_id = None
    if body.client_id:
        try:
            analysis_id = str(uuid.UUID(body.client_id))
        except ValueError:
            analysis_id = None
    if analysis_id:
        existing = (
            supabase.table("analyses").select("id, status").eq("id", analysis_id).limit(1).execute()
        ).data
        if existing:
            return {"id": existing[0]["id"], "status": existing[0]["status"], "scan_id": scan_id}
    analysis_id = analysis_id or str(uuid.uuid4())

    owner_id = scan["user_id"]
    title = (body.title or scan.get("title") or "Без названия").strip()
    notes = body.notes or ""
    supabase.table("analyses").insert(
        {
            "id":             analysis_id,
            "client_id":      analysis_id if body.client_id else None,
            "user_id":        owner_id,
            "title":          title,
            "notes":          notes,
            "photo_urls":     [f["public_url"] for f in frames],
            "thumbnail_urls": [f.get("thumb_url") or f["public_url"] for f in frames],
            "status":         "pending",
            "scan_id":        scan_id,
            "created_at":     datetime.now(timezone.utc).isoformat(),
        }
    ).execute()

    # профиль ВЛАДЕЛЬЦА обхода (админ может запускать чужие) — как в rerun
    try:
        profile = (
            supabase.table("profiles").select("emails, name, company").eq("id", owner_id).single().execute()
        ).data or {}
    except Exception:
        profile = {}
    emails: list[str] = list(profile.get("emails") or [])
    owner_email = current_user["email"] if owner_id == current_user["id"] else None
    if owner_email and owner_email not in emails:
        emails = [owner_email] + emails

    background_tasks.add_task(
        _run_scan_analysis,
        analysis_id,
        frames,
        title,
        notes,
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
    return {"id": analysis_id, "status": "pending", "scan_id": scan_id,
            "mode": "prod" if body.is_prod else "test"}
