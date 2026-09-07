# logger 改善計画

## Context

LP（`Home.tsx`）に編集者向けのボタンが散らばっており、サイドバー・モバイルタブ・ヘッダーの3か所に同種の操作が重複している。カテゴリー選択も lg 以上とモバイルで別実装になっている。これを「バルク操作」「カテゴリー選択」の2つのポップアップに集約し、サイドバーはタグ専用に縮小する。

あわせて、実運用で見つかった3つの不具合を直す:

1. **編集時に最後に付けた画像が反映されないことがある** — 編集モードには pending 画像の回収処理が無く、アップロード完了前に「更新する」を押すと画像ブロックが無言で消える競合状態。
2. **画像の縦画面判定が保存時に効かない** — バックエンドが PIL で再エンコードする際に EXIF Orientation を適用も保存もしていないため、スマホの縦写真が横向きで保存される。
3. **URL抽出記事がゲストにも見えてしまう** — 記事の出自を記録するカラムが実質未使用で、抽出記事を区別する手段が無い。

---

## 1. LP の再編（ポップアップ2つ + サイドバー縮小）

### 1-1. 新規 `frontend/src/components/BulkActionsModal.tsx`

既存の `CategoryEditModal.tsx` のモーダル構造（`fixed inset-0 z-50 / bg-black/70` + `stopPropagation` する内側パネル）をそのまま踏襲する。

中身（すべて `isEditor` のときのみ）:

| 項目 | 現在の実装元 | 使うフック/props |
|---|---|---|
| ✦ AIカテゴリ分析 | `Sidebar.tsx:42-49` / `Home.tsx:230-236` | `useAiJob().startJob` / `status` / `progress` |
| ✦ AIコメント | `Sidebar.tsx:62-69` / `Home.tsx:237-243` | `useAiJob().startCommentJob` / `commentStatus` / `commentProgress` |
| 🔔 AI通知 ON/OFF | `Sidebar.tsx:163-176` / `Home.tsx:285-295` | `usePushNotification()` |
| 📁 カテゴリー一括更新 | `Sidebar.tsx:51` | props `onBulkCategorize`（＝`Home.enterBulkMode`）— 押したらモーダルを閉じて選択モードへ |
| ⬇ WordPress一括インポート | `Sidebar.tsx:134-142` | `<Link to="/import">` |
| ⬇ Shopifyブログ一括インポート | `Sidebar.tsx:143-151` | `<Link to="/import/shopify">` |
| ⬆ Shopifyブログにエクスポート | `Sidebar.tsx:152-160` | props `onShopifyExport` |

進捗テキスト（`aiProgress` / `commentProgress`）はモーダル内の各行の下に出す。ジョブ実行中はモーダルを閉じても `AiJobContext` が polling を続けるので、既存の Header の実行中インジケーター（`Header.tsx:68-76`）はそのまま残す。

### 1-2. 新規 `frontend/src/components/CategoryPickerModal.tsx`

- 「すべて / All」＋ 全記事件数、各カテゴリー＋ `cat.article_count`（`CategoryOut.article_count` は `routers/categories.py:16-38` で既に返っている）。色ドットと `name_en` の見せ方は `Sidebar.tsx:92-110` を流用。
- 選択したらモーダルを閉じて `onSelectCategory(slug)` を呼ぶ（`Home.handleSelectCategory` がそのまま使える）。
- フッターに「カテゴリーを編集」ボタン → 既存 `CategoryEditModal` を開く（ユーザー指示どおり、バルク操作側ではなくこちらに置く）。`isEditor` のときのみ表示。
- 翻訳ラベル（`translatedCategoryLabels` / `translatedLabels`）を props で受けて既存挙動を維持する。

### 1-3. `frontend/src/pages/Home.tsx` の組み替え

- モバイル用アクションボタン群（`Home.tsx:227-257`）とモバイルカテゴリータブ（`Home.tsx:259-297`）を削除。
- 記事グリッド上部に全ブレークポイント共通のツールバーを置く:
  - `[ カテゴリー: 温泉 23件 / 全 754件 ]` — `CategoryPickerModal` を開くボタン。件数は **`total`（現在のフィルタの件数、`loadArticles` が既にセット）と `allCount`** を使う。`cat.article_count` ではなく `total` を使うのは、タグ絞り込み時も正しい値になるため。
  - `[ バルク操作 ]` — `isEditor` のときのみ、`BulkActionsModal` を開く。
  - 既存の「新着順 / インポート順」ボタン（`Home.tsx:316-331`）はここに並べる。
