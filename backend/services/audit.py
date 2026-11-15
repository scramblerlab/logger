"""Append-only local audit log of state-changing API actions, for analytics.

One JSON object per line under DATA_DIR/logs/audit.log, size-rotated. Each line
records who (editor email, or "anon"), from where (client IP — the real visitor
IP when the app runs behind the tunnel with --proxy-headers), did what
(method + path), and the resulting status. Read requests are intentionally
excluded to keep the log signal-rich.
"""
import json
import logging
import os
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler

from database import DATA_DIR

_LOG_DIR = os.path.join(DATA_DIR, "logs")

_logger = logging.getLogger("audit")
_logger.setLevel(logging.INFO)
_logger.propagate = False  # keep audit lines out of the console/root logger

_configured = False


def _ensure_configured() -> None:
    global _configured
    if _configured:
        return
    os.makedirs(_LOG_DIR, exist_ok=True)
    handler = RotatingFileHandler(
        os.path.join(_LOG_DIR, "audit.log"),
        maxBytes=5_000_000, backupCount=5, encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(message)s"))  # message is already JSON
    _logger.addHandler(handler)
    _configured = True


def record(*, actor, ip, method, path, status, target=None) -> None:
    _ensure_configured()
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "actor": actor or "anon",
        "ip": ip,
        "method": method,
        "path": path,
        "status": status,
    }
    if target:
        entry["target"] = target
    _logger.info(json.dumps(entry, ensure_ascii=False))
