-- ============================================================
-- Миграция C2: выравнивание схемы + защита идемпотентности (2026-07)
-- ------------------------------------------------------------
-- Запускать в: Supabase Dashboard → SQL Editor.
-- Идемпотентно и защитно. НЕ переписывает schema.sql / migration_thumbnails.sql.
--
-- НАЗНАЧЕНИЕ: код (backend/app/routers/analyses.py, scripts/backfill_thumbnails.py,
-- фронт Analyze.jsx) реально ожидает таблицу colmap_photos, колонку
-- analyses.client_id, уникальный индекс (user_id, client_id) и колонки
-- analyses.glb_url / ply_url — но в трекаемом SQL их не было. Из-за этого
-- чистая установка из schema.sql не поднималась, а без уникального индекса
-- «атомарная гарантия одной строки на client_id» (analyses.py:221) была ложной.
--
-- ВАЖНО (прод): таблица colmap_photos, колонки client_id/glb_url/ply_url и
-- уникальный индекс analyses_user_client_uniq в проде УЖЕ накачены руками.
-- Здесь всё под IF NOT EXISTS — на проде это no-op. Файл нужен прежде всего
-- для ЧИСТЫХ установок, чтобы трекаемая схема совпала с продом.
--
-- ВАЖНО (транзакции): CREATE INDEX CONCURRENTLY нельзя запускать внутри
-- транзакции — выполняй операторы по отдельности, не оборачивая в BEGIN/COMMIT.
-- ============================================================

-- A1. Таблица фото 3D-реконструкции. В проде УЖЕ существует → IF NOT EXISTS
--     здесь no-op; ценность в том, что чистая установка из трекаемого SQL
--     теперь поднимется. NOT NULL на public_url / filename / created_at
--     проставлены по факту прод-схемы (сверено), чтобы свежая установка
--     не разошлась с продом.
CREATE TABLE IF NOT EXISTS public.colmap_photos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analyze_id         UUID NOT NULL REFERENCES public.analyses(id) ON DELETE CASCADE,
  storage_path       TEXT NOT NULL,
  public_url         TEXT NOT NULL,
  thumb_storage_path TEXT,
  thumb_url          TEXT,
  filename           TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS colmap_photos_analyze_id_idx
  ON public.colmap_photos(analyze_id);

-- A2. Колонка идемпотентности. В проде УЖЕ существует (app в неё пишет) →
--     no-op; нужна для чистой установки.
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS client_id UUID;

-- A3. Колонки ссылок на 3D-модели. В проде УЖЕ существуют; их читает фронт
--     (Analyze.jsx:214-218), пишет пайплайн n8n напрямую. Фронт корректно
--     работает и без них (фолбэк на парсинг result). Добавлены для паритета
--     чистой установки с продом.
--     ПРИМЕЧАНИЕ: up_vector / up_vector_glb в проде НЕТ и пайплайн их не пишет —
--     поэтому здесь их НЕ заводим (фронт берёт up-вектор из текста result).
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS glb_url TEXT,
  ADD COLUMN IF NOT EXISTS ply_url TEXT;

-- A4. Уникальный индекс — ГЛАВНЫЙ фикс идемпотентности. Partial: только когда
--     client_id задан (прямой POST без client_id пишет NULL и не должен
--     конфликтовать). CONCURRENTLY — не блокирует запись на живой таблице.
--     ⚠️ ПЕРЕД созданием на «живой» БД сначала проверь дубли:
--         SELECT user_id, client_id, COUNT(*)
--         FROM public.analyses WHERE client_id IS NOT NULL
--         GROUP BY user_id, client_id HAVING COUNT(*) > 1;
--     При наличии дублей индекс НЕ создастся — сперва разведи дубли.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS analyses_user_client_uniq
  ON public.analyses(user_id, client_id)
  WHERE client_id IS NOT NULL;

-- ============================================================
-- ОТКАТ (в обратном порядке). На проде НЕ дропай таблицу/колонки с данными —
-- только индекс при необходимости. Дроп таблицы/колонок — лишь на чистой БД.
-- ------------------------------------------------------------
-- DROP INDEX CONCURRENTLY IF EXISTS analyses_user_client_uniq;
-- ALTER TABLE public.analyses DROP COLUMN IF EXISTS glb_url, DROP COLUMN IF EXISTS ply_url;
-- ALTER TABLE public.analyses DROP COLUMN IF EXISTS client_id;   -- только чистая БД
-- DROP TABLE IF EXISTS public.colmap_photos;                     -- только чистая БД
-- ============================================================
