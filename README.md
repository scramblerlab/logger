# logger

A self-hosted, AI-powered lifestyle blog app. Consolidates content from six WordPress sub-sites at scrambler-lab.com into a single searchable interface, with local AI auto-classification, bulk import/export, and worldwide access via CloudFlare tunnel.

---

## Overview

| Feature | Details |
|---|---|
| **Post articles** | Web UI with Markdown editor, hero image drag-and-drop, bilingual title (EN/JA) |
| **AI tagging** | Per-article "✦ AI分析" button — local Ollama model auto-assigns categories and tags |
| **Bulk AI classify** | "AI分類" button classifies all uncategorized articles in one background pass |
| **Category management** | Add / delete categories from the sidebar; article counts shown inline |
| **Bulk category update** | Select multiple articles and add/remove categories in one operation |
| **Browse & filter** | Card grid with hero image, category badge, tags; sort by publish date or import date |
| **Search** | SQLite FTS5 full-text search with Japanese morphological tokenization (fugashi + UniDic) |
| **WordPress import** | One-click bulk import from any WordPress site — REST API with sitemap/HTML fallback |
| **Shopify import** | Bulk import blog articles (text + images) from a Shopify store via GraphQL Admin API |
| **Shopify export** | Select articles and export them to a Shopify blog (text, images, categories as tags) |
| **Auth** | Editor login (httpOnly cookie) — write/import/export require authentication |
| **Public access** | CloudFlare tunnel exposes localhost to the internet without port-forwarding |

**Categories (seeds):** bike / onsen / sentou / container / cooking / lens / sauna / auto / diy / beer

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy async, SQLite |
| AI | Ollama (local) — `gemma4:e2b-mlx` (Apple Silicon MLX, ~7 GB) |
| Scraping | `httpx` + `BeautifulSoup4` + WordPress REST API / Shopify GraphQL |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, dark theme |
| Tunnel | `cloudflared` (Homebrew), Mac launchd autostart |

---

## Folder Structure

```
logger/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── auth.py              # JWT cookie auth + get_current_user dependency
│   ├── database.py          # SQLite engine, DB init, category seeds
│   ├── models.py            # SQLAlchemy ORM: Article, Category, Tag
│   ├── schemas.py           # Pydantic request/response schemas
│   ├── routers/
│   │   ├── articles.py      # CRUD + image upload + AI classify endpoints
│   │   ├── auth.py          # Login / logout / verify
│   │   ├── categories.py    # Category list + CRUD + tag counts
│   │   ├── search.py        # FTS5 full-text search
│   │   ├── importer.py      # WordPress bulk import (SSE streaming)
│   │   └── shopify_importer.py  # Shopify import + export (SSE streaming)
│   ├── services/
│   │   ├── ai_classifier.py # Ollama API: auto-categorise + tag
│   │   ├── ai_chat.py       # Ollama API: Ask AI feature with DB + web search
│   │   ├── task_manager.py  # Background AI classification task runner
│   │   ├── tokenizer.py     # Japanese FTS tokenizer (fugashi + UniDic)
│   │   ├── wp_importer.py   # WordPress importer (REST API / sitemap / scrape)
│   │   ├── shopify_service.py  # Shopify GraphQL: list blogs, import, export
│   │   └── storage.py       # Image save/optimise, article.json read/write
│   ├── data/                # ⚠ NOT in git — see "Article Data" section below
│   │   ├── blog.db          # SQLite database
│   │   └── articles/        # One folder per article
│   │       └── [slug]/
│   │           ├── article.json
│   │           ├── hero.jpg
│   │           └── images/
│   ├── editors.json         # ⚠ NOT in git — editor credentials (email + bcrypt hash)
│   ├── .env                 # ⚠ NOT in git — copy from .env.example
│   ├── .env.example         # Template for .env
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx              # Landing page: card grid + sidebar + filters
│   │   │   ├── ArticlePage.tsx       # Full article with Markdown rendering
│   │   │   ├── WritePage.tsx         # New/edit article form + AI analysis button
│   │   │   ├── ImportPage.tsx        # WordPress bulk import UI
│   │   │   └── ShopifyImportPage.tsx # Shopify bulk import UI (3-step flow)
│   │   ├── components/
│   │   │   ├── Header.tsx            # Sticky header with search + Write button
│   │   │   ├── ArticleCard.tsx       # Card: hero image, category badge, tags; selectable
│   │   │   ├── Sidebar.tsx           # Category nav + AI classify + tag cloud + import links
│   │   │   ├── BulkCategoryPanel.tsx # Fixed bottom bar for bulk category updates
│   │   │   ├── CategoryBadge.tsx     # Colored category chip
│   │   │   ├── CategoryEditModal.tsx # Add/delete categories
│   │   │   ├── LoginModal.tsx        # Editor login dialog
│   │   │   ├── ShopifyExportDialog.tsx  # Shopify credentials + blog select modal
│   │   │   └── ShopifyExportPanel.tsx   # Fixed bottom bar for Shopify export
│   │   ├── context/
│   │   │   ├── AuthContext.tsx       # Editor auth state + login/logout
│   │   │   └── AiJobContext.tsx      # Background AI job polling + status
│   │   ├── api/client.ts             # Fetch wrapper against FastAPI
│   │   └── types.ts                  # Shared TypeScript types
│   ├── vite.config.ts                # Proxy /api and /static → localhost:8000
│   └── package.json
├── cloudflare/
│   ├── config.yml           # cloudflared tunnel config (fill in TUNNEL_ID)
│   └── setup.md             # Step-by-step CloudFlare tunnel setup guide
├── docs/
│   └── shopify-import-export.md  # Shopify feature design notes
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

- macOS (MacBook / Mac Mini — Intel or Apple Silicon)
- Python 3.12 via [`uv`](https://github.com/astral-sh/uv) (`brew install uv`)
- Node.js 18+ and npm
- [Homebrew](https://brew.sh/)

> **Note on Japanese search dependencies:** `fugashi` and `unidic-lite` (Japanese morphological tokenizer) are installed automatically by `setup.sh` via `pip`. Pre-built Cython wheels are available for macOS (Intel + Apple Silicon) — no Homebrew or C compiler needed.

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

### 2 — Configure editor credentials

Create `backend/editors.json` (not in git):

```json
[
  { "email": "you@example.com", "password_hash": "<bcrypt hash>" }
]
```

Generate a bcrypt hash:

```bash
cd backend && .venv/bin/python -c "import bcrypt; print(bcrypt.hashpw(b'yourpassword', bcrypt.gensalt()).decode())"
```

### 3 — Start

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

## Configuration (`backend/.env`)

```
# Ollama (local AI)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma4:e2b-mlx

