# WordPress Import

Implementation reference for the WordPress bulk import feature.

---

## Overview

The importer fetches all posts from a WordPress site and saves them locally as Markdown articles with downloaded images. It supports **three detection strategies** tried in order:

1. **WP REST API** — primary path; fast, structured, includes hero images inline
2. **Sitemap + HTML scrape** — fallback when the REST API is unavailable or returns nothing
3. **Archive page crawl** — last resort; follows `next` pagination links on listing pages

---

## WP REST API (primary path)

### Endpoint

```
GET {wp_base}/wp-json/wp/v2/posts
    ?per_page=100
    &page={n}
    &_embed=wp:featuredmedia
    [&categories={id}]
```

The `_embed=wp:featuredmedia` parameter inlines the featured image in the response, avoiding a separate request per article.

### Auto-detecting the installation root (`_detect_wp_base`)

scrambler-lab.com is a **WordPress Multisite** network with subdirectory installs. Each section (`/bike/`, `/onsen/`, etc.) is its own WP installation with its own REST API root.

When given a URL like `https://www.scrambler-lab.com/bike/category/touring/`, the importer tries progressively shorter path prefixes as candidate WP roots until it gets a `200` from `/wp-json/wp/v2/posts`:

```
https://www.scrambler-lab.com/bike/category/touring/  →  404
https://www.scrambler-lab.com/bike/category/          →  404
https://www.scrambler-lab.com/bike/                   →  200 ✓  ← WP root found
```

After finding the root, the remaining path segment (`category/touring` → slug `touring`) is resolved to a numeric category ID via:

```
GET {wp_base}/wp-json/wp/v2/categories?slug=touring&per_page=1
```

That ID is then passed as `&categories={id}` to filter posts.

### Total count

The REST API returns the total post count in the response header:

```
X-WP-Total: 201
```

Used for the progress bar during import and the article count shown in the analyze preview.

### Hero image extraction

From the `_embedded["wp:featuredmedia"]` block in each post response:

```
sizes.large.source_url  →  preferred (lower bandwidth)
sizes.full.source_url   →  fallback
media.source_url        →  last resort
```

### Response fields used

| Field | Used for |
|---|---|
| `title.rendered` | Article title (HTML-decoded via BeautifulSoup) |
| `content.rendered` | Body HTML |
| `date` | Published date (`YYYY-MM-DDTHH:MM:SS`) |
| `link` | Source URL (stored for reference) |
| `_embedded["wp:featuredmedia"]` | Hero image URL |

Body `<img>` tags are parsed separately for additional image URLs (up to 12 per article).

---

## Fallback: Sitemap + HTML Scraping

Used when the REST API is unavailable (disabled plugin, password-protected, etc.).

### Sitemap discovery

Tries these URLs in order:

```
{base}/sitemap.xml
{base}/sitemap_index.xml
{base}/post-sitemap.xml
```

Handles both flat sitemaps and sitemap index files (follows nested `<sitemap><loc>` entries). Article URLs are filtered by checking whether the target path prefix appears in each `<loc>`.

### HTML scraping per article

For each URL collected from the sitemap, the scraper tries CSS selectors in priority order:

**Title:**
```
h1.entry-title  →  h1.post-title  →  article h1  →  h1
```

**Body:**
```
.entry-content  →  .post-content  →  article .content  →  article
```

**Published date:**
```
time[datetime]  →  .published  →  .entry-date
```

**Hero image:**
```
<meta property="og:image">  →  .post-thumbnail img  →  .featured-image img  →  article img
```

Additional body images: all `<img src>` / `<img data-src>` / `<img data-lazy-src>` tags that differ from the hero (up to 10 per article).

### Archive page crawl (last resort)

If no sitemap is found, the importer scrapes listing pages following `<a class="next">` / `<a class="次">` pagination links to collect individual article URLs.

---

## Import Pipeline (per article)

Once raw post data is collected by any method, each article goes through the same pipeline:

