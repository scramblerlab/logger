import asyncio
import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from slugify import slugify

from database import get_db
from models import Article, Tag
from schemas import ImportAnalyzeRequest, ImportAnalyzeResponse, ImportRunRequest
from services import wp_importer, storage

router = APIRouter(prefix="/api/import", tags=["import"])


@router.post("/analyze", response_model=ImportAnalyzeResponse)
async def analyze_site(req: ImportAnalyzeRequest):
    result = await wp_importer.analyze(req.url)
    return ImportAnalyzeResponse(**result)


@router.post("/run")
async def run_import(req: ImportRunRequest, db: AsyncSession = Depends(get_db)):
    """SSE stream of import progress."""

    async def event_stream():
        imported = 0
        async for event in wp_importer.import_articles(
            req.url, limit=req.limit, auto_classify=req.auto_classify
        ):
            if event["type"] == "progress":
                data = json.dumps({"done": event["done"], "total": event["total"], "current": event["current_title"]})
                yield f"data: {data}\n\n"

            elif event["type"] == "article":
                art = event["data"]
                try:
                    article = Article(
                        slug=art["slug"],
                        title=art["title"],
                        body=art.get("body", ""),
                        hero_image=art.get("hero_image"),
                        categories=json.dumps(art.get("categories", []), ensure_ascii=False),
                        tags=json.dumps(art.get("tags", []), ensure_ascii=False),
                        published_at=datetime.fromisoformat(art["published_at"]) if art.get("published_at") else datetime.now(timezone.utc),
                        source_url=art.get("source_url"),
                        data_path=f"articles/{art['slug']}",
                    )
                    db.add(article)

                    for tag_name in art.get("tags", []):
                        tag_slug = slugify(tag_name, separator="-")
                        from sqlalchemy import select
                        r = await db.execute(select(Tag).where(Tag.slug == tag_slug))
                        tag = r.scalar_one_or_none()
                        if tag:
                            tag.article_count += 1
                        else:
                            db.add(Tag(slug=tag_slug, name=tag_name, article_count=1))

                    await db.commit()

                    # Write JSON file
                    storage.write_article_json(art["slug"], {
                        **art,
                        "heroImage": art.get("hero_image"),
                        "additionalImages": art.get("additional_images", []),
                        "publishedAt": art.get("published_at"),
                    })

                    imported += 1
                    yield f"data: {json.dumps({'saved': art['title']})}\n\n"
                except Exception as e:
                    yield f"data: {json.dumps({'error': str(e), 'title': art.get('title', '')})}\n\n"

            elif event["type"] == "done":
                yield f"data: {json.dumps({'finished': True, 'imported': imported})}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
