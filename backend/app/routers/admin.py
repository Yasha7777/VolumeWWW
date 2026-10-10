"""Админка суперпользователя: настройки расчётного сервера (GPU).

  GET  /api/admin/gpu         текущие адрес, режим масштаба и «задан ли ключ»
  PUT  /api/admin/gpu         сохранить адрес / режим Cube|VIO / ключ доступа
  POST /api/admin/gpu/check   проверить связь с приёмником (расчёт не запускает)
  GET  /api/admin/docs-password  пароль к странице Swagger (/api/docs)

Права — только profiles.is_superadmin, и проверяются ЗДЕСЬ: панель в «Профиле»
всего лишь UI, прямой запрос от обычного пользователя получает 403.

Ключ доступа в браузер не возвращается никогда — только признак «задан» и
последние 4 символа, чтобы отличить один ключ от другого.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from .. import gpu
from ..apidocs import DOCS_PASSWORD, DOCS_URL
from ..auth import get_current_user
from .analyses import _is_superadmin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])


def require_superadmin(current_user: dict = Depends(get_current_user)) -> dict:
    if not _is_superadmin(current_user["id"]):
        raise HTTPException(403, "Только для администратора")
    return current_user


class GpuSettingsUpdate(BaseModel):
    url: str = Field(..., max_length=500)
    mode: str = Field("cube", max_length=10)
    # None — ключ не трогаем; строка — заменить; "" — стереть
    token: Optional[str] = Field(None, max_length=200)


class GpuCheckRequest(BaseModel):
    # Пусто — проверяем то, что сохранено. Заполнено — проверяем введённое,
    # ещё не сохраняя: чтобы не записать в настройки адрес с опечаткой.
    url: Optional[str] = Field(None, max_length=500)
    token: Optional[str] = Field(None, max_length=200)


@router.get("/gpu")
def get_gpu_settings(_: dict = Depends(require_superadmin)):
    return gpu.public_settings(gpu.load_gpu_settings())


@router.put("/gpu")
def update_gpu_settings(data: GpuSettingsUpdate, user: dict = Depends(require_superadmin)):
    mode = str(data.mode or "").strip().lower()
    if mode not in gpu.MODES:
        raise HTTPException(400, "Режим масштаба: cube или vio")
    try:
        saved = gpu.save_gpu_settings(data.url, mode, data.token, user["id"])
    except ValueError as exc:                      # адрес с ошибкой
        raise HTTPException(400, str(exc))
    except gpu.SettingsStorageMissing as exc:      # миграция не применена
        raise HTTPException(503, str(exc))
    logger.info("GPU-настройки изменил %s: %s, режим %s, ключ %s",
                user["id"], saved["url"], saved["mode"],
                "задан" if saved["token"] else "не задан")
    return gpu.public_settings(saved)


@router.post("/gpu/check")
async def check_gpu(data: GpuCheckRequest, _: dict = Depends(require_superadmin)):
    saved = gpu.load_gpu_settings()
    url = (data.url or "").strip() or saved["url"]
    token = saved["token"] if data.token is None else data.token.strip()
    if not url:
        raise HTTPException(400, "Адрес расчётного сервера не задан")
    try:
        return await gpu.check_gpu(url, token)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/docs-password")
def get_docs_password(response: Response, _: dict = Depends(require_superadmin)):
    # Пароль зашит в apidocs.py и во фронт НЕ копируется: бандл публичный, и
    # пароль из него прочитал бы любой. Панель «Swagger» в «Профиле» берёт его здесь.
    response.headers["Cache-Control"] = "no-store"
    return {"password": DOCS_PASSWORD, "docs_url": DOCS_URL}
