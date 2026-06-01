import json
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from schemas import ArticleCard
from services.tokenizer import tokenize_ja

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=list[ArticleCard])
async def search_articles(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            SELECT a.* FROM articles a
            JOIN articles_fts fts ON a.rowid = fts.rowid
            WHERE articles_fts MATCH :q
            ORDER BY rank
            LIMIT :limit
        """),
        {"q": tokenize_ja(q), "limit": limit},
    )
    rows = result.mappings().all()
    return [_row_to_card(dict(r)) for r in rows]


def _row_to_card(r: dict) -> dict:
    for key in ("categories", "tags"):
        if isinstance(r.get(key), str):
            try:
                r[key] = json.loads(r[key])
            except Exception:
                r[key] = []
    return r
