# logger

A self-hosted, AI-powered lifestyle blog app. Consolidates content from six WordPress sub-sites at scrambler-lab.com into a single searchable interface, with AI auto-classification, bulk import, and worldwide access via CloudFlare tunnel.

---

## Overview

| Feature | Details |
|---|---|
| **Post articles** | Web UI with Markdown editor, hero image drag-and-drop, bilingual title (EN/JA) |
| **AI tagging** | Submitting an article calls Claude to auto-assign categories and tags |
| **Browse** | Card grid with hero image, category badge, tags; category sidebar + tag cloud |
| **Search** | SQLite FTS5 full-text search across titles and body content |
| **Bulk import** | One-click import from any WordPress site — REST API with sitemap/HTML fallback |
| **Public access** | CloudFlare tunnel exposes localhost to the internet without port-forwarding |

**Categories:** bike / onsen / sentou / container / cooking / lens / sauna / auto / diy / beer

---

## Tech Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy async, SQLite |
| AI | Anthropic SDK — `claude-sonnet-4-6` |
| Scraping | `httpx` + `BeautifulSoup4` + WordPress REST API |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS |
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
│   │   ├── articles.py      # CRUD + multipart image upload
│   │   ├── categories.py    # Category list + tag counts
│   │   ├── search.py        # FTS5 full-text search
│   │   └── importer.py      # Bulk import (SSE streaming)
│   ├── services/
│   │   ├── ai_classifier.py # Claude API: auto-categorise + tag
│   │   ├── wp_importer.py   # WordPress importer (REST API / sitemap / scrape)
│   │   └── storage.py       # Image save/optimise, article.json read/write
│   ├── data/                # ⚠ NOT in git — see "Article Data" section below
│   │   ├── blog.db          # SQLite database
│   │   └── articles/        # One folder per article
│   │       └── [slug]/
│   │           ├── article.json
│   │           ├── hero.jpg
│   │           └── images/
│   ├── .env                 # ⚠ NOT in git — add ANTHROPIC_API_KEY here
│   ├── .env.example         # Template for .env
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx         # Landing page: card grid + sidebar + filters
│   │   │   ├── ArticlePage.tsx  # Full article with Markdown rendering
│   │   │   ├── WritePage.tsx    # New/edit article form
│   │   │   └── ImportPage.tsx   # Bulk import UI
│   │   ├── components/
│   │   │   ├── Header.tsx       # Sticky header with search + Write button
│   │   │   ├── ArticleCard.tsx  # Card: hero image, category badge, tags
│   │   │   └── Sidebar.tsx      # Category nav + tag cloud
│   │   ├── api/client.ts        # Fetch wrapper against FastAPI
│   │   └── types.ts             # Shared TypeScript types
│   ├── vite.config.ts           # Proxy /api and /static → localhost:8000
│   └── package.json
├── cloudflare/
│   ├── config.yml           # cloudflared tunnel config (fill in TUNNEL_ID)
│   └── setup.md             # Step-by-step CloudFlare tunnel setup guide
├── docs/
│   └── plan.md              # Architecture and design decisions
├── start.sh                 # Start both servers with one command
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

`article.json` schema:
```json
{
  "slug": "2024-01-15-yamaha-sr400-custom-a1b2",
  "title": "Yamaha SR400 Custom",
  "body": "## Intro\n...",
  "heroImage": "hero.jpg",
  "additionalImages": ["images/8fa3_photo1.jpg"],
  "categories": ["bike"],
  "tags": ["yamaha", "sr400", "custom"],
  "publishedAt": "2024-01-15T10:00:00",
  "sourceUrl": "https://www.scrambler-lab.com/bike/..."
}
```