# Auth
JWT_SECRET=<random string>
JWT_EXPIRE_DAYS=30

# Data storage
DATA_DIR=./data
CORS_ORIGINS=http://localhost:5173,http://localhost:3000

# Shopify export — absolute base URL for body images sent to Shopify
# Leave as localhost during development; images will be omitted from export.
# Set to your public CloudFlare tunnel URL for full image export.
PUBLIC_BASE_URL=http://localhost:8000
```

---

## AI Classification

The app uses a **local Ollama model** for all AI features — no cloud API, no usage fees.

### Available models

| Model | Size | Notes |
|---|---|---|
| `gemma4:e2b-mlx` | 7.1 GB | **Recommended** — Apple Silicon optimised |
| `gemma4:e2b` | 7.2 GB | Standard (non-MLX) |
| `gemma4:e4b-mlx` | 9.6 GB | MLX variant, slightly better quality |
| `gemma4:e4b` | 9.6 GB | Larger, slower |

Set `OLLAMA_MODEL` in `.env` and run `ollama pull <model>` to switch.

### How it's used

**Per-article (Write / Edit page):**
Click **✦ AI分析** to analyse the current title + body and fill in suggested categories and tags. Review and adjust before saving.

**Bulk classify (Sidebar / LP):**
Click **AI分類** to run classification on every article that has no category assigned yet. Progress streams live in the sidebar badge. Categories and tags are written to the DB and `article.json`.

**Post-import (automatic):**
Both WordPress and Shopify importers automatically trigger a background AI classification pass after import completes.

---

## WordPress Import

1. Open http://localhost:5173/import
2. Click a preset button (Bike, Onsen, etc.) or paste any WordPress URL
3. Click **分析** to preview article count and sample titles
4. Click **インポート開始** — progress streams live via SSE

The importer auto-detects the WP installation root, fetches posts with `_embed=wp:featuredmedia` to inline hero images, and downloads all body images. Falls back to sitemap parsing then HTML scraping if the REST API is unavailable.

| URL | WordPress REST API root | Articles |
|---|---|---|
| `/bike/` | `/bike/wp-json/wp/v2/` | 201 |
| `/onsen/` | `/onsen/wp-json/wp/v2/` | 352 |
| `/sentou/` | `/sentou/wp-json/wp/v2/` | 79 |
| `/container/` | `/container/wp-json/wp/v2/` | 40 |
| `/cooking/` | `/cooking/wp-json/wp/v2/` | 43 |
| `/lens/` | `/lens/wp-json/wp/v2/` | 18 |

---

## Shopify Import / Export

Uses the **Shopify Admin GraphQL API** (`2024-01`) with the **Client Credentials Grant** flow (new dev.shopify.com authentication — the old static Admin API token is deprecated).

### Getting credentials

1. Go to [dev.shopify.com](https://dev.shopify.com) and open (or create) your app
2. Under **設定 → APIの設定**, add scopes: `read_content` (import) and `write_content` (export)
3. Copy **クライアントID** and **シークレット** from the 資格情報 section

The store URL + client ID are saved in the browser between sessions. The client secret must be entered each time (not stored for security).

### Import

1. Open http://localhost:5173/import/shopify
2. Enter store URL, client ID, and client secret → **接続してブログを確認**
3. Select a blog from the list → set an optional article limit → **インポート開始**
4. Progress streams live; articles are saved with hero and body images downloaded locally
5. Background AI classification runs automatically on completion

### Export

1. Click **Shopifyブログにエクスポート** in the sidebar
2. Enter credentials and select the target blog → **エクスポートモードを開始**
3. Article cards become selectable — check the ones to export
4. Click **Shopifyにエクスポート** in the bottom bar — progress streams live

**Notes on export:**
- Article body (Markdown) is converted to HTML before sending
- Categories are written as Shopify tags with a `cat:` prefix (e.g., `cat:bike`)
- Body and hero images are only included when `PUBLIC_BASE_URL` is set to a publicly reachable URL. On localhost, images are omitted (Shopify cannot reach them). Set `PUBLIC_BASE_URL` to your CloudFlare tunnel URL for full image export.

---

## Bulk Category Update

1. Click **一括更新** in the sidebar (desktop) or action bar (mobile)
2. Article cards become selectable with checkboxes
3. Use the bottom panel to add or remove categories across all selected articles at once
4. Click **更新** to apply; the panel closes and article counts refresh

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

Once running, the app is accessible at your chosen hostname (e.g., `https://log.scrambler-lab.com`). Update `PUBLIC_BASE_URL` in `backend/.env` to this URL to enable full image export to Shopify.

