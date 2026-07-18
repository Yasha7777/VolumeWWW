"""
Бэкфилл миниатюр v2.

Отличия от v1:
- Матчим фото не по URL (self-hosted Supabase может отдавать разные URL для
  одного и того же файла), а по индексу — сортируем colmap_photos по
  created_at ASC (порядок загрузки) и сопоставляем позиция-в-позицию
  с analyses.photo_urls.
- Skip-условие смотрит на colmap_photos.thumb_url (истинное состояние
  файлов в Storage), а не на analyses.thumbnail_urls, который в v1 мог
  быть заполнен фейковыми значениями (копией photo_urls).

Запуск:
    docker compose exec backend python -m scripts.backfill_thumbnails
"""
import sys
import logging
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.supabase_client import supabase           # noqa: E402
from app.imaging import make_thumbnail             # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
# httpx на INFO спамит каждым запросом — на 400+ анализов это тысячи строк
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

log = logging.getLogger("backfill")
COLMAP_BUCKET = "colmap"


def download_bytes(url: str, timeout: float = 30.0) -> bytes | None:
    try:
        with httpx.Client(timeout=timeout) as c:
            r = c.get(url)
            r.raise_for_status()
            return r.content
    except Exception as e:
        log.warning("не смог скачать %s: %s", url, e)
        return None


def process_photo(row: dict) -> str | None:
    """
    Обрабатывает одну строку colmap_photos. Возвращает thumb_url:
    существующий, новосозданный, или fallback на оригинал при ошибке.
    """
    if row.get("thumb_url"):
        return row["thumb_url"]

    origin_url = row.get("public_url")
    if not origin_url:
        return None

    content = download_bytes(origin_url)
    if not content:
        return origin_url

    try:
        thumb_bytes = make_thumbnail(content)
    except Exception as e:
        log.warning("Pillow не осилил %s: %s", row.get("filename"), e)
        return origin_url

    orig_path = row["storage_path"]
    if orig_path.lower().endswith((".jpg", ".jpeg")):
        thumb_path = orig_path.rsplit(".", 1)[0] + "_thumb.jpg"
    else:
        thumb_path = orig_path + "_thumb.jpg"

    try:
        supabase.storage.from_(COLMAP_BUCKET).upload(
            thumb_path,
            thumb_bytes,
            file_options={"content-type": "image/jpeg"},
        )
    except Exception as e:
        msg = str(e).lower()
        if "already exists" not in msg and "duplicate" not in msg and "409" not in msg:
            log.warning("upload %s failed: %s", thumb_path, e)
            return origin_url
        # уже есть — просто прописываем URL в БД

    thumb_url = supabase.storage.from_(COLMAP_BUCKET).get_public_url(thumb_path)

    supabase.table("colmap_photos").update({
        "thumb_storage_path": thumb_path,
        "thumb_url":          thumb_url,
    }).eq("id", row["id"]).execute()

    return thumb_url


def main():
    log.info("beginning backfill v2")

    analyses = supabase.table("analyses").select(
        "id, photo_urls"
    ).order("created_at", desc=False).execute().data or []

    total = len(analyses)
    log.info("нашёл %d анализов", total)

    updated = 0
    skipped = 0
    processed_photos = 0

    for i, a in enumerate(analyses, 1):
        aid = a["id"]
        photos = a.get("photo_urls") or []
        if not photos:
            skipped += 1
            continue

        # порядок = порядок загрузки (см. create_analysis в routers/analyses.py)
        rows = supabase.table("colmap_photos").select(
            "id, storage_path, public_url, thumb_storage_path, thumb_url, filename, created_at"
        ).eq("analyze_id", aid).order("created_at", desc=False).execute().data or []

        if not rows:
            log.warning("[%d/%d] %s: photo_urls=%d, но в colmap_photos пусто — пропускаю",
                        i, total, aid, len(photos))
            skipped += 1
            continue

        # если у всех строк уже есть thumb_url — считаем анализ готовым
        if all(r.get("thumb_url") for r in rows) and len(rows) >= len(photos):
            skipped += 1
            continue

        n = min(len(photos), len(rows))
        if n != len(photos):
            log.warning("[%d/%d] %s: несовпадение количеств (photo_urls=%d, colmap=%d), обработаю %d",
                        i, total, aid, len(photos), len(rows), n)

        log.info("[%d/%d] %s: %d фото", i, total, aid, n)

        new_thumbs = list(photos)  # старт — копия оригиналов, ниже перезапишем
        for j in range(n):
            thumb_url = process_photo(rows[j])
            if thumb_url:
                new_thumbs[j] = thumb_url
                processed_photos += 1

        supabase.table("analyses").update(
            {"thumbnail_urls": new_thumbs}
        ).eq("id", aid).execute()

        updated += 1

    log.info("готово. анализов обновлено: %d, пропущено: %d, фото обработано: %d",
             updated, skipped, processed_photos)


if __name__ == "__main__":
    main()