- ログイン/ログアウトボタンは `Header` に集約するか、ツールバー右端に置く（現状 `Sidebar.tsx:177-183` と `Home.tsx:279-284` に重複しているので1か所に）。
- `Sidebar` の呼び出しは残すが、渡す props は `tags` / `onSelectTag` のみに減らす。

### 1-4. `frontend/src/components/Sidebar.tsx` をタグ専用に縮小

カテゴリー一覧・AI系ボタン・インポート/エクスポート導線・通知トグル・ログインを全て削除し、タグクラウド（`Sidebar.tsx:114-130`）だけ残す。タグが0件なら `Home` 側でサイドバー領域ごと非表示にする。

### 1-5. 検索ヒット数を検索ボックス横に表示

検索ボックスは `Header.tsx:30-43`、結果は `Home.tsx` にあるので、件数を運ぶ経路が要る。

- **バックエンド**: `backend/routers/search.py` の戻り値を `list[ArticleCard]` から `{ items, total }` に変更。`total` は同じ MATCH 条件で `LIMIT` 無しの `COUNT(*)`。`backend/schemas.py` に `SearchResponse` を追加。
- **フロント**: `api.search.query`（`api/client.ts:63-66`）と `types.ts` を追従。
- 新規 `frontend/src/context/SearchContext.tsx` — `{ hitCount: number | null, setHitCount }` だけの軽量 context。既存の `TranslationContext.tsx` と同じ形。`App.tsx:44` の `TranslationProvider` の隣に `SearchProvider` を追加。
- `Home.tsx:112-113` の検索完了時に `setHitCount(res.total)`、検索解除時に `setHitCount(null)`。
- `Header.tsx` の `searchInput` の右に `{hitCount !== null && <span>{hitCount}件</span>}` を出す。
- `Home.tsx:332-337` の既存の「「〜」の検索結果: N件」は `displayedArticles.length`（最大20）ではなく `total` を使うよう直す。

---

## 2. 投稿画面（`frontend/src/pages/WritePage.tsx`）

### 2-1. ピル名称変更と配置

- `WritePage.tsx:459` `'✦ AI分析'` → **`'✦ AIカテゴリー分析'`**（実行中は `'⏳ AIカテゴリー分析中...'`）
- `WritePage.tsx:477` `'✦ AIコメント追加/変更'` → **`'✦ AIコメント'`**（実行中は `'⏳ AIコメント生成中...'`）
- 現在 AIコメントのブロック（`WritePage.tsx:468-492`）がカテゴリーチップ（`:494-506`）**より上**にあるため、AIカテゴリー分析ボタンと、その結果であるカテゴリーチップが分断されている。順序を **`AIカテゴリー分析ボタン` → `カテゴリーチップ` → `AIコメントボタン + 現在のコメント表示`** に入れ替え、機能単位でまとまるようにする。

### 2-2. ゲスト公開チェックボックス

「ソースURL」欄（`WritePage.tsx:537-549`、現在は新規時のみ表示）の近くに、新規・編集どちらでも表示するチェックボックスを追加:

```
[x] ゲストにも公開する
     URL抽出した記事は既定で非公開です
```

- state: `const [guestVisible, setGuestVisible] = useState(true)`
- Web記事抽出から来た場合（`WritePage.tsx:129-152` の `location.state.extraction` 分岐）は `setGuestVisible(false)`
- 編集時は `api.articles.get()` のレスポンスから復元（`WritePage.tsx:114-125`）
- `handleSubmit` の両分岐で `form.append('guest_visible', String(guestVisible))`

---

## 3. 編集時に画像が反映されない不具合

### 根本原因（コード確認済み・推測ではない）

