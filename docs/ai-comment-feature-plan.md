# Plan: AIコメント Feature + App Rename to GENERATIVE LOGGER

## Context
The app currently uses AI only for article categorization. The goal is to extend it with research-based Japanese commentary ("AIコメント") generated per article via web search + Ollama. The comment is stored independently from the article body so both can be edited separately. The feature mirrors the existing AI分類 UX pattern throughout.

---

## Backend Changes

### 1. `backend/database.py` — DB migration
Add a `version < 2` block immediately after the existing `version < 1` block (line 61):
```python
if version < 2:
    await conn.execute(text("ALTER TABLE articles ADD COLUMN ai_comment TEXT"))
    await conn.execute(text("ALTER TABLE articles ADD COLUMN ai_comment_model TEXT"))
    await conn.execute(text("PRAGMA user_version = 2"))
```

### 2. `backend/models.py` — ORM columns
Add after `data_path`:
```python
ai_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
ai_comment_model: Mapped[str | None] = mapped_column(Text, nullable=True)
```

### 3. `backend/schemas.py` — Pydantic schemas
- Add `ai_comment: Optional[str] = None` and `ai_comment_model: Optional[str] = None` to `ArticleOut`
- Add both fields to `ArticleUpdate`

### 4. `backend/services/ai_commenter.py` — New service (new file)
Reuses `_web_search` pattern from `ai_chat.py` (same `OLLAMA_API_KEY`).

**Prompts:**

System:
```
あなたは日本語ライフスタイルブログのAIコメンターです。
記事のタイトルと本文から最も注目すべきキーワードや概念を1つ特定し、そのキーワードについてウェブ検索の結果を参考にしながら、読者向けに簡潔な補足コメントを生成してください。

必ず以下のルールを守ってください：
- 出力は日本語のみ
- 200〜300文字程度で構成する
- 最後に「リンク：URL」の形式で参考URLを1つ付ける
- URLは実際に検索結果に含まれているものだけを使う
- 事実に基づいた客観的な説明にする
- ブログの本文には触れず、キーワードの説明に集中する
```

User:
```
記事タイトル：{title}

本文（抜粋）：
{body[:600]}

ウェブ検索結果：
{snippets or "（検索結果なし）"}

上記の記事タイトルと本文から最も注目すべきキーワードを1つ選び、そのキーワードについて200〜300文字程度の日本語コメントを生成してください。最後に「リンク：URL」を付けてください。
```

Logic: `async def generate(title: str, body: str) -> tuple[str, str]` — returns `(comment_text, model_name)`. Web search using title + first 300 chars of body → format top 3 snippets → `ollama_client.chat()` with retry → return `(stripped_text, OLLAMA_MODEL)`.

**Retry logic — shared utility (new file `backend/services/ollama_client.py`):**
Extract a shared helper used by all Ollama callers (ai_commenter, ai_classifier, ai_chat):
```python
async def chat(messages, *, max_retries=3, wait=30) -> str:
    # Calls {OLLAMA_BASE_URL}/api/chat with OLLAMA_MODEL
    # On httpx.HTTPStatusError (5xx) or ConnectError: asyncio.sleep(30), retry up to 3×
    # On 4xx or timeout: raise immediately
    # Returns message content string
```
Also wrap the web search call in `ai_chat.py` and `ai_commenter.py` with the same retry pattern.
Apply to:
- `ai_commenter.py` — chat call + web search (new code, planned here)
- `ai_classifier.py` — replace direct httpx call with `ollama_client.chat()`
- `ai_chat.py` — replace direct Ollama chat call with `ollama_client.chat()`; keep its own `_web_search` but add retry there too

### 5. `backend/services/task_manager.py` — Second task state
Add parallel module-level variables `_comment_state` (dict) and `_comment_task` (asyncio.Task | None), mirroring `_state` / `_task`. Add:
- `get_comment_state() -> dict`
- `is_comment_running() -> bool`
- `async start_comment(db_factory, commenter_module) -> bool`
- `async cancel_comment()`
- `async _run_comment(db_factory, commenter_module)` — queries `Article.ai_comment == None`, validates Ollama, iterates, calls `commenter_module.generate(article.title, article.body)` → receives `(comment, model)`, saves both `ai_comment` and `ai_comment_model` to DB + JSON sidecar (null-check before JSON write), updates `_comment_state`.

Also update `main.py` lifespan shutdown to call `await task_manager.cancel_comment()`.

### 6. `backend/routers/articles.py` — New endpoints + auto-trigger

**Route ordering:** All new static-path routes must be placed **before** the existing `GET /{slug}` at line 76.

New endpoints:
```
POST /api/articles/ai-comment-bulk          → start_comment task (202, auth required)
GET  /api/articles/ai-comment-bulk/status   → get_comment_state (public)
POST /api/articles/{slug}/ai-comment        → generate + save for single article (auth required)
```

