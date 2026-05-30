import json
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from slugify import slugify

from database import get_db
from models import Article, Tag
from schemas import ArticleOut, ArticleCard, ArticleCreate, ArticleListResponse, AIClassifyRequest, AIClassifyResult
from services import storage, ai_classifier

router = APIRouter(prefix="/api/articles", tags=["articles"])


async def _upsert_tags(db: AsyncSession, tag_names: list[str]):
    for name in tag_names:
        slug = slugify(name, separator="-")
        result = await db.execute(select(Tag).where(Tag.slug == slug))
        tag = result.scalar_one_or_none()
        if tag:
            tag.article_count += 1
        else:
            db.add(Tag(slug=slug, name=name, article_count=1))


async def _fts_upsert(db: AsyncSession, article: Article):
    await db.execute(
        text("INSERT OR REPLACE INTO articles_fts(rowid, title, body) VALUES (:rowid, :title, :body)"),
        {"rowid": article.rowid if hasattr(article, "rowid") else None, "title": article.title, "body": article.body},
    )


@router.get("", response_model=ArticleListResponse)
async def list_articles(
    category: Optional[str] = None,
    tag: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    q = select(Article).order_by(Article.published_at.desc(), Article.created_at.desc())

    if category:
        q = q.where(Article.categories.like(f'%"{category}"%'))
    if tag:
        q = q.where(Article.tags.like(f'%{tag}%'))

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()

    q = q.offset((page - 1) * limit).limit(limit)
    rows = (await db.execute(q)).scalars().all()

    return ArticleListResponse(
        items=[ArticleCard.model_validate(r) for r in rows],
        total=total,
        page=page,
        limit=limit,
    )


@router.get("/{slug}", response_model=ArticleOut)
async def get_article(slug: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Article).where(Article.slug == slug))
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(404, "Article not found")
    return ArticleOut.model_validate(article)


