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
- 2GB RAM минимум (для background tasks)
- Порт 80 открыт

### Запуск

```bash
git clone <your-repo>
cd karelia-ai
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
karelia-ai/
├── .env.example              ← шаблон переменных
├── docker-compose.yml
├── supabase/
│   └── schema.sql            ← SQL для Supabase
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py           ← FastAPI app
│       ├── config.py         ← настройки из env
│       ├── auth.py           ← проверка JWT
│       ├── supabase_client.py
│       └── routers/
│           ├── analyses.py   ← загрузка фото, n8n, polling
│           └── profile.py    ← профиль пользователя
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── vite.config.js
    └── src/
        ├── api.js            ← клиент к backend
        ├── supabase.js       ← клиент к Supabase
        ├── context/AuthContext.jsx
        ├── components/
        │   ├── Layout.jsx    ← header + footer
        │   ├── PrivateRoute.jsx
        │   └── Timer.jsx     ← таймер ожидания (до 1ч)
        └── pages/
            ├── Login.jsx
            ├── Register.jsx
            ├── Analyze.jsx   ← главная страница
            ├── History.jsx   ← история с авто-обновлением
            └── Profile.jsx
```

---

## 6. Поток данных при анализе

```
1. Пользователь загружает фото → браузер сжимает до 1600px / JPEG 85%
2. POST /api/analyses/ (multipart/form-data) → FastAPI
3. FastAPI загружает каждое фото в Supabase Storage
4. FastAPI создаёт запись analyses с status="pending"
5. FastAPI запускает background task: вызывает n8n webhook (timeout=1h)
6. Клиент получает {id, status:"pending"} и запускает polling
7. GET /api/analyses/{id} каждые 5 секунд
8. Клиент показывает таймер (00:00 → 60:00)
9. Background task получает ответ от n8n → обновляет запись → status="completed"
10. Следующий poll видит completed → показывает результат
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

## 8. HTTPS (рекомендуется для продакшн)

Используйте nginx reverse proxy с Let's Encrypt снаружи контейнера:

```bash
# На хосте установите certbot + nginx
# В docker-compose.yml поменяйте порт frontend с 80 на 8080
# Настройте хостовый nginx как proxy к localhost:8080
```

Или используйте Cloudflare Tunnel — самый простой вариант.

---

## 9. Известные ограничения

- Background tasks живут только пока жив процесс uvicorn. При рестарте сервера pending анализы зависнут. Для надёжности добавьте Redis + Celery (следующий шаг).
- Фото хранятся в Supabase Storage — учитывайте лимиты free tier (1GB).