Single-article endpoint fetches the article, calls `ai_commenter.generate(article.title, article.body)` → `(comment, model)`, saves both `ai_comment` and `ai_comment_model` to DB and JSON sidecar. Returns `{"ai_comment": "...", "ai_comment_model": "..."}`.

**Auto-trigger:** In the `POST /api/articles/ai-categorize` handler (and `POST /api/articles` creation with `auto_classify=True`), fire `await task_manager.start_comment(SessionLocal, ai_commenter)` right after `await task_manager.start(...)`. Both tasks run concurrently and independently.

**PUT `/{slug}` update:** Add `ai_comment: Optional[str] = Form(None)` parameter; if provided, set `article.ai_comment = ai_comment` in the update block.

---

## Frontend Changes

### 7. `frontend/src/types.ts`
Add to `Article` interface:
```typescript
ai_comment: string | null;
ai_comment_model: string | null;
```

### 8. `frontend/src/api/client.ts`
Add to `api.articles`:
```typescript
aiComment: (slug: string) => request(`/articles/${slug}/ai-comment`, { method: 'POST' }),
aiCommentBulk: () => request('/articles/ai-comment-bulk', { method: 'POST' }),
aiCommentBulkStatus: () => request('/articles/ai-comment-bulk/status'),
```

### 9. `frontend/src/context/AiJobContext.tsx` — Second job
Extend (do not replace) the existing provider with a parallel set of state/polling for the comment job:
- `commentState` / `setCommentState` (same `AiJobState` type)
- `commentIntervalRef`, `prevCommentServerStatusRef`
- `pollCommentStatus()` — calls `/api/articles/ai-comment-bulk/status`, same guard logic as `pollStatus()`
- `useEffect` on `commentState.status` — same 2s/30s interval logic
- `startCommentJob()` — POSTs to `/api/articles/ai-comment-bulk`

Extend `AiJobContextValue` with `commentStatus`, `commentProgress`, `startCommentJob`. Expose in provider value.

### 10. `frontend/src/pages/Home.tsx` — Bulk button
Destructure `commentStatus`, `commentProgress`, `startCommentJob` from `useAiJob()`. Add button immediately after the existing "AI分類" button:
```tsx
<button onClick={startCommentJob} disabled={commentStatus === 'running'} className="...same style as AI分類 button...">
  {commentStatus === 'running' ? '⏳ AIコメント中...' : 'AIコメント追加'}
</button>
```
Add progress display alongside existing `aiProgress`.

### 11. `frontend/src/pages/WritePage.tsx` — Single-article button
Add states `[commenting, setCommenting]` and `[commentMsg, setCommentMsg]`. Add `handleAiComment` handler that calls `api.articles.aiComment(editSlug)`. Render button (edit mode only, requires `editSlug`):
```tsx
{editSlug && (
  <div className="flex items-center gap-3">
    <button onClick={handleAiComment} disabled={commenting} className="...same amber style...">
      {commenting ? '⏳ 生成中...' : '✦ AIコメント追加/変更'}
    </button>
    {commentMsg && <span className="text-xs ...">{commentMsg}</span>}
  </div>
)}
```
Place after the existing "✦ AI分析" button group (~line 260).

### 12. `frontend/src/pages/ArticlePage.tsx` — Display
Insert after the `</ReactMarkdown>` closing tag (line 114), before the `source_url` block:
```tsx
{article.ai_comment && (
  <div className="mt-8 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
    <div className="flex items-center gap-2 mb-2">
      <span className="text-xs font-semibold text-amber-400 tracking-wide">✦ AIコメント</span>
      {article.ai_comment_model && (
        <span className="text-xs text-slate-500">by {article.ai_comment_model}</span>
      )}
    </div>
    <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
      {article.ai_comment}
    </p>
  </div>
)}
```

### 13. `frontend/src/components/Header.tsx` — Rename
Line 34: change `logger` → `GENERATIVE LOGGER`. Add `tracking-wide` if `tracking-widest` looks too stretched.

---

## Verification
1. Restart backend → `PRAGMA table_info(articles)` shows `ai_comment` column, `PRAGMA user_version` = 2
2. `POST /api/articles/{slug}/ai-comment` → returns Japanese text ending with `リンク：URL`; GET article confirms persistence
3. `POST /api/articles/ai-comment-bulk` → poll status endpoint, confirm `running` → `done`; spot-check articles
4. Concurrent jobs: trigger both ai-categorize and ai-comment-bulk; both status endpoints return independent state
5. Create new article with auto_classify → article eventually gets `ai_comment` (background task)
6. WritePage edit → click "✦ AIコメント追加/変更" → success message → ArticlePage shows amber comment box
7. Header shows "GENERATIVE LOGGER" on all pages
8. No OLLAMA_API_KEY: web search returns `[]`, AI still generates comment from training knowledge
