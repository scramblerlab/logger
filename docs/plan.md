# Plan: logger — Unified Blog App

## Context

The user (scramblerlab@gmail.com) runs a lifestyle blog across 6 WordPress sub-sites at scrambler-lab.com covering motorcycles, hot springs, public baths, container/DIY, cooking, and photography. The goal is to migrate all content into a single, locally-hosted, AI-powered blog app named **logger** — accessible worldwide via CloudFlare tunnel. The new app must handle article creation, AI auto-classification, structured storage, and bulk import from the existing WordPress sites.

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Backend | Python 3.11 + FastAPI | User preference; good for scraping/AI |
| Frontend | React 18 + Vite + TypeScript | User preference |
| Styling | Tailwind CSS | Rapid UI without custom CSS overhead |
| ORM / DB | SQLite + SQLAlchemy (async) | Zero-config, file-based, portable |
| AI | Anthropic Python SDK (`claude-sonnet-4-6`) | Claude for classification + tagging |
| Scraping | `httpx` + `BeautifulSoup4` + WordPress REST API | WP REST first, HTML scraping fallback |
| Markdown | `html2text` (import) + `@uiw/react-md-editor` (frontend) | |
| Images | Pillow for resize/optimize; local filesystem storage | |
| Tunnel | `cloudflared` (Homebrew) | Mac launchd service |

---

## Project Layout

```
/Users/nobu/dev/ai/logger/          ← project root ("logger")
├── backend/
│   ├── main.py                     # FastAPI app + CORS + static mount
│   ├── database.py                 # SQLAlchemy async engine + session
│   ├── models.py                   # ORM models: Article, Category, Tag
│   ├── schemas.py                  # Pydantic request/response schemas
│   ├── routers/
│   │   ├── articles.py             # CRUD + image upload
│   │   ├── categories.py           # List categories + tag counts
│   │   ├── search.py               # Full-text search (SQLite FTS5)
│   │   └── importer.py             # WP import: analyze + run + SSE status
│   ├── services/
│   │   ├── ai_classifier.py        # Claude API: classify + tag articles
│   │   ├── wp_importer.py          # WordPress REST API + HTML scraper
│   │   └── storage.py              # Filesystem: save/read article.json + images
│   ├── data/                       # Persistent data (gitignored large files)
│   │   ├── blog.db                 # SQLite database
│   │   └── articles/               # One folder per article
│   │       └── [slug]/
│   │           ├── article.json
│   │           ├── hero.jpg
│   │           └── images/
│   ├── requirements.txt
│   └── .env                        # ANTHROPIC_API_KEY, etc.
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx            # Landing: card grid + sidebar
│   │   │   ├── ArticlePage.tsx     # Full article view
│   │   │   ├── WritePage.tsx       # New/edit article form
│   │   │   └── ImportPage.tsx      # Bulk import UI
│   │   ├── components/
│   │   │   ├── ArticleCard.tsx     # Hero image + title + badges
│   │   │   ├── Sidebar.tsx         # Category nav + tag cloud + hot picks
│   │   │   ├── SearchBar.tsx       # Real-time search input
│   │   │   ├── CategoryFilter.tsx  # Horizontal tab/chip filter
│   │   │   └── ImageUploader.tsx   # Drag-and-drop multi-image
│   │   ├── api/
│   │   │   └── client.ts           # Axios/fetch wrapper against FastAPI
│   │   ├── types.ts                # Article, Category, Tag types
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts              # Proxy /api → localhost:8000
└── cloudflare/
    └── config.yml                  # cloudflared tunnel config
```

---

## Data Model

### SQLite Tables

**`articles`**
```
id TEXT PK (UUID), slug TEXT UNIQUE, title TEXT, title_ja TEXT,
body TEXT (Markdown), hero_image TEXT (relative path),
categories TEXT (JSON array), tags TEXT (JSON array),
published_at DATETIME, source_url TEXT, source_site TEXT,
data_path TEXT, created_at DATETIME, updated_at DATETIME
```

**`categories`** (seeded at startup)
```
id, slug, name_en, name_ja, description, color (hex)
```
Predefined seeds:
- `bike` / バイク / #E84040
- `onsen` / 温泉 / #4A90D9
- `sentou` / 銭湯 / #7B68EE
- `container` / コンテナ / #F5A623
- `cooking` / 料理 / #7ED321
- `lens` / レンズ / #9B59B6
- `sauna` / サウナ / #FF6B35
- `auto` / 4輪 / #2ECC71
- `diy` / DIY / #95A5A6
- `beer` / ビール / #F39C12

