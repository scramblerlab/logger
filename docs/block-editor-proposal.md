# Proposal: Block-Based Edit Page for Logger (Mobile-First)

## Context

The logger app's `WritePage` (`frontend/src/pages/WritePage.tsx`) currently uses `@uiw/react-md-editor` — a raw Markdown textarea. On iPhone, users must type syntax manually (`##` for headings, `- ` for list items, `![](path)` for images). This is ergonomically poor on a phone keyboard.

The goal is to replace the body editor with a **block-based WYSIWYG editor** inspired by WordPress Gutenberg, designed specifically for single-thumb use on iPhone Air (~390px wide). The article backend and Markdown storage format remain unchanged — blocks serialize to/from Markdown transparently.

---

## Block Types to Implement

| Block | Icon | Description |
|-------|------|-------------|
| Paragraph | ¶ | Default text block; supports inline bold/italic/link |
| Heading | H | H2, H3, H4 levels |
| List | ≡ | Bullet or numbered; multiple items |
| Quote | " | Blockquote with optional attribution line |
| Code | </> | Monospace code block with optional language label |
| Image | 🖼 | Upload from camera/library or pick existing; optional caption |
| Video | ▶ | File upload or URL (YouTube/Vimeo embed) |

---

## Page Layout (ASCII Mockups)

### Main editor — scrollable, no keyboard

```
┌──────────────────────────────────────────┐
│ [←]  記事を編集            [更新する]    │  ← sticky top bar (amber button)
├──────────────────────────────────────────┤
│  ┌──────────────────────────────────┐    │
│  │                                  │    │
│  │  📷  ヒーロー画像をタップして選択  │    │  ← hero image zone (tap=pick)
│  │                                  │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  タイトルを入力...（大きいフォント）│    │  ← auto-resize title textarea
│  └──────────────────────────────────┘    │
│  ────────────────────────────────────    │
│                                          │
│  ┌─[¶]────────────────────────────────┐  │
│  │ 本文を入力してください...            │  │  ← paragraph block
│  └──────────────────────────────────────┘ │
│                  [+]                     │  ← inter-block inserter (centered)
│  ┌─[H2]───────────────────────────────┐  │
│  │ 見出しテキスト                      │  │  ← heading block
│  └──────────────────────────────────────┘ │
│                  [+]                     │
│  ┌─[🖼]───────────────────────────────┐  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │       画像プレビュー          │  │  │  ← image block
│  │  └──────────────────────────────┘  │  │
│  │  キャプション...                    │  │
│  └──────────────────────────────────────┘ │
│                  [+]                     │
│  ┌─[" ]───────────────────────────────┐  │
│  │  ❝ 引用文を入力...                  │  │  ← quote block
│  │  — 出典（任意）...                  │  │
│  └──────────────────────────────────────┘ │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │       [＋ ブロックを追加]         │    │  ← end-of-content inserter
│  └──────────────────────────────────┘    │
│                                          │
│  ── カテゴリー ─────────────────────    │
│  [バイク] [温泉] [銭湯] [✦ AI分析]      │
│                                          │
│  ── タグ ───────────────────────────    │
│  [タグ入力 → Enter]  [追加]             │
│  #tokyo  #cycling  ×                    │
│                                          │
│  ── 公開日時 ────────────────────────   │
│  [2026-06-14T09:00]                     │
│                                          │
│  ── AIコメント ──────────────────────   │
│  [✦ AIコメント追加/変更]                 │
│  ┌──────────────────────────────────┐   │
│  │ ✦ AIコメント（現在）             │   │
│  │ ...                              │   │
│  └──────────────────────────────────┘   │
│                                          │
└──────────────────────────────────────────┘
```

### Block selected state (keyboard open)

```
┌──────────────────────────────────────────┐
│ [←]  記事を編集            [更新する]    │  ← still visible
├──────────────────────────────────────────┤
│                                          │
│  ┌─[¶ ▾]──────────────────────────────┐  │
│  │ テキストを入力中|カーソル            │  │  ← active block (amber border)
│  └──────────────────────────────────────┘ │
│                                          │
└──────────────────────────────────────────┘
┌──────────────────────────────────────────┐  ← floats above keyboard
│ B I 🔗 │ H2 H3 H4 │ " ≡ • 🖼 │ ↑ ↓ ⠿ 🗑 │  ← format / block-level / move
└──────────────────────────────────────────┘
┌──────────────────────────────────────────┐
│                                          │
│             iOS キーボード                │
│                                          │
└──────────────────────────────────────────┘
```

