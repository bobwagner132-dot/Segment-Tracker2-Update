"""SQLite database access — schema, migrations, connection helpers.

All persistent state for Cycling Segment Tracker 2 lives in a single SQLite
file (`database.sqlite`) inside the configured data directory. The schema is
designed multi-user-from-day-one: every row carries a `user_id` foreign key
so the single-user mode (seeded `default_user` with id=1) can grow into a
multi-tenant deployment with zero schema changes.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DATA_DIR = Path(os.environ.get("CST_DATA_DIR", "/app/data"))
DB_PATH = DATA_DIR / "database.sqlite"
UPLOADS_DIR = DATA_DIR / "uploads"
BACKUPS_DIR = DATA_DIR / "backups"
GPX_DIR = UPLOADS_DIR / "gpx"
FIT_DIR = UPLOADS_DIR / "fit"

# Single hard-coded default user. Pass 1 ships single-user; Pass 2 turns this
# into a real account with a login screen.
DEFAULT_USER_ID = 1
DEFAULT_USER_EMAIL = "local@cyclingtracker"


def ensure_dirs() -> None:
    for d in (DATA_DIR, UPLOADS_DIR, BACKUPS_DIR, GPX_DIR, FIT_DIR):
        d.mkdir(parents=True, exist_ok=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Connections are short-lived (one per request) so a fresh sqlite3.connect
# is fine. We enable WAL once at startup; future connections inherit it.
def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, isolation_level=None, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_conn():
    conn = _connect()
    try:
        yield conn
    finally:
        conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT,
    is_admin        INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    last_login_at   TEXT,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    TEXT
);

CREATE TABLE IF NOT EXISTS segments (
    id               TEXT PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    hash             TEXT NOT NULL,
    distance_m       REAL NOT NULL DEFAULT 0,
    elevation_gain_m REAL NOT NULL DEFAULT 0,
    point_count      INTEGER NOT NULL DEFAULT 0,
    points_json      TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    UNIQUE(user_id, hash)
);
CREATE INDEX IF NOT EXISTS idx_segments_user ON segments(user_id);
CREATE INDEX IF NOT EXISTS idx_segments_name ON segments(user_id, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS rides (
    id               TEXT PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    hash             TEXT NOT NULL,
    source_type      TEXT NOT NULL,
    source_filename  TEXT,
    source_path      TEXT,
    start_time       TEXT,
    duration_s       INTEGER NOT NULL DEFAULT 0,
    distance_m       REAL NOT NULL DEFAULT 0,
    elevation_gain_m REAL NOT NULL DEFAULT 0,
    elevation_loss_m REAL NOT NULL DEFAULT 0,
    point_count      INTEGER NOT NULL DEFAULT 0,
    points_json      TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    sport            TEXT,
    sub_sport        TEXT,
    device           TEXT,
    bike_name        TEXT,
    moving_time_s    REAL,
    avg_speed_mps    REAL,
    max_speed_mps    REAL,
    avg_heart_rate   REAL,
    max_heart_rate   REAL,
    avg_cadence      REAL,
    max_cadence      REAL,
    avg_power        REAL,
    max_power        REAL,
    normalized_power REAL,
    total_calories   REAL,
    total_ascent_m   REAL,
    total_descent_m  REAL,
    avg_temperature  REAL,
    max_temperature  REAL,
    min_temperature  REAL,
    UNIQUE(user_id, hash)
);
CREATE INDEX IF NOT EXISTS idx_rides_user ON rides(user_id);
CREATE INDEX IF NOT EXISTS idx_rides_start ON rides(user_id, start_time);

CREATE TABLE IF NOT EXISTS efforts (
    id               TEXT PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ride_id          TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    segment_id       TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    datetime_utc     TEXT,
    elapsed_s        REAL NOT NULL,
    moving_time_s    REAL,
    distance_m       REAL,
    avg_power        REAL,
    max_power        REAL,
    avg_hr           REAL,
    max_hr           REAL,
    avg_cadence      REAL,
    avg_speed_mps    REAL,
    max_speed_mps    REAL,
    elevation_gain_m REAL,
    start_idx        INTEGER,
    end_idx          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_efforts_user ON efforts(user_id);
CREATE INDEX IF NOT EXISTS idx_efforts_ride ON efforts(ride_id);
CREATE INDEX IF NOT EXISTS idx_efforts_segment ON efforts(segment_id);

CREATE TABLE IF NOT EXISTS bikes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    type              TEXT,
    is_default        INTEGER NOT NULL DEFAULT 0,
    added_at          TEXT,
    starting_km       REAL DEFAULT 0,
    parts_json        TEXT,
    custom_parts_json TEXT,
    created_at        TEXT NOT NULL,
    UNIQUE(user_id, name COLLATE NOCASE)
);
CREATE INDEX IF NOT EXISTS idx_bikes_user ON bikes(user_id);

CREATE TABLE IF NOT EXISTS meta (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    value   TEXT,
    PRIMARY KEY (user_id, key)
);
"""


def init_db() -> None:
    ensure_dirs()
    with get_conn() as c:
        # WAL is essential on macOS so iCloud / Time Machine / supervisor reloads
        # never see a half-written page.
        c.execute("PRAGMA journal_mode = WAL")
        c.execute("PRAGMA synchronous = NORMAL")
        c.executescript(SCHEMA)
        # Forward-migrate older databases that pre-date the auth columns.
        existing_cols = {r["name"] for r in c.execute("PRAGMA table_info(users)").fetchall()}
        for col, ddl in (
            ("last_login_at", "ALTER TABLE users ADD COLUMN last_login_at TEXT"),
            ("failed_attempts", "ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0"),
            ("locked_until", "ALTER TABLE users ADD COLUMN locked_until TEXT"),
        ):
            if col not in existing_cols:
                c.execute(ddl)
        existing = c.execute(
            "SELECT 1 FROM users WHERE id = ?", (DEFAULT_USER_ID,)
        ).fetchone()
        if not existing:
            c.execute(
                "INSERT INTO users (id, email, password_hash, is_admin, created_at) "
                "VALUES (?, ?, NULL, 1, ?)",
                (DEFAULT_USER_ID, DEFAULT_USER_EMAIL, _now_iso()),
            )
        # One-shot orphan cleanup — drops any effort whose segment or ride
        # was deleted in a prior version that relied on FK cascade alone.
        c.execute(
            "DELETE FROM efforts WHERE segment_id NOT IN (SELECT id FROM segments) "
            "OR ride_id NOT IN (SELECT id FROM rides)"
        )
