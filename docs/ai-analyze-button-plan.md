# 新規投稿の「AI分析」ボタン（カテゴリー分析 + AIコメント一括実行）

## 目的

「投稿」ページ（新規作成モード）で、現在の「✦ AIカテゴリー分析」ボタンを「✦ AI分析」ボタンに置き換え、
1 回押すだけで **カテゴリー/タグ分類** と **AIコメント生成** を両方実行する。

## 現状の仕様（解析結果）

| | 新規投稿 (`/write`) | 編集 (`/write?edit=slug`) |
|---|---|---|
| AIカテゴリー分析 | 表示 | 表示 |
| AIコメント | **非表示** | 表示 |

- **カテゴリー分析** — `POST /api/articles/ai-classify`（title, body を JSON で送信）→ `job_id` → `GET /ai-classify/status/{job_id}` をポーリング。
  記事の保存を必要としない「ステートレス」な API なので、新規投稿でも使える。
  結果は `selectedCats` / `tags` の state に入るだけで、保存は「投稿する」時。
  （`frontend/src/pages/WritePage.tsx` `handleAiClassify`、`backend/routers/articles.py` `ai_classify_start`）
- **AIコメント** — `POST /api/articles/{slug}/ai-comment` → `_run_comment` が DB と `article.json` の
  `ai_comment` / `ai_comment_model` を **直接書き込む**。slug（＝保存済み記事）が必須なので、
  新規投稿画面では `{editSlug && ...}` で非表示になっている。これが今回の制約の核心。
- `create_article`（`POST /api/articles`）は `ai_comment` / `ai_comment_model` を受け付けない。
  `update_article` は `ai_comment` のみ受け付け、`ai_comment_model` は受け付けない。

## 方針

**AIコメントにも「保存しないプレビュー用」API を追加し、生成結果をフロントの state に保持 → 「投稿する」時に一緒に保存する。**
カテゴリー分析と同じ流れ（AI 結果は state、保存は投稿時）に揃える。

### 検討して採用しなかった案

- *投稿後に自動で AIコメントを走らせる* — 「ボタンを押すと両方実行」という要件と違い、投稿前に内容を確認できない。
- *AI分析ボタンを押した時点で下書き保存して slug を作る* — 下書き概念がないため、未完成記事が公開一覧に出てしまう。

## 変更内容

### Backend (`backend/routers/articles.py`, `backend/schemas.py`)

1. **新エンドポイント `POST /api/articles/ai-comment-preview`**（要ログイン）
   - リクエスト: `AIClassifyRequest` と同形 `{title, body}`（スキーマは共用 or `AICommentPreviewRequest` を追加）
   - `single_job.create()` → `asyncio.create_task(_run_comment_preview(...))` → `{job_id}` を返す
   - `_run_comment_preview` は `ai_commenter.generate()` を呼び、結果を `single_job.done(job_id, {ai_comment, ai_comment_model})` に入れるだけ（DB/JSON には書かない）
2. **`GET /api/articles/ai-comment-preview/status/{job_id}`** — `single_job.get(job_id)` を返す
   - ※ ルート定義は `/{slug}` 系より前に置く（`/ai-classify` と同様、パス衝突回避）
3. **`create_article` に `ai_comment` / `ai_comment_model` の Form フィールド（任意）を追加**し、
   `Article` と `article.json` に保存する。

### Frontend

1. `api/client.ts` に `aiCommentPreview(title, body)` / `aiCommentPreviewStatus(jobId)` を追加。
2. `WritePage.tsx`
   - state 追加: `currentCommentModel`（新規投稿時に保存するため）
   - **`handleAiAnalyze`**（新規投稿用）: `classify` → `comment-preview` を**直列実行**（決定事項）。
     分類が失敗してもコメント生成は続行し、メッセージはそれぞれ `classifyMsg` / `commentMsg` に出す。
   - ボタン表示は進行中のステップを示す: 「✦ AI分析」→「⏳ カテゴリー分析中... (1/2)」→「⏳ AIコメント作成中... (2/2)」
   - AI分析の実行中は「投稿する」ボタンを無効化（実行中に投稿するとコメントが保存されず失われるため）
   - カテゴリー欄のボタン: 新規投稿時は「✦ AI分析」(実行中「⏳ AI分析中...」)、編集時は従来どおり「✦ AIカテゴリー分析」。
   - AIコメント欄: 新規投稿時も表示（ボタンなし、生成結果のプレビューと `commentMsg` のみ）。
     ラベルは新規時「✦ AIコメント（投稿時に保存）」、編集時は従来の「✦ AIコメント（現在）」。
   - `handleSubmit` の新規作成分岐で `currentComment` / `currentCommentModel` を `form` に追加。
3. 編集モードは**現状維持**（「AIカテゴリー分析」「AIコメント」の 2 ボタン）。

## 注意点・決めておきたいこと

- **直列実行**: ローカル Ollama は並列リクエストを結局キューに積むため、直列で実行し進行状況を明示する。
  各ステップのポーリングタイムアウトは 180 秒ずつ。
- **AI分析の再実行**: 2 回押すとカテゴリー/タグ/コメントを上書きする（現行の分類と同じ挙動）。
- **AI分析後に本文を編集した場合**: コメントは古い本文ベースのまま保存される。必要なら再度 AI分析を押す運用。
- 編集モードは現状維持（「AIカテゴリー分析」「AIコメント」の別ボタン）で確定。

## 検証

### Claude 側
- `npm run build`（tsc + vite）、lint
- Backend: `TestClient` で `ai-comment-preview` の起動/ステータス、`create_article` に `ai_comment` を渡して
  DB と `article.json` に保存されることを確認（`ai_commenter.generate` はモック）
- DB マイグレーション不要（既存カラムのみ使用）

### 要・実機テスト
- 新規投稿で「AI分析」→ カテゴリー・タグ・AIコメントのプレビューが出る → 投稿 → 記事ページに AIコメントが表示される
- ボタン表示が「カテゴリー分析中 (1/2)」→「AIコメント作成中 (2/2)」と切り替わること
- 片方だけ失敗するケースでもう片方が反映されること
- 実機 Ollama での所要時間
- 編集モードは従来どおり 2 ボタンで動くこと
