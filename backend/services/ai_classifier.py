"""
AI classifier using a local Ollama model.
Configure via backend/.env: OLLAMA_BASE_URL, OLLAMA_MODEL.
"""
import json
import os

KNOWN_CATEGORIES = [
    "bike", "onsen", "sentou", "container", "cooking",
    "lens", "sauna", "auto", "diy", "beer",
]

_CATS_LIST = "\n".join(f"- {c}" for c in KNOWN_CATEGORIES)

SYSTEM_PROMPT = f"""You are a classifier for a Japanese lifestyle blog.

You MUST choose categories ONLY from this exact list (use the slugs as-is):
{_CATS_LIST}

You MUST respond with ONLY a JSON object — no markdown, no explanation, nothing else.
Pick 1-3 categories that best match. Add exactly 3-5 lowercase tag keywords.

Required format (example):
{{"categories":["bike"],"tags":["yamaha","sr400","custom"]}}"""


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

    # Extract the first {...} block in case the model adds surrounding text
    import re
    m = re.search(r'\{.*\}', raw, re.DOTALL)
    if not m:
        return {"categories": [], "tags": []}
    try:
        result = json.loads(m.group())
    except json.JSONDecodeError:
        return {"categories": [], "tags": []}

    cats_raw = result.get("categories", [])
    if isinstance(cats_raw, str):
        cats_raw = [cats_raw]
    cats = [c for c in cats_raw if c in KNOWN_CATEGORIES]

    tags_raw = result.get("tags", [])
    if isinstance(tags_raw, str):
        tags_raw = [tags_raw]
    tags = [str(t).lower().strip() for t in tags_raw if t][:5]

    return {"categories": cats, "tags": tags}
