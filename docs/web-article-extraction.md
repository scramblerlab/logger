# Web記事抽出機能

任意のURLから記事タイトル・本文・画像を抽出し、記事編集画面をプリフィルする機能の実装ノート。

---

## 概要

ログイン済みエディターがヘッダーの「Web記事抽出」ボタンからURLを入力すると、バックエンドがHTMLをスクレイピングしてMarkdownに変換し、フロントエンドの記事投稿フォームを自動入力する。翻訳・インポートと同様に、DBへの保存はユーザーが投稿ボタンを押したときのみ行われる。

```
[Web記事抽出ボタン]
      ↓
ExtractDialog (URL入力)
      ↓
POST /api/extract/url
      ↓
web_extractor.extract_article(url)
  ├─ HTML取得 (httpx)
  ├─ タイトル / 公開日 / og:image 抽出 (BeautifulSoup)
  ├─ ノイズ除去 → コンテンツ要素選択
  ├─ 遅延ロード画像解決 (data-src → src)
  └─ 画像ダウンロード → staging_{uuid}/ ディレクトリ
      ↓
レスポンス: {title, body, hero_url, additional_urls, published_at, source_url}
      ↓
navigate('/write', { state: { extraction: data } })
      ↓
WritePage が初期化時に extraction state を検出
  ├─ title / body / source_url をステートにセット
  └─ 画像URLをfetch → File オブジェクト → heroFile / additionalFiles にセット
      ↓
ユーザーが編集 → 通常の記事作成フロー (FormData)
```

---

## 実装の工夫

### 1. 遅延ロード画像の解決

現代的なサイトの多くは画像を遅延ロード（lazy-load）する。HTMLソースでは `src="#"` となっており、実URLは `data-src` などの属性に格納されている。

```html
<!-- 遅延ロードの典型例 (dancyu.jp) -->
<img src="#" data-src="/images/10424b.jpg" class="is-lazyload" alt="パクチーを刻む">
```

この状態で html2text に渡すと `![パクチーを刻む](#)` という壊れたMarkdownが生成される。

**解決策:** `_real_src()` 関数で `data-src` → `data-lazy-src` → `data-original` → `src` の順に実URLを探索し、変換前に `img[src]` を実URLで上書きする。

```python
def _real_src(img: Tag) -> Optional[str]:
    for attr in ("data-src", "data-lazy-src", "data-original", "data-lazy"):
        val = img.get(attr, "")
        if val and val not in ("#", ""):
            return str(val)
    src = img.get("src", "")
    if src and src not in ("#", ""):
        return src
    return None
```

### 2. コンテンツ要素の選択

記事本文を正確に抽出するには、ナビゲーション・フッター・関連記事などのノイズを除いた上で、最も記事らしいコンテナを選ぶ必要がある。

**問題:** ナビゲーション除去をコンテンツ要素の「内側」で行うと、記事画像が含まれる親コンテナが先に選ばれてしまい、ノイズ除去で記事画像まで消える。

**解決策:** ノイズ除去をソープ全体に先にかける（グローバル適用）。

```python
# 1. ノイズをドキュメント全体から除去
_strip_global_noise(soup)   # <nav>, <header>, <footer>, <aside> + ノイズクラス要素を削除

# 2. ノイズ除去後のソープからコンテンツ要素を選択
content_el = _find_content_element(soup)
```

**コンテンツ要素の選択ロジック（優先順）:**

| 優先度 | 戦略 | 対象サイト例 |
|--------|------|------------|
| 1 | CMS固有セレクター (`.entry-content`, `.post-content` 等) | WordPress |
| 2 | `<article>` 要素 (nav/aside の外側のもの) | 汎用HTML5 |
| 3 | `<main>` 要素 | 汎用HTML5 |
| 4 | スコアリング (画像数 × 60 + テキスト長、深さをタイブレーカー) | dancyu.jp 等 |

スコアリングでは `(imgs, depth)` のタプルで比較し、同じ画像数なら深い（より具体的な）要素を優先する。

### 3. 画像URLの本文中書き換え

本文 HTML を Markdown に変換する前に、画像URLをすべてローカルのステージングパスに書き換える。

- 対象: ヒーロー画像 + 本文中の追加画像（最大20枚）
- `additional_urls` として返却するのは上位9枚のみ（WritePage の追加画像欄への反映）
- 本文中の全URLを書き換えることで、Markdown レンダリング時に外部URLが残らない

