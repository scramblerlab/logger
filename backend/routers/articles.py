import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from slugify import slugify

from auth import get_current_user
from database import get_db, SessionLocal
from models import Article, Tag
from schemas import ArticleOut, ArticleCard, ArticleCreate, ArticleListResponse, AIClassifyRequest, AIClassifyResult, BulkCategorizeRequest
from services import storage, ai_classifier, task_manager

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

    # Kick off background AI for any uncategorized articles (no-op if already running or nothing to do)
    await task_manager.start(SessionLocal, ai_classifier)

    return ArticleOut.model_validate(article)


@router.post("/ai-classify", response_model=AIClassifyResult)
async def ai_classify_single(req: AIClassifyRequest, _: str = Depends(get_current_user)):
    """Classify a single article's title+body and return suggested categories/tags."""
    result = await ai_classifier.classify(req.title, req.body)
    return AIClassifyResult(**result)


@router.post("/ai-categorize", status_code=202)
async def ai_categorize_all(_: str = Depends(get_current_user)):
    """Start background AI classification of all uncategorized articles."""
    if task_manager.is_running():
        raise HTTPException(409, "AI categorization already running")
    await task_manager.start(SessionLocal, ai_classifier)
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


@router.put("/{slug}", response_model=ArticleOut)
async def update_article(
    slug: str,
    title: Optional[str] = Form(None),
    title_ja: Optional[str] = Form(None),
    body: Optional[str] = Form(None),
    categories: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
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
        if title_ja is not None:
            art_json["title_ja"] = title_ja
        if body is not None:
            art_json["body"] = body
        if categories is not None:
            art_json["categories"] = json.loads(categories)
        if tags is not None:
            art_json["tags"] = json.loads(tags)
        if (hero_image and hero_image.filename) or reuse_image_as_hero:
            art_json["heroImage"] = article.hero_image
        art_json["additionalImages"] = all_extras
        storage.write_article_json(slug, art_json)

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
