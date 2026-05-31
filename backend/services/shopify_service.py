"""
Shopify blog importer/exporter using the Shopify Admin GraphQL API.

Authentication: Client Credentials Grant (new Shopify Dev Dashboard flow).
  The old "Admin API access token" from the store Admin panel is deprecated.
  Instead, use Client ID + Client Secret from dev.shopify.com → your app → 設定.

  Token endpoint (24-hour tokens, refresh by repeating the same request):
    POST https://{shop}.myshopify.com/admin/oauth/access_token
    grant_type=client_credentials&client_id=...&client_secret=...
"""
import os
import uuid
from datetime import datetime, timezone
from typing import AsyncIterator

import html2text
import httpx
import markdown as _md
from bs4 import BeautifulSoup
from slugify import slugify

_API_VERSION = "2024-01"


async def _get_access_token(shop_url: str, client_id: str, client_secret: str) -> str:
    """
    Exchange Client ID + Secret for a short-lived Admin API access token (valid 24 h).
    This is the Client Credentials Grant introduced in the new Shopify Dev Dashboard.
    Tokens are refreshed by repeating the same request — no refresh_token needed.
    """
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"https://{shop_url}/admin/oauth/access_token",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )
        r.raise_for_status()
        return r.json()["access_token"]


async def _gql(shop_url: str, access_token: str, query: str, variables: dict | None = None) -> dict:
    """Execute a Shopify Admin GraphQL query/mutation."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"https://{shop_url}/admin/api/{_API_VERSION}/graphql.json",
            headers={
                "X-Shopify-Access-Token": access_token,
                "Content-Type": "application/json",
            },
            json={"query": query, "variables": variables or {}},
        )
        r.raise_for_status()
        data = r.json()
        if "errors" in data:
            raise ValueError(str(data["errors"]))
        return data["data"]


_BLOGS_QUERY = """
query {
  blogs(first: 50) {
    nodes {
      id
      title
      handle
      articlesCount { count }
    }
  }
}
"""

_ARTICLES_QUERY = """
query GetArticles($blogId: ID!, $cursor: String) {
  blog(id: $blogId) {
    articles(first: 50, after: $cursor) {
      nodes {
        id
        title
        handle
        body
        author { name }
        tags
        publishedAt
        image { url altText }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
"""

_CREATE_ARTICLE_MUTATION = """
mutation CreateArticle($article: ArticleCreateInput!) {
  articleCreate(article: $article) {
    article {
      id
      handle
      title
    }
    userErrors {
      field
      message
    }
  }
}
"""


def _html_to_md(html: str) -> str:
    converter = html2text.HTML2Text()
    converter.ignore_links = False
    converter.ignore_images = False
    converter.body_width = 0
    return converter.handle(html).strip()


async def list_blogs(shop_url: str, client_id: str, client_secret: str) -> list[dict]:
    """Return all blogs in the store with article counts."""
    access_token = await _get_access_token(shop_url, client_id, client_secret)
    data = await _gql(shop_url, access_token, _BLOGS_QUERY)
    blogs = []
    for node in data["blogs"]["nodes"]:
        blogs.append({
            "id": node["id"],
            "title": node["title"],
            "handle": node["handle"],
            "article_count": (node.get("articlesCount") or {}).get("count", 0),
        })
    return blogs


async def import_articles(
    shop_url: str,
    client_id: str,
    client_secret: str,
    blog_id: str,
    limit: int | None = None,
    auto_classify: bool = True,
) -> AsyncIterator[dict]:
    """
    Async generator — yields progress dicts matching wp_importer format:
      {"type": "progress", "done": N, "total": M, "current_title": "..."}
      {"type": "article", "data": {...}}
      {"type": "done", "imported": N, "failed": N}
    """
    access_token = await _get_access_token(shop_url, client_id, client_secret)
    lim = limit or 500

    # Collect all articles via cursor-based pagination
    all_articles: list[dict] = []
    cursor = None
    while len(all_articles) < lim:
        data = await _gql(shop_url, access_token, _ARTICLES_QUERY, {
            "blogId": blog_id,
            "cursor": cursor,
        })
        blog_data = data.get("blog")
        if not blog_data:
            break
        conn = blog_data["articles"]
        all_articles.extend(conn["nodes"])
        page_info = conn["pageInfo"]
        if not page_info["hasNextPage"]:
            break
        cursor = page_info["endCursor"]

    all_articles = all_articles[:lim]
    total = len(all_articles)
    done = 0
    failed = 0

    from services.storage import download_and_save

    for raw in all_articles:
        title = raw.get("title") or "Untitled"
        yield {"type": "progress", "done": done, "total": total, "current_title": title}

        # Slug: date-handle-uuid4
        handle = raw.get("handle") or slugify(title, max_length=60, separator="-") or "article"
        pub = raw.get("publishedAt")
        if pub:
            try:
                dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                date_prefix = dt.strftime("%Y-%m-%d")
            except Exception:
                date_prefix = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        else:
            date_prefix = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        slug = f"{date_prefix}-{handle[:60]}-{uuid.uuid4().hex[:4]}"

        # Hero image
        hero_rel = None
        img = raw.get("image") or {}
        hero_url = img.get("url")
        if hero_url:
            hero_rel = await download_and_save(slug, hero_url, "hero.jpg", is_hero=True)

        # Body images: download and rewrite URLs
        body_html = raw.get("body") or ""
        extra_rels: list[str] = []
        url_rewrite: dict[str, str] = {}
        try:
            soup = BeautifulSoup(body_html, "html.parser")
            for img_tag in soup.find_all("img"):
                src = img_tag.get("src") or img_tag.get("data-src")
                if src and src != hero_url:
                    fname = src.split("/")[-1].split("?")[0] or "image.jpg"
                    rel = await download_and_save(slug, src, fname)
                    if rel:
                        extra_rels.append(rel)
                        url_rewrite[src] = f"/static/articles/{slug}/{rel}"
        except Exception:
            pass

        for orig, local in url_rewrite.items():
            body_html = body_html.replace(orig, local)
        body_md = _html_to_md(body_html)

        # Tags from Shopify; categories filled by AI classifier
        tags: list[str] = list(raw.get("tags") or [])
        categories: list[str] = []

        if auto_classify:
            try:
                from services.ai_classifier import classify
                result = await classify(title, body_md)
                categories = result.get("categories", [])
                if not tags:
                    tags = result.get("tags", [])
            except Exception:
                pass

        pub_dt = None
        if pub:
            try:
                pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
            except Exception:
                pass

        yield {
            "type": "article",
            "data": {
                "slug": slug,
                "title": title,
                "body": body_md,
                "hero_image": hero_rel,
                "additional_images": extra_rels,
                "categories": categories,
                "tags": tags,
                "published_at": pub_dt.isoformat() if pub_dt else None,
                "source_url": f"https://{shop_url}/blogs/{handle}",
            },
        }
        done += 1

    yield {"type": "done", "imported": done, "failed": failed}


async def export_articles(
    shop_url: str,
    client_id: str,
    client_secret: str,
    blog_id: str,
    articles: list[dict],
    author: str = "Author",
) -> AsyncIterator[dict]:
    """
    Async generator — yields:
      {"type": "progress", "done": N, "total": M, "current_title": "..."}
      {"type": "exported", "title": "...", "handle": "..."}
      {"type": "error",    "title": "...", "error": "..."}
      {"type": "done",     "exported": N, "failed": N}
    """
    access_token = await _get_access_token(shop_url, client_id, client_secret)
    public_base = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
    is_local = "localhost" in public_base or "127.0.0.1" in public_base
    total = len(articles)
    done = 0
    failed = 0

    for art in articles:
        title = art.get("title") or "Untitled"
        yield {"type": "progress", "done": done, "total": total, "current_title": title}

        try:
            slug = art["slug"]

            # Markdown → HTML; rewrite local image paths to absolute URLs only when reachable
            body_html = _md.markdown(art.get("body") or "", extensions=["extra"])
            if not is_local:
                body_html = body_html.replace(
                    'src="/static/', f'src="{public_base}/static/'
                ).replace(
                    "src='/static/", f"src='{public_base}/static/"
                )
            else:
                # Strip <img> tags entirely — localhost URLs are unreachable by Shopify
                soup = BeautifulSoup(body_html, "html.parser")
                for img_tag in soup.find_all("img"):
                    img_tag.decompose()
                body_html = str(soup)

            # Hero image — omit when running on localhost (unreachable by Shopify)
            hero_image = art.get("hero_image")
            image_payload = None
            if hero_image and not is_local:
                image_payload = {
                    "url": f"{public_base}/static/articles/{slug}/{hero_image}",
                    "altText": title,
                }

            # Combine categories (prefixed "cat:") + tags for Shopify tags field
            categories = art.get("categories") or []
            tags = art.get("tags") or []
            all_tags = [f"cat:{c}" for c in categories] + tags

            pub_at = art.get("published_at")
            pub_iso = pub_at or datetime.now(timezone.utc).isoformat()

            variables: dict = {
                "article": {
                    "blogId": blog_id,
                    "title": title,
                    "body": body_html,
                    "author": {"name": author},
                    "tags": all_tags,
                    "publishDate": pub_iso,
                    "isPublished": True,
                }
            }
            if image_payload:
                variables["article"]["image"] = image_payload

            data = await _gql(shop_url, access_token, _CREATE_ARTICLE_MUTATION, variables)
            result = data.get("articleCreate", {})
            errors = result.get("userErrors", [])
            if errors:
                raise ValueError(str(errors))

            created = result.get("article", {})
            yield {"type": "exported", "title": title, "handle": created.get("handle", "")}
            done += 1
        except Exception as e:
            yield {"type": "error", "title": title, "error": str(e)}
            failed += 1

    yield {"type": "done", "exported": done, "failed": failed}
