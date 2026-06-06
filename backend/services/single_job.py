"""
In-memory job tracker for single-article async AI operations.
Each job_id maps to {"status": "running"|"done"|"error", "result": ..., "error": ...}.
"""
import uuid
from typing import Any

_jobs: dict[str, dict] = {}


def create(key: str | None = None) -> str:
    job_id = key or uuid.uuid4().hex
    _jobs[job_id] = {"status": "running", "result": None, "error": None}
    return job_id


def done(job_id: str, result: Any) -> None:
    if job_id in _jobs:
        _jobs[job_id] = {"status": "done", "result": result, "error": None}


def fail(job_id: str, msg: str) -> None:
    if job_id in _jobs:
        _jobs[job_id] = {"status": "error", "result": None, "error": msg}


def get(job_id: str) -> dict:
    return _jobs.get(job_id, {"status": "not_found", "result": None, "error": None})