The floating toolbar uses `position: fixed; bottom: env(keyboard-inset-height, 0)` (iOS 15+ CSS env variable) so it sits exactly above the software keyboard. The toolbar is kept **compact** (≤ 36px tall, icons ~24px, padding minimal) so it steals as little screen space as possible while remaining tap-friendly (44px touch targets via extended padding, not visual height).

**Toolbar icon groups (left → right, horizontally scrollable if needed):**
```
[ B  I  🔗 ]  — inline: bold, italic, link
[ H2 H3 H4 ]  — convert heading level (or convert paragraph → heading)
[ "  ≡  •  🖼 ] — convert to quote / ordered list / bullet list / insert image
[ ↑  ↓  ⠿  🗑 ] — move up, move down, drag handle (see below), delete block
```

The `🖼` button in the toolbar opens the device photo picker inline (same as the Image block "add" flow) and inserts a new Image block immediately below the current block — useful when you want to add a photo mid-paragraph without leaving typing flow.

**Auto-scroll when keyboard opens:** When a block is focused and the iOS keyboard appears, the page must scroll so the active block is visible above the toolbar. Implementation: on block `focus`, call `block.scrollIntoView({ behavior: 'smooth', block: 'nearest' })` after a short delay (~300ms, enough time for the keyboard animation). The `interactive-widget=resizes-content` viewport flag causes the browser to resize the viewport (shrink it), so `scrollIntoView` uses the correct visual viewport. This ensures the user always sees what they're typing.

### Block picker bottom sheet (after tapping "+")

```
┌──────────────────────────────────────────┐
│              ━━━━━━━━━                   │  ← drag handle
│  ブロックを追加                          │
├──────────────────────────────────────────┤
│                                          │
│  ┌───────┐  ┌───────┐  ┌───────┐        │
│  │   ¶   │  │   H   │  │   ≡   │        │
│  │  段落  │  │  見出し │  │ リスト │       │
│  └───────┘  └───────┘  └───────┘        │
│                                          │
│  ┌───────┐  ┌───────┐  ┌───────┐        │
│  │   "   │  │  </>  │  │  🖼   │        │
│  │  引用  │  │ コード │  │  画像  │        │
│  └───────┘  └───────┘  └───────┘        │
│                                          │
│  ┌───────┐                              │
│  │   ▶   │                              │
│  │  動画  │                              │
│  └───────┘                              │
│                                          │
│  ────────────────────────────────────   │
│  [キャンセル]                           │
└──────────────────────────────────────────┘
```

The sheet slides up from the bottom (CSS transform transition). Each block icon is ≥ 64×64px (thumb-friendly). Tapping outside the sheet dismisses it.

### Post success banner (after "更新する")

```
┌──────────────────────────────────────────┐
│                                          │
│      ✓  更新が完了しました               │  ← green checkmark + title
│                                          │
├──────────────────────────────────────────┤
│                                          │
│  URL                                     │
│  /articles/2026-06-14-my-post-a1b2       │
│                                          │
│  ページサイズ       23.4 KB             │
│  ブロック数          8                  │
│  公開日時     2026-06-14 09:00          │
│                                          │
├──────────────────────────────────────────┤
│                                          │
│  ┌──────────────────────────────────┐   │
│  │         記事を表示する            │   │  ← primary CTA (amber)
│  └──────────────────────────────────┘   │
│                                          │
│  [編集を続ける]      [一覧へ戻る]       │
│                                          │
└──────────────────────────────────────────┘
```

**Failure state** (same component, red):
```
┌──────────────────────────────────────────┐
│   ✕   投稿に失敗しました                 │
│   ネットワークエラーが発生しました。     │
│   [再試行する]   [下書き保存]           │
└──────────────────────────────────────────┘
```

---

## Architecture

### Storage strategy — no backend schema change

Markdown remains the canonical format. The block editor is a visual layer:

- **Load**: Parse `article.body` (Markdown string) → `Block[]` using remark's mdast
- **Save**: Serialize `Block[]` → Markdown string → POST/PUT to existing API (no change to endpoint)

This means `ArticlePage` and its `react-markdown` rendering continue to work without modification.

### Block data model (`utils/blocks.ts`)

```ts
type Block =
  | { id: string; type: 'paragraph'; content: string }
  | { id: string; type: 'heading'; level: 2 | 3 | 4; content: string }
  | { id: string; type: 'list'; ordered: boolean; items: string[] }
  | { id: string; type: 'quote'; content: string; attribution?: string }
  | { id: string; type: 'code'; language?: string; code: string }
  | { id: string; type: 'image'; src: string; caption?: string }
  | { id: string; type: 'video'; src?: string; url?: string; caption?: string }
```

### Markdown serialization (blocks → string)

