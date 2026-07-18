-- ============================================================
-- Миграция: миниатюры фото анализов (2026-07)
-- ------------------------------------------------------------
-- Запускать в: Supabase Dashboard → SQL Editor.
-- Безопасно катить на живой БД: только ADD COLUMN IF NOT EXISTS,
-- существующие данные не трогаются.
--
-- После миграции у старых записей thumbnail_urls будет '{}' —
-- фронт делает фолбэк на photo_urls (см. History.jsx).
-- Чтобы обновить старые записи полноценными миниатюрами,
-- прогони scripts/backfill_thumbnails.py (один раз).
-- ============================================================

-- Параллельный массив к analyses.photo_urls: тот же порядок,
-- тот же размер. Фронт берёт thumb для карточек, photo_urls
-- для лайтбокса и PDF-фотофиксации.
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS thumbnail_urls TEXT[] DEFAULT '{}';

-- В colmap_photos храним путь миниатюры отдельно — нужно при DELETE,
-- чтобы прибрать за собой в Storage.
ALTER TABLE public.colmap_photos
  ADD COLUMN IF NOT EXISTS thumb_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS thumb_url          TEXT;
