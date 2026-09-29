-- Загрузка обходов из приложения VolmetricARKit (≥ 5): backend/app/routers/scans.py
-- Идемпотентность по кадру: один кадр обхода — одна строка. Код переживает и без
-- индекса (проверяет перед вставкой), индекс закрывает гонку двух одинаковых
-- запросов с телефона на плохой связи.
create unique index if not exists colmap_photos_scan_frame_uidx
  on public.colmap_photos (scan_id, frame_index)
  where scan_id is not null;

-- Быстрый список обходов пользователя за период (GET /api/scans/?from&to).
create index if not exists scans_user_captured_idx
  on public.scans (user_id, captured_at desc)
  where deleted_at is null;
