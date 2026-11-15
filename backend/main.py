import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from database import init_db, DATA_DIR
from routers import articles, categories, search, importer, auth, ai_chat, translate, extract, shared_storage, push, static_files
from routers import shopify_importer
from routers.auth import limiter
from services import task_manager, audit
from services.shared_storage_service import ensure_shared_dir
from auth import verify_token


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await ensure_shared_dir()
    yield
    await task_manager.cancel()
    await task_manager.cancel_comment()


_enable_docs = os.getenv("ENABLE_DOCS", "").lower() in ("1", "true", "yes")
app = FastAPI(
    title="logger",
    lifespan=lifespan,
    docs_url="/docs" if _enable_docs else None,
    redoc_url="/redoc" if _enable_docs else None,
    openapi_url="/openapi.json" if _enable_docs else None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def _log_shared_origin(request, call_next):
    if request.url.path.startswith("/api/shared"):
        logging.getLogger("cors_debug").info(
            "method=%s origin=%s",
            request.method,
            request.headers.get("origin", "(none)"),
        )
    return await call_next(request)


@app.middleware("http")
async def _log_article_writes(request, call_next):
    # Debug aid for per-device posting failures (Android vs iOS): shows whether
    # the request arrived at all, its size, whether the auth cookie came along,
    # and how it ended — including exceptions that never reach a handler log.
    if request.method == "GET" or not request.url.path.startswith("/api/articles"):
        return await call_next(request)
    log = logging.getLogger("article_debug")
    started = time.monotonic()
    log.info(
        "→ %s %s len=%s ctype=%s cookie=%s ua=%s",
        request.method, request.url.path,
        request.headers.get("content-length", "?"),
        request.headers.get("content-type", "?").split(";")[0],
        "auth_token" in request.cookies,
        request.headers.get("user-agent", "?")[:160],
    )
    try:
        response = await call_next(request)
    except Exception:
        log.exception("✗ %s %s crashed after %.2fs", request.method, request.url.path, time.monotonic() - started)
        raise
    log.info("← %s %s status=%d %.2fs", request.method, request.url.path, response.status_code, time.monotonic() - started)
    return response


@app.middleware("http")
async def _audit_log(request, call_next):
    # Record who did what for state-changing API calls (analytics / audit trail).
    response = await call_next(request)
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path.startswith("/api/"):
        actor = None
        token = request.cookies.get("auth_token") or request.cookies.get("__Host-auth_token")
        if token:
            try:
                actor = verify_token(token)
            except Exception:
                actor = None
        try:
            audit.record(
                actor=actor,
                ip=request.client.host if request.client else None,
                method=request.method,
                path=request.url.path,
                status=response.status_code,
            )
        except Exception:
            logging.getLogger("audit").warning("audit record failed", exc_info=True)
    return response

app.include_router(auth.router)
app.include_router(articles.router)
app.include_router(categories.router)
app.include_router(search.router)
app.include_router(importer.router)
app.include_router(shopify_importer.router)
app.include_router(ai_chat.router)
app.include_router(translate.router)
app.include_router(extract.router)
app.include_router(shared_storage.router)
app.include_router(push.router)
app.include_router(static_files.router)


FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/favicon.svg")
    async def favicon():
        return FileResponse(FRONTEND_DIST / "favicon.svg")

    @app.get("/icons.svg")
    async def icons():
        return FileResponse(FRONTEND_DIST / "icons.svg")

    @app.get("/manifest.json")
    async def manifest():
        return FileResponse(FRONTEND_DIST / "manifest.json", media_type="application/manifest+json")

    @app.get("/sw.js")
    async def service_worker():
        return FileResponse(FRONTEND_DIST / "sw.js", media_type="application/javascript",
                            headers={"Service-Worker-Allowed": "/"})

    @app.get("/icon-192.png")
    async def icon_192():
        return FileResponse(FRONTEND_DIST / "icon-192.png", media_type="image/png")

    @app.get("/icon-512.png")
    async def icon_512():
        return FileResponse(FRONTEND_DIST / "icon-512.png", media_type="image/png")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    if FRONTEND_DIST.exists():
        # index.html points at hashed bundles, so it must be revalidated every
        # load — otherwise a cached copy (notably in installed PWAs) keeps
        # running the previous build after a deploy.
        return FileResponse(FRONTEND_DIST / "index.html", headers={"Cache-Control": "no-cache"})
    return {"detail": "Not Found"}
