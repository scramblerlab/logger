import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from slugify import slugify

from auth import get_current_user
from database import get_db, SessionLocal
from models import Article, Tag
from schemas import (
    ShopifyBlogsRequest,
    ShopifyBlogsResponse,
    ShopifyBlog,
    ShopifyImportRequest,
    ShopifyExportRequest,
)
from services import storage, ai_classifier, task_manager
from services import shopify_service

router = APIRouter(prefix="/api/shopify", tags=["shopify"])


@router.post("/blogs", response_model=ShopifyBlogsResponse)
async def list_blogs(req: ShopifyBlogsRequest):
    """List all blogs in a Shopify store (no editor auth needed — proxies Shopify API)."""
    blogs = await shopify_service.list_blogs(req.shop_url, req.client_id, req.client_secret)
    return ShopifyBlogsResponse(blogs=[ShopifyBlog(**b) for b in blogs])


@router.post("/import")
async def run_import(
    req: ShopifyImportRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """SSE stream of Shopify blog import progress."""

    async def event_stream():
        imported = 0
        try:
            async for event in shopify_service.import_articles(
                req.shop_url,
                req.client_id,
                req.client_secret,
                req.blog_id,
                limit=req.limit,
                auto_classify=req.auto_classify,
            ):
                if event["type"] == "progress":
                    yield f"data: {json.dumps({'done': event['done'], 'total': event['total'], 'current': event['current_title']})}\n\n"

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
                            r = await db.execute(select(Tag).where(Tag.slug == tag_slug))
                            tag = r.scalar_one_or_none()
                            if tag:
                                tag.article_count += 1
                            else:
                                db.add(Tag(slug=tag_slug, name=tag_name, article_count=1))

                        await db.commit()
                        from routers.articles import _fts_upsert
                        await _fts_upsert(db, article)
                        await db.commit()

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
                    await task_manager.start(SessionLocal, ai_classifier)

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/export")
async def run_export(
    req: ShopifyExportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: str = Depends(get_current_user),
):
    """SSE stream of Shopify blog export progress."""

    # Load articles from DB before streaming
    result = await db.execute(select(Article).where(Article.slug.in_(req.article_slugs)))
    articles_by_slug = {a.slug: a for a in result.scalars().all()}

    articles = []
    for slug in req.article_slugs:
        a = articles_by_slug.get(slug)
        if a:
            articles.append({
                "slug": a.slug,
                "title": a.title,
                "body": a.body,
                "hero_image": a.hero_image,
                "categories": json.loads(a.categories) if a.categories else [],
                "tags": json.loads(a.tags) if a.tags else [],
                "published_at": a.published_at.isoformat() if a.published_at else None,
            })

    async def event_stream():
        try:
            async for event in shopify_service.export_articles(
                req.shop_url,
                req.client_id,
                req.client_secret,
                req.blog_id,
                articles,
                author=current_user,
            ):
                if event["type"] == "progress":
                    yield f"data: {json.dumps({'done': event['done'], 'total': event['total'], 'current': event['current_title']})}\n\n"
                elif event["type"] == "exported":
                    yield f"data: {json.dumps({'saved': event['title']})}\n\n"
                elif event["type"] == "error":
                    yield f"data: {json.dumps({'error': event['error'], 'title': event['title']})}\n\n"
                elif event["type"] == "done":
                    yield f"data: {json.dumps({'finished': True, 'exported': event['exported'], 'failed': event.get('failed', 0)})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
