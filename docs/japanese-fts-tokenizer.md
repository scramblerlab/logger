# Japanese FTS Tokenizer

## Problem

SQLite's default `unicode61` tokenizer stores Japanese compound words as single unsplittable tokens. Searching for 「オイル」 when an article contains 「オイル交換」 returns zero results because the tokenizer has no concept of Japanese word boundaries.

## Solution: fugashi + unidic-lite

**Pre-tokenize text at write time using morphological analysis**, store space-separated surface forms in a standalone FTS5 table, and tokenize queries the same way before MATCH.

### Why fugashi over alternatives

| Option | Quality | Notes |
|--------|---------|-------|
| `trigram` (built-in) | ✗ fails 2-char queries | Requires ≥3 Unicode chars; 「交換」= 2 chars → no results |
| Janome | ✓ | Pure Python but ~50× slower than fugashi |
| **fugashi + unidic-lite** | ✓✓ | Fastest; pre-built macOS wheels; no system MeCab needed |
| SudachiPy | ✓✓✓ | Best quality but ~30× slower than fugashi |

**Deployment note:** Pre-built Cython wheels for macOS (Intel and Apple Silicon) are available on PyPI — `pip install fugashi unidic-lite` just works on MacBook / Mac Mini. No Homebrew, no C compiler.

## Architecture

### Before
```
articles table → SQL triggers → articles_fts (content=articles, unicode61)
```
Triggers auto-synced, but SQL cannot call Python tokenizer → no pre-tokenization possible.

### After
```
articles table → Python _fts_upsert() → articles_fts (standalone, fugashi tokens)
```
FTS5 is a standalone table. Python manages all inserts, updates, and deletes.

## Files Changed

| File | Change |
|------|--------|
| `backend/requirements.txt` | Added `fugashi==1.3.2`, `unidic-lite==1.0.8` |
| `backend/services/tokenizer.py` | New — `tokenize_ja()` singleton using fugashi |
| `backend/database.py` | One-time migration via `PRAGMA user_version`; drops triggers, recreates standalone FTS5, repopulates |
| `backend/routers/articles.py` | `_fts_upsert` fetches rowid + tokenizes; called from create/update/delete |
| `backend/routers/importer.py` | Calls `_fts_upsert` after WordPress import |
| `backend/routers/shopify_importer.py` | Calls `_fts_upsert` after Shopify import |
| `backend/routers/search.py` | Tokenizes search query via `tokenize_ja()` |
| `backend/services/ai_chat.py` | Tokenizes FTS queries via `tokenize_ja()` |

## Migration

`PRAGMA user_version` (SQLite built-in, default 0) gates the one-time migration:
- `0` → run migration (drop old FTS5 + triggers, create standalone FTS5, repopulate with tokenized text, set to `1`)
- `1+` → skip

The rebuild at startup tokenizes all existing articles. For a ~1000-article blog this takes a few seconds on first run.

## Example

| Token | unicode61 result | fugashi result |
|-------|-----------------|----------------|
| 「オイル交換」stored, search 「オイル」 | ✗ no match | ✓ matches |
| 「オイル交換」stored, search 「交換」 | ✗ no match | ✓ matches |
| 「GS 1000R」search | ✓ matches | ✓ matches |
| Mixed「GS オイル交換」search | ✗ partial | ✓ AND-matches both tokens |
