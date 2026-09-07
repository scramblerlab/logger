from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_optional_user
from database import get_db
from services.ai_chat import ask_ai

router = APIRouter(prefix="/api", tags=["ai-chat"])


class AskRequest(BaseModel):
    question: str


class ArticleRef(BaseModel):
    title: str
    slug: str


class AskResponse(BaseModel):
    answer: str
    articles: list[ArticleRef]


@router.post("/ask", response_model=AskResponse)
async def ask(
    body: AskRequest,
    db: AsyncSession = Depends(get_db),
    viewer: str | None = Depends(get_optional_user),
):
    if not body.question.strip():
        raise HTTPException(status_code=400, detail="question is required")
    result = await ask_ai(body.question.strip(), db, include_hidden=viewer is not None)
    return result
