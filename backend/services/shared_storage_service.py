import asyncio
import json
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import aiofiles
from fastapi import HTTPException
from pydantic import BaseModel

MAX_FILE_SIZE = 65 * 1024  # 66,560 bytes

ALLOWED_CONTENT_TYPES = frozenset([
    "application/json",
    "text/plain",
    "text/markdown",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
])

_FILENAME_RE = re.compile(r'^[a-zA-Z0-9_\-\.]+$')

DATA_DIR = os.getenv("DATA_DIR", "./data")
SHARED_DIR = Path(DATA_DIR) / "shared"


class FileMeta(BaseModel):
    filename: str
    content_type: str
    size: int
    created_at: str
    updated_at: str


class WriterPreferenceRWLock:
    """
    Asyncio RW lock that blocks new readers when a writer is waiting or active.
    Writes are serialized; reads are concurrent when no write is pending.
    """

    def __init__(self):
        self._cond = asyncio.Condition()
        self._readers = 0
        self._writers_waiting = 0
        self._writing = False

    @asynccontextmanager
    async def read(self, timeout: float = 10.0):
        async def _acquire():
            async with self._cond:
                await self._cond.wait_for(
                    lambda: not self._writing and self._writers_waiting == 0
                )
                self._readers += 1

        await asyncio.wait_for(_acquire(), timeout=timeout)
        try:
            yield
        finally:
            async with self._cond:
                self._readers -= 1
                if self._readers == 0:
                    self._cond.notify_all()

    @asynccontextmanager
    async def write(self, timeout: float = 30.0):
        async def _acquire():
            async with self._cond:
                self._writers_waiting += 1
                try:
                    await self._cond.wait_for(
                        lambda: not self._writing and self._readers == 0
                    )
                    self._writing = True
                finally:
                    self._writers_waiting -= 1

        await asyncio.wait_for(_acquire(), timeout=timeout)
        try:
            yield
        finally:
            async with self._cond:
                self._writing = False
                self._cond.notify_all()


class FileLockRegistry:
    def __init__(self):
        self._mutex = asyncio.Lock()
        self._locks: dict[str, WriterPreferenceRWLock] = {}
        self._refcounts: dict[str, int] = {}

    @asynccontextmanager
    async def for_read(self, filename: str, timeout: float = 10.0):
        async with self._mutex:
            if filename not in self._locks:
                self._locks[filename] = WriterPreferenceRWLock()
                self._refcounts[filename] = 0
            self._refcounts[filename] += 1
            lock = self._locks[filename]
        try:
            async with lock.read(timeout=timeout):
                yield
        finally:
            async with self._mutex:
                self._refcounts[filename] -= 1
                if self._refcounts[filename] == 0:
                    self._locks.pop(filename, None)
                    self._refcounts.pop(filename, None)

    @asynccontextmanager
    async def for_write(self, filename: str, timeout: float = 30.0):
        async with self._mutex:
            if filename not in self._locks:
                self._locks[filename] = WriterPreferenceRWLock()
                self._refcounts[filename] = 0
            self._refcounts[filename] += 1
            lock = self._locks[filename]
        try:
            async with lock.write(timeout=timeout):
                yield
        finally:
            async with self._mutex:
                self._refcounts[filename] -= 1
                if self._refcounts[filename] == 0:
                    self._locks.pop(filename, None)
                    self._refcounts.pop(filename, None)


_registry = FileLockRegistry()


def validate_filename(filename: str) -> None:
    if (
        not filename
        or not _FILENAME_RE.match(filename)
        or len(filename) > 255
        or ".." in filename
        or filename.startswith(".")
    ):
        raise HTTPException(400, f"Invalid filename '{filename}'. Use only alphanumeric characters, hyphens, underscores, and dots. Max 255 chars. No leading dots or '..'.")


def validate_content_type(content_type: str) -> None:
    if content_type not in ALLOWED_CONTENT_TYPES:
        allowed = ", ".join(sorted(ALLOWED_CONTENT_TYPES))
        raise HTTPException(415, f"Unsupported Content-Type '{content_type}'. Allowed: {allowed}")


async def ensure_shared_dir() -> None:
    SHARED_DIR.mkdir(parents=True, exist_ok=True)


async def write_file(filename: str, data: bytes, content_type: str) -> FileMeta:
    path = SHARED_DIR / filename
    meta_path = SHARED_DIR / f"{filename}.meta"
    now = datetime.now(timezone.utc).isoformat()

    async with _registry.for_write(filename):
        created_at = now
        if meta_path.exists():
            try:
                existing = json.loads(meta_path.read_text())
                created_at = existing.get("created_at", now)
            except Exception:
                pass

        async with aiofiles.open(path, "wb") as f:
            await f.write(data)

        meta = {
            "content_type": content_type,
            "size": len(data),
            "created_at": created_at,
            "updated_at": now,
        }
        async with aiofiles.open(meta_path, "w") as f:
            await f.write(json.dumps(meta))

    return FileMeta(filename=filename, **meta)


async def read_file(filename: str) -> tuple[bytes, str]:
    path = SHARED_DIR / filename
    meta_path = SHARED_DIR / f"{filename}.meta"

    async with _registry.for_read(filename):
        if not path.exists():
            raise HTTPException(404, f"File '{filename}' not found.")
        async with aiofiles.open(path, "rb") as f:
            data = await f.read()
        content_type = "application/octet-stream"
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text())
                content_type = meta.get("content_type", content_type)
            except Exception:
                pass

    return data, content_type


async def delete_file(filename: str) -> None:
    path = SHARED_DIR / filename
    meta_path = SHARED_DIR / f"{filename}.meta"

    async with _registry.for_write(filename):
        if not path.exists():
            raise HTTPException(404, f"File '{filename}' not found.")
        path.unlink()
        if meta_path.exists():
            meta_path.unlink()


async def list_files() -> list[FileMeta]:
    results = []
    for meta_path in sorted(SHARED_DIR.glob("*.meta")):
        try:
            meta = json.loads(meta_path.read_text())
            filename = meta_path.stem
            results.append(FileMeta(filename=filename, **meta))
        except Exception:
            continue
    return results
