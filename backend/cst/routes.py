"""All REST routes for Cycling Segment Tracker 2.

Kept in one file so the route surface is easy to scan; can be split into
sub-modules later without changing URLs.
"""

from __future__ import annotations

import json
import shutil
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from . import db
from .db import (
    BACKUPS_DIR, DATA_DIR, FIT_DIR, GPX_DIR, UPLOADS_DIR,
    get_conn,
)
from .deps import (
    current_user_id, dumps, loads_or, reverse_geocode, type_matches_sub_sport,
)
from .detector import (
    DETECTION_RADIUS_M, decimate, detect_efforts,
    elevation_gain_m, elevation_loss_m, haversine_m,
    hash_ride_points, hash_segment_points, total_distance_m,
)
from .parsers import parse_fit, parse_gpx
from . import scheduler as backup_scheduler

router = APIRouter(prefix="/api")


# ---------- Mac-install bootstrap helper ----------
# One-shot endpoint that streams the entire pre-built frontend as a tarball.
# Lets Mac users `curl` the latest build directly from the Emergent preview
# URL when Emergent's "Download Project" ZIP exporter silently strips
# frontend/build/ (it ignores any folder named `build` regardless of
# .gitignore overrides). No auth required because the bundle is public
# static assets anyway.
@router.get("/__mac_install/frontend-build.tar.gz")
def stream_frontend_build():
    import tarfile, io
    build_dir = Path(__file__).resolve().parent.parent.parent / "frontend" / "build"
    if not build_dir.exists():
        raise HTTPException(404, "frontend/build is not present on the server")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(str(build_dir), arcname="build")
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/gzip",
        headers={"Content-Disposition": 'attachment; filename="frontend-build.tar.gz"'},
    )


@router.get("/__mac_install/update.tar.gz")
def stream_full_update():
    """Streams the bits a Mac install needs to refresh: the entire backend/
    Python tree + the pre-built frontend/build/. Everything else (data,
    venv, node_modules, scripts) is excluded so a `tar -xzf` over the top
    is safe and idempotent.
    """
    import tarfile, io
    root = Path(__file__).resolve().parent.parent.parent
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        # Backend Python sources (skip __pycache__).
        backend_dir = root / "backend"
        for sub in ("cst", "tests"):
            p = backend_dir / sub
            if p.exists():
                tar.add(str(p), arcname=f"backend/{sub}",
                        filter=lambda ti: None if "__pycache__" in ti.name else ti)
        for f in ("server.py", "requirements.txt", "requirements-mac.txt"):
            p = backend_dir / f
            if p.exists():
                tar.add(str(p), arcname=f"backend/{f}")
        # Pre-built frontend.
        fb = root / "frontend" / "build"
        if fb.exists():
            tar.add(str(fb), arcname="frontend/build")
        # Launcher scripts.
        scripts = root / "scripts"
        if scripts.exists():
            tar.add(str(scripts), arcname="scripts",
                    filter=lambda ti: None if "__pycache__" in ti.name else ti)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/gzip",
        headers={"Content-Disposition": 'attachment; filename="update.tar.gz"'},
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _seg_summary(row, best=None, effort_count=0) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "distance_m": row["distance_m"],
        "elevation_gain_m": row["elevation_gain_m"],
        "point_count": row["point_count"],
        "created_at": row["created_at"],
        "effort_count": effort_count,
        "best_effort": best,
    }


def _seg_detail(row, best=None, effort_count=0) -> dict:
    pts = loads_or([], row["points_json"])
    return {
        **_seg_summary(row, best=best, effort_count=effort_count),
        "points": decimate(pts),
    }


def _segment_best_map(conn, uid: int, seg_ids: Optional[List[str]] = None) -> Dict[str, dict]:
    """Return {segment_id: {effort fields}} for the user's PR per segment.

    A PR is the row with the smallest `elapsed_s` for that segment. Joined
    with rides so we can surface the ride name and start_time alongside.
    """
    if seg_ids is not None and len(seg_ids) == 0:
        return {}
    sql = (
        "SELECT e.segment_id, e.id as effort_id, e.ride_id, e.elapsed_s, "
        "e.datetime_utc, e.avg_power, e.avg_hr, r.name AS ride_name "
        "FROM efforts e JOIN rides r ON r.id = e.ride_id "
        "WHERE e.user_id = ? "
        "AND e.elapsed_s = (SELECT MIN(e2.elapsed_s) FROM efforts e2 "
        "WHERE e2.segment_id = e.segment_id AND e2.user_id = e.user_id)"
    )
    params: List[Any] = [uid]
    if seg_ids is not None:
        placeholders = ",".join("?" * len(seg_ids))
        sql += f" AND e.segment_id IN ({placeholders})"
        params.extend(seg_ids)
    sql += " GROUP BY e.segment_id"  # if multiple rows share the min, take one
    out: Dict[str, dict] = {}
    for r in conn.execute(sql, params).fetchall():
        out[r["segment_id"]] = {
            "effort_id": r["effort_id"],
            "ride_id": r["ride_id"],
            "ride_name": r["ride_name"],
            "elapsed_s": r["elapsed_s"],
            "datetime_utc": r["datetime_utc"],
            "avg_power": r["avg_power"],
            "avg_hr": r["avg_hr"],
        }
    return out


def _segment_effort_counts(conn, uid: int, seg_ids: Optional[List[str]] = None) -> Dict[str, int]:
    if seg_ids is not None and len(seg_ids) == 0:
        return {}
    sql = "SELECT segment_id, COUNT(*) AS n FROM efforts WHERE user_id = ?"
    params: List[Any] = [uid]
    if seg_ids is not None:
        placeholders = ",".join("?" * len(seg_ids))
        sql += f" AND segment_id IN ({placeholders})"
        params.extend(seg_ids)
    sql += " GROUP BY segment_id"
    return {r["segment_id"]: r["n"] for r in conn.execute(sql, params).fetchall()}


