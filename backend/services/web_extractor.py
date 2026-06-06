"""
Single-URL web article extractor.
Scrapes HTML, converts to Markdown, downloads images to a staging directory.
"""
import re
import uuid
from typing import Optional
from urllib.parse import urljoin, urlparse

import html2text
import httpx
from bs4 import BeautifulSoup, Tag

from services.storage import download_and_save

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"
}

# Class/id fragments that indicate navigation or peripheral content
_NOISE_RE = re.compile(
    r"(^nav$|navigation|sidebar|related|series|breadcrumb|^header$|^footer$"
    r"|site-header|site-footer|global-header|global-footer"
    r"|main-menu|global-nav|overlay|pagenation|pagination|sns-share|comment-area)",
    re.IGNORECASE,
)


def _html_to_md(html: str) -> str:
    converter = html2text.HTML2Text()
    converter.ignore_links = False
    converter.ignore_images = False
    converter.body_width = 0
    return converter.handle(html).strip()


def _absolute_url(base: str, src: str) -> Optional[str]:
    if not src or src in ("#", "") or src.startswith("data:"):
        return None
    return urljoin(base, src)


def _real_src(img: Tag) -> Optional[str]:
    """Resolve actual image URL, handling lazy-load patterns (data-src etc.)."""
    for attr in ("data-src", "data-lazy-src", "data-original", "data-lazy"):
        val = img.get(attr, "")
        if val and val not in ("#", ""):
            return str(val)
    # srcset: take first URL
    srcset = img.get("srcset", "")
    if srcset:
        first = str(srcset).split()[0]
        if first and first not in ("#", ""):
            return first
    src = img.get("src", "")
    if src and src not in ("#", ""):
        return str(src)
    return None


def _is_noise(el: Tag) -> bool:
    try:
        cls = " ".join(el.get("class") or [])
        eid = str(el.get("id") or "")
        return bool(_NOISE_RE.search(cls) or _NOISE_RE.search(eid))
    except Exception:
        return False


def _strip_global_noise(soup: BeautifulSoup) -> None:
    """Remove noise elements from the entire document before content selection."""
    # Remove semantic noise tags
    for tag in list(soup.find_all(["nav", "header", "footer", "aside"])):
        try:
            tag.decompose()
        except Exception:
            pass
    # Remove elements whose class/id match noise patterns
    for tag in list(soup.find_all(True)):
        try:
            if isinstance(tag, Tag) and tag.attrs is not None and _is_noise(tag):
                tag.decompose()
        except Exception:
            pass


def _count_real_imgs(el: Tag) -> int:
    return sum(1 for img in el.find_all("img") if _real_src(img))


def _find_content_element(soup: BeautifulSoup) -> Tag:
    """Select the most article-like content container."""
    # 1. Specific CMS/blog selectors
    for sel in [
        ".entry-content", ".post-content", ".article-body", ".article__body",
        ".story-body", ".post-body", ".content-body", ".js-article-body",
        "article .content", ".article-detail", ".recipe-detail",
    ]:
        el = soup.select_one(sel)
        if el and len(el.get_text(strip=True)) > 200:
            return el

    # 2. Standalone <article> elements
    for art in soup.find_all("article"):
        if len(art.get_text(strip=True)) > 200:
            return art

    # 3. <main>
    main = soup.find("main")
    if main and len(main.get_text(strip=True)) > 200:
        return main

    # 4. Score-based: prefer elements with real images + sufficient text.
    #    Tiebreak by depth (prefer deeper/more-specific elements).
    best_el: Optional[Tag] = None
    best_score = (0, 0)  # (img_count, text_len)
    for el in soup.find_all(["div", "section"]):
        imgs = _count_real_imgs(el)
        text_len = len(el.get_text(strip=True))
        if imgs < 2 or text_len < 300:
            continue
        depth = len(list(el.parents))
        score = (imgs, depth)  # more images → better; deeper → better tiebreak
        if score > best_score:
            best_score = score
            best_el = el

    return best_el or soup.find("body") or soup


def _extract_title(soup: BeautifulSoup) -> str:
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        return str(og["content"]).strip()
    for sel in ["h1.entry-title", "h1.post-title", "article h1", "main h1", "h1"]:
        el = soup.select_one(sel)
        if el:
            return el.get_text(strip=True)
    title_tag = soup.find("title")
    if title_tag:
        return title_tag.get_text(strip=True)
    return "Untitled"


def _extract_og_image(soup: BeautifulSoup, base: str) -> Optional[str]:
    og = soup.find("meta", property="og:image")
    if og and og.get("content"):
        return _absolute_url(base, str(og["content"]))
    return None


