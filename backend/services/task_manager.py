"""
Background AI categorization task.
Singleton state — survives browser disconnects, persists until server restart.
"""
import asyncio
import json
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

_state: dict[str, Any] = {
    "status": "idle",      # idle | running | done | error
    "progress": "",
    "current_title": "",
    "updated": 0,
    "total": 0,
    "failed": 0,
    "started_at": None,
}
_task: asyncio.Task | None = None

_comment_state: dict[str, Any] = {
    "status": "idle",
    "progress": "",
    "current_title": "",
    "updated": 0,
    "total": 0,
    "failed": 0,
    "started_at": None,
}
_comment_task: asyncio.Task | None = None


def get_state() -> dict:
    return dict(_state)


def is_running() -> bool:
    return _state["status"] == "running"


def get_comment_state() -> dict:
    return dict(_comment_state)


def is_comment_running() -> bool:
    return _comment_state["status"] == "running"


async def start(db_factory, classifier_module) -> bool:
    global _task
    if is_running():
        return False
    _task = asyncio.create_task(_run(db_factory, classifier_module))
    return True


async def cancel() -> None:
    global _task
    if _task and not _task.done():
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
    _task = None


async def start_comment(db_factory, commenter_module) -> bool:
    global _comment_task
    if is_comment_running():
        return False
    _comment_task = asyncio.create_task(_run_comment(db_factory, commenter_module))
    return True


async def cancel_comment() -> None:
    global _comment_task
    if _comment_task and not _comment_task.done():
        _comment_task.cancel()
        try:
            await _comment_task
        except asyncio.CancelledError:
            pass
    _comment_task = None


async def _run(db_factory, classifier_module) -> None:
    from models import Article
    from services import storage

    _state.update({"status": "running", "progress": "", "current_title": "",
                   "updated": 0, "total": 0, "failed": 0,
                   "started_at": datetime.now(timezone.utc).isoformat()})

    try:
        # Check article count first — skip Ollama ping if nothing to do
        async with db_factory() as db:
            result = await db.execute(
                select(Article).where(Article.categories == "[]").order_by(Article.created_at)
            )
            articles = result.scalars().all()
            total = len(articles)

        if total == 0:
            _state.update({"status": "done", "progress": "未分類の記事はありません", "total": 0})
            return

        # Validate Ollama availability
        import httpx
        base = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        model = os.getenv("OLLAMA_MODEL", "gemma4:e2b-mlx")
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                tags_resp = await c.get(f"{base}/api/tags")
                pulled = [m["name"] for m in tags_resp.json().get("models", [])]
                if model not in pulled:
                    _state.update({"status": "error",
                                   "progress": f"モデル {model} が見つかりません。`ollama pull {model}` を実行してください。"})
                    return
        except Exception:
            _state.update({"status": "error",
                           "progress": f"Ollama に接続できません ({base})。ollama serve が起動しているか確認してください。"})
            return

        _state["total"] = total
        updated = 0
        failed = 0

        for i, article in enumerate(articles):
            _state.update({"progress": f"AI分類中... {i + 1}/{total}", "current_title": article.title})

            try:
                cls = await classifier_module.classify(article.title, article.body[:800])
                cats = cls.get("categories", [])
                new_tags = cls.get("tags", [])

                if cats:
                    async with db_factory() as db:
                        from sqlalchemy import select as sa_select
                        r = await db.execute(sa_select(Article).where(Article.id == article.id))
                        art_row = r.scalar_one_or_none()
                        if art_row:
                            art_row.categories = json.dumps(cats, ensure_ascii=False)
                            if new_tags:
                                art_row.tags = json.dumps(new_tags, ensure_ascii=False)
                                await _upsert_tags(db, new_tags)
                            await db.commit()
                            await db.refresh(art_row)

                    art_json = storage.read_article_json(article.slug)
                    if art_json:
                        art_json["categories"] = cats
                        if new_tags:
                            art_json["tags"] = new_tags
                        storage.write_article_json(article.slug, art_json)

                    updated += 1
                else:
                    failed += 1
            except asyncio.CancelledError:
                raise
            except Exception:
                failed += 1

            _state.update({"updated": updated, "failed": failed})

        msg = (
            "未分類の記事はありません" if total == 0
            else f"完了: {updated}/{total}件を分類しました" if failed == 0
            else f"完了: {updated}/{total}件を分類 ({failed}件失敗)"
        )
        _state.update({"status": "done", "progress": msg, "current_title": ""})

    except asyncio.CancelledError:
        _state.update({"status": "idle", "progress": "", "current_title": ""})
        raise
    except Exception as e:
        _state.update({"status": "error", "progress": str(e), "current_title": ""})


