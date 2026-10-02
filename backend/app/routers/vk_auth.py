"""Вход через VK ID — целиком на бэкенде.

Почему не через Supabase Auth, как Яндекс. VK ID (OAuth 2.1) при обмене кода на
токен требует параметр device_id, который приходит в адрес возврата. GoTrue его
дальше не передаёт, а профиль ВК отдаёт POST-запросом с нестандартными полями.
Поэтому обмен делаем сами, а сессию сайта выдаёт Supabase по одноразовому
токену входа (admin generate_link → verifyOtp на фронте).

Ход:
  1. Фронт (AuthContext.signInWithVk) придумывает случайную строку n, кладёт её
     в sessionStorage и уводит браузер на
       GET /api/auth/vk/start?h=<base64url(sha256(n))>
  2. /start собирает state (подписан, живёт 10 минут, внутри nonce и h) и
     уводит на страницу входа ВК. PKCE-verifier НЕ хранится нигде: он
     вычисляется из nonce и секрета сервера, наружу уходит только challenge.
  3. ВК возвращает на GET /api/auth/vk/callback?code=…&state=…&device_id=…
     Меняем код на токен, спрашиваем профиль, берём почту.
  4. Просим у Supabase одноразовый токен входа для этой почты (учётная запись
     создаётся, если её не было) и возвращаем браузер на
       /login?vk_ticket=<подписанный билет, 2 минуты>
  5. Фронт меняет билет на токен: POST /api/auth/vk/finish {ticket, n}.
     Билет отдаёт токен только тому, кто знает n — то есть тому же браузеру,
     который начинал вход. Это и защита от подмены входа (login CSRF), и
     причина, по которой токен входа не лежит в адресной строке.

Cookie не используются — на сайте их нет, и в Политике так и написано.
Токены ВК не сохраняются и не пишутся в лог: нужны на два запроса.
Почте из ВК доверяем как подтверждённой: вход по совпавшему адресу попадает в
уже существующую учётную запись.
"""
import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from ..config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/vk", tags=["auth"])

STATE_TTL = 600      # сек: сколько живёт начатый вход
TICKET_TTL = 120     # сек: сколько живёт билет на обмен
SCOPE = "vkid.personal_info email"


# ── подпись ──────────────────────────────────────────────────────────────────
# Отдельный ключ, выведенный из JWT-секрета: подписи отсюда нельзя выдать за
# токены сайта и наоборот.
def _key(purpose: str) -> bytes:
    return hmac.new(settings.supabase_jwt_secret.encode(), f"kb-vk:{purpose}".encode(), hashlib.sha256).digest()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


SIG_LEN = 43  # base64url от 32 байт без «=»


def _pack(purpose: str, payload: dict) -> str:
    """payload → строка только из a-z A-Z 0-9 _ - (такие требования у state ВК):
    base64url(json) + подпись фиксированной длины, без разделителей."""
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64(hmac.new(_key(purpose), body.encode(), hashlib.sha256).digest())
    return body + sig