```
paragraph → content (may contain **bold**, _italic_ inline syntax)
heading   → ## / ### / #### + content
list      → - item\n- item   or   1. item\n2. item
quote     → > content\n> — attribution
code      → ```lang\ncode\n```
image     → ![caption](src)
video     → [▶ caption](url)  or  <video src="..."></video>
```

Blocks are joined with `\n\n` to produce standard Markdown.

### Markdown parsing (string → blocks)

Use `remark-parse` (already a transitive dep of `react-markdown`; no new npm install expected) to parse to mdast, then map node types:

| mdast type | → Block type |
|------------|--------------|
| `paragraph` | `paragraph` |
| `heading` (depth 2–4) | `heading` |
| `list` | `list` |
| `blockquote` | `quote` |
| `code` | `code` |
| `image` | `image` |
| Other | `paragraph` (raw markdown text as fallback) |

Inline formatting within paragraph/heading nodes is re-serialized back to Markdown syntax (bold → `**`, italic → `_`) so the content string carries inline markup without us needing a rich-text editor.

### Component structure

```
WritePage.tsx  (refactored)
├── HeroImagePicker         (existing logic, extracted into component)
├── BlockEditor.tsx         (NEW — orchestrates block list state)
│   ├── BlockInserter.tsx   (NEW — "+" buttons + bottom sheet)
│   ├── BlockItem.tsx       (NEW — selected state, amber border, drag handle)
│   │   ├── ParagraphBlock.tsx   (auto-resize textarea)
│   │   ├── HeadingBlock.tsx     (auto-resize input, large font)
│   │   ├── ListBlock.tsx        (one input per item, Enter adds item)
│   │   ├── QuoteBlock.tsx       (two textareas: content + attribution)
│   │   ├── CodeBlock.tsx        (monospace textarea, language input)
│   │   ├── ImageBlock.tsx       (file input + preview + caption)
│   │   └── VideoBlock.tsx       (file or URL input + caption)
│   └── BlockToolbar.tsx    (NEW — fixed bar above keyboard)
└── PostResultBanner.tsx    (NEW — success/failure overlay)
```

### Keyboard-aware toolbar technique

```css
/* Toolbar floats above iOS software keyboard */
.block-toolbar {
  position: fixed;
  bottom: env(keyboard-inset-height, 0px);  /* iOS 15+ */
  left: 0; right: 0;
  z-index: 50;
}
```

This requires `<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content">` in `index.html` (add `interactive-widget` attribute).

### Block reordering (two complementary modes)

**Mode 1 — Arrow buttons (↑ ↓) in the floating toolbar:**  
Tap ↑ or ↓ to move the currently selected block one position up or down. Fast and accessible; works with any input method.

**Mode 2 — Drag handle (⠿) in the toolbar — block drag when selected:**  
When a block is selected (focused or tapped while already focused), the ⠿ handle in the toolbar becomes a touch-drag affordance. Touching and holding ⠿ then dragging up or down reorders the block relative to others. Visual feedback: the dragged block becomes semi-transparent (opacity 0.5), and a blue insertion line appears between blocks to show the drop target. Implementation uses React's pointer event API (`onPointerDown`, `onPointerMove`, `onPointerUp`) rather than HTML5 drag-and-drop for better iOS touch reliability. The block list maintains a `dragIndex` + `dropIndex` state; on pointer-up the array is reordered.

This means: selecting a block → toolbar appears → user can immediately drag it by the handle without leaving the editing state.

### Post feedback — backend minor addition

`backend/schemas.py` — add `body_size_bytes: int` to `ArticleOut`:
```python
body_size_bytes: int = 0  # len(body.encode('utf-8'))
```
`backend/routers/articles.py` — populate when returning response. This gives the frontend page size info for the success banner. No DB change needed.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `frontend/src/pages/WritePage.tsx` | Refactor: swap MDEditor for BlockEditor, add PostResultBanner, wire success state |
| `frontend/src/utils/blocks.ts` | Create: Block types, `parseMarkdown()`, `serializeBlocks()` |
| `frontend/src/components/BlockEditor.tsx` | Create: block list state, add/remove/reorder, passes blocks to child |
| `frontend/src/components/BlockInserter.tsx` | Create: "+" button + bottom sheet overlay |
| `frontend/src/components/BlockToolbar.tsx` | Create: fixed above-keyboard formatting bar |
| `frontend/src/components/blocks/ParagraphBlock.tsx` | Create |
| `frontend/src/components/blocks/HeadingBlock.tsx` | Create |
| `frontend/src/components/blocks/ListBlock.tsx` | Create |
| `frontend/src/components/blocks/QuoteBlock.tsx` | Create |
| `frontend/src/components/blocks/CodeBlock.tsx` | Create |
| `frontend/src/components/blocks/ImageBlock.tsx` | Create |
| `frontend/src/components/blocks/VideoBlock.tsx` | Create |
| `frontend/src/components/PostResultBanner.tsx` | Create |
| `frontend/index.html` | Add `interactive-widget=resizes-content` to viewport meta |
| `backend/schemas.py` | Add `body_size_bytes` to ArticleOut |
| `backend/routers/articles.py` | Populate `body_size_bytes` in create/update responses |

