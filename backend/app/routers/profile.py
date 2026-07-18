from fastapi import APIRouter, Depends
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


@router.put("/")
def update_profile(
    data: ProfileUpdate,
    current_user: dict = Depends(get_current_user),
):
    supabase.table("profiles").upsert(
        {
            "id":       current_user["id"],
            "name":     data.name,
            "company":  data.company,
            "position": data.position,
            "city":     data.city,
            "phone":    data.phone,
            "emails":   data.emails or [],
        }
    ).execute()
    return {"ok": True}
