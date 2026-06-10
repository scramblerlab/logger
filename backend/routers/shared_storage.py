import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from auth import verify_shared_token
from services import shared_storage_service as service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/shared", tags=["shared-storage"])


@router.get("/", response_model=list[service.FileMeta])
async def list_files(_: None = Depends(verify_shared_token)):
    return await service.list_files()


@router.put("/{filename}", response_model=service.FileMeta)
async def write_file(
    filename: str,
    request: Request,
    _: None = Depends(verify_shared_token),
):
    service.validate_filename(filename)
    body = await request.body()
    if len(body) > service.MAX_FILE_SIZE:
        raise HTTPException(
            413,
            f"File too large: {len(body)} bytes. Maximum is {service.MAX_FILE_SIZE} bytes (65 KB).",
        )
    content_type = request.headers.get("content-type", "").split(";")[0].strip()
    service.validate_content_type(content_type)
    try:
        return await service.write_file(filename, body, content_type)
    except asyncio.TimeoutError:
        raise HTTPException(503, "Write lock timed out — server too busy, retry in a moment.")


@router.get("/{filename}")
async def read_file(
    filename: str,
    _: None = Depends(verify_shared_token),
):
    service.validate_filename(filename)
    try:
        data, content_type = await service.read_file(filename)
    except asyncio.TimeoutError:
        raise HTTPException(503, "Read lock timed out — server too busy, retry in a moment.")
    return Response(content=data, media_type=content_type)


@router.delete("/{filename}", status_code=204)
async def delete_file(
    filename: str,
    _: None = Depends(verify_shared_token),
):
    service.validate_filename(filename)
    try:
        await service.delete_file(filename)
    except asyncio.TimeoutError:
        raise HTTPException(503, "Write lock timed out — server too busy, retry in a moment.")
