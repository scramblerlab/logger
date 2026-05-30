# logger

A self-hosted, AI-powered lifestyle blog app. Consolidates content from six WordPress sub-sites at scrambler-lab.com into a single searchable interface, with local AI auto-classification, bulk import, and worldwide access via CloudFlare tunnel.

---

## Overview

| Feature | Details |
|---|---|
| **Post articles** | Web UI with Markdown editor, hero image drag-and-drop, bilingual title (EN/JA) |
| **AI tagging** | Per-article "✦ AI分析" button — local Ollama model auto-assigns categories and tags |
| **Bulk AI classify** | "AI分類" button classifies all uncategorized articles in one pass |
| **Category management** | Add / delete categories from the sidebar; article counts shown inline |
| **Browse** | Card grid with hero image, category badge, tags; dark-themed sidebar + tag cloud |
| **Search** | SQLite FTS5 full-text search across titles and body content |
| **Bulk import** | One-click import from any WordPress site — REST API with sitemap/HTML fallback |
| **Image editing** | Edit page lets you replace the hero image and add/remove additional images |
| **Public access** | CloudFlare tunnel exposes localhost to the internet without port-forwarding |

**Categories (seeds):** bike / onsen / sentou / container / cooking / lens / sauna / auto / diy / beer

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy async, SQLite |
| AI | Ollama (local) — `gemma4:e2b-mlx` (Apple Silicon MLX, ~7 GB) |
| Scraping | `httpx` + `BeautifulSoup4` + WordPress REST API |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, dark theme |
| Tunnel | `cloudflared` (Homebrew), Mac launchd autostart |

---

## Folder Structure

```
logger/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── database.py          # SQLite engine, DB init, category seeds
│   ├── models.py            # SQLAlchemy ORM: Article, Category, Tag
│   ├── schemas.py           # Pydantic request/response schemas
│   ├── routers/
│   │   ├── articles.py      # CRUD + image upload + AI classify endpoints
│   │   ├── categories.py    # Category list + CRUD + tag counts
│   │   ├── search.py        # FTS5 full-text search
│   │   └── importer.py      # Bulk import (SSE streaming)
│   ├── services/
│   │   ├── ai_classifier.py # Ollama API: auto-categorise + tag
│   │   ├── wp_importer.py   # WordPress importer (REST API / sitemap / scrape)
│   │   └── storage.py       # Image save/optimise, article.json read/write
│   ├── data/                # ⚠ NOT in git — see "Article Data" section below
│   │   ├── blog.db          # SQLite database
│   │   └── articles/        # One folder per article
│   │       └── [slug]/
│   │           ├── article.json
│   │           ├── hero.jpg
│   │           └── images/
│   ├── .env                 # ⚠ NOT in git — copy from .env.example
│   ├── .env.example         # Template for .env
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx         # Landing page: card grid + sidebar + filters
│   │   │   ├── ArticlePage.tsx  # Full article with Markdown rendering
│   │   │   ├── WritePage.tsx    # New/edit article form + AI analysis button
│   │   │   └── ImportPage.tsx   # Bulk import UI
│   │   ├── components/
│   │   │   ├── Header.tsx           # Sticky header with search + Write button
│   │   │   ├── ArticleCard.tsx      # Card: hero image, category badge, tags
│   │   │   ├── Sidebar.tsx          # Category nav + AI classify + tag cloud
│   │   │   └── CategoryEditModal.tsx # Add/delete categories
│   │   ├── api/client.ts        # Fetch wrapper against FastAPI
│   │   └── types.ts             # Shared TypeScript types
│   ├── vite.config.ts           # Proxy /api and /static → localhost:8000
│   └── package.json
├── cloudflare/
│   ├── config.yml           # cloudflared tunnel config (fill in TUNNEL_ID)
│   └── setup.md             # Step-by-step CloudFlare tunnel setup guide
├── docs/
│   └── plan.md              # Architecture and design decisions
├── setup.sh                 # First-time setup (deps + Ollama + model pull)
├── start.sh                 # Start Ollama + both servers with one command
└── .gitignore
```

---

## Article Data

