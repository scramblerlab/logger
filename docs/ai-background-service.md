# Plan: Background AI Categorization Service

## Context

AI bulk categorization currently runs as a synchronous SSE stream tied to the browser connection. If the tab is closed or navigation occurs, the task stops. The user wants the analysis to run as a persistent background service — independent of the frontend — with an "AI Status" indicator visible on any page while it's running.

---

## Architecture

```
POST /api/articles/ai-categorize  (editor only)
  → asyncio.create_task(run_categorize())   ← runs on FastAPI event loop, survives tab close
  → returns 202 immediately

GET  /api/articles/ai-categorize/status  (public — read-only)
  → returns current TaskState as JSON

TaskState (module singleton in services/task_manager.py)
  { status, progress, current_title, updated, total, failed, started_at }

Auto-triggers:
  create_article  → task_manager.start() after save
  run_import      → task_manager.start() after import stream ends

Frontend: AiJobContext (polls status every 2s while running)
  ├── Header.tsx       — pulsing "AI分析中..." badge (visible on all pages)
  ├── Sidebar.tsx      — uses context directly (removes prop-threading)
  └── Home.tsx         — uses context; triggers article/category reload on completion
```

---

## Backend

### 1. `backend/services/task_manager.py` (new)

Module-level singleton state + asyncio task handle. No new dependencies.

```python
@dataclass
class TaskState:
    status: str = "idle"   # idle | running | done | error
    progress: str = ""
    current_title: str = ""
    updated: int = 0
    total: int = 0
    failed: int = 0
    started_at: str | None = None

_state = TaskState()
_task: asyncio.Task | None = None

def get_state() -> dict: ...
def is_running() -> bool: ...
async def start(db_factory, classifier_module) -> bool:
    # Returns False if already running (prevents double-start)
    # asyncio.create_task(_run(...))

async def cancel() -> None: ...   # called on app shutdown
```

`_run()` mirrors the current `_stream()` logic in `articles.py` — updates `_state` in place instead of yielding SSE lines. Per-article exceptions increment `failed` and continue. Catches `asyncio.CancelledError` gracefully.

**Important**: `_run()` checks `total == 0` **before** the Ollama availability check. This ensures auto-triggers are nearly free (one DB count query, no Ollama ping) when everything is already classified.

### 2. `backend/routers/articles.py` (modify)

Replace the `StreamingResponse` with a fire-and-forget pattern, and auto-trigger after article creation:

```python
@router.post("/ai-categorize", status_code=202)
async def ai_categorize_all(_: str = Depends(get_current_user)):
    if task_manager.is_running():
        raise HTTPException(409, "AI categorization already running")
    await task_manager.start(SessionLocal, ai_classifier)
    return {"started": True}

@router.get("/ai-categorize/status")   # no auth — read-only
async def ai_categorize_status():
    return task_manager.get_state()
```

**Auto-trigger after `create_article`**: at the end of the handler, after the article is saved:
```python
await task_manager.start(SessionLocal, ai_classifier)
```

### 3. `backend/routers/importer.py` (modify)

Auto-trigger after bulk import stream finishes:
```python
elif event["type"] == "done":
    yield f"data: {json.dumps({'finished': True, 'imported': imported})}\n\n"
    await task_manager.start(SessionLocal, ai_classifier)
yield "data: [DONE]\n\n"
```

### 4. `backend/main.py` (minor)

Add task cancellation on shutdown:
```python
@asynccontextmanager
async def lifespan(app):
    await init_db()
    yield
    await task_manager.cancel()
```

---

## Frontend

### 5. `frontend/src/context/AiJobContext.tsx` (new)

```ts
type AiJobContextValue = {
  status: 'idle' | 'running' | 'done' | 'error'
  progress: string
  currentTitle: string
  updated: number
  total: number
  failed: number
  startJob: () => Promise<void>
  setOnComplete: (fn: () => void) => void
}
```

- On mount: GET status — if `running`, start polling immediately
- `startJob()`: POST → start polling
- Polling: `setInterval(2000)` while `status === 'running'`; stops on `done` / `error`
- On `done`: call `onComplete()`; auto-reset to `idle` after 5 seconds

### 6. `frontend/src/main.tsx` (modify)

Wrap with `<AiJobProvider>` alongside `<AuthProvider>`.

### 7. `frontend/src/components/Header.tsx` (modify)

AI status badge in nav, visible on all pages:

```tsx
{status === 'running' && (
  <span className="flex items-center gap-1.5 text-xs text-amber-400 animate-pulse">
    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
    AI分析中...{currentTitle ? ` 「${currentTitle}」` : ''}
  </span>
)}
{status === 'done' && (
  <span className="text-xs text-emerald-400">✓ AI分類完了</span>
)}
```

### 8. `frontend/src/pages/Home.tsx` (modify)

- Remove local `aiStatus`, `aiProgress`, `handleAiCategorize`
- Use `useAiJob()`; register `setOnComplete(() => { loadArticles(true); reloadCategories(); })`

### 9. `frontend/src/components/Sidebar.tsx` (modify)

Replace 3 AI props with direct `useAiJob()`. Only `onOpenCategoryEdit` remains as a prop.

### 10. `frontend/src/api/client.ts` (modify)

- Change `aiCategorize` to `request<{started: boolean}>` (202 JSON, no streaming)
- Add `aiCategorizeStatus: () => request('/articles/ai-categorize/status')`

---

## Files to create / modify

| File | Action |
|---|---|
| `backend/services/task_manager.py` | Create |
| `backend/routers/articles.py` | Modify — replace SSE with background task; auto-trigger on create |
| `backend/routers/importer.py` | Modify — auto-trigger after import stream ends |
| `backend/main.py` | Modify — cancel task on shutdown |
| `frontend/src/context/AiJobContext.tsx` | Create |
| `frontend/src/main.tsx` | Modify — wrap with AiJobProvider |
| `frontend/src/components/Header.tsx` | Modify — AI status badge |
| `frontend/src/components/Sidebar.tsx` | Modify — use AiJobContext directly |
| `frontend/src/pages/Home.tsx` | Modify — use AiJobContext, remove local state |
| `frontend/src/api/client.ts` | Modify — change aiCategorize + add status call |

---

## Verification

1. **Background persistence**: Start AI分類, immediately navigate to an article page — Header shows pulsing badge and progress continues updating.
2. **Tab close resilience**: Start AI分類, close the tab, reopen — badge shows "AI分析中..." immediately (polling resumes on mount).
3. **409 guard**: Click AI分類 while already running — second start is rejected; button stays disabled via context status.
4. **Completion**: After all articles processed — badge shows "✓ AI分類完了", articles/categories reload, badge disappears after 5s.
5. **Viewer visibility**: While logged out — AI status badge still shows in Header if task is running (status endpoint is public).
6. **Auto-trigger on post**: Write and save a new article with no categories — confirm AI badge appears in Header shortly after, article gets classified automatically.
7. **Auto-trigger on import**: Complete a bulk import — confirm AI badge appears immediately after the import SSE stream closes and classifies any uncategorized imported articles.
