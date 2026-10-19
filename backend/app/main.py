import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import apidocs
from .routers import admin, analyses, profile, scans

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="Volumetric Gottland",
    version="1.0.0",
    # Штатные страницы документации выключены: Swagger подключает
    # apidocs.install(app) в конце файла — /api/docs, под паролем.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

# С 2026-10-19 сайт и API на разных доменах (volumetric… → api.volumetric…),
# и каждый вызов фронта — кросс-доменный: CORS теперь работает по-настоящему.
# "*" безопасен: вход — токен в заголовке Authorization, а не cookie, чужая
# страница его не подставит. max_age — браузер помнит ответ на предварительный
# OPTIONS 2 ч (больше Chrome не держит) и не гоняет его перед каждым опросом
# замера; по умолчанию было 10 мин.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=7200,
)

app.include_router(analyses.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
app.include_router(scans.router, prefix="/api")
app.include_router(admin.router, prefix="/api")         # настройки расчётного сервера


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "karelia-build-ai"}


# Swagger с описаниями методов (что делает, куда ходит: БД, Storage, GPU):
# /api/docs — страница с полем пароля, /api/openapi.json — схема, под паролем.
# Вызывать ПОСЛЕ объявления всех маршрутов. На работу самих методов не влияет.
apidocs.install(app)