**No new npm packages** are expected (remark-parse is already a transitive dep; verify with `ls node_modules/remark-parse` before install).

---

## Key UX Decisions

| Decision | Rationale |
|----------|-----------|
| `<textarea>` per block (not contenteditable) | iOS Safari contenteditable has longstanding bugs with cursor position and selection; textarea is reliable |
| Bottom sheet for block picker | Thumb reaches bottom easily; slides up naturally from the action area |
| Floating toolbar above keyboard | The standard mobile rich-text pattern (Notion, WordPress iOS, Bear) — no hunting for formatting options |
| Inline markdown syntax in paragraph/heading `content` field | Avoids needing a full rich-text engine; users familiar with **bold** still work, newcomers use the toolbar |
| 🖼 in toolbar (not only in block picker) | Adding a photo mid-flow is the most common mobile action; one tap from the keyboard is faster than dismissing → opening block picker → selecting Image |
| Auto-scroll active block above keyboard | iOS keyboard covers ~40% of screen; without explicit scroll the user types blind. `scrollIntoView` after keyboard animation completes keeps the block visible |
| Compact toolbar (≤ 36px) with extended touch targets | Screen real estate is scarce with keyboard open; visual slimness matters but tap reliability must be maintained via invisible padding |
| Pointer-event drag (not HTML5 DnD) for block reorder | HTML5 drag API fires `dragstart` poorly on iOS Safari touch; pointer events are consistent across all iOS versions |
| Markdown as storage format (not block JSON) | Zero backend migration; ArticlePage works unchanged; existing articles editable |
| Parse existing articles best-effort | Complex markdown (tables, HTML blocks) falls back to paragraph blocks showing raw markdown; acceptable tradeoff |

---

## Verification Plan

### Part 1 — Verified by Claude (automated / static checks)

These run before handing off:

1. **TypeScript compile**: `cd frontend && npx tsc --noEmit` — zero errors
2. **Markdown serialization round-trip unit test** (inline, via `tsx`/`node`):  
   - Feed a representative Markdown string through `parseMarkdown()` → `serializeBlocks()` → compare with original; assert structural equivalence for paragraph, heading (H2–H4), bullet list, numbered list, blockquote, code block, image
3. **Block order operations**: verify `moveBlock(blocks, 2, 0)` and `moveBlock(blocks, 0, 3)` produce correct arrays
4. **Backend type check**: `cd backend && python -m mypy routers/articles.py schemas.py` (or `pyright`) — no new errors from `body_size_bytes` addition
5. **Dev server starts**: `npm run dev` exits with no fatal errors; app loads at `localhost:5173`
6. **Browser console**: open the app in Chromium headless / Playwright and assert zero JS errors on page load and on navigating to `/write`
7. **Markdown serialization of each block type**: programmatically create one block of each type with known content, serialize, assert the output string matches expected Markdown pattern

### Part 2 — Verified by human (on-device / interactive)

Hand off after Part 1 passes. Test on **iPhone Air** (or Chrome DevTools → iPhone 15 Pro, 390 × 844):

1. Navigate to `/write?edit=<any-existing-slug>` — existing article body loads as visible blocks (paragraph, heading, image), no raw Markdown syntax visible
2. Tap between two blocks → "+" appears → tap "+" → bottom sheet slides up with all 7 block types
3. Tap "見出し" → heading block inserted at that position → type text → toolbar shows H2/H3/H4 switcher
4. Tap "🖼" in the floating toolbar while a paragraph is active → photo picker opens → select photo → Image block inserted below, preview visible
5. Focus a block → keyboard opens → active block is visible above the keyboard (not hidden beneath it)
6. Verify toolbar height is compact — does not crowd the content area excessively
7. Tap ↑/↓ in toolbar → blocks reorder correctly
8. Touch-hold ⠿ drag handle → drag block up/down → blue drop indicator appears between blocks → release → block moves to new position
9. Tap "更新する" → success banner shows URL, page size (KB), block count
10. Toggle airplane mode → tap "更新する" → failure banner appears with retry option
11. Navigate to `ArticlePage` for the saved article → verify it renders correctly (Markdown round-trip intact)