**`tags`** (auto-created from articles)
```
id, slug, name, article_count
```

**FTS5 virtual table** over `articles(title, body)` for full-text search.

### Article JSON (filesystem, `data/articles/[slug]/article.json`)
```json
{
  "id": "...",
  "slug": "2024-01-15-yamaha-sr400-custom",
  "title": "Yamaha SR400 Custom",
  "title_ja": "ヤマハSR400カスタム",
  "body": "## ...",
  "heroImage": "hero.jpg",
  "additionalImages": ["images/01.jpg"],
  "categories": ["bike"],
  "tags": ["yamaha", "sr400", "custom"],
  "publishedAt": "2024-01-15T10:00:00Z",
  "sourceUrl": "https://www.scrambler-lab.com/bike/...",
  "sourceSite": "scrambler-lab.com"
}
```

---

## Feature Implementation Plan

### Phase 1 — Backend Foundation
1. `requirements.txt`: fastapi, uvicorn, sqlalchemy[asyncio], aiosqlite, anthropic, httpx, beautifulsoup4, html2text, Pillow, python-multipart, python-dotenv
2. `database.py`: async SQLAlchemy engine, session factory, `init_db()` that creates tables + seeds categories
3. `models.py`: SQLAlchemy ORM models
4. `schemas.py`: Pydantic v2 schemas for request/response
5. `main.py`: FastAPI app, CORS (allow localhost + cloudflare domain), mount `data/articles` as `/static`, include routers

### Phase 2 — Article CRUD API (`routers/articles.py`)
- `POST /api/articles` — accept JSON body + multipart images; save images via `storage.py`; call `ai_classifier.py`; write `article.json`; insert DB row
- `GET /api/articles` — list with query params: `category`, `tag`, `q` (search), `page`, `limit`; return cards (no full body)
- `GET /api/articles/{slug}` — full article
- `PUT /api/articles/{slug}` — update
- `DELETE /api/articles/{slug}` — remove DB + files

### Phase 3 — AI Classification (`services/ai_classifier.py`)
- Call `claude-sonnet-4-6` with a structured prompt:
  - System: "You are a blog post classifier. Predefined categories: bike, onsen, sentou, container, cooking, lens."
  - User: article title + first 500 chars of body
  - Expected JSON output: `{ "categories": [...], "tags": [...] }` (use Claude tool_use or JSON mode)
- Use `anthropic.Anthropic()` with `ANTHROPIC_API_KEY` from `.env`
- Return suggestions to the POST handler; if `auto_apply=true` the suggestions are saved directly, otherwise returned for user review

### Phase 4 — WordPress Importer (`services/wp_importer.py` + `routers/importer.py`)

**Key finding (discovered during testing):** `scrambler-lab.com` is a **WordPress Multisite network with subdirectory installs**. Each section (`/bike/`, `/onsen/`, etc.) is a completely independent WordPress installation with its own REST API endpoint at `{section}/wp-json/wp/v2/`. The root domain (`scrambler-lab.com`) hosts the **lens** blog. Initial implementation pointed all REST API calls at the domain root (`scrambler-lab.com/wp-json/wp/v2/`), which returned lens articles regardless of which section was requested.

A second bug: `categories_slug` is not a valid WP REST API parameter. Filtering by category requires first resolving the slug to a numeric ID via `/wp-json/wp/v2/categories?slug=<slug>`, then passing `?categories=<id>`.

**Implemented strategy (in order of priority):**
1. `_detect_wp_base(url)` — probes progressive URL path prefixes to locate the WordPress installation root. For `scrambler-lab.com/bike/` it finds `scrambler-lab.com/bike/` as the WP root; for a root install it falls back to the domain. Returns `(wp_base, cat_id_or_None)`.
2. WP REST API at the correct base with `_embed=wp:featuredmedia` to inline hero images (avoids N extra media requests).
3. If REST API fails: sitemap.xml / sitemap_index.xml parsing.
4. Final fallback: HTML scraping of listing + article pages via BeautifulSoup.

