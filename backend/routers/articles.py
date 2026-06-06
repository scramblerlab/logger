import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from slugify import slugify

from auth import get_current_user
from database import get_db, SessionLocal
from models import Article, Tag
from schemas import ArticleOut, ArticleCard, ArticleCreate, ArticleListResponse, AIClassifyRequest, BulkCategorizeRequest
from services import storage, ai_classifier, ai_commenter, task_manager, single_job
from services.tokenizer import tokenize_ja

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
    rowid = (await db.execute(text("SELECT rowid FROM articles WHERE id = :id"), {"id": article.id})).scalar()
    if rowid is None:
        return
    await db.execute(text("DELETE FROM articles_fts WHERE rowid = :rowid"), {"rowid": rowid})
    await db.execute(
        text("INSERT INTO articles_fts(rowid, title, body) VALUES (:rowid, :title, :body)"),
        {"rowid": rowid, "title": tokenize_ja(article.title or ""), "body": tokenize_ja(article.body or "")},
    )


@router.get("", response_model=ArticleListResponse)
async def list_articles(
    category: Optional[str] = None,
    tag: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, le=100),
    sort: str = Query("published"),
    db: AsyncSession = Depends(get_db),
):
    if sort == "imported":
        order = Article.created_at.desc()
    else:
        order = Article.published_at.desc()
    q = select(Article).order_by(order)

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


@router.post("/ai-comment-bulk", status_code=202)
async def ai_comment_bulk(_: str = Depends(get_current_user)):
    """Start background AI comment generation for all articles missing ai_comment."""
    if task_manager.is_comment_running():
        raise HTTPException(409, "AI comment generation already running")
    await task_manager.start_comment(SessionLocal, ai_commenter)
    return {"started": True}


@router.get("/ai-comment-bulk/status")
async def ai_comment_bulk_status():
    """Return current AI comment generation task state (public — read-only)."""
    return task_manager.get_comment_state()


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
    body: str = Form(""),
    categories: str = Form("[]"),
    tags: str = Form("[]"),
    published_at: Optional[str] = Form(None),
    source_url: Optional[str] = Form(None),
    hero_image: Optional[UploadFile] = File(None),
    additional_images: list[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
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
        body=body,
        hero_image=hero_rel,
        categories=json.dumps(cats, ensure_ascii=False),
        tags=json.dumps(tag_list, ensure_ascii=False),
        published_at=pub_dt,
        source_url=source_url,
        data_path=f"articles/{slug}",
    )
    db.add(article)
    await db.flush()  # get rowid

    # Write JSON file
    storage.write_article_json(slug, {
        "id": article.id,
        "slug": slug,
        "title": title,
        "body": body,
        "heroImage": hero_rel,
        "additionalImages": extra_rels,
        "categories": cats,
        "tags": tag_list,
        "publishedAt": pub_dt.isoformat(),
    })

    await _upsert_tags(db, tag_list)
    await _fts_upsert(db, article)
    await db.commit()
    await db.refresh(article)

    return ArticleOut.model_validate(article)


@router.post("/ai-classify", status_code=202)
async def ai_classify_start(req: AIClassifyRequest, _: str = Depends(get_current_user)):
    """Start background AI classification. Poll /ai-classify/status/{job_id} for result."""
    job_id = single_job.create()
    asyncio.create_task(_run_classify(job_id, req.title, req.body))
    return {"job_id": job_id}


@router.get("/ai-classify/status/{job_id}")
async def ai_classify_status(job_id: str):
    return single_job.get(job_id)


async def _run_classify(job_id: str, title: str, body: str) -> None:
    try:
        result = await ai_classifier.classify(title, body)
        single_job.done(job_id, result)
    except Exception as exc:
        logger.exception("classify job %s failed", job_id)
        single_job.fail(job_id, str(exc))


@router.post("/ai-categorize", status_code=202)
async def ai_categorize_all(_: str = Depends(get_current_user)):
    """Start background AI classification of all uncategorized articles."""
    if task_manager.is_running():
        raise HTTPException(409, "AI categorization already running")
    await task_manager.start(SessionLocal, ai_classifier)
    await task_manager.start_comment(SessionLocal, ai_commenter)
    return {"started": True}


@router.get("/ai-categorize/status")
async def ai_categorize_status():
    """Return current AI categorization task state (public — read-only)."""
    return task_manager.get_state()


