import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import WebPushSubscription
from auth import get_current_user
from services.push_service import get_vapid_public_key

router = APIRouter(prefix="/api/push", tags=["push"])


class SubscribeBody(BaseModel):
    endpoint: str
    keys: dict  # {"p256dh": str, "auth": str}
    expirationTime: float | None = None


class UnsubscribeBody(BaseModel):
    endpoint: str


@router.get("/vapid-key")
async def vapid_key():
    """Return the VAPID public key for browser applicationServerKey."""
    key = get_vapid_public_key()
    if not key:
        raise HTTPException(503, "Push not configured — run VAPID key generation first")
    return {"publicKey": key}


@router.post("/subscribe", status_code=204)
async def subscribe(
    body: SubscribeBody,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Save or refresh a Web Push subscription (auth required)."""
    p256dh = body.keys.get("p256dh", "")
    auth = body.keys.get("auth", "")
    if not p256dh or not auth:
        raise HTTPException(400, "Missing p256dh or auth key")

    existing = (
        await db.execute(
            select(WebPushSubscription).where(WebPushSubscription.endpoint == body.endpoint)
        )
    ).scalar_one_or_none()

    if existing:
        existing.p256dh = p256dh
        existing.auth = auth
    else:
        db.add(WebPushSubscription(
            id=str(uuid.uuid4()),
            endpoint=body.endpoint,
            p256dh=p256dh,
            auth=auth,
        ))
    await db.commit()


@router.post("/unsubscribe", status_code=204)
async def unsubscribe(
    body: UnsubscribeBody,
    db: AsyncSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """Remove a Web Push subscription."""
    await db.execute(
        delete(WebPushSubscription).where(WebPushSubscription.endpoint == body.endpoint)
    )
    await db.commit()
