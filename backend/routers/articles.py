import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy import select, func, text, or_
from sqlalchemy.ext.asyncio import AsyncSession
from slugify import slugify

from database import get_db
from models import Article, Tag
from schemas import ArticleOut, ArticleCard, ArticleCreate, ArticleUpdate, ArticleListResponse
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


@router.put("/{slug}", response_model=ArticleOut)
async def update_article(slug: str, body: ArticleUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Article).where(Article.slug == slug))
    article = result.scalar_one_or_none()
    if not article:
        raise HTTPException(404, "Article not found")

    for field, value in body.model_dump(exclude_none=True).items():
        if field in ("categories", "tags"):
            setattr(article, field, json.dumps(value, ensure_ascii=False))
        else:
            setattr(article, field, value)

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
