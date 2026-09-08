-- ============================================================
-- Миграция: колонки profiles, которых не было в трекаемом SQL (2026-09-08)
-- ------------------------------------------------------------
-- Запускать в: Supabase Dashboard → SQL Editor.
-- Безопасно катить на живой БД: только ADD COLUMN IF NOT EXISTS,
-- существующие данные не трогаются. На проде, скорее всего, no-op —
-- эти колонки там заведены руками (иначе профиль и права админа
-- не работали бы вовсе).
--
-- ЗАЧЕМ. schema.sql заводит profiles с четырьмя полями (id, name,
-- company, created_at/updated_at), а код читает и пишет ещё пять:
--
--   position       backend/app/routers/profile.py:42   (upsert)
--   city           backend/app/routers/profile.py:43   (upsert)
--                  backend/app/routers/analyses.py:877 (select для админ-селектора)
--   phone          backend/app/routers/profile.py:44   (upsert)
--   emails         backend/app/routers/profile.py:45   (upsert, СПИСОК строк)
--                  backend/app/routers/analyses.py:768,777 (кому слать письмо из n8n)
--   is_superadmin  backend/app/routers/analyses.py:246,251 (единственный признак прав)
--
-- Чистая установка без этих колонок ломается не «немножко», а по местам,
-- которые видно не сразу:
--   • PUT /api/profile/ падает на upsert целиком — профиль не сохраняется;
--   • is_superadmin: _is_superadmin() ловит ЛЮБОЕ исключение и возвращает
--     False (analyses.py:252-254), поэтому админ молча становится обычным
--     пользователем — без ошибки в интерфейсе.
--
-- ⚠️ ТИПЫ ВЫВЕДЕНЫ ИЗ КОДА, а не сняты с прод-схемы (её дампа не осталось).
--    Проверить на живой БД и, если разойдётся, править ЗДЕСЬ:
--      select column_name, data_type, is_nullable, column_default
--      from information_schema.columns
--      where table_schema = 'public' and table_name = 'profiles'
--      order by ordinal_position;
--    Ожидаемо 10 колонок.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS position      TEXT,
  ADD COLUMN IF NOT EXISTS city          TEXT,
  ADD COLUMN IF NOT EXISTS phone         TEXT,
  -- ProfileUpdate.emails: Optional[List[str]] (profile.py:17), в БД уходит
  -- `data.emails or []` — то есть массив строк, а не JSON и не одна строка.
  ADD COLUMN IF NOT EXISTS emails        TEXT[] DEFAULT '{}',
  -- Бэкенд читает через bool(res.data.get("is_superadmin")), так что NULL
  -- эквивалентен false. DEFAULT false — чтобы это было явно и в БД.
  ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN DEFAULT false;

-- Первый суперадмин заводится ТОЛЬКО руками — в коде нет ни одного места,
-- которое выставляет этот флаг:
--   update public.profiles set is_superadmin = true
--   where id = (select id from auth.users where email = 'admin@example.com');
