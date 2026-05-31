import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiofiles
from PIL import Image

DATA_DIR = os.getenv("DATA_DIR", "./data")
ARTICLES_DIR = os.path.join(DATA_DIR, "articles")
MAX_IMAGE_DIMENSION = 2048
JPEG_QUALITY = 85


def _article_dir(slug: str) -> Path:
    return Path(ARTICLES_DIR) / slug


def article_image_url(slug: str, filename: str) -> str:
    return f"/static/articles/{slug}/{filename}"


async def save_upload(slug: str, data: bytes, filename: str, is_hero: bool = False) -> str:
    art_dir = _article_dir(slug)
    if is_hero:
        dest = art_dir / "hero.jpg"
        rel = "hero.jpg"
    else:
        images_dir = art_dir / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        name = f"{uuid.uuid4().hex[:8]}_{filename}"
        dest = images_dir / name
        rel = f"images/{name}"

    art_dir.mkdir(parents=True, exist_ok=True)
    _write_and_optimize(data, dest)
    return rel


def _write_and_optimize(data: bytes, dest: Path):
    import io
    img = Image.open(io.BytesIO(data))
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    elif img.mode == "RGBA":
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[3])
        img = bg

    w, h = img.size
    if w > MAX_IMAGE_DIMENSION or h > MAX_IMAGE_DIMENSION:
        img.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.LANCZOS)

    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(str(dest), "JPEG", quality=JPEG_QUALITY, optimize=True)


async def download_and_save(slug: str, url: str, filename: str, is_hero: bool = False) -> Optional[str]:
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
            return await save_upload(slug, r.content, filename, is_hero=is_hero)
    except Exception:
        return None


def write_article_json(slug: str, data: dict):
    art_dir = _article_dir(slug)
    art_dir.mkdir(parents=True, exist_ok=True)
    path = art_dir / "article.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_article_json(slug: str) -> Optional[dict]:
    path = _article_dir(slug) / "article.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def copy_image_as_hero(slug: str, rel_path: str) -> str | None:
    """Copy an existing article image to hero.jpg (re-optimized)."""
    src = _article_dir(slug) / rel_path
    if not src.exists():
        return None
    data = src.read_bytes()
    dest = _article_dir(slug) / "hero.jpg"
    try:
        _write_and_optimize(data, dest)
        return "hero.jpg"
    except Exception:
        return None


def delete_article_files(slug: str):
    import shutil
    art_dir = _article_dir(slug)
    if art_dir.exists():
        shutil.rmtree(art_dir)
