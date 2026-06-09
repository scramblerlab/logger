import re
import logging
from services import ollama_client

logger = logging.getLogger(__name__)


def _strip_thinking(text: str) -> str:
    """Remove <think>…</think> blocks emitted by reasoning models (e.g. Qwen3)."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def _extract_tag(text: str, tag: str, fallback: str) -> str:
    clean = _strip_thinking(text)
    matches = re.findall(rf"<{tag}>(.*?)</{tag}>", clean, re.DOTALL)
    if not matches:
        return fallback
    return " ".join(m.strip() for m in matches)


async def translate_article(
    title: str,
    body: str,
    ai_comment: str | None,
    target_language: str,
) -> dict:
    comment_block = f"\n<comment>{ai_comment}</comment>" if ai_comment else ""
    prompt = (
        f"Translate the following Japanese content to {target_language}.\n"
        "Return ONLY the translated content using the same XML tags. No other text or explanation.\n\n"
        f"<title>{title}</title>\n"
        f"<body>{body}</body>"
        f"{comment_block}"
    )
    try:
        response = await ollama_client.chat(
            [{"role": "user", "content": prompt}],
            options={"num_ctx": 8192},
            think=False,
        )
        translated_title = _extract_tag(response, "title", title)
        translated_body = _extract_tag(response, "body", body)
        translated_comment: str | None = None
        if ai_comment:
            translated_comment = _extract_tag(response, "comment", ai_comment)
        return {
            "title": translated_title,
            "body": translated_body,
            "ai_comment": translated_comment,
        }
    except Exception as exc:
        logger.error("translate_article failed: %s", exc)
        return {"title": title, "body": body, "ai_comment": ai_comment}


async def translate_titles(titles: list[str], target_language: str) -> list[str]:
    if not titles:
        return []
    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(titles))
    prompt = (
        f"Translate these Japanese article titles to {target_language}.\n"
        "Return ONLY the translated titles, numbered in the same format (1. 2. 3. ...). No other text.\n\n"
        f"{numbered}"
    )
    try:
        response = await ollama_client.chat(
            [{"role": "user", "content": prompt}],
            options={"num_ctx": 4096},
            think=False,
        )
        result: list[str] = []
        for i, original in enumerate(titles):
            pattern = rf"^{i + 1}\.\s+(.+)"
            match = re.search(pattern, response, re.MULTILINE)
            result.append(match.group(1).strip() if match else original)
        return result
    except Exception as exc:
        logger.error("translate_titles failed: %s", exc)
        return titles
