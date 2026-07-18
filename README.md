# Karelia Build AI — Полное руководство по запуску

## Архитектура

```
                    ┌──────────────────────────────────┐
User Browser ──────▶│  nginx (80)                      │
                    │  /        → React SPA (dist/)    │
                    │  /api/    → FastAPI (8000)        │
                    └──────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  FastAPI Backend     │
                    │  - JWT auth verify   │
                    │  - File upload       │
                    │  - n8n webhook call  │
                    │  - Polling endpoint  │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼───────────────┐
              ▼                ▼               ▼
        Supabase DB      Supabase        n8n Webhook
        (analyses,       Storage         (CLIP + Ollama
        profiles)        (photos)         pipeline)
```

---

## 1. Supabase — настройка

### 1.1 Создайте Storage bucket

В Supabase Dashboard → Storage → New Bucket:
- Name: `analysis-photos`
- Public: ✅ (чтобы фото были доступны по URL)

### 1.2 Выполните SQL схему

Dashboard → SQL Editor → вставьте содержимое `supabase/schema.sql` → Run.

Если нужна поддержка миниатюр (thumbnails):

```sql
-- supabase/migration_thumbnails.sql
```

### 1.3 Получите ключи

Dashboard → Settings → API:
- `URL` → `SUPABASE_URL` и `VITE_SUPABASE_URL`
- `anon` / `public` → `VITE_SUPABASE_ANON_KEY`
- `service_role` → `SUPABASE_SERVICE_KEY` (⚠️ только для backend!)
- Settings → API → JWT Secret → `SUPABASE_JWT_SECRET`

### 1.4 Email подтверждение (опционально)

Dashboard → Authentication → Email → отключить "Confirm email" если хотите без подтверждения.

---

## 2. Настройка .env

```bash
cp .env.example .env
# Заполните все переменные в .env
```

---

## 3. Запуск на VPS

### Требования
- Docker + Docker Compose v2
- 2GB RAM минимум
- Порт 80 открыт

### Запуск

```bash
git clone <your-repo>
cd VolumeWWW
cp .env.example .env
# заполнить .env

docker compose up --build -d

# Проверить логи
docker compose logs -f backend
docker compose logs -f frontend
```

### Обновление

```bash
git pull
docker compose up --build -d
```

---

