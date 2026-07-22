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
- `routers/analyses.py` — upload photos → Supabase Storage → create DB record → background task calls n8n webhook (1h timeout) → polling endpoint
- `routers/profile.py` — user profile CRUD
- `imaging.py` — Pillow-based image processing / thumbnail generation

**Frontend** (`frontend/src/`):
- `api.js` — all fetch calls to `/api/*`
- `supabase.js` — Supabase anon client (auth only, frontend doesn't call DB directly)
- `context/AuthContext.jsx` — auth state, session management
- `pages/Analyze.jsx` — main page: photo upload, client-side resize to 1600px/JPEG 85%, polling every 5s
- `pages/History.jsx` — analysis history with auto-refresh
- `queue/queue.js` + `queue/db.js` — offline-first upload queue backed by IndexedDB; uses `BroadcastChannel` for cross-tab sync and Background Sync API (Chromium) for service-worker flush; `client_id` = future analysis UUID for idempotency
- `components/PlyViewer.jsx` / `PlyViewerImpl.jsx` — lazy-loaded Three.js PLY mesh viewer (react-three-fiber/drei)
- `components/plyAlign.js` — выравнивание облака/меша по «вверх». Если пайплайн прислал `up_vector`/`up_vector_glb` — применяется он. Иначе фолбэк: RANSAC находит опорную плоскость, а знак «вверх» выбирается по массе облака (насыпь существует только над землёй → нормаль смотрит в сторону массы точек). Не возвращай прежний «канонический знак» без учёта массы — из-за него насыпи вставали вверх дном.
- `components/raschet/` — PDF report generation via `@react-pdf/renderer`; `RaschetDocument.jsx` is the layout, `raschetData.js` holds formulas/constants
- `components/ReportPanel.jsx` — renders AI analysis result; `report-panel.css` styles it
- `sw.js` — service worker (vite-plugin-pwa); handles `kb-flush` message to trigger queue flush
- Theme system: `theme/ThemeProvider.jsx` + gothic "swag" theme (SwagAtmosphere, IntroVeil, Fracture components)
- Code-split per page via `lazy()`; Login is statically imported (LCP page)

**Supabase** (`supabase/`):
- `schema.sql` — full DB schema (run in SQL Editor to initialize)
- `migration_thumbnails.sql` — adds thumbnail column
- Storage bucket: `analysis-photos` (public)

## Data Flow

1. User uploads photos → browser compresses to 1600px / JPEG 85%
2. `POST /api/analyses/` → FastAPI uploads each photo to Supabase Storage, creates `analyses` record with `status="pending"`
3. FastAPI spawns background task: calls n8n webhook (up to 1h)
4. Client polls `GET /api/analyses/{id}` every 5s, shows countdown timer
5. n8n responds → backend sets `status="completed"` with results
6. Next poll shows result

## Environment Variables

Backend (`.env`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_JWT_SECRET`, `N8N_WEBHOOK_URL`

Frontend build args / `frontend/.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Known Limitations

- Background tasks die with the uvicorn process — pending analyses hang on restart (Redis + Celery would fix this)
- Supabase Storage free tier: 1GB limit

## Frontend Stack & Design

**Стек фронта:** React · @react-three/fiber · drei · three · Lenis (плавный скролл) · PWA-очередь (IndexedDB + BroadcastChannel + Background Sync) · Supabase · пайплайн n8n + DUSt3R.

**Дизайн-направление:** премиальный вид «на десятки тысяч $», карельский вайб.
Цвета: лес `#2f4a1c`, охра `#c98a24`, камень (нейтральный серый). Контурный (line/outline) мотив.

**Ключевые файлы hero/эффектов:**
- `frontend/src/pages/Analyze.jsx` — главная страница, hero
- `frontend/src/components/three/CubesHeroImpl.jsx` — 3D-эффект hero
- `frontend/src/styles.css` — глобальные стили

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
таблицы `colmap_photos`, бакет назван `analysis-photos`, хотя код пишет в `colmap`). Реальная
схема мигрирована на сервере вручную; сверяйся с кодом бэкенда, а не только со schema.sql.

## Workflow Rule

После каждой значимой правки дописывай строку в `PROGRESS.md`: что изменил и в каком файле.
Каждую запись начинай с даты в формате `[ГГГГ-ММ-ДД]`.
