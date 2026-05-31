"""
AI classifier using a local Ollama model.
Configure via backend/.env: OLLAMA_BASE_URL, OLLAMA_MODEL.
"""
import os
import re

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
    """Extract categories and tags from a plain-text labeled response."""
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

    # Filter categories against the known list; keep tags as-is (up to 5)
    cats = [c for c in cats if c in KNOWN_CATEGORIES]
    tags = [t for t in tags if t][:5]
    return {"categories": cats, "tags": tags}


async def classify(title: str, body_excerpt: str) -> dict:
    import httpx

    base = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    model = os.getenv("OLLAMA_MODEL", "gemma4:e2b-mlx")
    prompt = f"Title: {title}\n\nContent excerpt:\n{body_excerpt[:800]}"

    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{base}/api/chat",
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                "stream": False,
            },
        )
        r.raise_for_status()
        raw = r.json()["message"]["content"].strip()

    return _parse_response(raw)