@router.patch("/bulk-categorize", status_code=200)
async def bulk_categorize(
    req: BulkCategorizeRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Merge/remove categories across multiple articles in one operation."""
    from models import now_utc
    result = await db.execute(select(Article).where(Article.slug.in_(req.article_slugs)))
    articles = result.scalars().all()
    add = set(req.add_categories)
    remove = set(req.remove_categories)
    for article in articles:
        existing = set(json.loads(article.categories))
        new_cats = sorted((existing | add) - remove)
        article.categories = json.dumps(new_cats, ensure_ascii=False)
        article.updated_at = now_utc()
    await db.commit()
    return {"updated": len(articles)}


@router.post("/{slug}/ai-comment", status_code=202)
async def ai_comment_start(
    slug: str,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    """Start background AI comment generation. Poll /{slug}/ai-comment/status for result."""
    result = await db.execute(select(Article).where(Article.slug == slug))
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(404, "Article not found")
    job_id = f"comment:{slug}"
    single_job.create(key=job_id)
    asyncio.create_task(_run_comment(job_id, slug, article.title, article.body))
    return {"job_id": job_id}


@router.get("/{slug}/ai-comment/status")
async def ai_comment_status(slug: str):
    return single_job.get(f"comment:{slug}")


async def _run_comment(job_id: str, slug: str, title: str, body: str) -> None:
    try:
        comment, comment_model = await ai_commenter.generate(title, body)
        async with SessionLocal() as db:
            result = await db.execute(select(Article).where(Article.slug == slug))
            article = result.scalar_one_or_none()
            if article:
                article.ai_comment = comment
                article.ai_comment_model = comment_model
                await db.commit()
        art_json = storage.read_article_json(slug)
        if art_json:
            art_json["ai_comment"] = comment
            art_json["ai_comment_model"] = comment_model
            storage.write_article_json(slug, art_json)
        single_job.done(job_id, {"ai_comment": comment, "ai_comment_model": comment_model})
    except Exception as exc:
        logger.exception("comment job %s failed", job_id)
        single_job.fail(job_id, str(exc))


@router.put("/{slug}", response_model=ArticleOut)
async def update_article(
    slug: str,
    title: Optional[str] = Form(None),
    body: Optional[str] = Form(None),
    categories: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    published_at: Optional[str] = Form(None),
    ai_comment: Optional[str] = Form(None),
    remove_image_paths: str = Form("[]"),
    reuse_image_as_hero: Optional[str] = Form(None),
    hero_image: Optional[UploadFile] = File(None),
    additional_images: list[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    result = await db.execute(select(Article).where(Article.slug == slug))
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(404, "Article not found")

    from models import now_utc
    article.updated_at = now_utc()  # always bump so hero URL cache buster changes

    if title is not None:
        article.title = title
    if body is not None:
        article.body = body
    if categories is not None:
        article.categories = json.dumps(json.loads(categories), ensure_ascii=False)
    if tags is not None:
        tag_list = json.loads(tags)
        article.tags = json.dumps(tag_list, ensure_ascii=False)
        await _upsert_tags(db, tag_list)
    if published_at is not None:
        try:
            article.published_at = datetime.fromisoformat(published_at)
        except ValueError:
            pass
    if ai_comment is not None:
        article.ai_comment = ai_comment

    # Remove requested images from disk (rel_path values match article.json additionalImages entries)
    from pathlib import Path
    paths_to_remove: list[str] = json.loads(remove_image_paths)
    if paths_to_remove:
        art_dir = Path(storage.ARTICLES_DIR) / slug
        for rel_path in paths_to_remove:
            target = art_dir / rel_path
            if target.exists():
                target.unlink()

    # Replace hero image (uploaded file takes precedence over reuse path)
    if hero_image and hero_image.filename:
        data = await hero_image.read()
        hero_rel = await storage.save_upload(slug, data, hero_image.filename, is_hero=True)
        article.hero_image = hero_rel
    elif reuse_image_as_hero:
        hero_rel = storage.copy_image_as_hero(slug, reuse_image_as_hero)
        if hero_rel:
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
        if body is not None:
            art_json["body"] = body
        if categories is not None:
            art_json["categories"] = json.loads(categories)
        if tags is not None:
            art_json["tags"] = json.loads(tags)
        if (hero_image and hero_image.filename) or reuse_image_as_hero:
            art_json["heroImage"] = article.hero_image
        if published_at is not None:
            art_json["publishedAt"] = article.published_at.isoformat() if article.published_at else None
        if ai_comment is not None:
            art_json["ai_comment"] = ai_comment
        art_json["additionalImages"] = all_extras
        storage.write_article_json(slug, art_json)

    await _fts_upsert(db, article)
    await db.commit()
    await db.refresh(article)
    return ArticleOut.model_validate(article)


@router.delete("/{slug}", status_code=204)
async def delete_article(slug: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    result = await db.execute(select(Article).where(Article.slug == slug))
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(404, "Article not found")
    await db.delete(article)
    storage.delete_article_files(slug)
    await db.commit()
