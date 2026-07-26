import json
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import Category, Article
from schemas import CategoryOut, TagOut, CategoryCreate
from services import storage

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db)):
    cats = (await db.execute(select(Category).order_by(Category.name_en))).scalars().all()

    # Count articles per category in one correlated subquery.
    # Column references must be qualified: a bare `slug` inside the subquery
    # binds to articles.slug, not categories.slug, making every count 0.
    count_rows = (await db.execute(text(
        "SELECT categories.slug,"
        " (SELECT COUNT(*) FROM articles"
        "  WHERE articles.categories LIKE '%\"' || categories.slug || '\"%') AS cnt"
        " FROM categories"
    ))).fetchall()
    counts = {row[0]: row[1] for row in count_rows}

    return [
        CategoryOut(
            id=cat.id, slug=cat.slug, name_en=cat.name_en,
            name_ja=cat.name_ja, color=cat.color,
            article_count=counts.get(cat.slug, 0),
        )
        for cat in cats
    ]


@router.get("/tags", response_model=list[TagOut])
async def list_tags(limit: int = 50, db: AsyncSession = Depends(get_db)):
    from models import Tag
    result = await db.execute(
        select(Tag).order_by(Tag.article_count.desc()).limit(limit)
    )
    return result.scalars().all()


@router.post("", response_model=CategoryOut, status_code=201)
async def create_category(body: CategoryCreate, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    existing = await db.execute(select(Category).where(Category.slug == body.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(409, f"Category '{body.slug}' already exists")
    cat = Category(
        id=str(uuid.uuid4()),
        slug=body.slug,
        name_en=body.name_en,
        name_ja=body.name_ja,
        color=body.color,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


@router.delete("/{slug}", status_code=204)
async def delete_category(slug: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    cat = (await db.execute(select(Category).where(Category.slug == slug))).scalar_one_or_none()
    if not cat:
        raise HTTPException(404, "Category not found")

    # Strip the deleted category from all articles that reference it
    articles = (await db.execute(
        select(Article).where(Article.categories.like(f'%"{slug}"%'))
    )).scalars().all()

    for article in articles:
        cats = json.loads(article.categories or "[]")
        cats = [c for c in cats if c != slug]
        article.categories = json.dumps(cats, ensure_ascii=False)
        # Update article.json on disk
        art_json = storage.read_article_json(article.slug)
        if art_json:
            art_json["categories"] = cats
            storage.write_article_json(article.slug, art_json)

    await db.delete(cat)
    await db.commit()
