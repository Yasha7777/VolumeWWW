"""Обходы (scans) из приложения VolmetricARKit.

Приложение снимает обход кучи: кадры + позы ARKit на каждый кадр. В БД это
таблица scans (сам обход) и colmap_photos с scan_id / frame_index / arkit
(кадры). Здесь — то, что нужно странице «Анализ»:

  GET  /api/scans/               список обходов пользователя (+ обложка, автор)
  GET  /api/scans/{id}/track     траектория камеры, вид сверху, в метрах ARKit,
                                 + до 12 кадров с миниатюрами для проигрывания
  GET  /api/scans/{id}/cloud     разреженное облако ARKit + позиции камеры (3D)
  POST /api/scans/{id}/analyze   анализ обхода: строка analyses (scan_id) из
                                 кадров обхода + прогон в n8n, как у «Повторить»

Загрузка обхода из приложения (VolmetricARKit ≥ 5), всё идемпотентно —
телефон на плохой связи повторяет запросы, дублей не бывает:

  POST /api/scans/                   заводит обход (id — UUID из приложения),
                                     статус uploading; повтор возвращает, какие
                                     кадры уже на сервере — телефон докачивает
  PUT  /api/scans/{id}/frames/{i}    кадр i: JPEG байт в байт + метаданные ARKit
  POST /api/scans/{id}/complete      scan.json целиком (облако ARKit), проверка
                                     полноты → статус ready
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import gzip
import json

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..config import settings
from ..supabase_client import supabase
from ..imaging import make_thumbnail
from .analyses import (
    COLMAP_BUCKET,
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


REPLAY_FRAMES = 12   # сколько кадров отдаём для проигрывания обхода на карте

# ─── привязка траектории ARKit к карте ───────────────────────────────────────
#
# ARKit снимает с worldAlignment = .gravity: ось y — вверх, а поворот вокруг
# неё случайный (как держали телефон при старте). Приложение (≥ 5) пишет в
# каждый кадр GPS и курс компаса. Отсюда поворот δ системы ARKit к северу:
#   • по компасу: курс камеры (−Z позы, по горизонтали) против heading.trueDeg,
#     круговая медиана по кадрам с погрешностью компаса ≤ 30°;
#   • если компаса нет или он «гуляет» — по GPS: подгонка поворота
#     ARKit-точек к GPS-точкам (Прокруст 2D без масштаба), только если обход
#     заметно больше погрешности GPS.
# Сдвиг — средневзвешенная разница GPS − повёрнутый ARKit (вес 1/σ²).
M_PER_DEG_LAT = 110_540.0
M_PER_DEG_LON = 111_320.0


def _circ_median_deg(values: list[float]) -> tuple[float, float]:
    """Круговая «медиана» (через средний вектор) и разброс, градусы."""
    import math
    if not values:
        return 0.0, 180.0
    sx = sum(math.sin(math.radians(v)) for v in values) / len(values)
    cx = sum(math.cos(math.radians(v)) for v in values) / len(values)
    mean = math.degrees(math.atan2(sx, cx)) % 360
    r = min(1.0, math.hypot(sx, cx))
    spread = math.degrees(math.sqrt(max(0.0, -2 * math.log(max(r, 1e-9)))))
    return mean, spread


def geo_align(frames: list[dict]) -> Optional[dict]:
    """frames: [{arkit: {...cameraTransform, location, heading}}] → привязка или None."""
    import math
    pts = []      # (x, z, fwd_bearing_ar, loc, heading)
    for f in frames:
        a = f.get("arkit") if isinstance(f.get("arkit"), dict) else f
        m = a.get("cameraTransform") or []
        if len(m) != 16 or not all(_finite(m[i]) for i in (8, 10, 12, 14)):
            continue
        x, z = float(m[12]), float(m[14])
        fx, fz = -float(m[8]), -float(m[10])
        bearing_ar = math.degrees(math.atan2(fx, -fz)) % 360 if math.hypot(fx, fz) > 0.2 else None
        pts.append((x, z, bearing_ar, a.get("location"), a.get("heading")))

    fixes = [(x, z, l) for x, z, _, l, _ in pts
             if isinstance(l, dict) and _finite(l.get("lat")) and _finite(l.get("lon")) and _finite(l.get("hAcc"))
             and l["hAcc"] <= 30]
    if not fixes:
        return None
    lat0 = sorted(l["lat"] for _, _, l in fixes)[len(fixes) // 2]
    lon0 = sorted(l["lon"] for _, _, l in fixes)[len(fixes) // 2]
    coslat = math.cos(math.radians(lat0))
    enu = [((l["lon"] - lon0) * M_PER_DEG_LON * coslat, (l["lat"] - lat0) * M_PER_DEG_LAT, l["hAcc"], x, z)
           for x, z, l in fixes]

    # поворот по компасу
    offsets = []
    for x, z, b_ar, _, h in pts:
        if b_ar is None or not isinstance(h, dict):
            continue
        t, acc = h.get("trueDeg"), h.get("accDeg")
        if _finite(t) and _finite(acc) and acc <= 30:
            offsets.append((t - b_ar) % 360)
    delta, source, spread = None, None, None
    if len(offsets) >= 3:
        d, sp = _circ_median_deg(offsets)
        if sp <= 25:
            delta, source, spread = d, "compass", sp

    # поворот по GPS, если компаса нет
    if delta is None and len(enu) >= 4:
        ex = sum(e for e, *_ in enu) / len(enu); ny = sum(n for _, n, *_ in enu) / len(enu)
        ax = sum(x for *_, x, _ in enu) / len(enu); az = sum(-z for *_, z in enu) / len(enu)
        sxx = sxy = 0.0
        extent = 0.0
        for e, n, _, x, z in enu:
            u, v = x - ax, -z - az          # ARKit: (x, −z) — «восток», «север» до поворота
            p, q = e - ex, n - ny
            sxx += u * p + v * q
            sxy += u * q - v * p
            extent = max(extent, math.hypot(u, v))
        acc = sorted(a for _, _, a, _, _ in enu)[len(enu) // 2]
        if extent > 3 * acc:
            # угол против часовой (математический) → по часовой как у курса
            delta = (-math.degrees(math.atan2(sxy, sxx))) % 360
            source = "gps"

    rot = math.radians(delta or 0.0)
    def to_en(x, z):
        u, v = x, -z
        return (u * math.cos(rot) + v * math.sin(rot), -u * math.sin(rot) + v * math.cos(rot))

    # сдвиг: GPS − повёрнутый ARKit, вес 1/σ²
    wsum = te = tn = 0.0
    for e, n, acc, x, z in enu:
        w = 1.0 / max(acc, 1.0) ** 2
        pe, pn = to_en(x, z)
        te += w * (e - pe); tn += w * (n - pn); wsum += w
    te /= wsum; tn /= wsum
    acc_best = min(a for _, _, a, _, _ in enu)
    return {
        "lat0": lat0, "lon0": lon0,
        "rot_deg": round(delta, 1) if delta is not None else None,
        "rot_source": source,
        "rot_spread_deg": round(spread, 1) if spread is not None else None,
        "shift_en": [round(te, 2), round(tn, 2)],
        "acc_m": round(acc_best, 1),
        "fixes": len(enu),
        "_to_en": to_en,
    }


@router.get("/{scan_id}/track")
def scan_track(scan_id: str, current_user: dict = Depends(get_current_user)):
    _get_scan(scan_id, current_user, cols="id")
    frames = _scan_frames(scan_id, with_arkit=True)
    posed = [(f, _xz_from_arkit(f.get("arkit"))) for f in frames]
    posed = [(f, p) for f, p in posed if p]
    points = [p for _, p in posed]
    # кадры для проигрывания: равномерно по обходу, только с миниатюрой
    step = max(1, len(posed) // REPLAY_FRAMES)
    replay = [
        {"index": f.get("frame_index"), "at": p, "thumb": f.get("thumb_url") or f.get("public_url")}
        for k, (f, p) in enumerate(posed)
        if k % step == 0 and (f.get("thumb_url") or f.get("public_url"))
    ][:REPLAY_FRAMES]
    out = {"scan_id": scan_id, "points": points, "frames": replay, "frame_total": len(frames)}
    geo = geo_align(frames)
    if geo is not None:
        to_en = geo.pop("_to_en")
        te, tn = geo["shift_en"]
        # точки обхода в метрах восток/север от (lat0, lon0) — фронт кладёт их на спутник
        en = []
        for f, _ in posed:
            m = (f.get("arkit") or {}).get("cameraTransform")
            e, n = to_en(float(m[12]), float(m[14]))
            en.append([round(e + te, 2), round(n + tn, 2)])
        geo["points_en"] = en
        geo["frames_en"] = []
        for r in replay:
            f = next((f for f, _ in posed if f.get("frame_index") == r["index"]), None)
            if f is not None:
                m = f["arkit"]["cameraTransform"]
                e, n = to_en(float(m[12]), float(m[14]))
                geo["frames_en"].append([round(e + te, 2), round(n + tn, 2)])
        out["geo"] = geo
    return out


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


# ─── облако ARKit для 3D ─────────────────────────────────────────────────────

# 6000 точек с точностью до сантиметра ≈ 90 КБ JSON (≈ 30 КБ gzip). Ответы
# крупнее ~200 КБ через прокси сервера обрывались (ERR_CONTENT_LENGTH_MISMATCH).
CLOUD_MAX_POINTS = 6000


def _scan_json(scan: dict) -> Optional[dict]:
    path = f"{scan['storage_prefix']}/scan.json"
    try:
        raw = supabase.storage.from_(COLMAP_BUCKET).download(path)
    except Exception:
        return None
    try:
        # приложение пишет NaN/Infinity строками — json.loads их не ждёт в числах,
        # а как строки они просто отфильтруются ниже
        return json.loads(raw)
    except ValueError:
        return None


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and v == v and abs(v) != float("inf")


def build_cloud(scan_json: dict) -> dict:
    """Точки ARKit со всех кадров, по одному разу на идентификатор (последнее
    наблюдение точнее первого), + позиции камеры. Метры, y — вверх."""
    by_id: dict = {}
    anon: list = []
    cameras: list = []
    for fr in scan_json.get("frames") or []:
        m = fr.get("cameraTransform") or []
        if len(m) == 16 and all(_finite(m[i]) for i in (12, 13, 14)):
            cameras.append([round(m[12], 2), round(m[13], 2), round(m[14], 2)])
        pts = fr.get("featurePoints") or []
        ids = fr.get("featurePointIdentifiers") or []
        for k in range(0, len(pts) - 2, 3):
            x, y, z = pts[k], pts[k + 1], pts[k + 2]
            if not (_finite(x) and _finite(y) and _finite(z)):
                continue
            p = [round(x, 2), round(y, 2), round(z, 2)]
            j = k // 3
            if j < len(ids):
                by_id[ids[j]] = p
            else:
                anon.append(p)
    points = list(by_id.values()) + anon
    if len(points) > CLOUD_MAX_POINTS:
        step = len(points) / CLOUD_MAX_POINTS
        points = [points[int(i * step)] for i in range(CLOUD_MAX_POINTS)]
    return {"points": points, "cameras": cameras}


def _json_response(request: Request, data) -> Response:
    """JSON, сжатый gzip, если клиент умеет: облако — самый тяжёлый ответ API."""
    raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode()
    if "gzip" in (request.headers.get("accept-encoding") or "") and len(raw) > 2048:
        return Response(gzip.compress(raw, 6), media_type="application/json",
                        headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
    return Response(raw, media_type="application/json")


CLOUD_VERSION = 2   # поменять — и закэшированные cloud.json пересчитаются


@router.get("/{scan_id}/cloud")
def scan_cloud(scan_id: str, request: Request, current_user: dict = Depends(get_current_user)):
    scan = _get_scan(scan_id, current_user, cols="id, storage_prefix")
    cached = f"{scan['storage_prefix']}/cloud.v{CLOUD_VERSION}.json"
    try:
        return _json_response(request, json.loads(supabase.storage.from_(COLMAP_BUCKET).download(cached)))
    except Exception:
        pass
    data = _scan_json(scan)
    if data is None:
        raise HTTPException(404, "У обхода нет scan.json — облако недоступно")
    cloud = build_cloud(data)
    try:
        supabase.storage.from_(COLMAP_BUCKET).upload(
            cached, json.dumps(cloud).encode(),
            file_options={"content-type": "application/json", "upsert": "true", "x-upsert": "true"},
        )
    except Exception:
        logger.warning("Не удалось закэшировать cloud.json для %s", scan_id)
    return _json_response(request, cloud)


# ─── загрузка обхода из приложения ───────────────────────────────────────────

# supabase==2.5.0 (storage3 0.7) читает заголовок x-upsert, новые версии — ключ upsert;
# передаём оба, чтобы повтор после обрыва не падал на «Duplicate».
MAX_FRAME_BYTES = 25 * 1024 * 1024      # 12 Мп JPEG 0.95 — 3–6 МБ, запас на 48 Мп
MAX_SCAN_JSON_BYTES = 40 * 1024 * 1024
# В colmap_photos.arkit кладём позу и то, что нужно карте/пайплайну. Точки
# облака туда не идут — они целиком лежат в scan.json в Storage.
ARKIT_KEYS = (
    "index", "timestamp", "width", "height", "intrinsics", "cameraTransform",
    "eulerAngles", "trackingState", "trackingReason", "worldMappingStatus",
    "exposureDuration", "exposureOffset", "ambientIntensity", "ambientColorTemperature",
    "sharpness", "motionBlurPx", "trackingSegment", "featurePointCount",
    "location", "heading", "device",
)


class ScanCreate(BaseModel):
    id: str
    title: Optional[str] = Field(None, max_length=200)
    captured_at: str
    frame_count: int = Field(..., ge=2, le=2000)
    duration_s: Optional[float] = None
    device_model: Optional[str] = Field(None, max_length=80)
    app_version: Optional[str] = Field(None, max_length=40)
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lon: Optional[float] = Field(None, ge=-180, le=180)
    loc_accuracy_m: Optional[float] = Field(None, ge=0)
    tracking_segments: Optional[int] = Field(None, ge=0, le=32767)
    frames_degraded: Optional[int] = Field(None, ge=0, le=32767)


def _uploaded_indexes(scan_id: str) -> list[int]:
    rows = (
        supabase.table("colmap_photos").select("frame_index").eq("scan_id", scan_id).execute()
    ).data or []
    return sorted({r["frame_index"] for r in rows if r.get("frame_index") is not None})


def _own_scan(scan_id: str, current_user: dict, cols: str = "id, user_id, status, frame_count, storage_prefix") -> dict:
    """Обход владельца (загружает только автор, даже суперадмин — чужие не трогает)."""
    try:
        sid = str(uuid.UUID(scan_id))
    except ValueError:
        raise HTTPException(400, "Некорректный id обхода")
    rows = (
        supabase.table("scans").select(cols).eq("id", sid).is_("deleted_at", "null").limit(1).execute()
    ).data
    if not rows or rows[0]["user_id"] != current_user["id"]:
        raise HTTPException(404, "Обход не найден")
    return rows[0]


@router.post("/", status_code=201)
def create_scan(body: ScanCreate, current_user: dict = Depends(get_current_user)):
    try:
        scan_id = str(uuid.UUID(body.id))
    except ValueError:
        raise HTTPException(400, "id обхода должен быть UUID")

    existing = (
        supabase.table("scans").select("id, user_id, status, frame_count").eq("id", scan_id).limit(1).execute()
    ).data
    meta = {
        "title":             (body.title or "").strip() or "Без названия",
        "frame_count":       body.frame_count,
        "duration_s":        body.duration_s,
        "device_model":      body.device_model,
        "app_version":       body.app_version,
        "lat":               body.lat,
        "lon":               body.lon,
        "loc_accuracy_m":    body.loc_accuracy_m,
        "tracking_segments": body.tracking_segments,
        "frames_degraded":   body.frames_degraded,
        "captured_at":       body.captured_at,
    }
    if existing:
        row = existing[0]
        if row["user_id"] != current_user["id"]:
            raise HTTPException(409, "Обход с таким id уже есть у другого пользователя")
        # повтор с телефона: обновляем метаданные (название могли поменять) и
        # говорим, какие кадры уже лежат на сервере
        supabase.table("scans").update(meta).eq("id", scan_id).execute()
        return {"id": scan_id, "status": row["status"], "uploaded": _uploaded_indexes(scan_id)}

    supabase.table("scans").insert({
        "id": scan_id,
        "user_id": current_user["id"],
        "status": "uploading",
        "storage_prefix": f"scans/{scan_id}",
        **meta,
    }).execute()
    return {"id": scan_id, "status": "uploading", "uploaded": []}


@router.put("/{scan_id}/frames/{index}")
async def upload_frame(
    scan_id: str,
    index: int,
    file: UploadFile = File(...),
    meta: str = Form("{}"),
    current_user: dict = Depends(get_current_user),
):
    scan = await asyncio.to_thread(_own_scan, scan_id, current_user)
    sid = scan["id"]
    if index < 0 or index >= scan["frame_count"]:
        raise HTTPException(400, f"Номер кадра вне обхода: {index}")

    # идемпотентность: кадр уже есть — отвечаем тем же, байты не льём повторно
    have = (
        await asyncio.to_thread(
            supabase.table("colmap_photos").select("id, public_url, thumb_url")
            .eq("scan_id", sid).eq("frame_index", index).limit(1).execute
        )
    ).data
    if have:
        return {"index": index, "id": have[0]["id"], "public_url": have[0]["public_url"], "duplicate": True}

    content = await file.read()
    if not content:
        raise HTTPException(400, "Пустой кадр")
    if len(content) > MAX_FRAME_BYTES:
        raise HTTPException(413, "Кадр больше 25 МБ")
    try:
        frame_meta = json.loads(meta or "{}")
        if not isinstance(frame_meta, dict):
            frame_meta = {}
    except ValueError:
        raise HTTPException(400, "meta — не JSON")

    arkit = {k: frame_meta[k] for k in ARKIT_KEYS if k in frame_meta}
    exif = frame_meta.get("exif") if isinstance(frame_meta.get("exif"), dict) else None

    prefix = scan["storage_prefix"]
    name = f"{index:03d}.jpg"
    storage_path = f"{prefix}/{name}"
    # оригинал — байт в байт (EXIF с фокусным нужен пайплайну), upsert: повтор
    # после обрыва между Storage и БД не падает на «уже существует»
    await asyncio.to_thread(
        supabase.storage.from_(COLMAP_BUCKET).upload,
        storage_path, content,
        file_options={"content-type": "image/jpeg", "upsert": "true", "x-upsert": "true"},
    )
    public_url = supabase.storage.from_(COLMAP_BUCKET).get_public_url(storage_path)

    thumb_path, thumb_url = None, public_url
    try:
        thumb = await asyncio.to_thread(make_thumbnail, content)
        thumb_path = f"{prefix}/{index:03d}_thumb.jpg"
        await asyncio.to_thread(
            supabase.storage.from_(COLMAP_BUCKET).upload,
            thumb_path, thumb,
            file_options={"content-type": "image/jpeg", "upsert": "true", "x-upsert": "true"},
        )
        thumb_url = supabase.storage.from_(COLMAP_BUCKET).get_public_url(thumb_path)
    except Exception:
        logger.warning("Миниатюра кадра %s/%s не сделалась", sid, index)
        thumb_path = None

    row = {
        "scan_id": sid, "frame_index": index,
        "storage_path": storage_path, "public_url": public_url,
        "thumb_storage_path": thumb_path, "thumb_url": thumb_url,
        "filename": name, "arkit": arkit, "exif": exif,
    }
    try:
        res = await asyncio.to_thread(supabase.table("colmap_photos").insert(row).execute)
    except Exception:
        # гонка двух одинаковых запросов при уникальном индексе (scan_id, frame_index)
        dup = (
            await asyncio.to_thread(
                supabase.table("colmap_photos").select("id, public_url")
                .eq("scan_id", sid).eq("frame_index", index).limit(1).execute
            )
        ).data
        if dup:
            return {"index": index, "id": dup[0]["id"], "public_url": dup[0]["public_url"], "duplicate": True}
        raise
    return {"index": index, "id": res.data[0]["id"], "public_url": public_url}


@router.post("/{scan_id}/complete")
async def complete_scan(
    scan_id: str,
    scan_json: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user),
):
    scan = await asyncio.to_thread(_own_scan, scan_id, current_user)
    sid = scan["id"]
    if scan_json is not None:
        raw = await scan_json.read()
        if len(raw) > MAX_SCAN_JSON_BYTES:
            raise HTTPException(413, "scan.json больше 40 МБ")
        await asyncio.to_thread(
            supabase.storage.from_(COLMAP_BUCKET).upload,
            f"{scan['storage_prefix']}/scan.json", raw,
            file_options={"content-type": "application/json", "upsert": "true", "x-upsert": "true"},
        )
    have = await asyncio.to_thread(_uploaded_indexes, sid)
    missing = [i for i in range(scan["frame_count"]) if i not in set(have)]
    if missing:
        return {"id": sid, "status": scan["status"], "missing": missing[:200], "uploaded": len(have)}
    if scan["status"] != "ready":
        await asyncio.to_thread(
            supabase.table("scans").update({"status": "ready"}).eq("id", sid).execute
        )
    return {"id": sid, "status": "ready", "missing": [], "uploaded": len(have)}
