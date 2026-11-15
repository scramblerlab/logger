"""Serve per-article static files (images, hero) with a visibility check.

Replaces a bare StaticFiles mount that served everything under articles/<slug>/
to anyone who knew the slug — including article.json (full body + guestVisible)
and the images of hidden articles. The frontend loads article *content* through
/api/articles/{slug} (which enforces visibility) and only images from here.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_optional_user
from database import get_db
from models import Article
from services import storage

router = APIRouter(prefix="/static/articles", tags=["static"])


@router.get("/{slug}/{path:path}")
async def serve_article_file(
    slug: str,
    path: str,
    db: AsyncSession = Depends(get_db),
    viewer: str | None = Depends(get_optional_user),
):
    # Never serve the raw JSON: it carries the full body and the guestVisible flag,
    # and the frontend never reads it over HTTP.
    if path == "article.json" or path.endswith("/article.json"):
        raise HTTPException(404, "Not found")

    # Guests may only read files of a guest-visible, saved article. Editors may
    # additionally read files under slugs that are not saved articles — e.g. the
    # staging_<uuid> folders the URL extractor writes for its preview.
    row = (await db.execute(
        select(Article.guest_visible).where(Article.slug == slug)
    )).first()
    if row is None:
        if viewer is None:
            raise HTTPException(404, "Not found")
    elif viewer is None and not row[0]:
        raise HTTPException(404, "Not found")

    # Containment check (blocks ../ and absolute paths) + must be a real file.
    target = storage.safe_article_path(slug, path)
    if target is None or not target.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(target)
