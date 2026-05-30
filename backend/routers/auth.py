from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

import auth as auth_module

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest):
    if not auth_module.verify_credentials(body.email, body.password):
        raise HTTPException(401, "Invalid credentials")
    token, exp = auth_module.create_access_token(body.email)
    response = JSONResponse({"email": body.email, "expires_at": exp.isoformat()})
    response.set_cookie(
        key="auth_token",
        value=token,
        httponly=True,
        samesite="strict",
        secure=True,
        max_age=auth_module._EXPIRE_DAYS * 86400,
        path="/",
    )
    return response


@router.post("/logout")
async def logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie(
        key="auth_token",
        path="/",
        httponly=True,
        samesite="strict",
        secure=True,
    )
    return response


@router.post("/verify")
async def verify(request: Request):
    token = request.cookies.get("auth_token")
    if not token:
        raise HTTPException(401, "Not authenticated")
    email = auth_module.verify_token(token)
    return {"valid": True, "email": email}
