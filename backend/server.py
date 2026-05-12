"""Cycling Segment Tracker 2 — FastAPI entrypoint.

Single-binary self-hosted app. Persists everything to SQLite in
$CST_DATA_DIR (defaults to /app/data inside the dev container, and to
~/Documents/CyclingTracker/data.nosync on Mac).
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from cst.db import init_db
from cst.routes import router

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


app.include_router(router)


@app.get("/")
def root():
    return {"name": "Cycling Segment Tracker 2", "status": "ok"}
