from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from auth import get_current_user
from services import web_extractor

router = APIRouter(prefix="/api/extract", tags=["extract"])


class ExtractRequest(BaseModel):
    url: str


class ExtractResponse(BaseModel):
    staging_slug: str
    title: str
    body: str
    hero_url: Optional[str] = None
    additional_urls: list[str] = []
    published_at: Optional[str] = None
    source_url: str


@router.post("/url", response_model=ExtractResponse)
async def extract_url(req: ExtractRequest, _: str = Depends(get_current_user)):
    try:
        result = await web_extractor.extract_article(req.url)
        return result
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