---

## API Reference

### Articles

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/articles` | — | List articles (`?category=bike&tag=bmw&page=1&limit=20&sort=published`) |
| `GET` | `/api/articles/{slug}` | — | Full article |
| `POST` | `/api/articles` | ✓ | Create article (multipart form + images) |
| `PUT` | `/api/articles/{slug}` | ✓ | Update article (multipart) |
| `DELETE` | `/api/articles/{slug}` | ✓ | Delete article + files |
| `POST` | `/api/articles/ai-classify` | ✓ | Classify a single article (`{title, body}`) |
| `POST` | `/api/articles/ai-categorize` | ✓ | Start bulk background classification |
| `GET` | `/api/articles/ai-categorize/status` | — | Poll background job status |
| `PATCH` | `/api/articles/bulk-categorize` | ✓ | Add/remove categories on multiple articles |

### Categories & Tags

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/categories` | — | List categories with article counts |
| `POST` | `/api/categories` | ✓ | Create category |
| `DELETE` | `/api/categories/{slug}` | ✓ | Delete category |
| `GET` | `/api/categories/tags` | — | Tag list with counts |

### Search & Import

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/search?q=...` | — | FTS5 full-text search |
| `POST` | `/api/import/analyze` | ✓ | Preview import from a WordPress URL |
| `POST` | `/api/import/run` | ✓ | Run WordPress bulk import (SSE stream) |

### Shopify

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/shopify/blogs` | — | List blogs in a Shopify store |
| `POST` | `/api/shopify/import` | ✓ | Bulk import from Shopify blog (SSE stream) |
| `POST` | `/api/shopify/export` | ✓ | Export selected articles to Shopify (SSE stream) |

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Login (`{email, password}`) → sets httpOnly cookie |
| `POST` | `/api/auth/logout` | Clear auth cookie |
| `POST` | `/api/auth/verify` | Check if current cookie is valid |

### Static files

| Path | Description |
|---|---|
| `/static/articles/{slug}/...` | Serve article images |

Full interactive docs at `http://localhost:8000/docs` (Swagger UI).
