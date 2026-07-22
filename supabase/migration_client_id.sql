-- ============================================================
-- Karelia Build AI — миграция: client_id + идемпотентность очереди
-- Запустить в: Supabase Dashboard → SQL Editor (безопасно повторно).
-- ============================================================
--
-- Зачем. Офлайн-очередь PWA (frontend/src/queue/queue.js) при постановке
-- замера генерит UUID и шлёт его как client_id (backend: routers/analyses.py).
-- Этот же UUID становится id анализа. Повторная отправка того же замера
-- (двойной сабмит / ретрай очереди / гонка flushAll / потеря ответа при уже
-- созданной строке) не должна плодить дубли.
--
-- Де-факто гарантию «одна строка на замер» уже даёт PRIMARY KEY на analyses.id
-- (id == client_id), поэтому второй insert с тем же id ловит конфликт PK, и
-- бэкенд возвращает существующую строку. Этот файл лишь приводит СХЕМУ в
-- соответствие с кодом (колонка client_id) и добавляет явный уникальный
-- индекс (user_id, client_id), на который ссылаются комментарии в analyses.py.

-- 1. Колонка client_id (бэкенд её пишет при insert)
ALTER TABLE public.analyses
  ADD COLUMN IF NOT EXISTS client_id UUID;

-- 2. Уникальность (user_id, client_id) — только для непустых client_id.
--    Частичный индекс: старые записи без client_id (NULL) не конфликтуют.
CREATE UNIQUE INDEX IF NOT EXISTS analyses_user_client_uniq
  ON public.analyses(user_id, client_id)
  WHERE client_id IS NOT NULL;
