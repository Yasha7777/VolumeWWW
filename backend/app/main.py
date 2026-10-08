import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import apidocs
from .routers import admin, analyses, profile, scans, vk_auth, yandex_auth

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


# Swagger: /api/docs и /api/openapi.json, под паролем, с описаниями методов
# (что делает, куда ходит: БД, Storage, GPU). Вызывать ПОСЛЕ объявления всех
# маршрутов. На работу самих методов не влияет.
apidocs.install(app)

