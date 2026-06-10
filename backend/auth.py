import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, HTTPException, Request
from jose import JWTError, jwt

_SECRET = os.getenv("JWT_SECRET", "")
_EXPIRE_DAYS = int(os.getenv("JWT_EXPIRE_DAYS", "30"))
_EDITORS_PATH = Path(__file__).parent / "editors.json"
_SHARED_STORAGE_TOKEN = os.getenv("SHARED_STORAGE_TOKEN", "")


def _load_editors() -> dict[str, str]:
    try:
        return json.loads(_EDITORS_PATH.read_text())
    except FileNotFoundError:
        return {}


def verify_credentials(email: str, password: str) -> bool:
    editors = _load_editors()
    stored = editors.get(email)
    if stored is None:
        return False
    return hmac.compare_digest(stored, password)


def create_access_token(email: str) -> tuple[str, datetime]:
    exp = datetime.now(timezone.utc) + timedelta(days=_EXPIRE_DAYS)
    token = jwt.encode(
        {"sub": email, "email": email, "exp": exp},
        _SECRET,
        algorithm="HS256",
    )
    return token, exp


def verify_token(token: str) -> str:
    if not _SECRET:
        raise HTTPException(500, "JWT_SECRET not configured")
    try:
        payload = jwt.decode(token, _SECRET, algorithms=["HS256"])
        email: str | None = payload.get("email") or payload.get("sub")
        if not email:
            raise HTTPException(401, "Invalid token claims")
        return email
    except JWTError:
        raise HTTPException(401, "Invalid or expired token")


async def get_current_user(request: Request) -> str:
    token = request.cookies.get("auth_token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    return verify_token(token)


async def verify_shared_token(request: Request) -> None:
    if not _SECRET:
        raise HTTPException(500, "JWT_SECRET not configured")
    if not _SHARED_STORAGE_TOKEN:
        raise HTTPException(500, "SHARED_STORAGE_TOKEN not configured")
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Authorization: Bearer <token> header required")
    token = auth.removeprefix("Bearer ")
    if not hmac.compare_digest(token, _SHARED_STORAGE_TOKEN):
        raise HTTPException(401, "Invalid shared storage token")
    try:
        payload = jwt.decode(token, _SECRET, algorithms=["HS256"],
                             options={"verify_exp": False})
        if payload.get("type") != "shared_storage":
            raise HTTPException(401, "Invalid token type claim")
        if payload.get("iss") != "scrambler-lab":
            raise HTTPException(401, "Invalid token issuer claim")
    except JWTError:
        raise HTTPException(401, "Invalid token signature")
