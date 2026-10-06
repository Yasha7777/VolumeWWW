-- Настройки сервиса, которые правятся из интерфейса, а не из .env.
-- backend/app/gpu.py: строка key='gpu' хранит адрес расчётного сервера, режим
-- масштаба (cube | vio) и ключ доступа к приёмнику. Правит их суперадмин в
-- «Профиле» (backend/app/routers/admin.py).
--
-- Выполнить один раз в SQL-редакторе Supabase. Повторный запуск безопасен.
-- Пока таблицы нет, бэкенд работает по переменным окружения GPU_SERVER_URL /
-- GPU_MODE / GPU_TOKEN, а сохранение из админки отвечает «таблица не создана».

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

comment on table public.app_settings is
  'Настройки сервиса из админки. key=gpu: {url, mode, token} расчётного сервера';

-- В value лежит ключ доступа к расчётному серверу, поэтому наружу таблица
-- закрыта целиком: RLS включён, политик НЕТ намеренно. Читает и пишет только
-- бэкенд под service_role (он RLS обходит); anon и authenticated не видят
-- ничего — фронт в БД не ходит вообще, настройки отдаёт /api/admin/gpu.
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant all on public.app_settings to service_role;

-- PostgREST узнаёт о новой таблице после перечитывания схемы
notify pgrst, 'reload schema';