def _ride_meta_view(row) -> dict:
    pts = loads_or([], row["points_json"])
    avg_speed = row["avg_speed_mps"]
    if avg_speed is None and row["distance_m"] and row["duration_s"]:
        avg_speed = row["distance_m"] / row["duration_s"]
    max_speed = row["max_speed_mps"]
    if max_speed is None and pts:
        m = 0.0
        for p in pts:
            v = p.get("speed")
            if v and v > m:
                m = v
        if m == 0.0:
            from datetime import datetime as _dt
            for i in range(1, len(pts)):
                a, b = pts[i - 1], pts[i]
                if not a.get("t") or not b.get("t"):
                    continue
                try:
                    da = _dt.fromisoformat(a["t"].replace("Z", "+00:00"))
                    dbb = _dt.fromisoformat(b["t"].replace("Z", "+00:00"))
                    dt = (dbb - da).total_seconds()
                    if dt <= 0:
                        continue
                    v = haversine_m(a["lat"], a["lon"], b["lat"], b["lon"]) / dt
                    if v > m:
                        m = v
                except Exception:
                    pass
        if m > 0:
            max_speed = m
    return {
        "sport": row["sport"],
        "sub_sport": row["sub_sport"],
        "device": row["device"],
        "bike_name": row["bike_name"],
        "moving_time_s": row["moving_time_s"],
        "avg_speed_mps": avg_speed,
        "max_speed_mps": max_speed,
        "avg_heart_rate": row["avg_heart_rate"],
        "max_heart_rate": row["max_heart_rate"],
        "avg_cadence": row["avg_cadence"],
        "max_cadence": row["max_cadence"],
        "avg_power": row["avg_power"],
        "max_power": row["max_power"],
        "normalized_power": row["normalized_power"],
        "total_calories": row["total_calories"],
        "total_ascent_m": row["total_ascent_m"] if row["total_ascent_m"] is not None else row["elevation_gain_m"],
        "total_descent_m": row["total_descent_m"] if row["total_descent_m"] is not None else row["elevation_loss_m"],
        "avg_temperature": row["avg_temperature"],
        "max_temperature": row["max_temperature"],
        "min_temperature": row["min_temperature"],
    }


# ============================ SEGMENTS ============================
@router.get("/segments")
def list_segments(uid: int = Depends(current_user_id)):
    with get_conn() as c:
        rows = c.execute(
            "SELECT * FROM segments WHERE user_id = ? ORDER BY LOWER(name)",
            (uid,),
        ).fetchall()
        seg_ids = [r["id"] for r in rows]
        bests = _segment_best_map(c, uid, seg_ids)
        counts = _segment_effort_counts(c, uid, seg_ids)
    return [_seg_summary(r, best=bests.get(r["id"]), effort_count=counts.get(r["id"], 0)) for r in rows]


