-- ============================================================================
-- VOLMETRIC — СХЕМА ДЛЯ САЙТА, ОДНИМ ФАЙЛОМ.  Составлено 09.09.2026.
-- ----------------------------------------------------------------------------
-- Что делает: поднимает всё, без чего фронт+бэкенд сайта не отрабатывают на
-- 100% — profiles / analyses / colmap_photos, индексы, RLS, триггер профиля,
-- бакет Storage. Собрано из кода сайта (см. docs/ВосстановлениеБД_сайт.md,
-- там на каждую колонку указан файл и строка).
--
-- КАК ЗАПУСКАТЬ. Целиком, одним куском:
--   Supabase Studio → SQL Editor (/project/default/sql) → вставить → Run
-- либо на сервере:
--   docker compose exec -T db psql -U postgres -d postgres < INSTALL_site_schema.sql
--
-- Идемпотентно: всё под if not exists / drop-create / on conflict. Повторный
-- прогон безопасен, данные не трогает. CREATE INDEX CONCURRENTLY здесь НЕТ
-- намеренно — Studio оборачивает Run в транзакцию, и CONCURRENTLY в ней падает.
--
-- Этот файл ЗАМЕНЯЕТ ручной прогон шести трекаемых файлов (schema.sql,
-- migration_c2_schema_alignment.sql, migration_thumbnails.sql,
-- migration_photo_exif.sql, migration_client_id.sql, migration_profile_fields.sql).
-- Прогнать и то и другое тоже можно — результат тот же.
--
-- ⚠️ ЧЕГО ЗДЕСЬ НЕТ: таблицы dust3r_results (118 колонок) — это расчётная
--    часть, её ставит Analyz/migrations/INSTALL_from_scratch_2026-09-08.sql.
--    Без неё сайт ЗАПУСТИТСЯ и замер загрузится, но результат считать будет
--    некуда: строки останутся в status='pending'.
-- ============================================================================


-- ─── 0. Расширения ──────────────────────────────────────────────────────────
create extension if not exists pgcrypto;          -- gen_random_uuid()


-- ############################################################################
-- 1. profiles — профиль пользователя + признак суперадмина
-- ############################################################################
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text,
  company       text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  position      text,                             -- profile.py:42
  city          text,                             -- profile.py:43, analyses.py:877
  phone         text,                             -- profile.py:44
  emails        text[]  default '{}',             -- profile.py:45 — МАССИВ строк
  is_superadmin boolean default false             -- analyses.py:246 — права админа
);

-- Догоняем колонки, если таблица уже была создана старым schema.sql (там 5 колонок)
alter table public.profiles
  add column if not exists position      text,
  add column if not exists city          text,
  add column if not exists phone         text,
  add column if not exists emails        text[]  default '{}',
  add column if not exists is_superadmin boolean default false;


-- ############################################################################
-- 2. analyses — замер
-- ############################################################################
create table if not exists public.analyses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  title          text not null default 'Без названия',
  notes          text,
  photo_urls     text[] default '{}',
  status         text not null default 'pending'
                 check (status in ('pending','completed','error')),
  result         text,
  created_at     timestamptz default now(),
  completed_at   timestamptz,
  -- ── пишет сайт ────────────────────────────────────────────────────────────
  thumbnail_urls text[] default '{}',             -- analyses.py:634,761
  client_id      uuid,                            -- analyses.py:629 (идемпотентность очереди)
  -- ── пишет пайплайн (n8n / расчёт), сайт только ЧИТАЕТ ─────────────────────
  --    Без них ошибок не будет — вьюер и диагностика просто останутся пустыми.
  glb_url          text,                          -- Analyze.jsx:193
  ply_url          text,                          -- Analyze.jsx:194
  up_vector        jsonb,                         -- Analyze.jsx:199  (массив [x,y,z])
  up_vector_glb    jsonb,                         -- Analyze.jsx:200
  heatmap_top_url  text,                          -- Diagnostics.jsx:72
  heatmap_side_url text,                          -- Diagnostics.jsx:73
  cloud_top_url    text,                          -- Diagnostics.jsx:72
  cloud_side_url   text                           -- Diagnostics.jsx:73
);

-- Догоняем колонки, если таблица уже была создана старым schema.sql (там 9 колонок)
alter table public.analyses
  add column if not exists thumbnail_urls   text[] default '{}',
  add column if not exists client_id        uuid,
  add column if not exists glb_url          text,
  add column if not exists ply_url          text,
  add column if not exists up_vector        jsonb,
  add column if not exists up_vector_glb    jsonb,
  add column if not exists heatmap_top_url  text,
  add column if not exists heatmap_side_url text,
  add column if not exists cloud_top_url    text,
  add column if not exists cloud_side_url   text;

create index if not exists analyses_user_id_idx    on public.analyses(user_id);
create index if not exists analyses_created_at_idx on public.analyses(created_at desc);

-- Идемпотентность очереди: одна строка на (user_id, client_id).
-- Partial — прямой POST без client_id пишет NULL и конфликтовать не должен.
-- Без CONCURRENTLY: в Studio оно не выполнится, а на пустой БД не нужно.
create unique index if not exists analyses_user_client_uniq
  on public.analyses(user_id, client_id)
  where client_id is not null;