@router.post("", response_model=ArticleOut, status_code=201)
async def create_article(
    title: str = Form(...),
    title_ja: Optional[str] = Form(None),
    body: str = Form(""),
    categories: str = Form("[]"),
    tags: str = Form("[]"),
    published_at: Optional[str] = Form(None),
    auto_classify: bool = Form(True),
    hero_image: Optional[UploadFile] = File(None),
    additional_images: list[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
):
    cats = json.loads(categories)
    tag_list = json.loads(tags)

    date_prefix = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    slug = f"{date_prefix}-{slugify(title, max_length=50, separator='-')}-{uuid.uuid4().hex[:4]}"

    hero_rel = None
    if hero_image and hero_image.filename:
        data = await hero_image.read()
        hero_rel = await storage.save_upload(slug, data, hero_image.filename, is_hero=True)

    extra_rels = []
    for img in additional_images:
        if img and img.filename:
            data = await img.read()
            rel = await storage.save_upload(slug, data, img.filename)
            extra_rels.append(rel)

    if auto_classify and not cats:
        result = await ai_classifier.classify(title, body)
        cats = result.get("categories", [])
        if not tag_list:
            tag_list = result.get("tags", [])

    pub_dt = None
    if published_at:
        try:
            pub_dt = datetime.fromisoformat(published_at)
        except Exception:
            pass
    if not pub_dt:
        pub_dt = datetime.now(timezone.utc)

    article = Article(
        slug=slug,
        title=title,
        title_ja=title_ja,
        body=body,
        hero_image=hero_rel,
        categories=json.dumps(cats, ensure_ascii=False),
        tags=json.dumps(tag_list, ensure_ascii=False),
        published_at=pub_dt,
        data_path=f"articles/{slug}",
    )
    db.add(article)
    await db.flush()  # get rowid

    # Write JSON file
    storage.write_article_json(slug, {
        "id": article.id,
        "slug": slug,
        "title": title,
        "title_ja": title_ja,
        "body": body,
        "heroImage": hero_rel,
        "additionalImages": extra_rels,
        "categories": cats,
        "tags": tag_list,
        "publishedAt": pub_dt.isoformat(),
    })

    await _upsert_tags(db, tag_list)
    await db.commit()
    await db.refresh(article)
    return ArticleOut.model_validate(article)


@router.post("/ai-classify", response_model=AIClassifyResult)
async def ai_classify_single(req: AIClassifyRequest):
    """Classify a single article's title+body and return suggested categories/tags."""
    result = await ai_classifier.classify(req.title, req.body)
    return AIClassifyResult(**result)


@router.post("/ai-categorize")
async def ai_categorize_all():
    """SSE stream: run AI classification on all uncategorized articles."""
    import os

    async def _stream() -> AsyncIterator[str]:
        import httpx as _httpx
        base = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        model = os.getenv("OLLAMA_MODEL", "gemma4:e2b-mlx")

        try:
            async with _httpx.AsyncClient(timeout=5) as c:
                tags_resp = await c.get(f"{base}/api/tags")
                pulled = [m["name"] for m in tags_resp.json().get("models", [])]
                if model not in pulled:
                    yield f"data: {json.dumps({'type': 'error', 'message': f'モデル {model} が見つかりません。`ollama pull {model}` を実行してください。'})}\n\n"
                    return
        except Exception:
            yield f"data: {json.dumps({'type': 'error', 'message': f'Ollama に接続できません ({base})。ollama serve が起動しているか確認してください。'})}\n\n"
            return

        from database import SessionLocal
        async with SessionLocal() as db:
            result = await db.execute(
                select(Article).where(Article.categories == "[]").order_by(Article.created_at)
            )
            articles = result.scalars().all()
            total = len(articles)
            updated = 0
            failed = 0

            if total == 0:
                yield f"data: {json.dumps({'type': 'done', 'updated': 0, 'total': 0, 'failed': 0})}\n\n"
                return

            for i, article in enumerate(articles):
                yield f"data: {json.dumps({'type': 'progress', 'done': i, 'total': total, 'current_title': article.title})}\n\n"

                try:
                    cls = await ai_classifier.classify(article.title, article.body[:800])
                    cats = cls.get("categories", [])
                    new_tags = cls.get("tags", [])

                    if cats:
                        article.categories = json.dumps(cats, ensure_ascii=False)
                        if new_tags:
                            article.tags = json.dumps(new_tags, ensure_ascii=False)
                            await _upsert_tags(db, new_tags)

                        await db.commit()
                        await db.refresh(article)

                        art_json = storage.read_article_json(article.slug)
                        if art_json:
                            art_json["categories"] = cats
                            if article.tags != "[]":
                                art_json["tags"] = json.loads(article.tags)
                            storage.write_article_json(article.slug, art_json)

                        updated += 1
                    else:
                        failed += 1
                except Exception as e:
                    # Surface the first API error immediately so the user isn't left guessing
                    err_msg = str(e)
                    yield f"data: {json.dumps({'type': 'error', 'message': err_msg})}\n\n"
                    return

            yield f"data: {json.dumps({'type': 'done', 'updated': updated, 'total': total, 'failed': failed})}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.put("/{slug}", response_model=ArticleOut)
async def update_article(
    slug: str,
    title: Optional[str] = Form(None),
    title_ja: Optional[str] = Form(None),
    body: Optional[str] = Form(None),
    categories: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    remove_image_paths: str = Form("[]"),
    hero_image: Optional[UploadFile] = File(None),
    additional_images: list[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Article).where(Article.slug == slug))
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(404, "Article not found")

    if title is not None:
        article.title = title
    if title_ja is not None:
        article.title_ja = title_ja
    if body is not None:
        article.body = body
    if categories is not None:
        article.categories = json.dumps(json.loads(categories), ensure_ascii=False)
    if tags is not None:
        tag_list = json.loads(tags)
        article.tags = json.dumps(tag_list, ensure_ascii=False)
        await _upsert_tags(db, tag_list)

    # Remove requested images from disk (rel_path values match article.json additionalImages entries)
    from pathlib import Path
    paths_to_remove: list[str] = json.loads(remove_image_paths)
    if paths_to_remove:
        art_dir = Path(storage.ARTICLES_DIR) / slug
        for rel_path in paths_to_remove:
            target = art_dir / rel_path
            if target.exists():
                target.unlink()

    # Replace hero image
    if hero_image and hero_image.filename:
        data = await hero_image.read()
        hero_rel = await storage.save_upload(slug, data, hero_image.filename, is_hero=True)
        article.hero_image = hero_rel

    # Add new additional images (appended to existing)
    existing_extras = []
    art_json = storage.read_article_json(slug)
    if art_json:
        existing_extras = art_json.get("additionalImages", [])
    if paths_to_remove:
        existing_extras = [p for p in existing_extras if p not in paths_to_remove]

    new_extras = []
    for img in additional_images:
        if img and img.filename:
            data = await img.read()
            rel = await storage.save_upload(slug, data, img.filename)
            new_extras.append(rel)

    all_extras = existing_extras + new_extras

    # Write updated article.json
    if art_json:
        if title is not None:
            art_json["title"] = title
        if title_ja is not None:
            art_json["title_ja"] = title_ja
        if body is not None:
            art_json["body"] = body
        if categories is not None:
            art_json["categories"] = json.loads(categories)
        if tags is not None:
            art_json["tags"] = json.loads(tags)
        if hero_image and hero_image.filename:
            art_json["heroImage"] = article.hero_image
        art_json["additionalImages"] = all_extras
        storage.write_article_json(slug, art_json)

    await db.commit()
    await db.refresh(article)
    return ArticleOut.model_validate(article)


@router.delete("/{slug}", status_code=204)
async def delete_article(slug: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Article).where(Article.slug == slug))
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(404, "Article not found")
    await db.delete(article)
    storage.delete_article_files(slug)
    await db.commit()