**Confirmed article counts (scrambler-lab.com):**
| Section | WP base path | Articles |
|---|---|---|
| `/bike/` | `/bike/wp-json/wp/v2/` | 201 |
| `/onsen/` | `/onsen/wp-json/wp/v2/` | 352 |
| `/sentou/` | `/sentou/wp-json/wp/v2/` | 79 |
| `/container/` | `/container/wp-json/wp/v2/` | 40 |
| `/cooking/` | `/cooking/wp-json/wp/v2/` | 43 |
| `/lens/` | `/lens/wp-json/wp/v2/` | 18 |

**API endpoints:**
- `POST /api/import/analyze` — body `{ "url": "https://scrambler-lab.com/bike/" }` → returns `{ article_count, sample_titles, detected_categories, method }`
- `POST /api/import/run` — body `{ "url": "...", "limit": null }` → SSE stream
- SSE events: `{ done, total, current }` progress, `{ saved }` per article, `{ finished, imported }` completion

### Phase 5 — Search (`routers/search.py`)
- Create FTS5 virtual table at `init_db()` time: `CREATE VIRTUAL TABLE articles_fts USING fts5(title, body, content=articles)`
- `GET /api/search?q=...` → `SELECT * FROM articles WHERE rowid IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?)`

### Phase 6 — Frontend (`frontend/src/`)

**Home page UX:**
- Top: sticky header with logo "logger", search bar, "Write" button
- Left sidebar (desktop) / top tabs (mobile): category filter chips (All | bike | onsen | ...), tag cloud (top 20 tags), "Hot" collection (3 cards per category carousel)
- Main area: masonry or 3-col responsive card grid, infinite scroll via `IntersectionObserver`
- Each `ArticleCard`: hero image (lazy-loaded), category color badge, title, date, tag chips

**Article page:**
- Full-width hero image
- Title (bilingual toggle if title_ja exists), date, category badge, tags
- Rendered Markdown body (`react-markdown` + `remark-gfm`)
- Inline images from `/static/[slug]/images/`

**Write page:**
- Bilingual title inputs (EN + JA)
- Hero image: drag-and-drop single image
- Additional images: multi-file picker
- `@uiw/react-md-editor` for body
- Category multi-select with color swatches
- Tag input with autocomplete (fetch `/api/tags`)
- Submit: calls `POST /api/articles`, shows AI-suggested tags with accept/edit dialog

**Import page:**
- URL input + "Analyze" button → shows preview table
- "Run Import" with progress bar (EventSource → SSE stream)
- Import history table

### Phase 7 — CloudFlare Tunnel
```yaml
# cloudflare/config.yml
tunnel: <TUNNEL_ID>
credentials-file: /Users/nobu/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: log.scrambler-lab.com  # or chosen subdomain
    service: http://localhost:8000
  - service: http_status:404
```
- Installation: `brew install cloudflared`
- Auth + tunnel creation: `cloudflared tunnel login && cloudflared tunnel create logger`
- DNS: `cloudflared tunnel route dns logger log.scrambler-lab.com`
- Autostart: `cloudflared service install` (creates launchd plist)

---

## Implementation Order

```
Step 1:  backend/ scaffold (main.py, database.py, models, schemas)
Step 2:  Article CRUD router + storage service
Step 3:  AI classifier service
Step 4:  Image upload handling
Step 5:  Search (FTS5)
Step 6:  WordPress importer service + router
Step 7:  frontend/ scaffold (Vite + React + Tailwind)
Step 8:  API client (types.ts + client.ts)
Step 9:  Home page (cards + sidebar + filters)
Step 10: Article page
Step 11: Write page (form + AI tag dialog)
Step 12: Import page (analyze + SSE progress)
Step 13: CloudFlare tunnel config + launchd setup
Step 14: Seed categories + run test import from one WP section
```

---

## Verification

1. **Unit**: `pytest backend/` — test AI classifier with a mock Anthropic client, test importer with a mock WP REST response
2. **Integration**: run `uvicorn backend.main:app --reload` and `vite dev`, POST a test article via the Write page, verify `data/articles/[slug]/` is created with correct `article.json` and hero image
3. **AI tagging**: post an article with body mentioning "温泉" → verify it gets tagged `onsen`
4. **Import**: run `POST /api/import/analyze` against scrambler-lab.com/bike/, verify article count preview matches expected; run a 5-article test import, verify cards appear on home page
5. **Tunnel**: after cloudflared setup, visit public hostname from a mobile device to verify end-to-end accessibility
6. **Search**: FTS5 query for a keyword known to appear in an imported article
