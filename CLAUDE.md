# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Karelia Build AI** — web app for AI-powered photo analysis (body composition / building research). Users upload photos, the backend stores them in Supabase Storage, triggers an n8n webhook that runs a CLIP + Ollama pipeline, and polls for results.

## Commands

### Backend (FastAPI)
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
# Swagger UI: http://localhost:8000/api/docs
```

### Frontend (React + Vite)
```bash
cd frontend
npm install
# Create frontend/.env.local with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev        # http://localhost:5173
npm run build
npm run preview
```

### Docker (full stack)
```bash
docker compose up --build -d
docker compose logs -f backend
docker compose logs -f frontend
```

## Architecture

```
nginx (port 80)
  /        → React SPA (built dist/)
  /api/    → FastAPI backend (port 8000, internal)
```

**Backend** (`backend/app/`):
- `main.py` — FastAPI app, CORS, mounts routers at `/api`
- `config.py` — env-based settings (pydantic-settings)
- `auth.py` — JWT verification via Supabase JWT secret
- `supabase_client.py` — service-role Supabase client
- `routers/analyses.py` — upload photos → Supabase Storage → create DB record → background task calls n8n webhook (1h timeout) → polling endpoint. **Внимание:** `GET /analyses/{id}` делает `select("*")` (новые колонки приезжают сами), а `list_analyses` (`GET /analyses`) — ЯВНЫЙ список колонок. Добавил колонку в БД и забыл дописать её сюда → в истории поле пустое, и это выглядит как «пайплайн ничего не отдал».
  **КОНТРАКТ С n8n (изменён 2026-08-23): в вебхук НЕ уходят байты фото.** Payload лёгкий (десятки КБ): `meta.analysis_id`, `photos[]` (`{index, id, url, thumb_url, filename, exif, quality_score}` — `id` это строка `colmap_photos`, `url` — публичная ссылка на ОРИГИНАЛ), `best_photos[]`, плюс параллельные массивы `exif[]`/`photo_urls[]` для старых нод. Оригиналы воркфлоу тянет из БД/Storage сам. `best_photos` — 2 лучших кадра, отобранных ЗДЕСЬ по EXIF (`_photo_quality_score`: ISO + BrightnessValue, поровну; нет EXIF → 0.5, тай-брейк по порядку съёмки): раньше это считала Code-нода n8n, и от полной пачки base64 (~250 МБ на 50 кадров) он ложился. Не возвращай `photos_b64` — рабочая замена ноды лежит в `n8n/select-best-photos.js`. EXIF пишется в `colmap_photos.exif` (`supabase/migration_photo_exif.sql`), поэтому переживает rerun; бэкенд работает и без этой колонки (пишет фото без EXIF + warning в лог).
- `routers/profile.py` — user profile CRUD
- `imaging.py` — Pillow-based image processing / thumbnail generation

**Frontend** (`frontend/src/`):
- `api.js` — all fetch calls to `/api/*`
- `supabase.js` — Supabase anon client (auth only, frontend doesn't call DB directly)
- `context/AuthContext.jsx` — auth state, session management
- `pages/Analyze.jsx` — main page: photo upload, polling every 5s
- `prepareImage.js` — подготовка файла к отправке. **ИНВАРИАНТ: на сервер уходит ОРИГИНАЛ, байт в байт** (сам `File`, без пережатия/ресайза/пересохранения через canvas). Расчётный сервер берёт фокусное расстояние из EXIF; прежний ресайз до 1600 px + `canvas.toBlob` (3024×4032 → 1200×1600) срезал EXIF целиком → фокус разъезжался втрое (391..1238 px по кадрам одной съёмки) и калибровочный куб занимал 5-7 px вместо 20+. Canvas остался ТОЛЬКО для превью 1024 px (сетка миниатюр + фото в PDF); на сервер превью не уходит — там своя миниатюра отдельным объектом (`colmap_photos.thumb_url`). HEIC/HEIF пайплайн не читает → конвертируются в JPEG, но в ПОЛНОМ разрешении. Не возвращай сюда сжатие «чтобы было легче»: вес пачки решается загрузкой (nginx `client_max_body_size 2g` + `proxy_request_buffering off`), а не порчей исходника.
- `pages/History.jsx` — analysis history with auto-refresh
- `queue/queue.js` + `queue/db.js` — offline-first upload queue backed by IndexedDB; uses `BroadcastChannel` for cross-tab sync and Background Sync API (Chromium) for service-worker flush; `client_id` = future analysis UUID for idempotency
- `components/PlyViewer.jsx` / `PlyViewerImpl.jsx` — lazy-loaded Three.js PLY mesh viewer (react-three-fiber/drei)
- `components/plyAlign.js` — выравнивание облака/меша по «вверх». Если пайплайн прислал `up_vector`/`up_vector_glb` — применяется он. Иначе фолбэк: RANSAC находит опорную плоскость, а знак «вверх» выбирается по массе облака (насыпь существует только над землёй → нормаль смотрит в сторону массы точек). Не возвращай прежний «канонический знак» без учёта массы — из-за него насыпи вставали вверх дном. Плюс есть УНИВЕРСАЛЬНАЯ пост-проверка `needsFlip()` (работает и для up из пайплайна, и для фолбэка): после выравнивания в +Y смотрит центр масс по Y — если масса смещена в верх bbox, значит насыпь вверх дном → доворот 180° вокруг X. Не удаляй эту пост-проверку: без неё инвертированный `up_vector` из пайплайна снова переворачивает модели.
- `components/Diagnostics.jsx` + `diagnostics.css` — диагностика замера: карта высот и облако точек, сверху и сбоку (колонки `analyses.heatmap_top_url / heatmap_side_url / cloud_top_url / cloud_side_url`, публичные PNG 960×720, как `ply_url`). Пара «карта ↔ облако» показана шторкой: снято одной камерой в одном масштабе, и сдвиг границы показывает, что дырка в облаке на карте закрыта достройкой. **ИНВАРИАНТЫ, это не оформление:** (1) только `object-fit: contain` — в нижние ~96 px кадра вшиты подписи и цветовая шкала, любой `cover`/кроп их срежет; (2) пометки (пурпур #EC00C8 — затянутая дыра, красный #F02D2D — обрыв края) занимают от ОДНОЙ ячейки = 1 px, поэтому обязателен просмотр 1:1 и `image-rendering: pixelated` на увеличении — сглаживание размазывает их в фон, и картинка начинает врать; «Вписать» ограничен `min(100%, 960px)`, чтобы браузер не растягивал кадр выше 1:1. Все поля NULLABLE: нет ни одного — блока нет вовсе, есть часть — рисуем что есть. **Не путать с `thumbnail_urls`** (превью исходных фото). Числа (сколько ячеек достроено, % объёма, доля обрыва) лежат в `dust3r_results` и на фронт НЕ приезжают — не выдумывай их и не парси из текста результата.
- `components/raschet/` — PDF report generation via `@react-pdf/renderer`; `RaschetDocument.jsx` is the layout, `raschetData.js` holds formulas/constants
- `components/ReportPanel.jsx` — renders AI analysis result; `report-panel.css` styles it
- `sw.js` — service worker (vite-plugin-pwa); handles `kb-flush` message to trigger queue flush
- Theme system: `theme/ThemeProvider.jsx` (две темы: `light` | `dark`) + `theme-dark.css` (тёмная палитра) + `components/ThemeToggle.jsx` (переключатель в шапке). Готическая тема `gtc`/«swag» удалена 2026-08-13 вместе с `swag.css`, `components/swag/*` и `public/swag/*`; сохранённые в localStorage значения `gtc`/`swag` мигрируют в `dark`. Не возвращай третью тему.
- Code-split per page via `lazy()`; Login is statically imported (LCP page)

**Supabase** (`supabase/`):
- `schema.sql` — full DB schema (run in SQL Editor to initialize)
- `migration_thumbnails.sql` — adds thumbnail column
- Storage bucket: `analysis-photos` (public)

## Data Flow

1. User uploads photos → браузер отдаёт ОРИГИНАЛЫ без изменений (см. `prepareImage.js`); уменьшается только локальное превью
2. `POST /api/analyses/` → FastAPI uploads each photo to Supabase Storage (оригинал байт в байт + отдельная 400px-миниатюра), creates `analyses` record with `status="pending"`
3. FastAPI spawns background task: calls n8n webhook (up to 1h) — payload ЛЁГКИЙ: id замера, id/ссылки/EXIF кадров и 2 лучших кадра для зрительной модели; сами фото n8n берёт из Storage по ссылкам
4. Client polls `GET /api/analyses/{id}` every 5s, shows countdown timer
5. n8n responds → backend sets `status="completed"` with results
6. Next poll shows result

## Environment Variables

Backend (`.env`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_JWT_SECRET`, `N8N_WEBHOOK_URL`

Frontend build args / `frontend/.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Known Limitations

- Background tasks die with the uvicorn process — pending analyses hang on restart (Redis + Celery would fix this)
- Supabase Storage free tier: 1GB limit
- Воркфлоу n8n должен уметь качать кадры по ссылке из payload: байтов фото в вебхуке больше нет (см. контракт ниже). Пока нода не обновлена — зрительная модель не получит изображений
- Загрузка пачки — один большой POST: обрыв мобильной сети роняет весь замер целиком (нужна resumable/поштучная загрузка). Хуже того, при обрыве ПОСЛЕ создания строки `analyses` (пока идёт заливка в Storage) ретрай очереди попадёт в идемпотентность по `client_id` и получит уже созданную строку с пустым `photo_urls` → замер навсегда зависнет в `pending`

## Frontend Stack & Design

**Стек фронта:** React · @react-three/fiber · drei · three · Lenis (плавный скролл) · PWA-очередь (IndexedDB + BroadcastChannel + Background Sync) · Supabase · пайплайн n8n + DUSt3R.

**Дизайн-направление:** премиальный вид «на десятки тысяч $», карельский вайб.
Цвета: лес `#2f4a1c`, охра `#c98a24`, камень (нейтральный серый). Контурный (line/outline) мотив.

**Ключевые файлы hero/эффектов:**
- `frontend/src/pages/Analyze.jsx` — главная страница, hero
- `frontend/src/components/three/CubesHeroImpl.jsx` — 3D-эффект hero
- `frontend/src/styles.css` — глобальные стили

### Конвенция производительности для тяжёлых r3f-сцен

Hero-сцена `fixed inset:0` и монтируется на весь лайфтайм страницы — по умолчанию r3f
рендерит её 60fps ВЕЧНО, даже когда она за скроллом (`opacity:0`), пришпиливая GPU/main-
thread и тормозя весь остальной UI (форму загрузки и т.д.). Правила (эталон — `CubesHeroImpl.jsx`):

1. **Гейт рендера по видимости.** Переключай `<Canvas frameloop>` "always"↔"never" по границе
   видимости (переиспользуй scroll-fade, который и так рулит opacity). При "never" r3f не зовёт
   `useFrame` и не рендерит — авто-анимация замирает без ручных `invalidate()`. Позиции выводи из
   scroll-прогресса (stateless) → при возврате в кадр сцена продолжается без скачка/сброса.
2. **Dirty-check в `useFrame`.** Не пересчитывай и не перезаливай `instanceMatrix` каждый кадр:
   держи `lastE` (последний scroll-progress) и трогай буфер, только если он реально изменился.
   InstancedMesh с сотнями частиц → полная перезаливка 60/сек — самая частая утечка.
3. **Тени запекай, не считай покадрово.** `ContactShadows frames={1}` + обновление по КВАНТОВАННОМУ
   бакету скролла (`key={bucket}`, ≤~24 ремаунта на весь скролл), а не `frames={Infinity}`.
4. **Тяжёлый маунт-расчёт — в `requestIdleCallback`.** Sobel/normal-map и подобное не блокируй на
   первом paint; при подъезде карты пересоздавай материал через `key` (иначе шейдер не
   перекомпилится с новым define).
5. **Ассеты.** Текстуры — WebP, размер под реальный экранный (здесь 512 хватает; см.
   `public/textures/*.webp`). `dpr={[1,1.5]}` (не 2+). Мелкие повторяющиеся меши — в один InstancedMesh.
6. **Маунт не должен блокировать первый paint формы.** Форма загрузки — главное на странице.
   Монтируй `<Canvas>` ОТЛОЖЕННО (`requestAnimationFrame → requestIdleCallback`, флаг `canvasMounted`),
   а не синхронно на входе — иначе компиляция PBR-шейдеров тянется в кадр первого paint (лаг входа).
   Появление сцены прикрывай CSS fade-in (`.kb-hero3d-canvas` / `kbHeroFadeIn`).
7. **Одна компиляция шейдера, не две.** Не пересоздавай материал через `key`, когда доезжает
   отложенная карта (normal/rough) — это второй long-task на перекомпиляцию. Задавай слот СРАЗУ
   (плоская 1×1 заглушка `FLAT_NORMAL`), потом подменяй только `.normalMap`: обе текстуры non-null →
   тот же program cache key → без перекомпиляции.

Инвариант: оптимизируем КОГДА/СКОЛЬКО раз считаем кадр, вес ассетов, число draw calls и КОГДА
монтируем/компилируем сцену — визуал «сборки» (premium-эффект) при этом не меняем.

## Deploy / кэширование (nginx)

`frontend/nginx.conf` — политика кэша критична для PWA:
- `sw.js` → `Cache-Control: no-cache` (точный `location = /sw.js`)
- `index.html` → `no-cache, must-revalidate` (точный `location = /index.html`)
- `assets/*.js|css|...` (хеш в имени) → `immutable; expires 30d` (общий regex-локейшн)

НЕ вешай immutable на `sw.js`/`index.html`: это точки входа обновления, иначе после
деплоя браузер отдаёт старый бандл, ссылающийся на удалённые чанки → 404 → белый экран.

## Офлайн-очередь PWA (queue.js) — инварианты

`frontend/src/queue/queue.js` — единый источник правды для замеров до ухода на сервер.
- Статус элемента: `queued` → (`sending` только пока реально летит POST из этого таба) → удаление из IndexedDB при успехе, либо `error` после `MAX_ATTEMPTS`.
- **Офлайн `flushItem` НЕ выставляет `sending`** и сразу выходит — иначе элемент залипает в `sending` (был баг: не отправлялся после возврата сети).
- Отправку инициируют: `scheduleFlush()` (коалесцирует online/visibilitychange/kb-flush/старт) + `ensureSafetyNet()` (повтор каждые 10 c, пока есть работа и есть сеть).
- `requeueOrphans()` возвращает осиротевшие `sending` (после перезагрузки вкладки) в `queued`.
- Идемпотентность отправки — по `client_id` (== будущий id анализа); на бэке держится PK `analyses.id` + `supabase/migration_client_id.sql` (колонка + уникальный индекс).

Примечание: `supabase/schema.sql` отстаёт от рабочей БД (нет `client_id`, `thumbnail_urls`,
таблицы `colmap_photos` с её `exif`, бакет назван `analysis-photos`, хотя код пишет в `colmap`). Реальная
схема мигрирована на сервере вручную; сверяйся с кодом бэкенда, а не только со schema.sql.

## Workflow Rule

После каждой значимой правки дописывай строку в `PROGRESS.md`: что изменил и в каком файле.
Каждую запись начинай с даты в формате `[ГГГГ-ММ-ДД]`.
