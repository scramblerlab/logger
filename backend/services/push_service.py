"""
Web Push notification sender using VAPID.
Reads private key from VAPID_PRIVATE_KEY_PATH (default ./vapid_private.pem).

Key generation (run once in backend/):
    pip install pywebpush
    python3 -c "
from py_vapid import Vapid
v = Vapid()
v.generate_keys()
v.save_key('vapid_private.pem')
print('VAPID public key (use in frontend):')
print(v.application_server_key.decode())
"
"""
import json
import logging
import os

logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY_PATH = os.getenv("VAPID_PRIVATE_KEY_PATH", "./vapid_private.pem")
VAPID_CLAIMS_EMAIL = os.getenv("VAPID_CLAIMS_EMAIL", "admin@example.com")


def get_vapid_public_key() -> str | None:
    """Return base64url-encoded VAPID public key for the browser applicationServerKey."""
    if not os.path.exists(VAPID_PRIVATE_KEY_PATH):
        return None
    try:
        import base64
        from py_vapid import Vapid
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        v = Vapid.from_file(VAPID_PRIVATE_KEY_PATH)
        pub_bytes = v.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        return base64.urlsafe_b64encode(pub_bytes).decode().rstrip("=")
    except Exception as e:
        logger.error("Failed to read VAPID public key: %s", e)
        return None


def send_web_push(subscription: dict, title: str, body: str, url: str = "/") -> bool:
    """
    Send a single Web Push notification.
    subscription: {"endpoint": str, "p256dh": str, "auth": str}
    Returns True on success, raises ValueError on 404/410 (stale subscription).
    """
    if not os.path.exists(VAPID_PRIVATE_KEY_PATH):
        logger.warning("VAPID key not found at %s — push skipped", VAPID_PRIVATE_KEY_PATH)
        return False
    try:
        from pywebpush import webpush, WebPushException

        subscription_info = {
            "endpoint": subscription["endpoint"],
            "keys": {
                "p256dh": subscription["p256dh"],
                "auth": subscription["auth"],
            },
        }
        webpush(
            subscription_info=subscription_info,
            data=json.dumps({"title": title, "body": body, "url": url}),
            vapid_private_key=VAPID_PRIVATE_KEY_PATH,
            vapid_claims={"sub": f"mailto:{VAPID_CLAIMS_EMAIL}"},
        )
        return True
    except Exception as e:
        err_str = str(e)
        if "404" in err_str or "410" in err_str:
            raise ValueError("stale") from e
        logger.error("Web push failed: %s", e)
        return False


async def broadcast_push(db_factory, title: str, body: str, url: str = "/") -> None:
    """Send push to all stored subscriptions, removing stale ones."""
    from models import WebPushSubscription
    from sqlalchemy import select, delete

    stale_ids = []
    async with db_factory() as db:
        rows = (await db.execute(select(WebPushSubscription))).scalars().all()

    for sub in rows:
        try:
            send_web_push(
                {"endpoint": sub.endpoint, "p256dh": sub.p256dh, "auth": sub.auth},
                title=title,
                body=body,
                url=url,
            )
        except ValueError:
            stale_ids.append(sub.id)
        except Exception as e:
            logger.error("Push to %s failed: %s", sub.endpoint[:40], e)

    if stale_ids:
        async with db_factory() as db:
            await db.execute(
                delete(WebPushSubscription).where(WebPushSubscription.id.in_(stale_ids))
            )
            await db.commit()
