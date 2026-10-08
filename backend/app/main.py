import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import apidocs
from .routers import admin, analyses, profile, scans, vk_auth, yandex_auth

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="Volumetric Gottland",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
    # Схема ОБЯЗАНА лежать под /api/: nginx проксирует на бэкенд только этот
    # префикс. С адресом по умолчанию (/openapi.json) страница /api/docs
    # открывалась, а схему получить не могла — на проде там был 404.
    openapi_url="/api/openapi.json",
    swagger_ui_oauth2_redirect_url=None,
    swagger_ui_parameters={
        "docExpansion": "list",            # разделы раскрыты, методы свёрнуты
        "defaultModelsExpandDepth": 0,     # блок схем внизу свёрнут
        "filter": True,                    # строка поиска по разделам
        "persistAuthorization": True,      # введённый токен переживает F5
    },
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # nginx ограничит снаружи
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyses.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
app.include_router(scans.router, prefix="/api")
app.include_router(admin.router, prefix="/api")         # настройки расчётного сервера
app.include_router(yandex_auth.router, prefix="/api")   # вход через Яндекс ID
app.include_router(vk_auth.router, prefix="/api")       # вход через VK ID


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "karelia-build-ai"}


# Описания методов для Swagger (что делает, куда ходит: БД, Storage, GPU).
# Вызывать ПОСЛЕ объявления всех маршрутов. На работу методов не влияет.
apidocs.install(app)

