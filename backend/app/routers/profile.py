import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from ..auth import get_current_user
from ..supabase_client import supabase

router = APIRouter(prefix="/profile", tags=["profile"])


class ProfileUpdate(BaseModel):
    name:     Optional[str]       = None
    company:  Optional[str]       = None
    position: Optional[str]       = None
    city:     Optional[str]       = None
    phone:    Optional[str]       = None
    emails:   Optional[List[str]] = None


@router.get("/")
def get_profile(current_user: dict = Depends(get_current_user)):
    res = (
        supabase.table("profiles")
        .select("*")
        .eq("id", current_user["id"])
        .single()
        .execute()
    )
    return res.data or {}


# Те же правила, что в форме (frontend/src/pages/Profile.jsx): форму можно
# обойти прямым запросом, а на эти адреса сервис отправляет отчёты.
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$")
MAX_EMAILS = 5


def _clean_phone(value: Optional[str]) -> Optional[str]:
    """Пусто — None. Иначе российский номер: 11 цифр, +7 и код с 3/4/8/9."""
    digits = re.sub(r"\D", "", value or "")
    if len(digits) <= 1:
        return None
    if digits[0] == "8":
        digits = "7" + digits[1:]
    if len(digits) != 11 or not re.match(r"^7[3489]", digits):
        raise HTTPException(status_code=400, detail="Номер телефона указан неверно: нужен российский номер, +7 и 10 цифр")
    return f"+7 ({digits[1:4]}) {digits[4:7]}-{digits[7:9]}-{digits[9:11]}"


def _clean_emails(values: Optional[List[str]]) -> List[str]:
    out: List[str] = []
    for raw in values or []:
        v = (raw or "").strip()
        if not v:
            continue
        if len(v) > 254 or not EMAIL_RE.match(v):
            raise HTTPException(status_code=400, detail=f"Адрес почты указан с ошибкой: {v[:60]}")
        if v.lower() not in (e.lower() for e in out):   # повторы молча убираем
            out.append(v)
    if len(out) > MAX_EMAILS:
        raise HTTPException(status_code=400, detail=f"Адресов для результатов может быть не больше {MAX_EMAILS}")
    return out


@router.put("/")
def update_profile(
    data: ProfileUpdate,
    current_user: dict = Depends(get_current_user),
):
    phone = _clean_phone(data.phone)
    emails = _clean_emails(data.emails)
    supabase.table("profiles").upsert(
        {
            "id":       current_user["id"],
            "name":     data.name,
            "company":  data.company,
            "position": data.position,
            "city":     data.city,
            "phone":    phone,
            "emails":   emails,
        }
    ).execute()
    return {"ok": True}