## 4. Разработка локально

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env  # заполнить
uvicorn app.main:app --reload
# API: http://localhost:8000/api/docs
```

### Frontend
```bash
cd frontend
npm install
# Создайте frontend/.env.local:
# VITE_SUPABASE_URL=...
# VITE_SUPABASE_ANON_KEY=...
npm run dev
# http://localhost:5173
```

---

## 5. Структура проекта

```
VolumeWWW/
├── .env.example
├── docker-compose.yml
├── supabase/
│   ├── schema.sql                    ← SQL для Supabase
│   └── migration_thumbnails.sql      ← добавляет колонку thumbnail
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py                   ← FastAPI app, CORS, роутеры
│       ├── config.py                 ← настройки из env (pydantic-settings)
│       ├── auth.py                   ← проверка JWT через Supabase
│       ├── imaging.py                ← Pillow: обработка / миниатюры
│       ├── supabase_client.py        ← service-role клиент
│       └── routers/
│           ├── analyses.py           ← загрузка фото, n8n webhook, polling
│           └── profile.py            ← профиль пользователя
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── vite.config.js
    └── src/
        ├── api.js                    ← все fetch-вызовы к /api/*
        ├── supabase.js               ← Supabase anon клиент (только auth)
        ├── sw.js                     ← Service Worker (vite-plugin-pwa)
        ├── polyfills.js
        ├── context/
        │   └── AuthContext.jsx       ← глобальное auth-состояние
        ├── queue/
        │   ├── queue.js              ← offline-first очередь загрузки
        │   └── db.js                 ← IndexedDB backing store
        ├── theme/
        │   └── ThemeProvider.jsx     ← gothic "swag" тема
        ├── components/
        │   ├── Layout.jsx
        │   ├── PrivateRoute.jsx
        │   ├── Timer.jsx             ← таймер ожидания (до 1ч)
        │   ├── ReportPanel.jsx       ← рендер AI-результата
        │   ├── PlyViewer.jsx         ← lazy-обёртка Three.js PLY viewer
        │   ├── PlyViewerImpl.jsx     ← реализация (react-three-fiber/drei)
        │   ├── RaschetDownloadButton.jsx
        │   └── raschet/
        │       ├── RaschetDocument.jsx  ← PDF-отчёт (@react-pdf/renderer)
        │       ├── raschetData.js       ← формулы и константы расчётов
        │       ├── PdfDownload.jsx
        │       └── PdfPreview.jsx
        └── pages/
            ├── Login.jsx
            ├── Register.jsx
            ├── Analyze.jsx           ← главная: загрузка фото, polling
            ├── History.jsx           ← история анализов, авто-обновление
            ├── Profile.jsx
            ├── Privacy.jsx
            └── NotFound.jsx
```

---

## 6. Поток данных при анализе

```
1. Пользователь загружает фото → браузер сжимает до 1600px / JPEG 85%
2. Если оффлайн — фото попадает в IndexedDB очередь (queue/queue.js)
   и синхронизируется через Background Sync API (Chromium) или
   BroadcastChannel при следующем открытии вкладки
3. POST /api/analyses/ (multipart/form-data) → FastAPI
4. FastAPI загружает каждое фото в Supabase Storage, генерирует миниатюру
5. FastAPI создаёт запись analyses с status="pending"
6. FastAPI запускает background task: вызывает n8n webhook (timeout=1h)
7. Клиент получает {id, status:"pending"} и запускает polling
8. GET /api/analyses/{id} каждые 5 секунд
9. Клиент показывает таймер (00:00 → 60:00)
10. n8n отвечает → backend обновляет запись → status="completed"
11. Следующий poll показывает результат в ReportPanel
12. Доступен PDF-отчёт (raschet/) и 3D PLY-просмотр (PlyViewer)
```

---

## 7. API Endpoints

| Method | Path | Описание |
|--------|------|----------|
| POST | /api/analyses/ | Создать анализ, загрузить фото |
| GET | /api/analyses/ | Список всех анализов |
| GET | /api/analyses/{id} | Статус и результат (для polling) |
| DELETE | /api/analyses/{id} | Удалить анализ + фото |
| GET | /api/profile/ | Получить профиль |
| PUT | /api/profile/ | Обновить профиль |
| GET | /api/health | Health check |
| GET | /api/docs | Swagger UI |

---

## 8. Ключевые возможности фронтенда

- **Offline-first очередь** — фото ставятся в IndexedDB, автоматически отправляются при восстановлении сети. Cross-tab синхронизация через `BroadcastChannel`. `client_id` используется как будущий UUID анализа для идемпотентности.
- **Service Worker** (`sw.js`, vite-plugin-pwa) — обрабатывает сообщение `kb-flush` для триггера ручной очистки очереди.
- **PLY-просмотр** — `PlyViewer.jsx` lazy-загружает `PlyViewerImpl.jsx` с Three.js / react-three-fiber для рендера 3D-сетки.
- **PDF-отчёт** — `raschet/RaschetDocument.jsx` генерирует отчёт через `@react-pdf/renderer`; формулы и константы вынесены в `raschetData.js`.
- **Gothic тема** — `ThemeProvider.jsx` + компоненты `SwagAtmosphere`, `IntroVeil`, `Fracture` в `components/swag/`.
- **Code splitting** — каждая страница lazy-загружается; Login статически импортирован (LCP-страница).

---

## 9. HTTPS (рекомендуется для продакшн)

Используйте nginx reverse proxy с Let's Encrypt снаружи контейнера:

```bash
# На хосте установите certbot + nginx
# В docker-compose.yml поменяйте порт frontend с 80 на 8080
# Настройте хостовый nginx как proxy к localhost:8080
```

Или используйте Cloudflare Tunnel — самый простой вариант.

---

## 10. Известные ограничения

- Background tasks живут только пока жив процесс uvicorn. При рестарте сервера pending анализы зависнут. Для надёжности нужен Redis + Celery.
- Фото хранятся в Supabase Storage — free tier: 1GB.