async def _run_comment(db_factory, commenter_module) -> None:
    from models import Article
    from services import storage

    _comment_state.update({
        "status": "running", "progress": "", "current_title": "",
        "updated": 0, "total": 0, "failed": 0,
        "started_at": datetime.now(timezone.utc).isoformat(),
    })

    try:
        async with db_factory() as db:
            result = await db.execute(
                select(Article).where(
                    (Article.ai_comment == None) | (Article.ai_comment == "")  # noqa: E711
                ).order_by(Article.created_at)
            )
            articles = result.scalars().all()
            total = len(articles)

        if total == 0:
            _comment_state.update({"status": "done", "progress": "AIコメントが未生成の記事はありません", "total": 0})
            return

        import httpx
        base = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        model = os.getenv("OLLAMA_MODEL", "gemma4:e2b-mlx")
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                tags_resp = await c.get(f"{base}/api/tags")
                pulled = [m["name"] for m in tags_resp.json().get("models", [])]
                if model not in pulled:
                    _comment_state.update({"status": "error",
                                           "progress": f"モデル {model} が見つかりません。`ollama pull {model}` を実行してください。"})
                    return
        except Exception:
            _comment_state.update({"status": "error",
                                   "progress": f"Ollama に接続できません ({base})。ollama serve が起動しているか確認してください。"})
            return

        _comment_state["total"] = total
        updated = 0
        failed = 0

        for i, article in enumerate(articles):
            _comment_state.update({"progress": f"AIコメント生成中... {i + 1}/{total}", "current_title": article.title})

            try:
                comment, comment_model = await commenter_module.generate(article.title, article.body)

                async with db_factory() as db:
                    from sqlalchemy import select as sa_select
                    r = await db.execute(sa_select(Article).where(Article.id == article.id))
                    art_row = r.scalar_one_or_none()
                    if art_row:
                        art_row.ai_comment = comment
                        art_row.ai_comment_model = comment_model
                        await db.commit()

                art_json = storage.read_article_json(article.slug)
                if art_json:
                    art_json["ai_comment"] = comment
                    art_json["ai_comment_model"] = comment_model
                    storage.write_article_json(article.slug, art_json)

                updated += 1
            except asyncio.CancelledError:
                raise
            except Exception:
                failed += 1

            _comment_state.update({"updated": updated, "failed": failed})

        msg = (
            "AIコメントが未生成の記事はありません" if total == 0
            else f"完了: {updated}/{total}件にAIコメントを追加しました" if failed == 0
            else f"完了: {updated}/{total}件にAIコメントを追加 ({failed}件失敗)"
        )
        _comment_state.update({"status": "done", "progress": msg, "current_title": ""})

    except asyncio.CancelledError:
        _comment_state.update({"status": "idle", "progress": "", "current_title": ""})
        raise
    except Exception as e:
        _comment_state.update({"status": "error", "progress": str(e), "current_title": ""})


async def _upsert_tags(db, tag_names: list[str]) -> None:
    from models import Tag
    from slugify import slugify
    for name in tag_names:
        slug = slugify(name, separator="-")
        r = await db.execute(select(Tag).where(Tag.slug == slug))
        tag = r.scalar_one_or_none()
        if tag:
            tag.article_count += 1
        else:
            db.add(Tag(slug=slug, name=name, article_count=1))
