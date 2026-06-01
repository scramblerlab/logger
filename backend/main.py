import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from database import init_db, DATA_DIR
from routers import articles, categories, search, importer, auth
from routers import shopify_importer
from routers.auth import limiter
from services import task_manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await task_manager.cancel()


app = FastAPI(title="logger", lifespan=lifespan)
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

articles_static = os.path.join(DATA_DIR, "articles")
os.makedirs(articles_static, exist_ok=True)
app.mount("/static/articles", StaticFiles(directory=articles_static), name="static_articles")

app.include_router(auth.router)
app.include_router(articles.router)
app.include_router(categories.router)
app.include_router(search.router)
app.include_router(importer.router)
app.include_router(shopify_importer.router)


FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/favicon.svg")
    async def favicon():
        return FileResponse(FRONTEND_DIST / "favicon.svg")

    @app.get("/icons.svg")
    async def icons():
        return FileResponse(FRONTEND_DIST / "icons.svg")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    if FRONTEND_DIST.exists():
        return FileResponse(FRONTEND_DIST / "index.html")
    return {"detail": "Not Found"}