**Back this directory up separately.** It is excluded from git. See the [Backup & Restore](#backup--restore) section below.

---

## Backup & Restore

> **Why this matters:** the WordPress sites will be deprecated. Once they go offline, `backend/data/` is the only copy of all article content. A corrupted drive or accidental `rm -rf` with no backup means permanent data loss.

### What needs to be backed up

| Path | Contents | Size |
|---|---|---|
| `backend/data/blog.db` | SQLite DB — all articles, categories, tags | small (grows with content) |
| `backend/data/articles/` | One folder per article: `article.json` + images | ~86 MB and growing |

Both must be backed up together. The JSON files and the DB are the authoritative sources — if one is lost without the other, recovery is partial (see restore notes below).

### Option A — Google Drive via rclone (recommended)

[rclone](https://rclone.org/) is a command-line tool that syncs any local folder to Google Drive (and 40+ other cloud storage providers). It handles incremental sync, so only changed files are uploaded after the first run.

**One-time setup:**
```bash
brew install rclone
rclone config
# → Choose "n" (new remote) → name it "gdrive"
# → Choose Google Drive → follow the browser OAuth flow
# → Accept default scope (full drive access)
```

**Manual backup:**
```bash
rclone sync /Users/nobu/dev/ai/logger/backend/data/ gdrive:logger-backup/data/ --progress
```

**Automated daily backup via cron:**
```bash
crontab -e
# Add this line (runs at 3 AM every day):
0 3 * * * /opt/homebrew/bin/rclone sync /Users/nobu/dev/ai/logger/backend/data/ gdrive:logger-backup/data/ --log-file=/tmp/logger-backup.log
```

After the first sync, Google Drive will contain:
```
logger-backup/
└── data/
    ├── blog.db
    └── articles/
        └── ...
```

### Option B — Google Drive for Desktop (simpler, less control)

If you have [Google Drive for Desktop](https://www.google.com/drive/download/) installed and your Drive is mounted at `~/Library/CloudStorage/GoogleDrive-*/`:

```bash
# Create a symlink so Drive auto-syncs the data folder
ln -s /Users/nobu/dev/ai/logger/backend/data \
      ~/Library/CloudStorage/GoogleDrive-scramblerlab@gmail.com/My\ Drive/logger-backup
```

This keeps a live mirror in Google Drive with no cron needed, but gives less control over sync timing and excludes nothing.

### Option C — Time Machine (local, always-on)

Time Machine backs up `backend/data/` automatically as long as the project is under your home directory. Useful as a secondary layer but not a substitute for off-machine backup.

---

### Restore — moving to a new machine

**Full restore (DB + files intact):**

```bash
# 1. Clone the repo
git clone <this-repo> logger && cd logger

# 2. Download backup from Google Drive
rclone sync gdrive:logger-backup/data/ backend/data/ --progress

# 3. Install dependencies (see Getting Started)
cd backend && uv venv .venv --python 3.12 && uv pip install -r requirements.txt
cd ../frontend && npm install

# 4. Set API key
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> backend/.env

# 5. Start — init_db() re-creates schema if needed, DB rows are already in blog.db
cd .. && ./start.sh
```

The app will start with all articles intact.

**Partial restore (JSON files only, DB lost):**

If `blog.db` is lost but the `articles/` folder is intact, run the re-import script:

```bash
cd backend
.venv/bin/python rebuild_db.py   # not yet implemented — see note below
```

> This script does not exist yet. If needed, it would iterate every `article.json` under `data/articles/`, parse the fields, and `INSERT OR IGNORE` into the `articles` table. A straightforward migration that can be written in ~30 lines when required.

**Full loss (no backup):**

Re-run the bulk import from scratch via the Import page. All 6 WordPress sections are still accessible at their current URLs until the sites are taken down. AI classification will re-run on each article. Locally authored articles (not imported from WordPress) cannot be recovered without a backup.

---

## Getting Started

### Prerequisites

- macOS (tested on Apple Silicon)
- Python 3.12 via [`uv`](https://github.com/astral-sh/uv) (`brew install uv`)
- Node.js 18+ and npm
- An [Anthropic API key](https://console.anthropic.com/)

### 1 — Clone and configure

```bash
git clone <this-repo> logger
cd logger

# Add your Anthropic API key
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> backend/.env
```

### 2 — Install backend dependencies

```bash
cd backend
uv venv .venv --python 3.12
uv pip install -r requirements.txt
cd ..
```

### 3 — Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 4 — Start

```bash
./start.sh
```

| Server | URL |
|---|---|
| Frontend (Vite dev) | http://localhost:5173 |
| Backend (FastAPI) | http://localhost:8000 |
| API docs (Swagger) | http://localhost:8000/docs |

> The backend creates `backend/data/blog.db` and seeds the 10 categories on first run.

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

The importer auto-detects the WP installation root by probing path prefixes (`_detect_wp_base`), then fetches posts with `_embed=wp:featuredmedia` to inline hero images. Falls back to sitemap parsing then HTML scraping if the REST API is unavailable.

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
| `PUT` | `/api/articles/{slug}` | Update article |
| `DELETE` | `/api/articles/{slug}` | Delete article + files |
| `GET` | `/api/categories` | List categories |
| `GET` | `/api/categories/tags` | Tag list with counts |
| `GET` | `/api/search?q=...` | FTS5 full-text search |
| `POST` | `/api/import/analyze` | Preview import from a WordPress URL |
| `POST` | `/api/import/run` | Run bulk import (SSE stream) |
| `GET` | `/static/articles/{slug}/...` | Serve article images |

Full interactive docs at `http://localhost:8000/docs` (Swagger UI).