1. 編集モードの画像アップロードは **fire-and-forget**。`BlockEditor.tsx:109-113`（ツールバー挿入）と `:83-90`（ImageBlock からの差し替え）が `onUploadImage(...).then(...)` を投げっぱなしで、進行中のアップロードをどこも追跡していない。
2. `serializeBlock` は `src` が空の画像ブロックを **無言で捨てる**（`utils/blocks.ts:175-176` → `''` を返し、`serializeBlocks` の `.filter(Boolean)` で消える）。
3. `handleSubmit` の**編集分岐**（`WritePage.tsx:266-276`）には pending 画像の回収処理が無い。新規分岐（`:281-312`）にしかない二段階アップロードが編集側に存在しない。
4. `uploadImageToSlug`（`WritePage.tsx:63-73`）が全ての失敗を握りつぶして `null` を返す。ステータスコードも理由もタイムアウトも無い。

→ アップロードが「更新する」より遅いと画像ブロックが消える。**最後に付けた画像**が最も猶予が短いので再現しやすく、通信状況次第で成功したりしなかったりする（＝「反映されない時がある」）。

### 修正

**`WritePage.tsx`**
- `uploadImageToSlug` を書き換え: `AbortController` + 60秒タイムアウト、戻り値を `{ ok: true; relPath } | { ok: false; reason: 'timeout' | 'http' | 'network'; detail: string }` に。各段階で `console.info` / `console.error`（slug・ファイル名・バイト数・経過ms・HTTPステータス）を出す。
- `const pendingUploads = useRef(new Map<string, Promise<...>>())` を追加。`handleBlockImageUpload` が Promise を登録し、settle 時に削除する。
- `handleSubmit` の **Step 0** として、編集・新規どちらでも:
  1. `setSubmitStatus('画像アップロードの完了を待機中...')` → `await Promise.all([...pendingUploads.current.values()])`
  2. それでも `pendingFile` があって `src` が空の画像ブロックが残っていたら、新規分岐と同じ要領でその場で順次アップロードして `src` を埋める（編集モードでは `editSlug` があるので即 upload 可）
  3. 最終的に `src` が埋まらなかった画像があれば **黙って捨てず throw** し、`postError` に理由を出す
- タイムアウト時のメッセージ: `画像のアップロードがタイムアウトしました（60秒）。通信環境を確認して、もう一度お試しください。`
- ついでに: `pollJob`（`:48-61`）は 180 秒で `'タイムアウトしました'` を throw しているのに、`handleAiClassify`（`:200`）と `handleAiComment`（`:212`）が `catch { ... 'エラーが発生しました' }` で握りつぶしていて、タイムアウト表示がユーザーに届いていない。`catch (err)` にして `err.message` を出す。

**`backend/routers/articles.py`**
- `upload_article_image`（`:386-401`）に `logger.info`（slug・filename・受信バイト数・保存後 rel_path・所要時間）と、`storage.save_upload` を `try/except` で囲んで `logger.exception` → `HTTPException(500, ...)` を追加。現状は PIL の失敗が無言の 500 になる。

---

## 4. 画像の縦画面（EXIF Orientation）不具合

### 根本原因

`backend/services/storage.py:42-57` `_write_and_optimize` が `Image.open()` → `img.save(..., "JPEG")` するだけで、**EXIF Orientation を適用も引き継ぎもしていない**。スマホの縦写真はピクセル自体は横向きで格納され `Orientation=6` で縦に見せているため、EXIF が落ちた保存後の JPEG は横向きになる。これが「縦画面判定が保存時に効いていない」の正体。リポジトリ全体を grep しても `exif` / `transpose` / `orientation` は1件もヒットしない。

### 修正

- `storage.py` で `from PIL import Image, ImageOps` し、`Image.open()` の直後に `img = ImageOps.exif_transpose(img)` を入れる（mode 変換・`thumbnail` より前）。これで正しい向きがピクセルに焼き込まれ、EXIF が落ちても正しく表示される。
- 検証用に `logger.debug` を1行追加: 変換前の Orientation タグ値と、変換前後の `img.size`。
- `WritePage.tsx:15` `createImageBitmap(file)` → `createImageBitmap(file, { imageOrientation: 'from-image' })`。既定値は仕様変更の経緯があり Safari/iOS で挙動が割れるため明示する。指定が無いと、ユーザーの手動回転と未適用の EXIF 回転が二重にかかる可能性がある。
- 任意（別件・保存の不具合ではない）: 記事本文の画像 `ArticlePage.tsx:104` と編集プレビュー `ImageBlock.tsx:53` が `object-cover` + 固定高のため縦写真が強く切れる。`object-contain` に寄せると縦写真の見え方が改善する。

