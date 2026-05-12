"""Scheduled backups.

A single background scheduler runs alongside the FastAPI app and triggers
`run_scheduled_backup(...)` at the configured interval. Configuration lives
in the `meta` table so the user can change it from the Admin UI without
restarting the server.

Meta keys (all stored against the default user id):
    backup_interval_hours    : int  (0 disables; default 24)
    backup_include_uploads   : "1" / "0" (default "1")
    backup_retention_count   : int  (default 14 — keep the N newest backups)
    backup_target_dir        : optional absolute path (default = BACKUPS_DIR)
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from .db import (
    BACKUPS_DIR, DATA_DIR, DB_PATH, DEFAULT_USER_ID,
    FIT_DIR, GPX_DIR, get_conn,
)

_scheduler: Optional[BackgroundScheduler] = None
_JOB_ID = "cst-auto-backup"


DEFAULTS = {
    "backup_interval_hours": "24",
    "backup_include_uploads": "1",
    "backup_retention_count": "14",
    "backup_target_dir": "",
}


def get_settings(uid: int = DEFAULT_USER_ID) -> dict:
    with get_conn() as c:
        rows = c.execute(
            "SELECT key, value FROM meta WHERE user_id = ? AND key LIKE 'backup_%'",
            (uid,),
        ).fetchall()
    found = {r["key"]: r["value"] for r in rows}
    merged = {**DEFAULTS, **found}
    return {
        "interval_hours": _safe_int(merged["backup_interval_hours"], 24),
        "include_uploads": merged["backup_include_uploads"] != "0",
        "retention_count": max(1, _safe_int(merged["backup_retention_count"], 14)),
        "target_dir": merged["backup_target_dir"] or str(BACKUPS_DIR),
    }


def save_settings(patch: dict, uid: int = DEFAULT_USER_ID) -> dict:
    mapping = {
        "interval_hours": "backup_interval_hours",
        "include_uploads": "backup_include_uploads",
        "retention_count": "backup_retention_count",
        "target_dir": "backup_target_dir",
    }
    with get_conn() as c:
        for k, db_key in mapping.items():
            if k not in patch:
                continue
            v = patch[k]
            if k == "include_uploads":
                v = "1" if v else "0"
            elif k in ("interval_hours", "retention_count"):
                v = str(int(v))
            else:
                v = str(v or "")
            c.execute(
                "INSERT INTO meta (user_id, key, value) VALUES (?, ?, ?) "
                "ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value",
                (uid, db_key, v),
            )
    reschedule()
    return get_settings(uid)


def _safe_int(v, default: int) -> int:
    try:
        return int(v)
    except Exception:
        return default


# ---------- Backup execution ----------
def run_backup(include_uploads: Optional[bool] = None, target_dir: Optional[str] = None,
               retention_count: Optional[int] = None) -> dict:
    """Generate a backup ZIP synchronously and trim older ones beyond retention."""
    settings = get_settings()
    if include_uploads is None:
        include_uploads = settings["include_uploads"]
    target = Path(target_dir or settings["target_dir"])
    target.mkdir(parents=True, exist_ok=True)
    keep = retention_count if retention_count is not None else settings["retention_count"]

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out_path = target / f"cst-backup-{stamp}.zip"

    # Use SQLite's online backup API for a crash-safe DB snapshot.
    tmp_db = target / f".sqlite-tmp-{stamp}.sqlite"
    src = sqlite3.connect(DB_PATH)
    dst = sqlite3.connect(tmp_db)
    try:
        with dst:
            src.backup(dst)
    finally:
        src.close()
        dst.close()

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(tmp_db, arcname="database.sqlite")
        if include_uploads:
            for folder in (GPX_DIR, FIT_DIR):
                if not folder.exists():
                    continue
                for f in folder.iterdir():
                    if f.is_file():
                        z.write(f, arcname=f"uploads/{folder.name}/{f.name}")
        z.writestr("manifest.json", json.dumps({
            "created_at": datetime.now(timezone.utc).isoformat(),
            "include_uploads": bool(include_uploads),
            "schema_version": 2,
        }))
    tmp_db.unlink(missing_ok=True)

    # Trim retention — keep the N newest cst-backup-*.zip files in `target`.
    backups = sorted(
        [p for p in target.glob("cst-backup-*.zip") if p.is_file()],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    removed = []
    for old in backups[keep:]:
        try:
            old.unlink()
            removed.append(old.name)
        except Exception:
            pass

    return {
        "path": str(out_path),
        "name": out_path.name,
        "bytes": out_path.stat().st_size,
        "removed": removed,
    }


def restore_zip(zip_path: Path) -> dict:
    """Atomic-ish restore: replace DB + uploads from a backup ZIP."""
    if not zip_path.exists():
        raise FileNotFoundError(zip_path)
    with zipfile.ZipFile(zip_path, "r") as z:
        names = set(z.namelist())
        if "database.sqlite" not in names:
            raise ValueError("Backup ZIP missing database.sqlite")
        # Stage DB beside the live file, then swap atomically.
        staged = DB_PATH.with_suffix(".staged")
        with z.open("database.sqlite") as src, open(staged, "wb") as out:
            shutil.copyfileobj(src, out)
        # Wipe live DB sidecars (WAL/SHM); replace main file; SQLite will
        # create new sidecars when next opened.
        for sidecar in (DB_PATH.with_suffix(".sqlite-wal"),
                        DB_PATH.with_suffix(".sqlite-shm")):
            sidecar.unlink(missing_ok=True)
        staged.replace(DB_PATH)
        # Restore uploads (best-effort; we don't wipe — files in the zip overwrite).
        for member in names:
            if member.startswith("uploads/") and not member.endswith("/"):
                target = DATA_DIR / member
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(member) as src, open(target, "wb") as out:
                    shutil.copyfileobj(src, out)
    return {"ok": True}


# ---------- APScheduler wiring ----------
def start(app=None) -> None:
    global _scheduler
    if _scheduler:
        return
    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.start()
    reschedule()


def shutdown() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None


def reschedule() -> None:
    global _scheduler
    if not _scheduler:
        return
    if _scheduler.get_job(_JOB_ID):
        _scheduler.remove_job(_JOB_ID)
    interval = get_settings()["interval_hours"]
    if interval <= 0:
        return  # User disabled scheduled backups.
    _scheduler.add_job(
        run_backup,
        trigger=IntervalTrigger(hours=interval),
        id=_JOB_ID,
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )


def status() -> dict:
    job = _scheduler.get_job(_JOB_ID) if _scheduler else None
    return {
        "running": bool(_scheduler and _scheduler.running),
        "next_run": job.next_run_time.isoformat() if job and job.next_run_time else None,
        "settings": get_settings(),
    }
