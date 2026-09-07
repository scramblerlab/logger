import json
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_optional_user
from database import get_db
from schemas import ArticleCard, SearchResponse
from services.tokenizer import tokenize_ja

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=SearchResponse)
async def search_articles(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
    viewer: Optional[str] = Depends(get_optional_user),
):
    # Guests must not learn about hidden articles, not even via the hit count.
    visibility = "" if viewer else " AND a.guest_visible = 1"
    tokenized = tokenize_ja(q)

    total = (await db.execute(
        text(f"""
            SELECT COUNT(*) FROM articles a
            JOIN articles_fts fts ON a.rowid = fts.rowid
            WHERE articles_fts MATCH :q{visibility}
        """),
        {"q": tokenized},
    )).scalar_one()

    result = await db.execute(
        text(f"""
            SELECT a.* FROM articles a
            JOIN articles_fts fts ON a.rowid = fts.rowid
            WHERE articles_fts MATCH :q{visibility}
            ORDER BY rank
            LIMIT :limit
        """),
        {"q": tokenized, "limit": limit},
    )
    rows = result.mappings().all()
    return SearchResponse(
        items=[ArticleCard.model_validate(_row_to_card(dict(r))) for r in rows],
        total=total,
    )


def _row_to_card(r: dict) -> dict:
    for key in ("categories", "tags"):
        if isinstance(r.get(key), str):
            try:
                r[key] = json.loads(r[key])
            except Exception:
                r[key] = []
    return r
