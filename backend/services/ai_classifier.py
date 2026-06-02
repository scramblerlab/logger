"""
AI classifier using a local Ollama model.
Configure via backend/.env: OLLAMA_BASE_URL, OLLAMA_MODEL.
"""
import re
from services import ollama_client

KNOWN_CATEGORIES = [
    "bike", "onsen", "sentou", "container", "cooking",
    "lens", "sauna", "auto", "diy", "beer",
]

_CATS_LIST = ", ".join(KNOWN_CATEGORIES)

SYSTEM_PROMPT = f"""You are a classifier for a Japanese lifestyle blog.

Choose 1-3 categories that best match the article from this list ONLY:
{_CATS_LIST}

Also choose 3-5 lowercase tag keywords that describe the specific content.

Reply in plain text using exactly this format (nothing else before or after):
CATEGORIES: <comma-separated slugs from the list above>
TAGS: <comma-separated lowercase keywords>

Example:
CATEGORIES: bike, diy
TAGS: yamaha, sr400, custom, frame, welding"""


def _parse_response(text: str) -> dict:
    cats: list[str] = []
    tags: list[str] = []

    for line in text.splitlines():
        line = line.strip()
        low = line.lower()

        if low.startswith("categories:"):
            raw = line[len("categories:"):].strip()
            cats = [c.strip().lower() for c in re.split(r"[,\s]+", raw) if c.strip()]
        elif low.startswith("tags:"):
            raw = line[len("tags:"):].strip()
            tags = [t.strip().lower() for t in re.split(r"[,\s]+", raw) if t.strip()]

    cats = [c for c in cats if c in KNOWN_CATEGORIES]
    tags = [t for t in tags if t][:5]
    return {"categories": cats, "tags": tags}


async def classify(title: str, body_excerpt: str) -> dict:
    prompt = f"Title: {title}\n\nContent excerpt:\n{body_excerpt[:800]}"
    raw = await ollama_client.chat([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ])
    return _parse_response(raw)
