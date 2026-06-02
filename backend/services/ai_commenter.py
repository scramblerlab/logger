"""
AI comment generator.
Picks the most notable keyword from an article, runs a web search,
then generates a 200-300 character Japanese commentary via Ollama.
Returns (comment_text, model_name).
"""
import logging
import os
from services import ollama_client

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """あなたは日本語ライフスタイルブログのAIコメンターです。
記事のタイトルと本文から最も注目すべきキーワードや概念を1つ特定し、そのキーワードについてウェブ検索の結果を参考にしながら、読者向けに簡潔な補足コメントを生成してください。

必ず以下のルールを守ってください：
- 出力は日本語のみ
- 200〜300文字程度で構成する
- 最後に「リンク：URL」の形式で参考URLを1つ付ける
- URLは実際に検索結果に含まれているものだけを使う
- 事実に基づいた客観的な説明にする
- ブログの本文には触れず、キーワードの説明に集中する"""


def _format_snippets(results: list[dict]) -> str:
    lines = []
    for r in results:
        snippet = (r.get("content") or "")[:200]
        lines.append(f"- {r.get('title', '')}: {snippet} ({r.get('url', '')})")
    return "\n".join(lines)


async def generate(title: str, body: str) -> tuple[str, str]:
    search_query = f"{title} {body[:300]}"
    results = await ollama_client.web_search(search_query, max_results=3)
    snippets = _format_snippets(results) if results else "（検索結果なし）"

    user_prompt = (
        f"記事タイトル：{title}\n\n"
        f"本文（抜粋）：\n{body[:600]}\n\n"
        f"ウェブ検索結果：\n{snippets}\n\n"
        "上記の記事タイトルと本文から最も注目すべきキーワードを1つ選び、そのキーワードについて"
        "200〜300文字程度の日本語コメントを生成してください。最後に「リンク：URL」を付けてください。"
    )

    comment = await ollama_client.chat(
        [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        options={"num_ctx": 4096, "think": False},
    )

    if not comment.strip():
        raise ValueError("Ollama returned empty comment")

    model = os.getenv("OLLAMA_MODEL", "gemma4:e2b-mlx")
    return comment, model
