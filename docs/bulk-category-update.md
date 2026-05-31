# Plan: UI-based Bulk Category Update

## Context

Editors need to efficiently assign or correct categories across many articles at once — especially after a bulk import where AI classification may not yet have run. The current workflow requires opening each article individually. This plan adds a "カテゴリー一括更新" (Bulk Category Update) mode to the home page: articles become selectable, and a persistent bottom action bar lets the editor apply or remove categories across all selected articles in one operation.

---

## Behavior Spec

1. Editor clicks **"カテゴリー一括更新"** button (Sidebar on desktop, mobile action row on mobile)
2. Article grid enters **selection mode**: cards show a checkbox overlay; clicking a card selects/deselects it instead of navigating
3. A **fixed bottom action bar** appears with:
   - Selection count + "全選択" / "解除" links
   - Horizontally-scrollable **category chips** (3 states, cycling on each click):
     - **Neutral** (grey) — no change to this category on any article
     - **Add** (amber `+`) — add this category to all selected articles
     - **Remove** (red `×`) — remove this category from all selected articles
   - **更新** button — applies changes; exits bulk mode; reloads articles
   - **✕** cancel button — exits bulk mode without saving
4. On **更新**:
   - Backend merges `add_categories` and subtracts `remove_categories` per article
   - Categories in "neutral" state are **untouched** per article (existing values preserved)
   - Result per article: `(existing ∪ add) − remove`

---

## Backend

### `backend/schemas.py` — new schema

```python
class BulkCategorizeRequest(BaseModel):
    article_slugs: list[str]
    add_categories: list[str] = []
    remove_categories: list[str] = []
```

### `backend/routers/articles.py` — new endpoint

Add before the `PUT /{slug}` handler. `PATCH` has no existing `/{slug}` handler so no path conflict.

```python
@router.patch("/bulk-categorize", status_code=200)
async def bulk_categorize(
    req: BulkCategorizeRequest,
    db: AsyncSession = Depends(get_db),
    _: str = Depends(get_current_user),
):
    from models import now_utc
    result = await db.execute(select(Article).where(Article.slug.in_(req.article_slugs)))
    articles = result.scalars().all()
    add = set(req.add_categories)
    remove = set(req.remove_categories)
    for article in articles:
        existing = set(json.loads(article.categories))
        new_cats = sorted((existing | add) - remove)
        article.categories = json.dumps(new_cats, ensure_ascii=False)
        article.updated_at = now_utc()
    await db.commit()
    return {"updated": len(articles)}
```

---

## Frontend

### `frontend/src/api/client.ts`

Add to `articles` object:
```typescript
bulkCategorize: (slugs: string[], add: string[], remove: string[]): Promise<{ updated: number }> =>
  request('/articles/bulk-categorize', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ article_slugs: slugs, add_categories: add, remove_categories: remove }),
  }),
```

### `frontend/src/components/ArticleCard.tsx` — selectable mode

Add optional props:
```typescript
interface Props {
  article: ArticleCardType;
  categories: {...}[];
  selectable?: boolean;   // bulk mode active
  selected?: boolean;     // this card is selected
  onSelect?: (id: string) => void;
}
```

When `selectable=true`:
- Render a `<div>` wrapper instead of `<Link>` (prevents navigation)
- `onClick` calls `onSelect(article.id)`
- Top-left overlay: small circular checkbox (empty / amber-checked)
- Selected state: `ring-2 ring-amber-500` on the card

### `frontend/src/components/Sidebar.tsx`

Add `onBulkCategorize: () => void` to `Props`; add a **"一括更新"** button in the editor section alongside "AI分類" and "編集".

### `frontend/src/components/BulkCategoryPanel.tsx` — **new file**

Fixed bottom bar (`fixed bottom-0 left-0 right-0 z-50`), dark background, shown only in bulk mode.

**Props:**
```typescript
interface Props {
  categories: Category[];
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onUpdate: (add: string[], remove: string[]) => Promise<void>;
  onCancel: () => void;
}
```

**Internal state:** `catState: Record<string, 'neutral' | 'add' | 'remove'>` — all start `'neutral'`; clicking a chip cycles `neutral → add → remove → neutral`.

**Layout (single row, responsive):**
```
│ N件選択中  [全選択] [解除]  │  ← scrollable chips →  │  [更新]  [✕]  │
```

Category chip styles:
- Neutral: `bg-surface2 text-slate-400` (no prefix)
- Add: `bg-amber-500 text-black` (prefix `+`)
- Remove: `bg-red-600 text-white` (prefix `×`)

"更新" disabled unless ≥1 article selected AND ≥1 category in add/remove state.

### `frontend/src/pages/Home.tsx` — bulk mode state

New state:
```typescript
const [bulkMode, setBulkMode] = useState(false);
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
```

Handlers:
```typescript
const toggleSelect = (id: string) => setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
const enterBulkMode = () => { setBulkMode(true); setSelectedIds(new Set()); };
const exitBulkMode  = () => { setBulkMode(false); setSelectedIds(new Set()); };

const handleBulkUpdate = async (add: string[], remove: string[]) => {
  const slugs = displayedArticles.filter(a => selectedIds.has(a.id)).map(a => a.slug);
  await api.articles.bulkCategorize(slugs, add, remove);
  exitBulkMode();
  loadArticles(true);
  reloadCategories();
};
```

Wire-up:
- Pass `onBulkCategorize={enterBulkMode}` to `<Sidebar>`
- Pass `selectable={bulkMode} selected={selectedIds.has(a.id)} onSelect={toggleSelect}` to each `<ArticleCard>`
- Render `<BulkCategoryPanel>` at bottom of page when `bulkMode === true`
- Add mobile "一括更新" button in the existing `{isEditor && ...}` mobile action row

---

## Files to Create / Modify

| File | Action |
|---|---|
| `backend/schemas.py` | Add `BulkCategorizeRequest` |
| `backend/routers/articles.py` | Add `PATCH /bulk-categorize` endpoint |
| `frontend/src/api/client.ts` | Add `bulkCategorize` method |
| `frontend/src/components/ArticleCard.tsx` | Add `selectable/selected/onSelect` props |
| `frontend/src/components/Sidebar.tsx` | Add `onBulkCategorize` prop + button |
| `frontend/src/components/BulkCategoryPanel.tsx` | **Create** — fixed bottom action bar |
| `frontend/src/pages/Home.tsx` | Bulk mode state, handlers, wire up all the above |

---

## Verification

1. Enter bulk mode → article cards show checkboxes; clicking navigates no longer, selects instead
2. Select several articles → count updates in bottom bar
3. 全選択 selects all visible; 解除 clears
4. Clicking a category chip cycles: grey → amber(+) → red(×) → grey
5. "更新" disabled until ≥1 article selected AND ≥1 category in add/remove state
6. Press "更新" with add category set → those articles gain the category; unselected articles unchanged; already-having articles unaffected (idempotent)
7. Remove (×) a category → selected articles lose it; unselected articles keep it
8. Neutral categories → verify no change across all articles
9. Cancel exits bulk mode with no changes made
10. Mobile: "一括更新" in the mobile action row; panel readable at the bottom