def _extract_published_at(soup: BeautifulSoup) -> Optional[str]:
    for prop in ["article:published_time", "article:modified_time", "og:updated_time"]:
        meta = soup.find("meta", property=prop)
        if meta and meta.get("content"):
            return str(meta["content"])
    time_el = soup.find("time", attrs={"datetime": True})
    if time_el:
        return str(time_el["datetime"])
    for sel in [".published", ".entry-date", ".post-date", ".date"]:
        el = soup.select_one(sel)
        if el:
            dt = el.get("datetime") or el.get_text(strip=True)
            if dt:
                return str(dt)
    return None


def _remove_extracted_from_content(content_el: Tag, title: str, hero_img_url: Optional[str]) -> None:
    """Remove title h1 and hero img from body to avoid duplication with article fields."""
    if title and title != "Untitled":
        for h1 in content_el.find_all("h1"):
            if h1.get_text(strip=True) == title:
                h1.decompose()
                break
    if hero_img_url:
        for img in content_el.find_all("img"):
            if img.get("src") == hero_img_url:
                parent = img.parent
                img.decompose()
                if parent and parent.name in ("figure", "p") and not parent.get_text(strip=True) and not parent.find_all():
                    parent.decompose()
                break


def _resolve_lazy_images(content_el: Tag, base: str) -> list[str]:
    """
    Collect real image URLs from a content element.
    Rewrites img[src] in-place so html2text produces correct Markdown.
    """
    img_urls: list[str] = []
    seen: set[str] = set()
    for img in content_el.find_all("img"):
        raw = _real_src(img)
        if not raw:
            continue
        abs_url = _absolute_url(base, raw)
        if not abs_url or abs_url in seen:
            continue
        # Skip non-image files
        lower = abs_url.lower().split("?")[0]
        if lower.endswith((".svg", ".gif", ".ico")):
            continue
        seen.add(abs_url)
        img["src"] = abs_url
        # Remove lazy-load attrs to avoid confusing html2text
        for attr in ("data-src", "data-lazy-src", "data-original", "data-lazy", "srcset"):
            img.attrs.pop(attr, None)
        img_urls.append(abs_url)
    return img_urls


async def extract_article(url: str) -> dict:
    """Scrape a URL and return article data with images in a staging directory."""
    staging_slug = f"staging_{uuid.uuid4().hex[:8]}"
    parsed = urlparse(url)
    base = f"{parsed.scheme}://{parsed.netloc}"

    async with httpx.AsyncClient(headers=HEADERS, timeout=30, follow_redirects=True) as client:
        r = await client.get(url)
        r.raise_for_status()
        html = r.text

    soup = BeautifulSoup(html, "html.parser")

    # Extract title/date/og:image BEFORE stripping noise (they live in head/header)
    title = _extract_title(soup)
    published_at = _extract_published_at(soup)
    og_hero_url = _extract_og_image(soup, base)

    # Strip global noise elements; find the best content container
    _strip_global_noise(soup)
    content_el = _find_content_element(soup)
    img_urls = _resolve_lazy_images(content_el, base)

    # Hero: og:image preferred, else first body image
    hero_img_url = og_hero_url or (img_urls[0] if img_urls else None)
    # All extra images (used for body rewriting); cap at 20 to avoid huge downloads
    extra_img_urls = [u for u in img_urls if u != hero_img_url][:20]

    # Remove title h1 and hero img from body to avoid duplication
    _remove_extracted_from_content(content_el, title, hero_img_url)
    body_html = str(content_el)

    # Download hero
    hero_rel: Optional[str] = None
    if hero_img_url:
        hero_rel = await download_and_save(staging_slug, hero_img_url, "hero.jpg", is_hero=True)

    # Build rewrite map: hero + all extra images (for complete body URL rewriting)
    url_rewrite: dict[str, str] = {}
    if hero_img_url and hero_rel:
        url_rewrite[hero_img_url] = f"/static/articles/{staging_slug}/{hero_rel}"

    extra_rels: list[str] = []
    for img_url in extra_img_urls:
        fname = re.sub(r"[?#].*$", "", img_url.split("/")[-1]) or "image.jpg"
        rel = await download_and_save(staging_slug, img_url, fname)
        if rel:
            extra_rels.append(rel)
            url_rewrite[img_url] = f"/static/articles/{staging_slug}/{rel}"

    # Rewrite all image URLs in body HTML to local staging paths
    for orig_url, local_url in url_rewrite.items():
        body_html = body_html.replace(orig_url, local_url)

    body_md = _html_to_md(body_html)
    body_md += f"\n\n---\n出典: {url}"

    return {
        "staging_slug": staging_slug,
        "title": title,
        "body": body_md,
        "hero_url": f"/static/articles/{staging_slug}/{hero_rel}" if hero_rel else None,
        "additional_urls": [f"/static/articles/{staging_slug}/{r}" for r in extra_rels[:9]],
        "published_at": published_at,
        "source_url": url,
    }
