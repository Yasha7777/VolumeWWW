"""
Генерация миниатюр для фото анализов.

Логика: 400px по длинной стороне, JPEG q75, EXIF-ориентация нормализована.
Со смартфона портретные снимки часто помечены EXIF-флагом «повернуть» —
без ImageOps.exif_transpose портрет ляжет боком.
Прогрессивный JPEG отдаётся браузеру постепенно, читается лучше на медленных сетях.
"""
from io import BytesIO
from PIL import Image, ImageOps

THUMB_MAX_SIDE = 400   # хватает для карточки истории и превью в PDF
THUMB_QUALITY = 75     # 75 — стандарт для web без видимых артефактов на фото


def make_thumbnail(content: bytes) -> bytes:
    """Возвращает JPEG-миниатюру. Кидает исключение, если content не картинка."""
    with Image.open(BytesIO(content)) as img:
        img = ImageOps.exif_transpose(img)  # ← критично для смартфонов
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img.thumbnail((THUMB_MAX_SIDE, THUMB_MAX_SIDE), Image.Resampling.LANCZOS)
        out = BytesIO()
        img.save(out, format="JPEG", quality=THUMB_QUALITY, optimize=True, progressive=True)
        return out.getvalue()
