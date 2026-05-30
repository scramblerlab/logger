import json
import os
from typing import Optional

import anthropic

KNOWN_CATEGORIES = [
    "bike", "onsen", "sentou", "container", "cooking",
    "lens", "sauna", "auto", "diy", "beer",
]

_client: Optional[anthropic.AsyncAnthropic] = None


def get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    return _client


SYSTEM_PROMPT = f"""You are a blog post classifier for a Japanese lifestyle blog.

Predefined categories (choose 1-3 that best fit):
{", ".join(KNOWN_CATEGORIES)}

Category meanings:
- bike: motorcycles, riding, moto touring
- onsen: hot springs, ryokan, onsen towns
- sentou: public baths (銭湯), neighborhood bathhouses
- container: container houses, tiny homes, DIY shelter builds
- cooking: food, recipes, cooking, restaurants
- lens: photography, cameras, lenses, photo trips
- sauna: sauna culture, sauna facilities
- auto: cars, driving, 4-wheel vehicles
- diy: DIY projects, crafts, workshop builds (non-container)
- beer: beer, craft beer, bars, drinking

Return ONLY valid JSON with no extra text:
{{"categories": ["slug1"], "tags": ["tag1", "tag2", "tag3"]}}

Tags should be 3-8 specific keywords relevant to the article (Japanese or English, lowercase).
"""


async def classify(title: str, body_excerpt: str) -> dict:
    client = get_client()
    prompt = f"Title: {title}\n\nContent excerpt:\n{body_excerpt[:800]}"

    try:
        message = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=256,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        result = json.loads(raw)
        cats = [c for c in result.get("categories", []) if c in KNOWN_CATEGORIES]
        tags = [str(t).lower().strip() for t in result.get("tags", []) if t][:10]
        return {"categories": cats, "tags": tags}
    except Exception:
        return {"categories": [], "tags": []}