---

## 5. URL抽出記事のゲスト非表示

**バックフィルは行わない**（実データは別マシンのため）。既存記事はすべて公開のまま、抽出記事は手動でチェックを外す運用。

### 5-1. `backend/models.py`

`Article` に追加:
```python
guest_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
```
出自の記録には**既存の未使用カラム `source_site`** を使う（現状どのコードも書き込んでいない）。`extract` 経由の作成時に `source_site="extract"` を入れる。新カラムは増やさない。

### 5-2. `backend/database.py` `init_db`

現在の DB は `user_version = 5`。既存パターン（`:63-66` の ai_comment 追加）に倣って追記:
```python
if version < 6:
    await conn.execute(text(
        "ALTER TABLE articles ADD COLUMN guest_visible BOOLEAN NOT NULL DEFAULT 1"
    ))
    await conn.execute(text("PRAGMA user_version = 6"))
```
`Base.metadata.create_all` は既存テーブルに列を足さないので ALTER が必須。バックフィルは無し＝既存記事は全部 `guest_visible = 1`。

### 5-3. `backend/auth.py` — オプショナル認証

`get_current_user`（`auth.py:54-58`）は未ログインで 401 を投げるため、公開エンドポイントには使えない。隣に追加:
```python
async def get_optional_user(request: Request) -> str | None:
    token = request.cookies.get("auth_token")
    if not token:
        return None
    try:
        return verify_token(token)
    except HTTPException:
        return None
```

### 5-4. フィルタを入れる箇所（すべて「未ログインのときだけ絞る」）

| ファイル | 箇所 | 対応 |
|---|---|---|
| `routers/articles.py:47-78` | `list_articles` | `if viewer is None: q = q.where(Article.guest_visible.is_(True))` — `total` も同じ `q` から数えているので自動で整合する |
| `routers/articles.py:96-102` | `get_article` | 非公開かつ未ログインなら 404（403 だと存在が漏れる） |
| `routers/search.py:13-30` | `search_articles` | SQL に `AND a.guest_visible = 1` を条件付きで足す。§1-5 の `total` も同条件で数える |
| `routers/categories.py:23-28` | カテゴリー件数の相関サブクエリ | 未ログイン時は `AND articles.guest_visible = 1` を足す。でないとサイドバー件数から非公開記事の存在が漏れる |
| `services/ai_chat.py:24-109` | 統計・FTS 検索 | `SELECT COUNT(*) FROM articles` / 最近記事 / FTS JOIN に同条件。ここを漏らすとゲストが AI 経由で非公開記事の内容を読める |

`Home.tsx:58-62` のヒーロー記事と `:67` の `allCount` は `api.articles.list` 経由なので自動で追従する。

### 5-5. スキーマ・型・表示

- `backend/schemas.py`: `ArticleCard` に `guest_visible: bool = True` を追加（`ArticleOut` は継承）。`source_site: Optional[str]` も `ArticleOut` に足すと編集画面で出自を出せる。
- `routers/articles.py` の `create_article`（`:105-117`）と `update_article`（`:282-297`）に `guest_visible: Optional[bool] = Form(None)` を追加して反映。`article.json` にも書き出す（`:160-170`, `:362-378`）。
- `routers/extract.py` の結果から作られた記事は `source_site="extract"`。ただし記事作成は抽出後に `WritePage` から `POST /api/articles` で行われるので、`extraction` 由来であることをフォームで送る必要がある: `WritePage` の抽出初期化分岐（`:129-152`）で `sourceSite` state に `'extract'` を入れ、作成時に `form.append('source_site', 'extract')`。
- `frontend/src/types.ts`: `ArticleCard` に `guest_visible: boolean`、`Article` に `source_site: string | null`。
- `frontend/src/components/ArticleCard.tsx`: `isEditor` かつ `!article.guest_visible` のとき、`checkbox`（`:29-37`）と同じ要領で右上に `🔒 非公開` バッジ。編集者が抽出記事を手動で見つけて切り替えるのに使う。

