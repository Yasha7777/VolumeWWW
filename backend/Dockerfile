# syntax=docker/dockerfile:1
FROM python:3.12-slim

WORKDIR /app

# Тот же приём, что во фронтовом Dockerfile: кеш колёс pip живёт в BuildKit
# cache-mount МЕЖДУ сборками, а не внутри слоя. Поэтому --no-cache-dir убран:
# он выключал ровно тот кеш, который мы теперь хотим переиспользовать, а на
# размер финального образа cache-mount не влияет (в слой он не пишется).
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

COPY app/ ./app/
COPY scripts/ ./scripts/

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
