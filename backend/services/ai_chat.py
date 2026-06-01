import asyncio
import os
import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

SYSTEM_PROMPT = """You are a helpful assistant for a personal Japanese lifestyle blog called "logger".

## Answer priority — follow this order strictly:
1. **Blog database (authoritative)** — The site overview and matching articles below are the ground truth for this blog. For any question about what articles exist, how many there are, or what topics the blog covers, answer ONLY from the database context. Do not invent or guess.
2. **Web search** — Use ONLY to supplement when the question asks about external information (e.g. how-to guides, external news, product specs) that cannot be answered from the database.
3. **Training knowledge** — Use only as background.

## Database rules:
- "How many articles about X?" → Report the exact count shown in the database context (e.g. "Found N matching articles").
- "What articles exist about X?" → List only the titles found in the database.
- If the database shows 0 matching articles, say so clearly — do not fill in with web results as if they were blog articles.
- If the database has relevant articles, lead with those before mentioning anything from web search.

Respond in the same language the user writes in (Japanese or English)."""


async def _get_site_stats(db: AsyncSession) -> dict:
    total_row = await db.execute(text("SELECT COUNT(*) FROM articles"))
    total = total_row.scalar() or 0

    date_row = await db.execute(text(
        "SELECT MIN(published_at), MAX(published_at) FROM articles WHERE published_at IS NOT NULL"
    ))
    date_range = date_row.fetchone()
    oldest = (date_range[0] or "")[:10]
    newest = (date_range[1] or "")[:10]

    cat_rows = await db.execute(text(
        "SELECT name_ja, name_en, slug FROM categories ORDER BY name_en"
    ))
    categories = [{"name_ja": r[0], "name_en": r[1], "slug": r[2]} for r in cat_rows.fetchall()]

    tag_rows = await db.execute(text(
        "SELECT name, article_count FROM tags ORDER BY article_count DESC LIMIT 10"
    ))
    tags = [{"name": r[0], "count": r[1]} for r in tag_rows.fetchall()]

    recent_rows = await db.execute(text(
        "SELECT title, slug FROM articles ORDER BY published_at DESC LIMIT 5"
    ))
    recent = [{"title": r[0], "slug": r[1]} for r in recent_rows.fetchall()]

    return {
        "total": total,
        "oldest": oldest,
        "newest": newest,
        "categories": categories,
        "tags": tags,
        "recent": recent,
    }


def _format_site_stats(stats: dict) -> str:
    lines = [
        f"## Blog site overview",
        f"- Total articles: {stats['total']}",
    ]
    if stats["oldest"] and stats["newest"]:
        lines.append(f"- Date range: {stats['oldest']} – {stats['newest']}")

    if stats["categories"]:
        cat_list = ", ".join(f"{c['name_ja']}({c['slug']})" for c in stats["categories"])
        lines.append(f"- Categories ({len(stats['categories'])}): {cat_list}")

    if stats["tags"]:
        tag_list = ", ".join(f"{t['name']}({t['count']})" for t in stats["tags"])
        lines.append(f"- Top tags: {tag_list}")

    if stats["recent"]:
        lines.append("- Recent articles:")
        for a in stats["recent"]:
            lines.append(f"  • {a['title']} (slug: {a['slug']})")

    return "\n".join(lines)


async def _search_db(question: str, db: AsyncSession, limit: int = 5) -> dict:
    try:
        count_row = await db.execute(
            text("""
                SELECT COUNT(*) FROM articles a
                JOIN articles_fts fts ON a.rowid = fts.rowid
                WHERE articles_fts MATCH :q
            """),
            {"q": question},
        )
        total = count_row.scalar() or 0

        result = await db.execute(
            text("""
                SELECT a.slug, a.title, a.body
                FROM articles a
                JOIN articles_fts fts ON a.rowid = fts.rowid
                WHERE articles_fts MATCH :q
                ORDER BY rank
                LIMIT :limit
            """),
            {"q": question, "limit": limit},
        )
        rows = result.mappings().all()
        articles = [{"slug": r["slug"], "title": r["title"], "excerpt": (r["body"] or "")[:250]} for r in rows]
        return {"total": total, "articles": articles}
    except Exception:
        return {"total": 0, "articles": []}


async def _web_search(query: str, max_results: int = 5) -> list[dict]:
    api_key = os.getenv("OLLAMA_API_KEY", "")
    if not api_key:
        return []
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.post(
                "https://ollama.com/api/web_search",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"query": query, "max_results": max_results},
            )
            r.raise_for_status()
            return r.json().get("results", [])
        except Exception:
            return []


def _build_context(stats_text: str, db_result: dict, web_results: list[dict]) -> str:
    parts = [stats_text]

    total = db_result["total"]
    articles = db_result["articles"]
    if total > 0:
        header = f"\n## Database search results: found {total} matching article(s)"
        if total > len(articles):
            header += f" (showing top {len(articles)})"
        parts.append(header)
        for a in articles:
            parts.append(f'- **{a["title"]}** (slug: {a["slug"]})\n  {a["excerpt"]}')
    else:
        parts.append("\n## Database search results: no matching articles found in this blog")

    if web_results:
        parts.append("\n## Web search results (external, not from this blog):")
        for w in web_results:
            snippet = (w.get("content") or "")[:200]
            parts.append(f'- **{w.get("title", "")}** ({w.get("url", "")})\n  {snippet}')

    return "\n".join(parts)


async def ask_ai(question: str, db: AsyncSession) -> dict:
    stats, db_result, web_results = await asyncio.gather(
        _get_site_stats(db),
        _search_db(question, db),
        _web_search(question),
    )

    stats_text = _format_site_stats(stats)
    context = _build_context(stats_text, db_result, web_results)
    user_message = f"{context}\n\n---\nQuestion: {question}"

    base = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    model = os.getenv("OLLAMA_MODEL", "gemma4:e2b-mlx")

    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{base}/api/chat",
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                "stream": False,
                "options": {"num_ctx": 8192},
            },
        )
        r.raise_for_status()
        answer = r.json()["message"]["content"].strip()

    return {
        "answer": answer,
        "articles": [{"title": a["title"], "slug": a["slug"]} for a in db_result["articles"]],
    }