---

## 変更ファイル一覧

**新規**
- `frontend/src/components/BulkActionsModal.tsx`
- `frontend/src/components/CategoryPickerModal.tsx`
- `frontend/src/context/SearchContext.tsx`

**変更（フロント）**
- `frontend/src/pages/Home.tsx` — ツールバー化、件数表示、モーダル配線
- `frontend/src/components/Sidebar.tsx` — タグ専用に縮小
- `frontend/src/components/Header.tsx` — 検索ヒット数
- `frontend/src/pages/WritePage.tsx` — ピル名称/配置、公開チェックボックス、画像アップロード修正、EXIF、AIエラーメッセージ
- `frontend/src/components/ArticleCard.tsx` — 非公開バッジ
- `frontend/src/api/client.ts` / `frontend/src/types.ts` — search レスポンス、`guest_visible`
- `frontend/src/App.tsx` — `SearchProvider`

**変更（バックエンド）**
- `backend/services/storage.py` — `ImageOps.exif_transpose`
- `backend/models.py` / `backend/database.py` / `backend/schemas.py` — `guest_visible`、migration v6
- `backend/auth.py` — `get_optional_user`
- `backend/routers/articles.py` — 可視性フィルタ、フォーム項目、アップロードのログ
- `backend/routers/search.py` — `total` 返却、可視性フィルタ
- `backend/routers/categories.py` / `backend/services/ai_chat.py` — 可視性フィルタ

---

## 検証

自動テストは無いので、`./start.sh`（aimodel proxy が先に必要）で立ち上げて手動確認する。型/lint は `cd frontend && npm run build && npm run lint`。

1. **マイグレーション**: 起動後 `sqlite3 backend/data/blog.db "PRAGMA user_version; SELECT COUNT(*), SUM(guest_visible) FROM articles;"` → `6` と、全件が `guest_visible=1` であること。
2. **LP**: 「カテゴリー」ボタンで件数付きポップアップが開き、選択で絞り込み＋ボタン表示が `温泉 23件 / 全 754件` に更新される。「バルク操作」ポップアップから AI分類・AIコメント・通知トグル・一括更新・インポート導線がすべて動く。サイドバーはタグのみ。
3. **検索**: 検索実行 → 検索ボックス横に件数が出る。20件超ヒットするクエリで、表示件数（20）ではなく総ヒット数が出ること。クリアで消えること。
4. **画像 EXIF**: iPhone で撮った縦写真をヒーロー画像に設定 → 保存 → 記事ページで縦のまま表示される。`sips -g pixelWidth -g pixelHeight backend/data/articles/<slug>/hero.jpg` で高さ > 幅 を確認。
5. **編集時の画像**（本命の再現）: 記事を編集 → 本文末尾に大きめの画像を追加 → **アップロード完了を待たずに即「更新する」**。「画像アップロードの完了を待機中...」が出て、保存後に画像が本文に残っていること。DevTools の Network を Slow 3G にすると再現しやすい。失敗させた場合（バックエンドを落とす等）は無言で消えず、エラーバナーに理由が出ること。
6. **ゲスト非表示**: 編集画面で「ゲストにも公開する」を外して保存 → シークレットウィンドウで LP に出ない / 直接 URL で 404 / 検索に出ない / カテゴリー件数が1減る / AIチャットで内容が引けない。ログイン状態では見えて 🔒 バッジが付くこと。
7. **Web記事抽出**: 抽出 → 投稿画面でチェックが最初から外れていること。

## 補足（実装時に留意）

- ローカルの `backend/data/blog.db` は 754件・全件に `source_url` あり（`www.scrambler-lab.com` 733 / `myshopify.com` 20 / `dancyu.jp` 1）で、`source_site` は全件 NULL。つまり既存データから「URL抽出記事」を機械的に判別する手段は無い。バックフィルを行わない判断はこの事実と整合する。抽出記事は手動でチェックを外す。
- 可視性フィルタは §5-4 の5か所すべてに入れる必要がある。1か所でも漏れると非公開記事が別経路（検索・件数・AIチャット）から漏れる。
