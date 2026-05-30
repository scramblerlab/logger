import json
from fastapi import APIRouter, Depends
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Category, Article
from schemas import CategoryOut, TagOut

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Category).order_by(Category.name_en))
    return result.scalars().all()


@router.get("/tags", response_model=list[TagOut])
async def list_tags(limit: int = 50, db: AsyncSession = Depends(get_db)):
    from models import Tag
    result = await db.execute(
        select(Tag).order_by(Tag.article_count.desc()).limit(limit)
    )
    return result.scalars().all()
