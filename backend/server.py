"""Cycling Segment Tracker 2 — FastAPI entrypoint.

Single-binary self-hosted app. Persists everything to SQLite in
$CST_DATA_DIR (defaults to /app/data inside the dev container, and to
~/Documents/CyclingTracker/data.nosync on Mac).
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from cst.db import init_db
from cst.routes import router
from cst import scheduler as backup_scheduler

app = FastAPI(title="Cycling Segment Tracker 2")

# Open CORS for local-first usage. Tightened up in Pass 2 when auth ships.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    init_db()
    backup_scheduler.start(app)


@app.on_event("shutdown")
def _shutdown():
    backup_scheduler.shutdown()


# /api/* routes must be registered BEFORE the SPA catch-all below.
app.include_router(router)


# ---------- Static frontend (single-port Mac deployment) ----------
# When the React frontend has been compiled (`yarn build`) we serve the
# resulting bundle from the same FastAPI process so the whole app runs at
# one URL. In the Emergent dev container this directory is empty and the
# webpack dev server on :3000 serves the UI instead — both modes work.
FRONTEND_BUILD = Path(
    os.environ.get(
        "CST_FRONTEND_BUILD",
        str(Path(__file__).resolve().parent.parent / "frontend" / "build"),
    )
)
_INDEX = FRONTEND_BUILD / "index.html"

if _INDEX.exists():
    # Mount the /static subdir at /static so React's hashed asset URLs work
    # untouched, then add a SPA fallback for any non-/api route.
    static_assets = FRONTEND_BUILD / "static"
    if static_assets.exists():
        app.mount("/static", StaticFiles(directory=static_assets), name="static")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        # Reserve /api/* for the FastAPI router (already registered above).
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        candidate = FRONTEND_BUILD / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_INDEX)
else:
    @app.get("/")
    def root():
        return {"name": "Cycling Segment Tracker 2", "status": "ok"}
