"""SQLite connection + schema.

No ORM — plain sqlite3, stdlib only. Each call opens its own short-lived
connection (sqlite handles this cheaply and it sidesteps any cross-thread
sharing issues since FastAPI may run sync route handlers on a threadpool).

Caching strategy: the `files` table fingerprints each data/raw/*.json file
by (size, mtime). On import, a file whose fingerprint hasn't changed since
last time is skipped entirely (no reparse) — see parser.import_all().
"""
import sqlite3
from contextlib import contextmanager

from backend import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    mtime REAL NOT NULL,
    segment_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT
);

CREATE TABLE IF NOT EXISTS visits (
    id TEXT PRIMARY KEY,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    place_id TEXT,
    semantic_type TEXT,
    category TEXT NOT NULL,
    probability REAL
);
CREATE INDEX IF NOT EXISTS idx_visits_start ON visits(start_time);

CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    start_lat REAL NOT NULL,
    start_lng REAL NOT NULL,
    end_lat REAL NOT NULL,
    end_lng REAL NOT NULL,
    distance_meters REAL NOT NULL,
    mode_raw TEXT,
    mode TEXT NOT NULL,
    probability REAL
);
CREATE INDEX IF NOT EXISTS idx_trips_start ON trips(start_time);

CREATE TABLE IF NOT EXISTS path_segments (
    id TEXT PRIMARY KEY,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    points_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paths_start ON path_segments(start_time);

CREATE TABLE IF NOT EXISTS geocode_cache (
    key TEXT PRIMARY KEY,  -- "lat_round,lng_round"
    place_name TEXT NOT NULL,
    source TEXT NOT NULL,  -- 'offline' or 'online'
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def init_db():
    config.DATA_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        conn.commit()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(config.DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db_cursor():
    """Context manager yielding a cursor on a fresh connection, committing
    and closing on exit."""
    conn = get_conn()
    try:
        cur = conn.cursor()
        yield cur
        conn.commit()
    finally:
        conn.close()


def get_meta(key: str, default=None):
    with db_cursor() as cur:
        row = cur.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default


def set_meta(key: str, value: str):
    with db_cursor() as cur:
        cur.execute(
            "INSERT INTO meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