### 4. Staging ディレクトリ

画像は `static/articles/staging_{uuid8}/` に一時保存され、FastAPI の `StaticFiles` マウントで同一オリジンから配信される。

フロントエンドは返却された画像URLを `fetch()` してBlobを取得し、`File` オブジェクトに変換して WritePage の `heroFile` / `additionalFiles` ステートにセットする。

```typescript
fetch(extraction.hero_url)
  .then(r => r.blob())
  .then(blob => {
    setHeroFile(new File([blob], 'hero.jpg', { type: 'image/jpeg' }));
    setHeroPreview(URL.createObjectURL(blob));
  });
```

この方式により、記事作成フロー（FormData でのファイルアップロード）を一切変更せずに抽出画像を利用できる。

Stagingディレクトリは記事作成後も残る（孤立ファイル）。定期クリーンアップは未実装。

---

## 遭遇した問題と解決

| 問題 | 原因 | 解決 |
|------|------|------|
| 本文に `![alt](#)` が大量出力される | `src="#"` の遅延ロード画像をそのまま html2text に渡していた | `_real_src()` で `data-src` を優先解決し、変換前に `img[src]` を上書き |
| 追加画像が0件 | ノイズ除去をコンテンツ要素内部で実行し、記事画像が入ったコンテナごと削除していた | ノイズ除去をソープ全体に先に適用し、その後コンテンツ要素を選択する順序に変更 |
| 本文中に外部URLが残る | `extra_img_urls[:9]` の上限で切れた画像がURLrewriteに含まれなかった | ダウンロードは最大20枚まで行いすべてURLrewriteマップに登録し、`additional_urls` の返却のみ9件に絞る |
| 最外殻の `div.wrapper` が選ばれる | スコアリングの絶対値が大きいほど勝つため、外側の大きなコンテナが常に勝つ | ノイズをグローバルに除去した後に選択 + 深さをタイブレーカーにして内側要素を優先 |

---

## 拡張設計

現在の `BaseExtractor`（`web_extractor.py` の汎用ロジック）は多くのサイトで動作するが、サイト固有の最適化が必要な場合はメソッドオーバーライドで対応できる設計を推奨する。

### 推奨: Strategy パターン + ドメインレジストリ

```python
# backend/services/extractors/base.py
class BaseExtractor:
    def get_title(self, soup: BeautifulSoup) -> str: ...
    def get_content(self, soup: BeautifulSoup) -> Tag: ...
    def get_published_at(self, soup: BeautifulSoup) -> Optional[str]: ...
    def get_og_image(self, soup: BeautifulSoup, base: str) -> Optional[str]: ...

# backend/services/extractors/cookpad.py
class CookpadExtractor(BaseExtractor):
    def get_content(self, soup):
        return soup.select_one(".recipe-instruction-item") or super().get_content(soup)

# backend/services/web_extractor.py
REGISTRY: dict[str, BaseExtractor] = {
    "cookpad.com": CookpadExtractor(),
}

async def extract_article(url: str) -> dict:
    domain = urlparse(url).netloc.removeprefix("www.")
    extractor = REGISTRY.get(domain, BaseExtractor())
    ...
```

各サイトはオーバーライドしたいメソッドだけ実装すればよい。汎用ロジックで動くサイトはレジストリへの登録不要。将来的に Playwright によるJS実行や REST API 直接呼び出しも同じインターフェースで組み込める。

---

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `backend/services/web_extractor.py` | スクレイピング・画像ダウンロード・Markdown変換 |
| `backend/routers/extract.py` | `POST /api/extract/url` エンドポイント |
| `frontend/src/components/ExtractDialog.tsx` | URL入力ダイアログ |
| `frontend/src/pages/WritePage.tsx` | extraction state の初期化処理 |
| `backend/services/storage.py` | `download_and_save()` — 画像ダウンロード共通処理 |

---

## 既知の制限

| 制限 | 備考 |
|------|------|
| JS レンダリングコンテンツ | `httpx` は静的HTMLのみ取得。Reactなど完全にJS描画されるページは本文が空になる可能性がある |
| ペイウォール / ログイン必須ページ | 認証が必要なページは取得不可 |
| Staging ファイルの蓄積 | 記事未投稿のまま閉じると `staging_xxx/` ディレクトリが残る。定期クリーンアップ未実装 |
| タイトルのサイト名サフィックス | `og:title` に「| サイト名」が含まれるケースあり（現状そのまま表示） |
