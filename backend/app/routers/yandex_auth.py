"""Вход через Яндекс ID: прослойка профиля для Supabase Auth.

Supabase Auth (GoTrue, провайдер custom:yandex) после обмена кода на токен
запрашивает профиль пользователя по userinfo_url и ждёт в ответе стандартные
поля OIDC: sub, email, email_verified, name. Яндекс отдаёт свои: id,
default_email, real_name. Переименовать их настройкой провайдера нельзя:
attribute_mapping в GoTrue читает только поля, уже разобранные в структуру
Claims, а нестандартные отбрасываются раньше (проверено по исходникам
supabase/auth и на проде 2026-10-02: «Error getting user email from external
provider»). Поэтому userinfo_url провайдера указывает сюда:

  GET /api/auth/yandex-userinfo     Authorization: Bearer <токен Яндекса>

Секретов и состояния здесь нет: токен приходит от GoTrue, мы с ним один раз
идём в login.yandex.ru и возвращаем переименованный ответ. Токен не пишется
ни в лог, ни в БД.
"""
import logging

import httpx
from fastapi import APIRouter, Header, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

YANDEX_INFO_URL = "https://login.yandex.ru/info"


@router.get("/yandex-userinfo")
async def yandex_userinfo(authorization: str = Header(...)):
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() not in ("bearer", "oauth") or not token.strip():
        raise HTTPException(status_code=401, detail="Нет токена")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                YANDEX_INFO_URL,
                params={"format": "json"},
                # Яндекс ID ждёт схему OAuth, а не Bearer
                headers={"Authorization": f"OAuth {token.strip()}"},
            )
    except httpx.HTTPError as e:
        logger.warning("yandex userinfo: сеть — %s", type(e).__name__)
        raise HTTPException(status_code=502, detail="Яндекс не ответил")

    if r.status_code != 200:
        logger.warning("yandex userinfo: HTTP %s", r.status_code)
        raise HTTPException(status_code=401, detail="Яндекс не подтвердил токен")

    d = r.json()
    uid = d.get("id")
    if not uid:
        raise HTTPException(status_code=502, detail="В ответе Яндекса нет id")

    # default_email — адрес почтового ящика самого аккаунта Яндекса, владение
    # им подтверждено входом. Поэтому email_verified = true: вход привяжется к
    # уже существующей учётной записи с тем же адресом, а не создаст дубль.
    email = (d.get("default_email") or "").strip().lower()
    return {
        "sub": str(uid),
        "email": email,
        "email_verified": bool(email),
        "name": d.get("real_name") or d.get("display_name") or d.get("login") or "",
    }
