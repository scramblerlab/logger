# Shopify Blog Import / Export

Implementation reference for the Shopify blog import and export feature. Uses the **Shopify Admin GraphQL API** (`2024-01`) via direct `httpx` calls — no third-party Shopify SDK required.

---

## Authentication

### Why not static Admin API tokens

The old flow (Shopify Admin → Apps → Develop apps → static `shpat_...` token) is **deprecated** as of the new Shopify Dev Dashboard. New apps created at [dev.shopify.com](https://dev.shopify.com) no longer issue a static token — instead they issue a **Client ID** and **Client Secret**.

### Client Credentials Grant (current approach)

Exchange Client ID + Secret for a short-lived access token on every request:

```
POST https://{shop}.myshopify.com/admin/oauth/access_token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=<id>&client_secret=<secret>
```

Response:
```json
{ "access_token": "shpat_...", "scope": "read_content,write_content", "expires_in": 86399 }
```

Tokens are valid for ~24 hours. Refresh by repeating the same POST — no refresh token needed. The exchange happens server-side in `_get_access_token()` in `shopify_service.py`; the frontend only ever sends Client ID + Secret, never the token itself.

### Getting credentials

1. Go to [dev.shopify.com](https://dev.shopify.com) and open (or create) your app
2. **設定 → APIの設定** — add scopes: `read_content` (import) and/or `write_content` (export)
3. Copy **クライアントID** and **シークレット** from the 資格情報 section on the same page

### Credential handling in the UI

- **Store URL** and **Client ID** are saved to `localStorage` (`shopify_creds_url`, `shopify_creds_id`) on successful connection and pre-filled on the next visit
- **Client Secret** is intentionally **never persisted** — must be entered each time
- The secret field shows `"※ 毎回入力が必要です"` in its label and auto-focuses when URL + ID are pre-filled, making it immediately clear what still needs to be entered

---

## GraphQL API

**Endpoint:** `POST https://{shop}/admin/api/2024-01/graphql.json`  
**Header:** `X-Shopify-Access-Token: {token}`

IDs are GIDs: `gid://shopify/Blog/123456789`

### List blogs

```graphql
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
```

### Fetch articles (paginated)

```graphql
query GetArticles($blogId: ID!, $cursor: String) {
  blog(id: $blogId) {
    articles(first: 50, after: $cursor) {
      nodes {
        id title handle
        body           # HTML — field is `body`, not `bodyHtml`
        author { name }
        tags           # [String!]! — already an array, no CSV parsing needed
        publishedAt
        image { url altText }   # `url` not deprecated `src`
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
```

### Create article

```graphql
mutation CreateArticle($article: ArticleCreateInput!) {
  articleCreate(article: $article) {
    article { id handle title }
    userErrors { field message }
  }
}
```

Variables:
```json
{
  "article": {
    "blogId": "gid://shopify/Blog/123",
    "title": "...",
    "body": "<p>HTML body</p>",
    "author": { "name": "user@example.com" },
    "tags": ["cat:bike", "motorcycle", "bmw"],
    "publishDate": "2026-05-31T10:00:00Z",
    "isPublished": true,
    "image": { "url": "https://example.com/static/articles/slug/hero.jpg", "altText": "..." }
  }
}
```

**Important:** `author` is **required** and must not be null — Shopify rejects the mutation otherwise. The logged-in user's email is passed as `author.name` from `get_current_user` in the router.

---

## Backend

### `backend/services/shopify_service.py`

Core functions:

```python
async def _get_access_token(shop_url, client_id, client_secret) -> str:
    # POSTs to /admin/oauth/access_token with grant_type=client_credentials
    # Returns the short-lived access token

async def _gql(shop_url, access_token, query, variables=None) -> dict:
    # POSTs to /admin/api/2024-01/graphql.json
    # Raises ValueError on GraphQL errors

async def list_blogs(shop_url, client_id, client_secret) -> list[dict]:
    # Returns [{ id (GID), title, handle, article_count }]

async def import_articles(shop_url, client_id, client_secret, blog_id, limit, auto_classify):
    # Async generator — yields progress/article/done events
    # Per article: slug={date}-{handle}-{uuid4[:4]}, hero + body images downloaded locally
    # Body: HTML → BeautifulSoup image rewrite → html2text Markdown
    # Optional AI classification via ai_classifier.classify()

async def export_articles(shop_url, client_id, client_secret, blog_id, articles, author):
    # Async generator — yields progress/exported/error/done events
    # Per article: Markdown → HTML (markdown lib), image URLs rewritten to absolute
    # Categories exported as "cat:X" prefixed tags
    # Images omitted when PUBLIC_BASE_URL is localhost (Shopify can't reach them)
```

### Image handling on export

`PUBLIC_BASE_URL` from `.env` controls whether images are included:

- **Non-localhost** (e.g., CloudFlare tunnel URL): body `src="/static/..."` paths rewritten to `{PUBLIC_BASE_URL}/static/...`; hero image URL constructed similarly
- **Localhost**: `<img>` tags stripped from body HTML via BeautifulSoup; hero image omitted from mutation — avoids Shopify's "Invalid URL provided" error since localhost is unreachable externally

Set `PUBLIC_BASE_URL` to your CloudFlare tunnel URL (e.g., `https://log.scrambler-lab.com`) in `backend/.env` for full image export.

### `backend/routers/shopify_importer.py`

```
POST /api/shopify/blogs   — no auth; proxies list_blogs()
POST /api/shopify/import  — requires get_current_user; SSE stream; triggers task_manager on done
POST /api/shopify/export  — requires get_current_user; loads articles from DB, then SSE stream
                            current_user email passed as author= to export_articles()
```

### Schemas (`backend/schemas.py`)

All three request schemas use `client_id` + `client_secret` (not `access_token`):

```python
class ShopifyBlogsRequest(BaseModel):
    shop_url: str; client_id: str; client_secret: str

class ShopifyImportRequest(BaseModel):
    shop_url: str; client_id: str; client_secret: str
    blog_id: str; limit: Optional[int] = None; auto_classify: bool = True

class ShopifyExportRequest(BaseModel):
    shop_url: str; client_id: str; client_secret: str
    blog_id: str; article_slugs: list[str]
```

---

## Frontend

### Import page — `ShopifyImportPage.tsx` → `/import/shopify`

Three-step flow:

1. **Connect** — store URL + client ID + client secret → `api.shopify.blogs()` → blog list
2. **Select** — radio-select blog + optional limit → インポート開始
3. **Progress** — SSE progress bar + log; done banner with link to home

Store URL and client ID pre-filled from `localStorage`. Secret auto-focused on mount when the other two are pre-filled.

### Export flow — `ShopifyExportDialog` + `ShopifyExportPanel`

**Dialog** (`ShopifyExportDialog.tsx`):
- Same three credential fields; connects and shows blog dropdown
- On confirm: passes `{ shopUrl, clientId, clientSecret, blogId, blogTitle }` to Home

**Panel** (`ShopifyExportPanel.tsx`):
- Fixed bottom bar while in export mode
- Handles SSE fetch to `/api/shopify/export` internally
- Shows live progress + log; done/cancel buttons

**Home.tsx export mode:**
- `exportMode` state makes article cards selectable (reuses existing `selectable` prop)
- `shopifyCreds` holds the confirmed credentials; cleared on exit

### API client — `api.shopify.blogs()`

```typescript
shopify: {
  blogs: (shopUrl, clientId, clientSecret): Promise<ShopifyBlogsResponse> =>
    request('/shopify/blogs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_url: shopUrl, client_id: clientId, client_secret: clientSecret }),
    }),
}
```

SSE streams (`/import`, `/export`) consumed via `fetch` reader directly — same pattern as `ImportPage.tsx`.

---

## Known Limitations

| Limitation | Notes |
|---|---|
| Images on export | Omitted when `PUBLIC_BASE_URL` is localhost. Set to CloudFlare tunnel URL to include them. |
| Token lifetime | 24-hour tokens; re-fetched on every import/export call. No token caching or refresh logic needed. |
| Blog pagination | Import fetches up to `limit` (default 500) articles. Shopify `blogs(first: 50)` covers most stores; increase if needed. |
| Duplicate import | No dedup check — re-importing the same blog creates duplicate articles. |
