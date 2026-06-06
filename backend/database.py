import os
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase

DATA_DIR = os.getenv("DATA_DIR", "./data")
DB_PATH = os.path.join(DATA_DIR, "blog.db")

engine = create_async_engine(f"sqlite+aiosqlite:///{DB_PATH}", echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session


CATEGORIES_SEED = [
    {"slug": "bike",      "name_en": "Bike",      "name_ja": "バイク",   "color": "#E84040"},
    {"slug": "onsen",     "name_en": "Onsen",     "name_ja": "温泉",     "color": "#4A90D9"},
    {"slug": "sentou",    "name_en": "Sento",     "name_ja": "銭湯",     "color": "#7B68EE"},
    {"slug": "container", "name_en": "Container", "name_ja": "コンテナ", "color": "#F5A623"},
    {"slug": "cooking",   "name_en": "Cooking",   "name_ja": "料理",     "color": "#7ED321"},
    {"slug": "lens",      "name_en": "Lens",      "name_ja": "レンズ",   "color": "#9B59B6"},
    {"slug": "sauna",     "name_en": "Sauna",     "name_ja": "サウナ",   "color": "#FF6B35"},
    {"slug": "auto",      "name_en": "Auto",      "name_ja": "4輪",      "color": "#2ECC71"},
    {"slug": "diy",       "name_en": "DIY",       "name_ja": "DIY",      "color": "#95A5A6"},
    {"slug": "beer",      "name_en": "Beer",      "name_ja": "ビール",   "color": "#F39C12"},
]


async def init_db():
    import os as _os
    _os.makedirs(DATA_DIR, exist_ok=True)
    _os.makedirs(os.path.join(DATA_DIR, "articles"), exist_ok=True)

    from models import Base as _Base, Category, Tag
    from sqlalchemy import text

    async with engine.begin() as conn:
        await conn.run_sync(_Base.metadata.create_all)

        # Migrate FTS5 to Janome/fugashi-tokenized standalone table (runs once via user_version)
        # user_version 0 = old unicode61 content table; 1 = fugashi tokenized standalone table
        version = (await conn.execute(text("PRAGMA user_version"))).scalar()
        if version < 1:
            await conn.execute(text("DROP TABLE IF EXISTS articles_fts"))
            await conn.execute(text("CREATE VIRTUAL TABLE articles_fts USING fts5(title, body)"))
            for trig in ("articles_ai", "articles_ad", "articles_au"):
                await conn.execute(text(f"DROP TRIGGER IF EXISTS {trig}"))
            from services.tokenizer import tokenize_ja
            rows = (await conn.execute(text("SELECT rowid, title, body FROM articles"))).fetchall()
            for row in rows:
                await conn.execute(
                    text("INSERT INTO articles_fts(rowid, title, body) VALUES (:rowid, :title, :body)"),
                    {"rowid": row[0], "title": tokenize_ja(row[1] or ""), "body": tokenize_ja(row[2] or "")},
                )
            await conn.execute(text("PRAGMA user_version = 1"))

        if version < 2:
            await conn.execute(text("ALTER TABLE articles ADD COLUMN ai_comment TEXT"))
            await conn.execute(text("ALTER TABLE articles ADD COLUMN ai_comment_model TEXT"))
            await conn.execute(text("PRAGMA user_version = 2"))

        if version < 3:
            # Fix broken triggers: old triggers matched FTS by content, but FTS stores
            # tokenized text so the content-match delete always fails with SQL logic error.
            # New triggers: use rowid-only delete, and articles_au only fires on title/body.
            for trig in ("articles_ai", "articles_au", "articles_ad"):
                await conn.execute(text(f"DROP TRIGGER IF EXISTS {trig}"))
            await conn.execute(text("""
                CREATE TRIGGER articles_ai AFTER INSERT ON articles BEGIN
                    INSERT INTO articles_fts(rowid, title, body)
                    VALUES (new.rowid, new.title, new.body);
                END
            """))
            await conn.execute(text("""
                CREATE TRIGGER articles_au AFTER UPDATE OF title, body ON articles BEGIN
                    INSERT INTO articles_fts(articles_fts, rowid) VALUES ('delete', old.rowid);
                    INSERT INTO articles_fts(rowid, title, body)
                    VALUES (new.rowid, new.title, new.body);
                END
            """))
            await conn.execute(text("""
                CREATE TRIGGER articles_ad AFTER DELETE ON articles BEGIN
                    INSERT INTO articles_fts(articles_fts, rowid) VALUES ('delete', old.rowid);
                END
            """))
            await conn.execute(text("PRAGMA user_version = 3"))

        if version < 4:
            # Root-cause fix: FTS5 ignores INSERT OR REPLACE (treats it as plain INSERT),
            # so both articles_ai trigger and _fts_upsert were each inserting a separate FTS row
            # for the same rowid → duplicates → 'delete' command fails with SQL logic error.
            # Fix: drop all triggers, rebuild FTS clean, recreate only articles_ad using plain DELETE.
            for trig in ("articles_ai", "articles_au", "articles_ad"):
                await conn.execute(text(f"DROP TRIGGER IF EXISTS {trig}"))
            await conn.execute(text("DROP TABLE IF EXISTS articles_fts"))
            await conn.execute(text("CREATE VIRTUAL TABLE articles_fts USING fts5(title, body)"))
            from services.tokenizer import tokenize_ja as _tok
            rows = (await conn.execute(text("SELECT rowid, title, body FROM articles"))).fetchall()
            for row in rows:
                await conn.execute(
                    text("INSERT INTO articles_fts(rowid, title, body) VALUES (:rowid, :title, :body)"),
                    {"rowid": row[0], "title": _tok(row[1] or ""), "body": _tok(row[2] or "")},
                )
            await conn.execute(text("""
                CREATE TRIGGER articles_ad AFTER DELETE ON articles BEGIN
                    DELETE FROM articles_fts WHERE rowid = old.rowid;
                END
            """))
            await conn.execute(text("PRAGMA user_version = 4"))

    # Seed categories
    async with SessionLocal() as session:
        from sqlalchemy import select
        for cat in CATEGORIES_SEED:
            result = await session.execute(
                select(Category).where(Category.slug == cat["slug"])
            )
            if not result.scalar_one_or_none():
                session.add(Category(**cat))
        await session.commit()