@router.get("/segments/{seg_id}")
def get_segment(seg_id: str, uid: int = Depends(current_user_id)):
    with get_conn() as c:
        row = c.execute(
            "SELECT * FROM segments WHERE id = ? AND user_id = ?", (seg_id, uid)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Segment not found")
        bests = _segment_best_map(c, uid, [seg_id])
        counts = _segment_effort_counts(c, uid, [seg_id])
    return _seg_detail(row, best=bests.get(seg_id), effort_count=counts.get(seg_id, 0))


@router.post("/segments")
async def upload_segment(file: UploadFile = File(...), uid: int = Depends(current_user_id)):
    fname = (file.filename or "").lower()
    if not fname.endswith(".gpx"):
        raise HTTPException(400, "Segment must be a GPX file")
    raw = await file.read()
    text = raw.decode("utf-8", errors="replace")
    try:
        parsed = parse_gpx(text)
    except Exception as e:
        raise HTTPException(400, f"GPX parse error: {e}")
    pts = parsed["points"]
    if len(pts) < 2:
        raise HTTPException(400, "Segment has too few points")

    h = hash_segment_points(pts)
    seg_id = str(uuid.uuid4())
    name = parsed["name"] or Path(file.filename or "Segment").stem
    distance = round(total_distance_m(pts) * 10) / 10
    gain = round(elevation_gain_m(pts) * 10) / 10
    saved_path = _save_upload(raw, file.filename or f"{seg_id}.gpx", GPX_DIR)

    with get_conn() as c:
        exists = c.execute(
            "SELECT id FROM segments WHERE user_id = ? AND hash = ?", (uid, h)
        ).fetchone()
        if exists:
            raise HTTPException(409, "Duplicate segment")
        c.execute(
            "INSERT INTO segments (id, user_id, name, hash, distance_m, elevation_gain_m, "
            "point_count, points_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (seg_id, uid, name, h, distance, gain, len(pts), dumps(pts), _now()),
        )
        # Detect against every existing ride for this user.
        rides = c.execute(
            "SELECT id, points_json FROM rides WHERE user_id = ?", (uid,)
        ).fetchall()
        for r in rides:
            ride_pts = loads_or([], r["points_json"])
            for eff in detect_efforts(ride_pts, pts):
                c.execute(_INSERT_EFFORT, _effort_params(uid, r["id"], seg_id, eff))

        new = c.execute("SELECT * FROM segments WHERE id = ?", (seg_id,)).fetchone()
        bests = _segment_best_map(c, uid, [seg_id])
        counts = _segment_effort_counts(c, uid, [seg_id])
    _ = saved_path  # path is captured for future reference if we want it
    return _seg_detail(new, best=bests.get(seg_id), effort_count=counts.get(seg_id, 0))


@router.delete("/segments/{seg_id}")
def delete_segment(seg_id: str, uid: int = Depends(current_user_id)):
    with get_conn() as c:
        cur = c.execute(
            "DELETE FROM segments WHERE id = ? AND user_id = ?", (seg_id, uid)
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Segment not found")
    return {"ok": True}


class RenameBody(BaseModel):
    name: str


@router.patch("/segments/{seg_id}")
def rename_segment(seg_id: str, body: RenameBody, uid: int = Depends(current_user_id)):
    trimmed = body.name.strip()
    if not trimmed:
        raise HTTPException(400, "Name cannot be empty")
    with get_conn() as c:
        cur = c.execute(
            "UPDATE segments SET name = ? WHERE id = ? AND user_id = ?",
            (trimmed, seg_id, uid),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Segment not found")
    return {"ok": True, "name": trimmed}


@router.delete("/segments")
def delete_all_segments(uid: int = Depends(current_user_id)):
    with get_conn() as c:
        # Efforts cascade-delete via segments FK, but we wipe explicitly for clarity.
        c.execute("DELETE FROM efforts WHERE user_id = ?", (uid,))
        c.execute("DELETE FROM segments WHERE user_id = ?", (uid,))
    return {"ok": True}


@router.get("/segments/{seg_id}/efforts")
def list_segment_efforts(seg_id: str, uid: int = Depends(current_user_id)):
    with get_conn() as c:
        rows = c.execute(
            "SELECT e.*, r.name as ride_name "
            "FROM efforts e JOIN rides r ON r.id = e.ride_id "
            "WHERE e.segment_id = ? AND e.user_id = ? "
            "ORDER BY e.elapsed_s ASC",
            (seg_id, uid),
        ).fetchall()
    return [dict(r) for r in rows]


# ============================ RIDES ============================
_RIDE_COLS = (
    "id, user_id, name, hash, source_type, source_filename, source_path, "
    "start_time, duration_s, distance_m, elevation_gain_m, elevation_loss_m, "
    "point_count, points_json, created_at, sport, sub_sport, device, bike_name, "
    "moving_time_s, avg_speed_mps, max_speed_mps, avg_heart_rate, max_heart_rate, "
    "avg_cadence, max_cadence, avg_power, max_power, normalized_power, "
    "total_calories, total_ascent_m, total_descent_m, "
    "avg_temperature, max_temperature, min_temperature"
)


def _ride_summary(row) -> dict:
    meta = _ride_meta_view(row)
    return {
        "id": row["id"],
        "name": row["name"],
        "source_type": row["source_type"],
        "start_time": row["start_time"],
        "duration_s": row["duration_s"] or 0,
        "distance_m": row["distance_m"] or 0,
        "elevation_gain_m": row["elevation_gain_m"] or 0,
        "point_count": row["point_count"],
        "created_at": row["created_at"],
        **meta,
    }


@router.get("/rides")
def list_rides(uid: int = Depends(current_user_id)):
    with get_conn() as c:
        rows = c.execute(
            "SELECT *, "
            "(SELECT COUNT(*) FROM efforts WHERE ride_id = rides.id) AS effort_count "
            "FROM rides WHERE user_id = ? "
            "ORDER BY COALESCE(start_time, created_at) DESC",
            (uid,),
        ).fetchall()
    return [{**_ride_summary(r), "effort_count": r["effort_count"]} for r in rows]


@router.get("/rides/{ride_id}")
def get_ride(ride_id: str, uid: int = Depends(current_user_id)):
    with get_conn() as c:
        row = c.execute(
            "SELECT * FROM rides WHERE id = ? AND user_id = ?", (ride_id, uid)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Ride not found")
        efforts = c.execute(
            "SELECT e.*, s.name as segment_name "
            "FROM efforts e LEFT JOIN segments s ON s.id = e.segment_id "
            "WHERE e.ride_id = ? AND e.user_id = ? ORDER BY e.elapsed_s",
            (ride_id, uid),
        ).fetchall()
    pts = loads_or([], row["points_json"])
    eff_out = []
    for e in efforts:
        e = dict(e)
        s, en = e.get("start_idx"), e.get("end_idx")
        if (
            isinstance(s, int) and isinstance(en, int)
            and 0 <= s <= en < len(pts)
        ):
            e["points"] = decimate(pts[s : en + 1], 500)
        eff_out.append(e)
    return {
        **_ride_summary(row),
        "points": decimate(pts),
        "efforts": eff_out,
        "effort_count": len(eff_out),
    }


def _save_upload(raw: bytes, filename: str, folder: Path) -> str:
    folder.mkdir(parents=True, exist_ok=True)
    safe_name = Path(filename).name
    stem = Path(safe_name).stem
    ext = Path(safe_name).suffix or ""
    # Prefix with timestamp + uuid fragment so two files with the same name don't collide.
    out = folder / f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}-{stem}{ext}"
    out.write_bytes(raw)
    return str(out.relative_to(DATA_DIR))


_INSERT_EFFORT = (
    "INSERT INTO efforts (id, user_id, ride_id, segment_id, datetime_utc, elapsed_s, "
    "moving_time_s, distance_m, avg_power, max_power, avg_hr, max_hr, avg_cadence, "
    "avg_speed_mps, max_speed_mps, elevation_gain_m, start_idx, end_idx) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)


def _effort_params(uid, ride_id, seg_id, eff):
    return (
        str(uuid.uuid4()), uid, ride_id, seg_id, eff.get("datetime_utc"),
        eff.get("elapsed_s") or 0, eff.get("moving_time_s"),
        eff.get("distance_m"), eff.get("avg_power"), eff.get("max_power"),
        eff.get("avg_hr"), eff.get("max_hr"), eff.get("avg_cadence"),
        eff.get("avg_speed_mps"), eff.get("max_speed_mps"),
        eff.get("elevation_gain_m"), eff.get("start_idx"), eff.get("end_idx"),
    )


@router.post("/rides")
async def upload_ride(file: UploadFile = File(...), uid: int = Depends(current_user_id)):
    fname = (file.filename or "").lower()
    raw = await file.read()
    if fname.endswith(".gpx"):
        try:
            parsed = parse_gpx(raw.decode("utf-8", errors="replace"))
        except Exception as e:
            raise HTTPException(400, f"GPX parse error: {e}")
        source_type = "gpx"
        saved = _save_upload(raw, file.filename or "ride.gpx", GPX_DIR)
    elif fname.endswith(".fit"):
        try:
            parsed = parse_fit(raw)
        except Exception as e:
            raise HTTPException(400, f"FIT parse error: {e}")
        source_type = "fit"
        saved = _save_upload(raw, file.filename or "ride.fit", FIT_DIR)
    else:
        raise HTTPException(400, "Ride must be .gpx or .fit")

    pts = parsed["points"]
    if len(pts) < 2:
        raise HTTPException(400, "Ride has too few points")

    h = hash_ride_points(pts)
    with get_conn() as c:
        if c.execute(
            "SELECT id FROM rides WHERE user_id = ? AND hash = ?", (uid, h)
        ).fetchone():
            raise HTTPException(409, "Duplicate ride")

    meta = parsed.get("meta") or {}
    start_t = pts[0].get("t")
    end_t = pts[-1].get("t")
    duration = 0
    if start_t and end_t:
        try:
            duration = int((
                datetime.fromisoformat(end_t.replace("Z", "+00:00"))
                - datetime.fromisoformat(start_t.replace("Z", "+00:00"))
            ).total_seconds())
        except Exception:
            duration = 0

    computed_gain = elevation_gain_m(pts)
    computed_loss = elevation_loss_m(pts)
    session_ascent = meta.get("total_ascent_m")
    session_descent = meta.get("total_descent_m")
    final_gain = session_ascent if session_ascent is not None else computed_gain
    final_loss = session_descent if session_descent is not None else computed_loss

    total_dist = total_distance_m(pts)
    avg_speed = meta.get("avg_speed_mps")
    if avg_speed is None and duration > 0 and total_dist > 0:
        avg_speed = total_dist / duration
    max_speed = meta.get("max_speed_mps")
    if max_speed is None:
        m = 0.0
        for p in pts:
            v = p.get("speed")
            if v and v > m:
                m = v
        if m > 0:
            max_speed = m

    # Reverse geocode best-effort
    auto_name = None
    place = await reverse_geocode(pts[0]["lat"], pts[0]["lon"])
    if place:
        auto_name = f"{place} Ride"
    parsed_name = (parsed.get("name") or "").strip()
    base_fn = Path(file.filename or "ride").stem
    generic = {"", "unnamed", "fit ride", "cycling ride", base_fn.lower()}
    use_auto = bool(auto_name) and (
        not parsed_name
        or parsed_name.lower() in generic
        or parsed_name.lower().endswith("ride")
    )
    final_name = auto_name if use_auto else (parsed_name or base_fn)

    # Resolve bike (mirrors the JS algorithm)
    sub_sport = meta.get("sub_sport")
    bike_name = meta.get("bike_name")
    with get_conn() as c:
        if not bike_name and sub_sport:
            bikes = c.execute(
                "SELECT name, type, is_default FROM bikes WHERE user_id = ?", (uid,)
            ).fetchall()
            default = next((b for b in bikes if b["is_default"]), None)
            if default and default["type"] and type_matches_sub_sport(default["type"], sub_sport):
                bike_name = default["name"]
            else:
                for b in bikes:
                    if default and b["name"].lower() == default["name"].lower():
                        continue
                    if b["type"] and type_matches_sub_sport(b["type"], sub_sport):
                        bike_name = b["name"]
                        break
        elif not bike_name:
            default = c.execute(
                "SELECT name FROM bikes WHERE user_id = ? AND is_default = 1", (uid,)
            ).fetchone()
            if default:
                bike_name = default["name"]
        elif bike_name:
            _add_bike_internal(c, uid, bike_name, None)

    ride_id = str(uuid.uuid4())
    row_values = (
        ride_id, uid, final_name, h, source_type, file.filename, saved,
        start_t, duration,
        round(total_dist * 10) / 10,
        round(final_gain * 10) / 10,
        round(final_loss * 10) / 10,
        len(pts), dumps(pts), _now(),
        meta.get("sport"), meta.get("sub_sport"), meta.get("device"), bike_name,
        meta.get("moving_time_s"), avg_speed, max_speed,
        meta.get("avg_heart_rate"), meta.get("max_heart_rate"),
        meta.get("avg_cadence"), meta.get("max_cadence"),
        meta.get("avg_power"), meta.get("max_power"), meta.get("normalized_power"),
        meta.get("total_calories"),
        session_ascent if session_ascent is not None else round(computed_gain * 10) / 10,
        session_descent if session_descent is not None else round(computed_loss * 10) / 10,
        meta.get("avg_temperature"), meta.get("max_temperature"), meta.get("min_temperature"),
    )
    with get_conn() as c:
        c.execute(f"INSERT INTO rides ({_RIDE_COLS}) VALUES ({','.join('?' * 35)})", row_values)
        # Detect against all segments
        segs = c.execute("SELECT id, points_json FROM segments WHERE user_id = ?", (uid,)).fetchall()
        for s in segs:
            seg_pts = loads_or([], s["points_json"])
            for eff in detect_efforts(pts, seg_pts):
                c.execute(_INSERT_EFFORT, _effort_params(uid, ride_id, s["id"], eff))
    return get_ride(ride_id, uid)


@router.delete("/rides/{ride_id}")
def delete_ride(ride_id: str, uid: int = Depends(current_user_id)):
    with get_conn() as c:
        row = c.execute(
            "SELECT source_path FROM rides WHERE id = ? AND user_id = ?",
            (ride_id, uid),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Ride not found")
        c.execute("DELETE FROM rides WHERE id = ? AND user_id = ?", (ride_id, uid))
    if row["source_path"]:
        try:
            (DATA_DIR / row["source_path"]).unlink(missing_ok=True)
        except Exception:
            pass
    return {"ok": True}


@router.patch("/rides/{ride_id}")
def rename_ride(ride_id: str, body: RenameBody, uid: int = Depends(current_user_id)):
    trimmed = body.name.strip()
    if not trimmed:
        raise HTTPException(400, "Name cannot be empty")
    with get_conn() as c:
        cur = c.execute(
            "UPDATE rides SET name = ? WHERE id = ? AND user_id = ?",
            (trimmed, ride_id, uid),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Ride not found")
    return {"ok": True, "name": trimmed}


class RideMetaPatch(BaseModel):
    bike_name: Optional[str] = None
    sub_sport: Optional[str] = None
    # Pydantic v2 trick to know whether a key was actually provided
    model_config = {"extra": "ignore"}


@router.patch("/rides/{ride_id}/meta")
def update_ride_meta(ride_id: str, body: Dict[str, Any], uid: int = Depends(current_user_id)):
    allowed = {"bike_name", "sub_sport"}
    patch = {k: v for k, v in body.items() if k in allowed}
    if not patch:
        raise HTTPException(400, "Nothing to update")
    with get_conn() as c:
        row = c.execute(
            "SELECT bike_name, sub_sport FROM rides WHERE id = ? AND user_id = ?",
            (ride_id, uid),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Ride not found")
        new_bike = patch.get("bike_name", row["bike_name"])
        new_sub = patch.get("sub_sport", row["sub_sport"])
        if isinstance(new_bike, str):
            new_bike = new_bike.strip() or None
        if isinstance(new_sub, str):
            new_sub = new_sub.strip() or None
        c.execute(
            "UPDATE rides SET bike_name = ?, sub_sport = ? WHERE id = ? AND user_id = ?",
            (new_bike, new_sub, ride_id, uid),
        )
        if "bike_name" in patch and new_bike:
            _add_bike_internal(c, uid, new_bike, None)
            c.execute("UPDATE bikes SET is_default = 0 WHERE user_id = ?", (uid,))
            c.execute(
                "UPDATE bikes SET is_default = 1 WHERE user_id = ? AND LOWER(name) = LOWER(?)",
                (uid, new_bike),
            )
        updated = c.execute(
            "SELECT * FROM rides WHERE id = ? AND user_id = ?", (ride_id, uid)
        ).fetchone()
    return {"ok": True, **_ride_meta_view(updated)}


@router.delete("/rides")
def delete_all_rides(uid: int = Depends(current_user_id)):
    with get_conn() as c:
        paths = [r["source_path"] for r in c.execute(
            "SELECT source_path FROM rides WHERE user_id = ?", (uid,)
        ).fetchall() if r["source_path"]]
        c.execute("DELETE FROM rides WHERE user_id = ?", (uid,))
    for p in paths:
        try:
            (DATA_DIR / p).unlink(missing_ok=True)
        except Exception:
            pass
    return {"ok": True}


# ============================ BIKES ============================
def _add_bike_internal(conn, uid: int, name: str, btype: Optional[str]):
    name = name.strip()
    if not name:
        return None
    row = conn.execute(
        "SELECT id FROM bikes WHERE user_id = ? AND LOWER(name) = LOWER(?)",
        (uid, name),
    ).fetchone()
    if row:
        if btype is not None:
            conn.execute(
                "UPDATE bikes SET type = ? WHERE id = ?", (btype, row["id"])
            )
        return row["id"]
    conn.execute(
        "INSERT INTO bikes (user_id, name, type, is_default, added_at, created_at) "
        "VALUES (?, ?, ?, 0, ?, ?)",
        (uid, name, btype, datetime.now(timezone.utc).strftime("%Y-%m-%d"), _now()),
    )
    return conn.execute("SELECT last_insert_rowid() AS i").fetchone()["i"]


def _set_default_bike(conn, uid: int, name: Optional[str]):
    conn.execute("UPDATE bikes SET is_default = 0 WHERE user_id = ?", (uid,))
    if name:
        conn.execute(
            "UPDATE bikes SET is_default = 1 WHERE user_id = ? AND LOWER(name) = LOWER(?)",
            (uid, name),
        )


@router.get("/bikes")
def list_bikes(uid: int = Depends(current_user_id)):
    with get_conn() as c:
        return _bike_stats(c, uid)


def _bike_stats(conn, uid: int):
    bikes = conn.execute(
        "SELECT * FROM bikes WHERE user_id = ? ORDER BY is_default DESC, name", (uid,)
    ).fetchall()
    rides = conn.execute(
        "SELECT bike_name, distance_m, moving_time_s, duration_s, elevation_gain_m, "
        "COALESCE(start_time, created_at) AS t FROM rides WHERE user_id = ?",
        (uid,),
    ).fetchall()
    buckets: Dict[str, Dict[str, Any]] = {}
    def _key(n): return (n or "__unassigned__").lower()
    for r in rides:
        k = _key(r["bike_name"])
        b = buckets.setdefault(k, {
            "name": r["bike_name"], "ride_count": 0, "distance_m": 0,
            "moving_time_s": 0, "elevation_gain_m": 0, "last_used_iso": None,
        })
        b["ride_count"] += 1
        b["distance_m"] += r["distance_m"] or 0
        b["moving_time_s"] += r["moving_time_s"] or r["duration_s"] or 0
        b["elevation_gain_m"] += r["elevation_gain_m"] or 0
        t = r["t"]
        if t and (not b["last_used_iso"] or t > b["last_used_iso"]):
            b["last_used_iso"] = t

    out: List[Dict[str, Any]] = []
    for b in bikes:
        bk = buckets.get(b["name"].lower(), {
            "ride_count": 0, "distance_m": 0,
            "moving_time_s": 0, "elevation_gain_m": 0, "last_used_iso": None,
        })
        starting = b["starting_km"] or 0
        ridden = (bk["distance_m"] or 0) / 1000
        out.append({
            "name": b["name"],
            "type": b["type"],
            "is_default": bool(b["is_default"]),
            "added_at": b["added_at"],
            "starting_km": starting,
            "ride_count": bk["ride_count"],
            "distance_m": round(bk["distance_m"] * 10) / 10,
            "moving_time_s": int(bk["moving_time_s"]),
            "elevation_gain_m": int(bk["elevation_gain_m"]),
            "last_used_iso": bk["last_used_iso"],
            "total_km": round((starting + ridden) * 10) / 10,
        })
    unassigned = buckets.get("__unassigned__")
    if unassigned and unassigned["ride_count"] > 0:
        unassigned_out = {
            **unassigned, "name": None,
            "distance_m": round(unassigned["distance_m"] * 10) / 10,
            "moving_time_s": int(unassigned["moving_time_s"]),
            "elevation_gain_m": int(unassigned["elevation_gain_m"]),
        }
    else:
        unassigned_out = None
    return {"bikes": out, "unassigned": unassigned_out}


@router.get("/bikes/names")
def list_bike_names(uid: int = Depends(current_user_id)):
    with get_conn() as c:
        rows = c.execute(
            "SELECT name FROM bikes WHERE user_id = ? ORDER BY is_default DESC, name",
            (uid,),
        ).fetchall()
    return [r["name"] for r in rows]


@router.get("/bikes/default")
def get_default_bike(uid: int = Depends(current_user_id)):
    with get_conn() as c:
        row = c.execute(
            "SELECT name FROM bikes WHERE user_id = ? AND is_default = 1", (uid,)
        ).fetchone()
    return {"name": row["name"] if row else None}


class AddBikeBody(BaseModel):
    name: str
    type: Optional[str] = None


@router.post("/bikes")
def add_bike(body: AddBikeBody, uid: int = Depends(current_user_id)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name cannot be empty")
    with get_conn() as c:
        _add_bike_internal(c, uid, name, body.type)
        _set_default_bike(c, uid, name)
    return {"ok": True, "name": name}


class SetDefaultBody(BaseModel):
    name: Optional[str] = None


@router.post("/bikes/default")
def set_default(body: SetDefaultBody, uid: int = Depends(current_user_id)):
    with get_conn() as c:
        _set_default_bike(c, uid, body.name)
    return {"ok": True, "name": body.name}


class BikeProfilePatch(BaseModel):
    added_at: Optional[str] = None
    starting_km: Optional[float] = None
    type: Optional[str] = None
    model_config = {"extra": "ignore"}


@router.patch("/bikes/{name}")
def update_bike_profile(name: str, body: Dict[str, Any], uid: int = Depends(current_user_id)):
    with get_conn() as c:
        row = c.execute(
            "SELECT * FROM bikes WHERE user_id = ? AND LOWER(name) = LOWER(?)",
            (uid, name),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Bike not found")
        # Allowed fields
        if "added_at" in body:
            c.execute("UPDATE bikes SET added_at = ? WHERE id = ?",
                      (body["added_at"] or None, row["id"]))
        if "starting_km" in body:
            try:
                k = float(body["starting_km"])
                if k < 0:
                    k = 0
            except Exception:
                k = 0
            c.execute("UPDATE bikes SET starting_km = ? WHERE id = ?", (k, row["id"]))
        if "type" in body:
            c.execute("UPDATE bikes SET type = ? WHERE id = ?",
                      ((body["type"] or None), row["id"]))
        new = c.execute("SELECT * FROM bikes WHERE id = ?", (row["id"],)).fetchone()
    return _bike_profile_response(new, uid)


def _bike_profile_response(row, uid: int):
    with get_conn() as c:
        ridden = c.execute(
            "SELECT COALESCE(SUM(distance_m), 0) AS m FROM rides "
            "WHERE user_id = ? AND LOWER(bike_name) = LOWER(?)",
            (uid, row["name"]),
        ).fetchone()["m"]
    ridden_km = round((ridden or 0) / 1000 * 10) / 10
    return {
        "name": row["name"],
        "type": row["type"],
        "added_at": row["added_at"],
        "starting_km": row["starting_km"] or 0,
        "parts": loads_or({}, row["parts_json"]),
        "custom_parts": loads_or({}, row["custom_parts_json"]),
        "ridden_km": ridden_km,
        "total_km": round((row["starting_km"] or 0 + ridden_km) * 10) / 10,
    }


@router.get("/bikes/{name}/profile")
def get_bike_profile(name: str, uid: int = Depends(current_user_id)):
    with get_conn() as c:
        row = c.execute(
            "SELECT * FROM bikes WHERE user_id = ? AND LOWER(name) = LOWER(?)",
            (uid, name),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Bike not found")
    return _bike_profile_response(row, uid)


class PartEventBody(BaseModel):
    action: str
    date: Optional[str] = None
    at_km: Optional[float] = None
    notes: Optional[str] = ""


@router.post("/bikes/{name}/parts/{part}/events")
def add_part_event(name: str, part: str, body: PartEventBody, uid: int = Depends(current_user_id)):
    with get_conn() as c:
        row = c.execute(
            "SELECT * FROM bikes WHERE user_id = ? AND LOWER(name) = LOWER(?)",
            (uid, name),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Bike not found")
        parts = loads_or({}, row["parts_json"])
        entry = parts.setdefault(part, {"events": []})
        entry["events"].insert(0, {
            "id": str(uuid.uuid4()),
            "date": body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "at_km": body.at_km,
            "action": body.action,
            "notes": body.notes or "",
        })
        c.execute("UPDATE bikes SET parts_json = ? WHERE id = ?",
                  (dumps(parts), row["id"]))
    return entry


@router.delete("/bikes/{name}/parts/{part}/events/{event_id}")
def delete_part_event(name: str, part: str, event_id: str, uid: int = Depends(current_user_id)):
    with get_conn() as c:
        row = c.execute(
            "SELECT * FROM bikes WHERE user_id = ? AND LOWER(name) = LOWER(?)",
            (uid, name),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Bike not found")
        parts = loads_or({}, row["parts_json"])
        if part in parts:
            parts[part]["events"] = [
                e for e in parts[part].get("events", []) if e.get("id") != event_id
            ]
            c.execute("UPDATE bikes SET parts_json = ? WHERE id = ?",
                      (dumps(parts), row["id"]))
    return {"ok": True}


class CustomPartBody(BaseModel):
    category: str
    name: str


@router.post("/bikes/{name}/custom-parts")
def add_custom_part(name: str, body: CustomPartBody, uid: int = Depends(current_user_id)):
    with get_conn() as c:
        row = c.execute(
            "SELECT * FROM bikes WHERE user_id = ? AND LOWER(name) = LOWER(?)",
            (uid, name),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Bike not found")
        custom = loads_or({}, row["custom_parts_json"])
        bucket = custom.setdefault(body.category, [])
        if not any(p.lower() == body.name.lower() for p in bucket):
            bucket.append(body.name)
        c.execute("UPDATE bikes SET custom_parts_json = ? WHERE id = ?",
                  (dumps(custom), row["id"]))
    return {"ok": True}


@router.delete("/bikes/{name}/custom-parts/{category}/{part_name}")
def delete_custom_part(name: str, category: str, part_name: str, uid: int = Depends(current_user_id)):
    with get_conn() as c:
        row = c.execute(
            "SELECT * FROM bikes WHERE user_id = ? AND LOWER(name) = LOWER(?)",
            (uid, name),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Bike not found")
        custom = loads_or({}, row["custom_parts_json"])
        if category in custom:
            custom[category] = [p for p in custom[category] if p.lower() != part_name.lower()]
        parts = loads_or({}, row["parts_json"])
        if part_name in parts:
            del parts[part_name]
        c.execute(
            "UPDATE bikes SET custom_parts_json = ?, parts_json = ? WHERE id = ?",
            (dumps(custom), dumps(parts), row["id"]),
        )
    return {"ok": True}


class RenameBikeBody(BaseModel):
    new_name: Optional[str] = None


@router.post("/bikes/{name}/rename")
def rename_bike(name: str, body: RenameBikeBody, uid: int = Depends(current_user_id)):
    old = name.strip()
    new = (body.new_name or "").strip()
    with get_conn() as c:
        row = c.execute(
            "SELECT id FROM bikes WHERE user_id = ? AND LOWER(name) = LOWER(?)",
            (uid, old),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Bike not found")
        if new:
            c.execute(
                "UPDATE bikes SET name = ? WHERE id = ?", (new, row["id"])
            )
        else:
            c.execute("DELETE FROM bikes WHERE id = ?", (row["id"],))
        cur = c.execute(
            "UPDATE rides SET bike_name = ? WHERE user_id = ? AND LOWER(bike_name) = LOWER(?)",
            (new or None, uid, old),
        )
    return {"ok": True, "touched": cur.rowcount}


@router.delete("/bikes/{name}")
def delete_bike_everywhere(name: str, uid: int = Depends(current_user_id)):
    with get_conn() as c:
        row = c.execute(
            "SELECT id FROM bikes WHERE user_id = ? AND LOWER(name) = LOWER(?)",
            (uid, name),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Bike not found")
        cur = c.execute(
            "UPDATE rides SET bike_name = NULL "
            "WHERE user_id = ? AND LOWER(bike_name) = LOWER(?)",
            (uid, name),
        )
        c.execute("DELETE FROM bikes WHERE id = ?", (row["id"],))
    return {"ok": True, "touched": cur.rowcount}


# ============================ STATS / YEARLY ============================
@router.get("/stats")
def stats(uid: int = Depends(current_user_id)):
    with get_conn() as c:
        seg = c.execute("SELECT COUNT(*) AS n FROM segments WHERE user_id = ?", (uid,)).fetchone()["n"]
        ride = c.execute("SELECT COUNT(*) AS n FROM rides WHERE user_id = ?", (uid,)).fetchone()["n"]
        eff = c.execute("SELECT COUNT(*) AS n FROM efforts WHERE user_id = ?", (uid,)).fetchone()["n"]
    return {"segments": seg, "rides": ride, "efforts": eff}


@router.get("/stats/yearly")
def yearly_stats(year: Optional[int] = None, uid: int = Depends(current_user_id)):
    with get_conn() as c:
        rides = c.execute(
            "SELECT * FROM rides WHERE user_id = ? "
            "ORDER BY COALESCE(start_time, created_at) ASC", (uid,)
        ).fetchall()
    years_set = set()
    for r in rides:
        t = r["start_time"] or r["created_at"]
        try:
            years_set.add(datetime.fromisoformat(t.replace("Z", "+00:00")).year)
        except Exception:
            pass
    years = sorted(years_set, reverse=True)
    target = year or (years[0] if years else datetime.now().year)

    month_labels = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    months = [{"month": i, "label": lbl, "distance_km": 0, "elevation_m": 0, "ride_count": 0}
              for i, lbl in enumerate(month_labels)]
    in_year = []
    for r in rides:
        t = r["start_time"] or r["created_at"]
        try:
            d = datetime.fromisoformat(t.replace("Z", "+00:00"))
        except Exception:
            continue
        if d.year != target:
            continue
        in_year.append((d, r))
    in_year.sort(key=lambda x: x[0])
    for d, r in in_year:
        m = months[d.month - 1]
        m["distance_km"] += (r["distance_m"] or 0) / 1000
        # Prefer FIT session total_ascent over our recomputed value
        ele = r["total_ascent_m"] if r["total_ascent_m"] is not None else (r["elevation_gain_m"] or 0)
        m["elevation_m"] += ele
        m["ride_count"] += 1
    for m in months:
        m["distance_km"] = round(m["distance_km"] * 10) / 10
        m["elevation_m"] = int(m["elevation_m"])

    cd = ce = 0.0
    cumulative = [{
        "t": int(datetime(target, 1, 1, tzinfo=timezone.utc).timestamp() * 1000),
        "distance_km": 0,
        "elevation_m": 0,
    }]
    for d, r in in_year:
        cd += (r["distance_m"] or 0) / 1000
        ce += r["total_ascent_m"] if r["total_ascent_m"] is not None else (r["elevation_gain_m"] or 0)
        cumulative.append({
            "t": int(d.timestamp() * 1000),
            "distance_km": round(cd * 10) / 10,
            "elevation_m": int(ce),
        })
    return {
        "year": target,
        "years": years,
        "months": months,
        "cumulative": cumulative,
        "totals": {
            "distance_km": round(cd * 10) / 10,
            "elevation_m": int(ce),
            "ride_count": len(in_year),
        },
    }


# ============================ BACKUP / RESTORE / MIGRATE ============================
@router.get("/backup")
def backup_json(uid: int = Depends(current_user_id)):
    with get_conn() as c:
        segs = [dict(r) for r in c.execute(
            "SELECT * FROM segments WHERE user_id = ?", (uid,)).fetchall()]
        rides = [dict(r) for r in c.execute(
            "SELECT * FROM rides WHERE user_id = ?", (uid,)).fetchall()]
        efforts = [dict(r) for r in c.execute(
            "SELECT * FROM efforts WHERE user_id = ?", (uid,)).fetchall()]
        bikes = [dict(r) for r in c.execute(
            "SELECT * FROM bikes WHERE user_id = ?", (uid,)).fetchall()]
    return {
        "version": 2,
        "exported_at": _now(),
        "segments": segs,
        "rides": rides,
        "efforts": efforts,
        "bikes": bikes,
    }


class RestoreBody(BaseModel):
    segments: List[Dict[str, Any]] = []
    rides: List[Dict[str, Any]] = []
    efforts: List[Dict[str, Any]] = []
    bikes: List[Dict[str, Any]] = []


@router.post("/restore")
def restore(payload: RestoreBody, uid: int = Depends(current_user_id)):
    inserted = {"segments": 0, "rides": 0, "efforts": 0, "bikes": 0}
    with get_conn() as c:
        c.execute("DELETE FROM efforts WHERE user_id = ?", (uid,))
        c.execute("DELETE FROM rides WHERE user_id = ?", (uid,))
        c.execute("DELETE FROM segments WHERE user_id = ?", (uid,))
        c.execute("DELETE FROM bikes WHERE user_id = ?", (uid,))
        for s in payload.segments:
            c.execute(
                "INSERT INTO segments (id, user_id, name, hash, distance_m, "
                "elevation_gain_m, point_count, points_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (s.get("id") or str(uuid.uuid4()), uid, s.get("name") or "Segment",
                 s.get("hash") or "", s.get("distance_m") or 0,
                 s.get("elevation_gain_m") or 0, s.get("point_count") or 0,
                 dumps(s.get("points") or loads_or([], s.get("points_json")) or []),
                 s.get("created_at") or _now()),
            )
            inserted["segments"] += 1
        for b in payload.bikes:
            c.execute(
                "INSERT INTO bikes (user_id, name, type, is_default, added_at, "
                "starting_km, parts_json, custom_parts_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (uid, b.get("name") or "Bike", b.get("type"),
                 1 if b.get("is_default") else 0, b.get("added_at"),
                 b.get("starting_km") or 0,
                 dumps(b.get("parts") or loads_or({}, b.get("parts_json")) or {}),
                 dumps(b.get("custom_parts") or loads_or({}, b.get("custom_parts_json")) or {}),
                 b.get("created_at") or _now()),
            )
            inserted["bikes"] += 1
        for r in payload.rides:
            pts = r.get("points") or loads_or([], r.get("points_json")) or []
            c.execute(
                f"INSERT INTO rides ({_RIDE_COLS}) VALUES ({','.join('?' * 35)})",
                (r.get("id") or str(uuid.uuid4()), uid,
                 r.get("name") or "Ride", r.get("hash") or "",
                 r.get("source_type") or "gpx", r.get("source_filename"),
                 r.get("source_path"),
                 r.get("start_time"), r.get("duration_s") or 0,
                 r.get("distance_m") or 0, r.get("elevation_gain_m") or 0,
                 r.get("elevation_loss_m") or 0, len(pts), dumps(pts),
                 r.get("created_at") or _now(),
                 r.get("sport"), r.get("sub_sport"), r.get("device"),
                 r.get("bike_name"), r.get("moving_time_s"),
                 r.get("avg_speed_mps"), r.get("max_speed_mps"),
                 r.get("avg_heart_rate"), r.get("max_heart_rate"),
                 r.get("avg_cadence"), r.get("max_cadence"),
                 r.get("avg_power"), r.get("max_power"),
                 r.get("normalized_power"), r.get("total_calories"),
                 r.get("total_ascent_m"), r.get("total_descent_m"),
                 r.get("avg_temperature"), r.get("max_temperature"),
                 r.get("min_temperature")),
            )
            inserted["rides"] += 1
        for e in payload.efforts:
            c.execute(_INSERT_EFFORT, (
                e.get("id") or str(uuid.uuid4()), uid,
                e["ride_id"], e["segment_id"], e.get("datetime_utc"),
                e.get("elapsed_s") or 0, e.get("moving_time_s"),
                e.get("distance_m"), e.get("avg_power"), e.get("max_power"),
                e.get("avg_hr"), e.get("max_hr"), e.get("avg_cadence"),
                e.get("avg_speed_mps"), e.get("max_speed_mps"),
                e.get("elevation_gain_m"), e.get("start_idx"), e.get("end_idx"),
            ))
            inserted["efforts"] += 1
    return {"ok": True, "inserted": inserted}


# Backup as ZIP including the live SQLite copy + uploads.
@router.get("/backup/zip")
def backup_zip(include_uploads: bool = True, uid: int = Depends(current_user_id)):
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out_path = BACKUPS_DIR / f"cst-backup-{stamp}.zip"
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        # JSON snapshot of this user's data
        snap = backup_json(uid)
        z.writestr(f"user-{uid}/data.json", json.dumps(snap, default=str))
        # Live SQLite (consistent because of WAL + SQLite atomic backup)
        backup_target = BACKUPS_DIR / f"sqlite-{stamp}.sqlite"
        with get_conn() as c:
            with sqlite_backup(c, backup_target):
                z.write(backup_target, arcname=f"user-{uid}/database.sqlite")
        backup_target.unlink(missing_ok=True)
        if include_uploads:
            for folder in (GPX_DIR, FIT_DIR):
                if not folder.exists():
                    continue
                for f in folder.iterdir():
                    if f.is_file():
                        z.write(f, arcname=f"user-{uid}/uploads/{folder.name}/{f.name}")

    def stream():
        with open(out_path, "rb") as fh:
            while chunk := fh.read(64 * 1024):
                yield chunk
    return StreamingResponse(stream(), media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="cst-backup-{stamp}.zip"'})


from contextlib import contextmanager
@contextmanager
def sqlite_backup(conn, dest_path: Path):
    dest = None
    try:
        import sqlite3
        dest = sqlite3.connect(dest_path)
        with dest:
            conn.backup(dest)
        yield dest_path
    finally:
        if dest:
            dest.close()


# ============================ ADMIN ============================
@router.get("/admin/storage")
def admin_storage(uid: int = Depends(current_user_id)):
    def _size(p: Path) -> int:
        if not p.exists():
            return 0
        if p.is_file():
            return p.stat().st_size
        return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())

    def _count(p: Path) -> int:
        if not p.exists() or not p.is_dir():
            return 0
        return sum(1 for f in p.iterdir() if f.is_file())

    return {
        "data_dir": str(DATA_DIR),
        "database_bytes": _size(DATA_DIR / "database.sqlite"),
        "uploads_bytes": _size(UPLOADS_DIR),
        "backups_bytes": _size(BACKUPS_DIR),
        "gpx_files": _count(GPX_DIR),
        "fit_files": _count(FIT_DIR),
        "backup_files": _count(BACKUPS_DIR),
        "total_bytes": _size(DATA_DIR),
    }


@router.get("/admin/backups")
def list_backups(uid: int = Depends(current_user_id)):
    target = Path(backup_scheduler.get_settings()["target_dir"])
    target.mkdir(parents=True, exist_ok=True)
    items = []
    for f in sorted(target.iterdir(), reverse=True):
        if f.is_file() and f.name.endswith(".zip"):
            items.append({
                "name": f.name,
                "bytes": f.stat().st_size,
                "modified": datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat(),
            })
    return items


@router.delete("/admin/uploads/orphans")
def delete_orphan_uploads(uid: int = Depends(current_user_id)):
    """Remove any files in uploads/ that aren't referenced by any ride."""
    with get_conn() as c:
        refs = {r["source_path"] for r in c.execute(
            "SELECT source_path FROM rides WHERE user_id = ?", (uid,)
        ).fetchall() if r["source_path"]}
    removed = 0
    for folder in (GPX_DIR, FIT_DIR):
        if not folder.exists():
            continue
        for f in folder.iterdir():
            rel = str(f.relative_to(DATA_DIR))
            if f.is_file() and rel not in refs:
                try:
                    f.unlink()
                    removed += 1
                except Exception:
                    pass
    return {"removed": removed}


# ============================ BACKUP SCHEDULER ============================
@router.get("/admin/scheduler")
def scheduler_status(uid: int = Depends(current_user_id)):
    return backup_scheduler.status()


class SchedulerSettings(BaseModel):
    interval_hours: Optional[int] = None
    include_uploads: Optional[bool] = None
    retention_count: Optional[int] = None
    target_dir: Optional[str] = None
    model_config = {"extra": "ignore"}


@router.patch("/admin/scheduler")
def update_scheduler(body: Dict[str, Any], uid: int = Depends(current_user_id)):
    patch: Dict[str, Any] = {}
    for k in ("interval_hours", "include_uploads", "retention_count", "target_dir"):
        if k in body:
            patch[k] = body[k]
    backup_scheduler.save_settings(patch)
    return backup_scheduler.status()


@router.post("/admin/backup-now")
def backup_now(body: Dict[str, Any] = None, uid: int = Depends(current_user_id)):
    body = body or {}
    return backup_scheduler.run_backup(
        include_uploads=body.get("include_uploads"),
        target_dir=body.get("target_dir"),
    )


@router.post("/admin/restore-from-server-backup")
def restore_from_server_backup(body: Dict[str, Any], uid: int = Depends(current_user_id)):
    """Restore from one of the files in the configured backup folder."""
    name = (body or {}).get("name", "")
    if not name or "/" in name or "\\" in name or name.startswith("."):
        raise HTTPException(400, "Invalid backup name")
    target_dir = Path(backup_scheduler.get_settings()["target_dir"])
    path = target_dir / name
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "Backup not found")
    return backup_scheduler.restore_zip(path)


@router.post("/admin/restore-zip-upload")
async def restore_zip_upload(file: UploadFile = File(...), uid: int = Depends(current_user_id)):
    """Restore by uploading a ZIP from the browser."""
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    target = BACKUPS_DIR / f"uploaded-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{file.filename}"
    raw = await file.read()
    target.write_bytes(raw)
    return backup_scheduler.restore_zip(target)


@router.get("/health")
def health():
    return {"ok": True, "data_dir": str(DATA_DIR), "db": str(db.DB_PATH)}
