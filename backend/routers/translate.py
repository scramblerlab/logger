from fastapi import APIRouter
from pydantic import BaseModel
from services import translator

router = APIRouter(prefix="/api/translate", tags=["translate"])


class ArticleTranslateRequest(BaseModel):
    title: str
    body: str
    ai_comment: str | None = None
    target_language: str


class ArticleTranslateResponse(BaseModel):
    title: str
    body: str
    ai_comment: str | None = None


class TitlesTranslateRequest(BaseModel):
    titles: list[str]
    target_language: str


class TitlesTranslateResponse(BaseModel):
    titles: list[str]


@router.post("/article", response_model=ArticleTranslateResponse)
async def translate_article(req: ArticleTranslateRequest):
    result = await translator.translate_article(
        req.title, req.body, req.ai_comment, req.target_language
    )
    return result


@router.post("/titles", response_model=TitlesTranslateResponse)
async def translate_titles(req: TitlesTranslateRequest):
    translated = await translator.translate_titles(req.titles, req.target_language)
    return {"titles": translated}
