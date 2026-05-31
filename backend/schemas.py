from __future__ import annotations
import json
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator, model_validator


class CategoryOut(BaseModel):
    id: str
    slug: str
    name_en: str
    name_ja: str
    color: str
    article_count: int = 0

    model_config = {"from_attributes": True}


class TagOut(BaseModel):
    id: str
    slug: str
    name: str
    article_count: int

    model_config = {"from_attributes": True}


class ArticleBase(BaseModel):
    title: str
    title_ja: Optional[str] = None
    body: str = ""
    categories: list[str] = []
    tags: list[str] = []
    published_at: Optional[datetime] = None


class ArticleCreate(ArticleBase):
    auto_classify: bool = True


class ArticleUpdate(BaseModel):
    title: Optional[str] = None
    title_ja: Optional[str] = None
    body: Optional[str] = None
    categories: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    published_at: Optional[datetime] = None


class ArticleCard(BaseModel):
    id: str
    slug: str
    title: str
    title_ja: Optional[str]
    hero_image: Optional[str]
    categories: list[str]
    tags: list[str]
    published_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("categories", "tags", mode="before")
    @classmethod
    def parse_json_list(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return []
        return v or []


class ArticleOut(ArticleCard):
    body: str
    source_url: Optional[str]
    updated_at: datetime


class ArticleListResponse(BaseModel):
    items: list[ArticleCard]
    total: int
    page: int
    limit: int


class CategoryCreate(BaseModel):
    slug: str
    name_en: str
    name_ja: str
    color: str = "#888888"


class AIClassifyRequest(BaseModel):
    title: str
    body: str = ""


class AIClassifyResult(BaseModel):
    categories: list[str]
    tags: list[str]


class ImportAnalyzeRequest(BaseModel):
    url: str


class ImportAnalyzeResponse(BaseModel):
    url: str
    article_count: int
    sample_titles: list[str]
    detected_categories: list[str]
    method: str


class ImportRunRequest(BaseModel):
    url: str
    limit: Optional[int] = None
    auto_classify: bool = True


class BulkCategorizeRequest(BaseModel):
    article_slugs: list[str]
    add_categories: list[str] = []
    remove_categories: list[str] = []