-- ############################################################################
-- 3. colmap_photos — по строке на кадр (оригинал + миниатюра + EXIF)
-- ############################################################################
create table if not exists public.colmap_photos (
  id                 uuid primary key default gen_random_uuid(),
  analyze_id         uuid not null references public.analyses(id) on delete cascade,
  storage_path       text not null,               -- analyses.py:738  {analysis_id}/{uuid}.jpg
  public_url         text not null,               -- analyses.py:739
  thumb_storage_path text,                        -- analyses.py:740  {analysis_id}/{uuid}_thumb.jpg
  thumb_url          text,                        -- analyses.py:741
  filename           text not null,               -- analyses.py:742
  created_at         timestamptz not null default now(),  -- держит ПОРЯДОК кадров
  exif               jsonb                        -- analyses.py:419
);

alter table public.colmap_photos
  add column if not exists thumb_storage_path text,
  add column if not exists thumb_url          text,
  add column if not exists exif               jsonb;

create index if not exists colmap_photos_analyze_id_idx
  on public.colmap_photos(analyze_id);


-- ############################################################################
-- 4. RLS
-- ----------------------------------------------------------------------------
-- Бэкенд ходит под service_role и RLS обходит; фронт в БД не ходит вообще
-- (frontend/src/supabase.js — только auth). Политики ниже — страховка на
-- случай, если кто-то придёт в PostgREST с anon/authenticated-токеном.
-- CREATE POLICY IF NOT EXISTS в Postgres нет, поэтому drop → create.
-- ############################################################################
alter table public.profiles      enable row level security;
alter table public.analyses      enable row level security;
alter table public.colmap_photos enable row level security;   -- политик нет: ходит только service_role

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

drop policy if exists "analyses_select_own" on public.analyses;
create policy "analyses_select_own" on public.analyses
  for select using (auth.uid() = user_id);

drop policy if exists "analyses_insert_own" on public.analyses;
create policy "analyses_insert_own" on public.analyses
  for insert with check (auth.uid() = user_id);

drop policy if exists "analyses_update_own" on public.analyses;
create policy "analyses_update_own" on public.analyses
  for update using (auth.uid() = user_id);

drop policy if exists "analyses_delete_own" on public.analyses;
create policy "analyses_delete_own" on public.analyses
  for delete using (auth.uid() = user_id);


-- ############################################################################
-- 5. Автосоздание профиля при регистрации — ОБЯЗАТЕЛЬНО
-- ----------------------------------------------------------------------------
-- Без триггера у нового пользователя не будет строки в profiles, и
-- analyses.py:246 (select is_superadmin) молча посчитает всех не-админами.
-- ############################################################################
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ############################################################################
-- 6. Storage — бакет colmap, ПУБЛИЧНЫЙ
-- ----------------------------------------------------------------------------
-- Имя зашито в коде: COLMAP_BUCKET (analyses.py:33, backfill_thumbnails.py:33),
-- переменной окружения для него нет. Публичность обязательна: браузер тянет
-- фото по прямым ссылкам из get_public_url (History.jsx:892).
-- Отдельные политики не нужны: пишет service_role, чтение публичное.
--
-- Бакет analysis-photos НЕ создавать: config.py:14 его объявляет, но значение
-- не используется нигде.
-- ############################################################################
-- Обёрнуто в проверку существования namespace'а Storage НАМЕРЕННО: Studio
-- выполняет весь скрипт ОДНОЙ транзакцией, и если контейнер storage не
-- поднят (storage.buckets нет), голый insert уронил бы и откатил ВСЁ
-- предыдущее — таблицы бы не создались. Так скрипт доходит до конца, а про
-- бакет говорит текстом.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice '⚠️  storage.buckets не найдена — Storage не установлен/не поднят. Бакет colmap создать отдельно, ПУБЛИЧНЫМ.';
  else
    insert into storage.buckets (id, name, public)
    values ('colmap', 'colmap', true)
    on conflict (id) do nothing;

    update storage.buckets set public = true where id = 'colmap';   -- если бакет уже был приватным

    raise notice '✅  бакет colmap на месте, public = true';
  end if;
end $$;


-- ############################################################################
-- 7. Сбросить кэш схемы PostgREST
-- ----------------------------------------------------------------------------
-- Иначе свежесозданные таблицы какое-то время отдают 404 на /rest/v1/...
-- ############################################################################
notify pgrst, 'reload schema';


-- ############################################################################
-- 8. ПРОВЕРКА — выполнить после установки
-- ############################################################################

-- 8.1. Все ли колонки на месте. Ожидается: profiles 10, analyses 19, colmap_photos 9.
select table_name, count(*) as колонок
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles','analyses','colmap_photos')
group by table_name
order by table_name;

-- 8.2. Индексы: analyses_user_id_idx, analyses_created_at_idx,
--      analyses_user_client_uniq, colmap_photos_analyze_id_idx (+ первичные ключи).
select tablename, indexname
from pg_indexes
where schemaname = 'public'
  and tablename in ('profiles','analyses','colmap_photos')
order by tablename, indexname;

-- 8.3. Триггер профиля на месте (должна вернуться 1 строка).
select tgname from pg_trigger where tgname = 'on_auth_user_created';

-- 8.4. Бакет публичный (public = true). Запускать ОТДЕЛЬНО от остального
--      скрипта: если Storage не установлен, запрос упадёт с «relation
--      storage.buckets does not exist» и в Studio откатит всю транзакцию.
-- select id, name, public from storage.buckets where id = 'colmap';


-- ############################################################################
-- 9. ПОСЛЕ УСТАНОВКИ — выдать себе права суперадмина
-- ----------------------------------------------------------------------------
-- В коде этот флаг не выставляет никто. Сначала зарегистрируйся на сайте
-- (строку в profiles создаст триггер), потом подставь свой email:
-- ############################################################################
-- update public.profiles set is_superadmin = true
-- where id = (select id from auth.users where email = 'ТВОЙ@EMAIL');