> **Location:** `backend/data/`
> **Not committed to git** (listed in `.gitignore`)

All imported and authored content lives here:

```
backend/data/
├── blog.db                        # SQLite DB (articles, categories, tags)
└── articles/
    └── 2024-01-15-yamaha-sr400-custom-a1b2/
        ├── article.json           # Full article metadata + body (Markdown)
        ├── hero.jpg               # Hero image (optimised JPEG, max 2048px)
        └── images/
            ├── 8fa3_photo1.jpg
            └── 9cd1_photo2.jpg
```

**Back this directory up separately.** See the [Backup & Restore](#backup--restore) section below.

---

## Backup & Restore

> **Why this matters:** the WordPress sites will be deprecated. Once they go offline, `backend/data/` is the only copy of all article content.

### What needs to be backed up

| Path | Contents |
|---|---|
| `backend/data/blog.db` | SQLite DB — all articles, categories, tags |
| `backend/data/articles/` | One folder per article: `article.json` + images |

### Option A — Google Drive via rclone (recommended)

```bash
brew install rclone
rclone config
# → name it "gdrive", choose Google Drive, follow OAuth flow

# Manual backup
rclone sync /Users/nobu/dev/ai/logger/backend/data/ gdrive:logger-backup/data/ --progress

# Automated daily backup (3 AM)
crontab -e
# Add: 0 3 * * * /opt/homebrew/bin/rclone sync /Users/nobu/dev/ai/logger/backend/data/ gdrive:logger-backup/data/ --log-file=/tmp/logger-backup.log
```

### Option B — Google Drive for Desktop

```bash
ln -s /Users/nobu/dev/ai/logger/backend/data \
      ~/Library/CloudStorage/GoogleDrive-scramblerlab@gmail.com/My\ Drive/logger-backup
```

### Option C — Time Machine (local, always-on)

Automatic as long as the project is under your home directory. Secondary layer only.

---

### Restore — moving to a new machine

**Full restore (DB + files intact):**

```bash
git clone <this-repo> logger && cd logger
rclone sync gdrive:logger-backup/data/ backend/data/ --progress
./setup.sh        # installs deps + Ollama + pulls model
./start.sh
```

**Partial restore (JSON files only, DB lost):**

```bash
cd backend
.venv/bin/python rebuild_db.py   # not yet implemented — see note below
```

> `rebuild_db.py` does not exist yet. If needed, it would iterate every `article.json` under `data/articles/`, parse the fields, and `INSERT OR IGNORE` into the `articles` table (~30 lines).

**Full loss (no backup):**

Re-run bulk import from the Import page. All 6 WordPress sections remain accessible at their current URLs until the sites are taken down. AI classification will re-run on each article. Locally authored articles cannot be recovered without a backup.

---

## Getting Started

### Prerequisites

- macOS (tested on Apple Silicon)
- Python 3.12 via [`uv`](https://github.com/astral-sh/uv) (`brew install uv`)
- Node.js 18+ and npm
- [Homebrew](https://brew.sh/)

### 1 — Clone and run setup

```bash
git clone <this-repo> logger
cd logger
./setup.sh
```

`setup.sh` handles everything in one pass:
1. Creates Python venv and installs backend dependencies
2. Copies `backend/.env.example` → `backend/.env` (if not present)
3. Runs `npm install` for the frontend
4. Installs Ollama (via Homebrew), starts `ollama serve`, and pulls the configured model

### 2 — Start

```bash
./start.sh
```

`start.sh` checks that Ollama is running and the model is available, then starts both servers.

| Server | URL |
|---|---|
| Frontend (Vite dev) | http://localhost:5173 |
| Backend (FastAPI) | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8000/docs |

> The backend creates `backend/data/blog.db` and seeds the 10 categories on first run.

---

## AI Classification

The app uses a **local Ollama model** for all AI features — no cloud API, no usage fees.

### Configuration (`backend/.env`)

```
OLLAMA_BASE_URL=http://localhost:11434   # default
OLLAMA_MODEL=gemma4:e2b-mlx             # Apple Silicon MLX variant (~7.1 GB)
```

Other available models (set `OLLAMA_MODEL` and run `ollama pull <model>`):

| Model | Size | Notes |
|---|---|---|
| `gemma4:e2b-mlx` | 7.1 GB | **Recommended** — Apple Silicon optimised |
| `gemma4:e2b` | 7.2 GB | Standard (non-MLX) |
| `gemma4:e4b` | 9.6 GB | Larger, slower, slightly better quality |
| `gemma4:e4b-mlx` | 9.6 GB | MLX variant of e4b |

### How it's used

**Per-article (Write / Edit page):**
Click **✦ AI分析** to analyse the current title + body and fill in suggested categories and tags. Review and adjust before saving.

**Bulk classify (Sidebar / LP):**
Click **AI分類** to run classification on every article that has no category assigned yet. Progress streams live. Categories and tags (3–5 keywords) are written to the DB and `article.json`.

---

## Bulk Import

1. Open http://localhost:5173/import
2. Click a preset button (Bike, Onsen, etc.) or paste any WordPress URL
3. Click **分析** to preview article count and sample titles
4. Click **インポート開始** — progress streams live via SSE

### How the importer works

`scrambler-lab.com` is a **WordPress Multisite network** with subdirectory installs. Each section is an independent WordPress installation:

| URL | WordPress REST API root | Articles |
|---|---|---|
| `/bike/` | `/bike/wp-json/wp/v2/` | 201 |
| `/onsen/` | `/onsen/wp-json/wp/v2/` | 352 |
| `/sentou/` | `/sentou/wp-json/wp/v2/` | 79 |
| `/container/` | `/container/wp-json/wp/v2/` | 40 |
| `/cooking/` | `/cooking/wp-json/wp/v2/` | 43 |
| `/lens/` | `/lens/wp-json/wp/v2/` | 18 |

The importer auto-detects the WP installation root (`_detect_wp_base`), fetches posts with `_embed=wp:featuredmedia` to inline hero images, and downloads all body images. Falls back to sitemap parsing then HTML scraping if the REST API is unavailable.

---

## Category Management

From the sidebar (desktop) or the action bar (mobile):

- **AI分類** — bulk-classify all uncategorized articles. Article counts update automatically when done.
- **編集** — opens the category editor modal:
  - Shows all current categories with article counts
  - Delete a category (articles lose that category; no cascade delete)
  - Add a new category: English name (used as slug), Japanese name, color swatch

---

## CloudFlare Tunnel (Public Access)

See [`cloudflare/setup.md`](cloudflare/setup.md) for full instructions. Quick summary:

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create logger
# edit cloudflare/config.yml with your TUNNEL_ID
cloudflared tunnel route dns logger log.scrambler-lab.com
sudo cloudflared service install   # autostart on boot
```

Once running, the app is accessible at your chosen hostname (e.g., `https://log.scrambler-lab.com`).

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/articles` | List articles (`?category=bike&tag=bmw&page=1&limit=20`) |
| `GET` | `/api/articles/{slug}` | Full article |
| `POST` | `/api/articles` | Create article (multipart form + images) |
| `PUT` | `/api/articles/{slug}` | Update article (multipart — text + optional image replacement) |
| `DELETE` | `/api/articles/{slug}` | Delete article + files |
| `POST` | `/api/articles/ai-classify` | Classify a single article (`{title, body}`) |
| `POST` | `/api/articles/ai-categorize` | Bulk classify all uncategorized articles (SSE stream) |
| `GET` | `/api/categories` | List categories with article counts |
| `POST` | `/api/categories` | Create category |
| `DELETE` | `/api/categories/{slug}` | Delete category (strips from articles) |
| `GET` | `/api/categories/tags` | Tag list with counts |
| `GET` | `/api/search?q=...` | FTS5 full-text search |
| `POST` | `/api/import/analyze` | Preview import from a WordPress URL |
| `POST` | `/api/import/run` | Run bulk import (SSE stream) |
| `GET` | `/static/articles/{slug}/...` | Serve article images |

Full interactive docs at `http://localhost:8000/docs` (Swagger UI).