```
1. Slug generation
   {YYYY-MM-DD}-{slugified-title}-{uuid4[:4]}
   e.g. 2026-05-01-yamaha-sr400-custom-a1b2

2. Hero image download
   download_and_save(slug, hero_url, "hero.jpg", is_hero=True)
   → saved as backend/data/articles/{slug}/hero.jpg

3. Body images download
   For each extra_image_url (up to 12):
     download_and_save(slug, img_url, original_filename)
     → saved as backend/data/articles/{slug}/images/{uuid8}_{filename}
   Build URL rewrite map: original_url → /static/articles/{slug}/images/...

4. Body conversion
   Replace original image URLs with local /static/... paths in the HTML
   html2text(body_html) → Markdown string

5. AI classification (if auto_classify=True and no categories yet)
   ai_classifier.classify(title, body_md)
   → categories: list[str], tags: list[str]

6. DB write
   INSERT Article(slug, title, body, hero_image, categories, tags, published_at, source_url)
   Upsert Tag rows with article_count

7. JSON write
   backend/data/articles/{slug}/article.json

8. SSE progress event
   → {"saved": title}  or  {"error": message}
```

After all articles are processed, `task_manager.start()` is called to kick off a background AI classification pass for any articles that still have no category.

---

## Image Storage

`storage.py` handles all image I/O:

| Function | What it does |
|---|---|
| `download_and_save(slug, url, filename, is_hero)` | Downloads URL, saves + optimizes |
| `save_upload(slug, bytes, filename, is_hero)` | Saves raw bytes (for editor uploads) |
| `_write_and_optimize(data, dest)` | Pillow: converts to RGB, resizes to ≤ 2048 px, saves JPEG at quality 85 |
| `write_article_json(slug, data)` | Writes `article.json` |
| `delete_article_files(slug)` | `shutil.rmtree` the article folder |

Hero images: `{slug}/hero.jpg`  
Body images: `{slug}/images/{uuid8}_{original_filename}`  
Served at: `/static/articles/{slug}/...` (FastAPI `StaticFiles` mount)

All images are converted to JPEG and capped at 2048 × 2048 regardless of input format (PNG, WebP, etc.).

---

## API Endpoints

### `POST /api/import/analyze`

Preview an import without saving anything. Returns article count + sample titles.

Request:
```json
{ "url": "https://www.scrambler-lab.com/bike/" }
```

Response:
```json
{
  "url": "https://www.scrambler-lab.com/bike/",
  "article_count": 201,
  "sample_titles": ["SR400 カスタム完成", "..."],
  "detected_categories": [],
  "method": "wp-rest-api"
}
```

`method` is one of `"wp-rest-api"` or `"html-scrape"` — indicates which detection path was used.

### `POST /api/import/run` (SSE stream, auth required)

Request:
```json
{
  "url": "https://www.scrambler-lab.com/bike/",
  "limit": 100,
  "auto_classify": true
}
```

SSE events streamed back:

| Event data | Meaning |
|---|---|
| `{"done": N, "total": M, "current": "title..."}` | Progress update |
| `{"saved": "Article Title"}` | Article saved successfully |
| `{"error": "...", "title": "..."}` | Article failed |
| `{"finished": true, "imported": N}` | All done |
| `[DONE]` | Stream closed |

---

## scrambler-lab.com Site Map

| Section | WP base URL | API root | Typical count |
|---|---|---|---|
| Bike | `scrambler-lab.com/bike/` | `/bike/wp-json/wp/v2/` | ~200 |
| Onsen | `scrambler-lab.com/onsen/` | `/onsen/wp-json/wp/v2/` | ~350 |
| Sentou | `scrambler-lab.com/sentou/` | `/sentou/wp-json/wp/v2/` | ~80 |
| Container | `scrambler-lab.com/container/` | `/container/wp-json/wp/v2/` | ~40 |
| Cooking | `scrambler-lab.com/cooking/` | `/cooking/wp-json/wp/v2/` | ~45 |
| Lens | `scrambler-lab.com/lens/` | `/lens/wp-json/wp/v2/` | ~20 |

Each section is an independent WP installation on a shared domain. The `_detect_wp_base` function handles this automatically — just paste any URL from any section and the correct API root is found.

---

## Known Limitations

| Limitation | Notes |
|---|---|
| No deduplication | Re-importing the same URL creates duplicate articles. Check existing content before re-running. |
| Body image cap | Up to 12 (REST API) or 10 (HTML scrape) body images per article are downloaded. |
| Private / paywalled sites | REST API requires no auth. Password-protected WP sites will fall through to HTML scraping; fully private sites cannot be imported. |
| Lazy-loaded images | `data-lazy-src` and `data-src` attributes are checked, but JavaScript-rendered content is not executed — images loaded purely via JS may be missed. |
| Tag import | WP tags are not fetched from the REST API. Tags come entirely from AI classification after import. |