def _unpack(purpose: str, token: str) -> dict:
    if not token or len(token) <= SIG_LEN:
        raise ValueError("пусто")
    body, sig = token[:-SIG_LEN], token[-SIG_LEN:]
    good = _b64(hmac.new(_key(purpose), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, good):
        raise ValueError("подпись")
    payload = json.loads(_unb64(body))
    if payload.get("exp", 0) < time.time():
        raise ValueError("срок")
    return payload


def _verifier(nonce: str) -> str:
    # 43 символа base64url — допустимая длина code_verifier (43–128)
    return _b64(hmac.new(_key("pkce"), nonce.encode(), hashlib.sha256).digest())


def _back(**params) -> RedirectResponse:
    """Возврат браузера на страницу входа сайта."""
    return RedirectResponse(f"{settings.site_url}/login?{urlencode(params)}", status_code=302)


# ── 1–2. Начало: уводим на ВК ────────────────────────────────────────────────
@router.get("/start")
def vk_start(h: str = Query(..., min_length=43, max_length=43, pattern=r"^[A-Za-z0-9_-]+$")):
    if not settings.vk_client_id:
        return _back(vk_error="off")
    nonce = secrets.token_urlsafe(24)
    state = _pack("state", {"n": nonce, "h": h, "exp": int(time.time()) + STATE_TTL})
    challenge = _b64(hashlib.sha256(_verifier(nonce).encode()).digest())
    query = urlencode({
        "response_type": "code",
        "client_id": settings.vk_client_id,
        "redirect_uri": settings.vk_redirect_uri,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "scope": SCOPE,
    })
    return RedirectResponse(f"{settings.vk_id_host}/authorize?{query}", status_code=302)


# ── 3–4. Возврат с ВК ────────────────────────────────────────────────────────
async def _vk_profile(code: str, device_id: str, state: str, verifier: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{settings.vk_id_host}/oauth2/auth", data={
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
            "client_id": settings.vk_client_id,
            "device_id": device_id,
            "redirect_uri": settings.vk_redirect_uri,
            "state": state,
        })
        tok = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        access = tok.get("access_token")
        if r.status_code != 200 or not access:
            # текст ошибки ВК — без токенов, его можно в лог
            logger.warning("vk auth: обмен кода HTTP %s %s", r.status_code, tok.get("error") or "")
            raise HTTPException(status_code=502, detail="exchange")

        r = await client.post(f"{settings.vk_id_host}/oauth2/user_info", data={
            "client_id": settings.vk_client_id,
            "access_token": access,
        }, headers={"Accept": "application/json"})
        info = r.json() if r.status_code == 200 else {}
        user = info.get("user") or info
        if r.status_code != 200 or not user.get("user_id"):
            logger.warning("vk auth: профиль HTTP %s", r.status_code)
            raise HTTPException(status_code=502, detail="profile")
        return user


async def _login_token(email: str, meta: dict) -> dict:
    """Одноразовый токен входа Supabase для этой почты. Учётной записи нет —
    GoTrue создаёт её сам (generate_link типа magiclink)."""
    base = settings.supabase_url.rstrip("/")
    headers = {"apikey": settings.supabase_service_key, "Authorization": f"Bearer {settings.supabase_service_key}"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{base}/auth/v1/admin/generate_link", headers=headers,
                              json={"type": "magiclink", "email": email, "data": meta})
    d = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    props = d.get("properties") or d
    token_hash = props.get("hashed_token")
    if r.status_code != 200 or not token_hash:
        logger.warning("vk auth: generate_link HTTP %s %s", r.status_code, d.get("msg") or d.get("error_code") or "")
        raise HTTPException(status_code=502, detail="session")
    return {"th": token_hash, "vt": props.get("verification_type") or "magiclink"}


@router.get("/callback")
async def vk_callback(
    code: str = "", state: str = "", device_id: str = "",
    error: str = "", error_description: str = "",
):
    if error or not code:
        # отказ на странице ВК или сбой на его стороне
        return _back(vk_error="denied" if error == "access_denied" else "vk")
    try:
        st = _unpack("state", state)
    except Exception:
        return _back(vk_error="state")   # чужой или протухший вход

    try:
        user = await _vk_profile(code, device_id, state, _verifier(st["n"]))
        email = (user.get("email") or "").strip().lower()
        if not email:
            # в аккаунте ВК нет почты либо человек снял галочку доступа к ней
            return _back(vk_error="noemail")
        name = " ".join(x for x in (user.get("first_name"), user.get("last_name")) if x).strip()
        tok = await _login_token(email, {"name": name, "vk_user_id": str(user["user_id"])})
    except HTTPException as e:
        return _back(vk_error=str(e.detail))
    except httpx.HTTPError as e:
        logger.warning("vk auth: сеть — %s", type(e).__name__)
        return _back(vk_error="net")

    ticket = _pack("ticket", {**tok, "h": st["h"], "exp": int(time.time()) + TICKET_TTL})
    return _back(vk_ticket=ticket)


# ── 5. Билет → токен входа ───────────────────────────────────────────────────
class Finish(BaseModel):
    ticket: str
    n: str


@router.post("/finish")
def vk_finish(body: Finish):
    try:
        t = _unpack("ticket", body.ticket)
    except Exception:
        raise HTTPException(status_code=400, detail="Вход устарел, начните заново")
    proof = _b64(hashlib.sha256(body.n.encode()).digest())
    if not hmac.compare_digest(proof, t.get("h", "")):
        # билет предъявил не тот браузер, который начинал вход
        raise HTTPException(status_code=403, detail="Вход начат в другом браузере")
    return {"token_hash": t["th"], "type": t["vt"]}
