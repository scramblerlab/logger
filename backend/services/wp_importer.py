"""
WordPress importer: tries WP REST API first, falls back to sitemap + HTML scraping.
"""
import asyncio
import re
from datetime import datetime, timezone
from typing import AsyncIterator
from urllib.parse import urljoin, urlparse

import html2text
import httpx
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"
}


def _base_url(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


async def _detect_wp_base(client: httpx.AsyncClient, url: str) -> tuple[str, int | None]:
    """
    Find the WordPress REST API installation root and the category ID to filter by.

    For a WordPress Multisite / subdirectory install like scrambler-lab.com/bike/,
    the REST API lives at that subdirectory, not at the domain root.

    Returns (wp_base_url, category_id_or_None).
    category_id is None when the sub-blog is already scoped to a single topic.
    """
    parsed = urlparse(url)
    domain_base = f"{parsed.scheme}://{parsed.netloc}"
    path_segments = [s for s in parsed.path.strip("/").split("/") if s]

    # Build candidates: try progressively shorter path prefixes as WP roots.
    # e.g. for /bike/category/foo/ we try:
    #   https://host/bike/category/foo/  →  https://host/bike/  →  https://host/
    candidates: list[str] = []
    for i in range(len(path_segments), -1, -1):
        prefix = "/".join(path_segments[:i])
        candidates.append(f"{domain_base}/{prefix}/" if prefix else f"{domain_base}/")

    for wp_base in candidates:
        try:
            r = await client.get(
                f"{wp_base}wp-json/wp/v2/posts",
                params={"per_page": 1, "_fields": "id"},
                timeout=8,
            )
            if r.status_code == 200 and r.json():
                # Found the WP root. Now decide if we need category filtering.
                # If wp_base == domain_base + "/" (i.e., root install) and the URL
                # had a path segment, that segment is a category slug to filter by.
                remaining_path = url[len(wp_base):].strip("/").split("/")[0] if len(url) > len(wp_base) else ""
                cat_id = None
                if remaining_path:
                    cat_id = await _resolve_category_id(client, wp_base.rstrip("/"), remaining_path)
                return wp_base.rstrip("/"), cat_id
        except Exception:
            continue

    return domain_base, None


def _html_to_md(html: str) -> str:
    converter = html2text.HTML2Text()
    converter.ignore_links = False
    converter.ignore_images = False
    converter.body_width = 0
    return converter.handle(html).strip()


async def analyze(url: str) -> dict:
    """Return a preview of what would be imported from a WP site URL."""
    base = _base_url(url)
    async with httpx.AsyncClient(headers=HEADERS, timeout=20, follow_redirects=True) as client:
        method, posts = await _fetch_posts(client, url, base, limit=5)

    titles = [p.get("title", "") for p in posts[:5]]
    cats = list({c for p in posts for c in p.get("categories", [])})

    total = await _estimate_count(url, base)
    return {
        "url": url,
        "article_count": total,
        "sample_titles": titles,
        "detected_categories": cats,
        "method": method,
    }


async def _resolve_category_id(client: httpx.AsyncClient, base: str, slug: str) -> int | None:
    """Look up the WP category numeric ID from its slug."""
    try:
        r = await client.get(
            f"{base}/wp-json/wp/v2/categories",
            params={"slug": slug, "_fields": "id,slug,name", "per_page": 1},
        )
        if r.status_code == 200:
            cats = r.json()
            if cats:
                return cats[0]["id"]
    except Exception:
        pass
    return None


async def _estimate_count(url: str, base: str) -> int:
    async with httpx.AsyncClient(headers=HEADERS, timeout=15, follow_redirects=True) as client:
        try:
            wp_base, cat_id = await _detect_wp_base(client, url)
            params: dict = {"per_page": 1, "_fields": "id"}
            if cat_id:
                params["categories"] = cat_id
            r = await client.get(f"{wp_base}/wp-json/wp/v2/posts", params=params)
            if r.status_code == 200:
                total = int(r.headers.get("X-WP-Total", 0))
                if total > 0:
                    return total
        except Exception:
            pass
        # Fallback: count sitemap entries whose URL contains the category path
        try:
            sm = await client.get(f"{base}/sitemap.xml")
            if sm.status_code == 200:
                soup = BeautifulSoup(sm.text, "xml")
                locs = soup.find_all("loc")
                path_prefix = urlparse(url).path.rstrip("/")
                return sum(1 for l in locs if path_prefix in l.text)
        except Exception:
            pass
    return 0


async def _fetch_posts(client: httpx.AsyncClient, url: str, base: str, limit: int = 100) -> tuple[str, list[dict]]:
    """Returns (method, list_of_raw_post_dicts)."""
    path = urlparse(url).path.strip("/")

    # --- Try WP REST API ---
    try:
        # Auto-detect the WP installation root (handles Multisite subdirectory installs).
        wp_base, cat_id = await _detect_wp_base(client, url)

        page, posts = 1, []
        while True:
            params: dict = {
                "per_page": min(100, limit - len(posts)),
                "page": page,
                "_embed": "wp:featuredmedia",  # inline hero image — no extra requests needed
            }
            if cat_id:
                params["categories"] = cat_id

            r = await client.get(f"{wp_base}/wp-json/wp/v2/posts", params=params)
            if r.status_code not in (200, 201):
                break
            batch = r.json()
            if not batch:
                break
            for p in batch:
                # Extract hero image from embedded media
                hero_url = None
                try:
                    media_list = p.get("_embedded", {}).get("wp:featuredmedia", [])
                    if media_list:
                        media = media_list[0]
                        sizes = media.get("media_details", {}).get("sizes", {})
                        hero_url = (
                            sizes.get("large", {}).get("source_url")
                            or sizes.get("full", {}).get("source_url")
                            or media.get("source_url")
                        )
                except Exception:
                    pass

                body_html = p["content"]["rendered"]
                extra_image_urls = []
                try:
                    body_soup = BeautifulSoup(body_html, "html.parser")
                    for img in body_soup.find_all("img"):
                        src = (img.get("src") or img.get("data-lazy-src")
                               or img.get("data-src"))
                        if src and src != hero_url:
                            extra_image_urls.append(src)
                except Exception:
                    pass

                posts.append({
                    "title": BeautifulSoup(f"<span>{p['title']['rendered']}</span>", "html.parser").get_text(),
                    "body_html": body_html,
                    "published_at": p.get("date"),
                    "source_url": p.get("link", ""),
                    "categories": [],
                    "hero_image_url": hero_url,
                    "extra_image_urls": extra_image_urls[:12],
                })
            if len(posts) >= limit or len(batch) < 100:
                break
            page += 1
        if posts:
            return "wp-rest-api", posts
    except Exception:
        pass

    # --- Fallback: sitemap + HTML scraping ---
    # Use wp_base if we found it, otherwise fall back to domain base
    try:
        fallback_base = wp_base
    except NameError:
        fallback_base = base
    urls = await _get_urls_from_sitemap_or_listing(client, url, fallback_base, limit)
    posts = []
    for article_url in urls[:limit]:
        p = await _scrape_article(client, article_url)
        if p:
            posts.append(p)
    return "html-scrape", posts


async def _get_urls_from_sitemap_or_listing(client, url, base, limit) -> list[str]:
    path_prefix = urlparse(url).path.rstrip("/")
    urls = []

    # Try sitemap
    for sm_url in [f"{base}/sitemap.xml", f"{base}/sitemap_index.xml", f"{base}/post-sitemap.xml"]:
        try:
            r = await client.get(sm_url)
            if r.status_code == 200:
                soup = BeautifulSoup(r.text, "xml")
                # Handle sitemap index
                sitemaps = soup.find_all("sitemap")
                if sitemaps:
                    for sm in sitemaps:
                        loc = sm.find("loc")
                        if loc:
                            r2 = await client.get(loc.text)
                            if r2.status_code == 200:
                                soup2 = BeautifulSoup(r2.text, "xml")
                                for l in soup2.find_all("loc"):
                                    if path_prefix in l.text:
                                        urls.append(l.text)
                else:
                    for l in soup.find_all("loc"):
                        if path_prefix in l.text and l.text != url:
                            urls.append(l.text)
                if urls:
                    return urls[:limit]
        except Exception:
            pass

    # Scrape listing pages
    page_url = url
    seen = set()
    while len(urls) < limit:
        try:
            r = await client.get(page_url)
            if r.status_code != 200:
                break
            soup = BeautifulSoup(r.text, "html.parser")
            found = False
            for a in soup.find_all("a", href=True):
                href = urljoin(base, a["href"])
                if href.startswith(url) and href != url and href not in seen:
                    seen.add(href)
                    urls.append(href)
                    found = True
            # Next page
            nxt = soup.find("a", class_=re.compile(r"next|次"))
            if nxt and nxt.get("href"):
                page_url = urljoin(base, nxt["href"])
            else:
                break
        except Exception:
            break
    return urls[:limit]


async def _scrape_article(client: httpx.AsyncClient, url: str) -> dict | None:
    try:
        r = await client.get(url)
        if r.status_code != 200:
            return None
        soup = BeautifulSoup(r.text, "html.parser")

        title = ""
        for sel in ["h1.entry-title", "h1.post-title", "article h1", "h1"]:
            el = soup.select_one(sel)
            if el:
                title = el.get_text(strip=True)
                break

        body_html = ""
        for sel in [".entry-content", ".post-content", "article .content", "article"]:
            el = soup.select_one(sel)
            if el:
                body_html = str(el)
                break

        date_str = None
        for sel in ["time[datetime]", ".published", ".entry-date"]:
            el = soup.select_one(sel)
            if el:
                date_str = el.get("datetime") or el.get_text(strip=True)
                break

        # Hero image
        hero_url = None
        og_img = soup.find("meta", property="og:image")
        if og_img:
            hero_url = og_img.get("content")
        if not hero_url:
            for sel in [".post-thumbnail img", ".featured-image img", "article img"]:
                el = soup.select_one(sel)
                if el:
                    hero_url = el.get("src") or el.get("data-src")
                    break

        # Additional images from body
        extra_images = []
        if body_html:
            body_soup = BeautifulSoup(body_html, "html.parser")
            for img in body_soup.find_all("img"):
                src = img.get("src") or img.get("data-src") or img.get("data-lazy-src")
                if src and src != hero_url:
                    extra_images.append(urljoin(url, src))

        return {
            "title": title,
            "body_html": body_html,
            "published_at": date_str,
            "source_url": url,
            "categories": [],
            "hero_image_url": hero_url,
            "extra_image_urls": extra_images[:10],
        }
    except Exception:
        return None


async def import_articles(
    url: str,
    limit: int | None = None,
    auto_classify: bool = True,
) -> AsyncIterator[dict]:
    """
    Async generator — yields progress dicts:
      {"type": "progress", "done": N, "total": M, "current_title": "..."}
      {"type": "article", "data": {...article fields...}}
      {"type": "done", "imported": N, "failed": N}
    """
    base = _base_url(url)
    lim = limit or 500
    async with httpx.AsyncClient(headers=HEADERS, timeout=30, follow_redirects=True) as client:
        method, posts = await _fetch_posts(client, url, base, limit=lim)

    total = len(posts)
    done = 0
    failed = 0

    for raw in posts:
        title = raw.get("title", "Untitled")
        yield {"type": "progress", "done": done, "total": total, "current_title": title}

        # Build slug first — needed for image paths
        from services.storage import download_and_save
        from slugify import slugify

        slug_base = slugify(title, max_length=60, separator="-") or "article"
        pub = raw.get("published_at")
        if pub:
            try:
                dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
                date_prefix = dt.strftime("%Y-%m-%d")
            except Exception:
                date_prefix = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        else:
            date_prefix = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        import uuid as _uuid
        slug = f"{date_prefix}-{slug_base}-{_uuid.uuid4().hex[:4]}"

        # Download hero
        hero_rel = None
        if raw.get("hero_image_url"):
            hero_rel = await download_and_save(slug, raw["hero_image_url"], "hero.jpg", is_hero=True)

        # Download body images and build a rewrite map (original URL → local static path)
        extra_rels = []
        url_rewrite: dict[str, str] = {}
        for img_url in raw.get("extra_image_urls", [])[:12]:
            fname = img_url.split("/")[-1].split("?")[0] or "image.jpg"
            rel = await download_and_save(slug, img_url, fname)
            if rel:
                extra_rels.append(rel)
                url_rewrite[img_url] = f"/static/articles/{slug}/{rel}"

        # Rewrite image URLs in body HTML to local paths, then convert to Markdown
        body_html = raw.get("body_html", "")
        for orig_url, local_url in url_rewrite.items():
            body_html = body_html.replace(orig_url, local_url)
        body_md = _html_to_md(body_html)

        categories = raw.get("categories", [])
        tags = raw.get("tags", [])

        if auto_classify and not categories:
            from services.ai_classifier import classify
            result = await classify(title, body_md)
            categories = result.get("categories", [])
            tags = tags or result.get("tags", [])

        pub_dt = None
        if pub:
            try:
                pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00"))
            except Exception:
                pass

        article_data = {
            "slug": slug,
            "title": title,
            "body": body_md,
            "hero_image": hero_rel,
            "additional_images": extra_rels,
            "categories": categories,
            "tags": tags,
            "published_at": pub_dt.isoformat() if pub_dt else None,
            "source_url": raw.get("source_url"),
        }

        yield {"type": "article", "data": article_data}
        done += 1

    yield {"type": "done", "imported": done, "failed": failed}
