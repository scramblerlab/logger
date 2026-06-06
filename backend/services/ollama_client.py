"""
Shared Ollama HTTP helpers with retry logic.
Retry on 5xx / connection errors: wait `wait` seconds, up to `max_retries` retries.
Raise immediately on 4xx or timeout.
"""
import asyncio
import logging
import os

import httpx

logger = logging.getLogger(__name__)

_BASE = lambda: os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
_MODEL = lambda: os.getenv("OLLAMA_MODEL", "gemma4:e2b-mlx")
_API_KEY = lambda: os.getenv("OLLAMA_API_KEY", "")


async def chat(
    messages: list[dict],
    *,
    options: dict | None = None,
    max_retries: int = 3,
    wait: int = 30,
) -> str:
    base = _BASE()
    model = _MODEL()
    payload: dict = {"model": model, "messages": messages, "stream": False}
    if options:
        payload["options"] = options

    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=300) as client:
                r = await client.post(f"{base}/api/chat", json=payload)
                if r.status_code >= 500:
                    raise httpx.HTTPStatusError(
                        f"Server error {r.status_code}", request=r.request, response=r
                    )
                r.raise_for_status()
                return r.json()["message"]["content"].strip()
        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
            last_exc = exc
            if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code < 500:
                raise
            if attempt < max_retries:
                logger.warning(
                    "Ollama chat error (attempt %d/%d): %s — retrying in %ds",
                    attempt + 1, max_retries + 1, exc, wait,
                )
                await asyncio.sleep(wait)

    raise last_exc  # type: ignore[misc]


async def web_search(
    query: str,
    max_results: int = 3,
    *,
    max_retries: int = 3,
    wait: int = 30,
) -> list[dict]:
    api_key = _API_KEY()
    if not api_key:
        return []

    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(
                    "https://ollama.com/api/web_search",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={"query": query, "max_results": max_results},
                )
                if r.status_code >= 500:
                    raise httpx.HTTPStatusError(
                        f"Server error {r.status_code}", request=r.request, response=r
                    )
                r.raise_for_status()
                return r.json().get("results", [])
        except (httpx.ConnectError, httpx.HTTPStatusError) as exc:
            last_exc = exc
            if isinstance(exc, httpx.HTTPStatusError):
                status = exc.response.status_code
                if status == 429 and attempt < max_retries:
                    retry_after = exc.response.headers.get("Retry-After", "")
                    delay = int(retry_after) if retry_after.isdigit() else wait * (2 ** attempt)
                    logger.warning(
                        "Web search rate limited (attempt %d/%d) — retrying in %ds",
                        attempt + 1, max_retries + 1, delay,
                    )
                    await asyncio.sleep(delay)
                    continue
                elif status < 500:
                    return []
            if attempt < max_retries:
                logger.warning(
                    "Web search error (attempt %d/%d): %s — retrying in %ds",
                    attempt + 1, max_retries + 1, exc, wait,
                )
                await asyncio.sleep(wait)
        except Exception:
            return []

    return []
