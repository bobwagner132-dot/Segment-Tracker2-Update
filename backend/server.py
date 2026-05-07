from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Body
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import math
import hashlib
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Any, Dict
import uuid
from datetime import datetime, timezone

import gpxpy
from fitparse import FitFile
import httpx


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ---------- Constants ----------
DETECTION_RADIUS_M = 30.0
MAX_DISPLAY_POINTS = 1500


# ---------- Helpers ----------
def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def total_distance_m(points: List[Dict[str, Any]]) -> float:
    d = 0.0
    for i in range(1, len(points)):
        d += haversine_m(points[i - 1]["lat"], points[i - 1]["lon"], points[i]["lat"], points[i]["lon"])
    return d


def elevation_gain_m(points: List[Dict[str, Any]]) -> float:
    gain = 0.0
    for i in range(1, len(points)):
        e1 = points[i - 1].get("ele")
        e2 = points[i].get("ele")
        if e1 is not None and e2 is not None and e2 > e1:
            gain += e2 - e1
    return gain


def decimate(points: List[Any], max_points: int = MAX_DISPLAY_POINTS) -> List[Any]:
    if len(points) <= max_points:
        return points
    step = max(1, len(points) // max_points)
    out = points[::step]
    if out[-1] is not points[-1]:
        out.append(points[-1])
    return out


def parse_gpx(content: bytes) -> Dict[str, Any]:
    text = content.decode("utf-8", errors="ignore")
    gpx = gpxpy.parse(text)
    name = None
    points = []
    for trk in gpx.tracks:
        if not name and trk.name:
            name = trk.name
        for seg in trk.segments:
            for p in seg.points:
                pt = {"lat": p.latitude, "lon": p.longitude, "ele": p.elevation}
                if p.time:
                    pt["t"] = p.time.astimezone(timezone.utc).isoformat()
                # GPX extensions (hr, power, cadence)
                hr = power = cad = None
                if p.extensions:
                    for ext in p.extensions:
                        for child in list(ext.iter()):
                            tag = child.tag.split("}")[-1].lower()
                            if tag in ("hr", "heartrate"):
                                try:
                                    hr = int(float(child.text))
                                except Exception:
                                    pass
                            elif tag == "power":
                                try:
                                    power = int(float(child.text))
                                except Exception:
                                    pass
                            elif tag in ("cad", "cadence"):
                                try:
                                    cad = int(float(child.text))
                                except Exception:
                                    pass
                if hr is not None:
                    pt["hr"] = hr
                if power is not None:
                    pt["power"] = power
                if cad is not None:
                    pt["cad"] = cad
                points.append(pt)
    # Route / waypoints fallback for pure-segment GPX with no track
    if not points:
        for rte in gpx.routes:
            if not name and rte.name:
                name = rte.name
            for p in rte.points:
                points.append({"lat": p.latitude, "lon": p.longitude, "ele": p.elevation})
    if not points:
        for p in gpx.waypoints:
            points.append({"lat": p.latitude, "lon": p.longitude, "ele": p.elevation})
    if not name:
        name = gpx.name or "Unnamed"
    return {"name": name, "points": points}


def parse_fit(content: bytes) -> Dict[str, Any]:
    fit = FitFile(io.BytesIO(content))
    points = []
    name = None
    for record in fit.get_messages("record"):
        vals = {d.name: d.value for d in record}
        lat = vals.get("position_lat")
        lon = vals.get("position_long")
        if lat is None or lon is None:
            continue
        # FIT semicircles to degrees
        if abs(lat) > 180:
            lat = lat * (180.0 / 2**31)
            lon = lon * (180.0 / 2**31)
        pt = {"lat": float(lat), "lon": float(lon)}
        if vals.get("altitude") is not None:
            pt["ele"] = float(vals["altitude"])
        elif vals.get("enhanced_altitude") is not None:
            pt["ele"] = float(vals["enhanced_altitude"])
        if vals.get("timestamp") is not None:
            t = vals["timestamp"]
            if hasattr(t, "isoformat"):
                if t.tzinfo is None:
                    t = t.replace(tzinfo=timezone.utc)
                pt["t"] = t.astimezone(timezone.utc).isoformat()
        if vals.get("heart_rate") is not None:
            pt["hr"] = int(vals["heart_rate"])
        if vals.get("power") is not None:
            pt["power"] = int(vals["power"])
        if vals.get("cadence") is not None:
            pt["cad"] = int(vals["cadence"])
        points.append(pt)
    # Session name
    try:
        for s in fit.get_messages("session"):
            for d in s:
                if d.name == "sport" and d.value:
                    name = f"{d.value} ride"
    except Exception:
        pass
    if not name:
        name = "FIT Ride"
    return {"name": name, "points": points}


def hash_segment(points: List[Dict[str, Any]]) -> str:
    key = ";".join(f"{round(p['lat'],5)},{round(p['lon'],5)}" for p in points)
    return hashlib.sha256(key.encode()).hexdigest()


async def reverse_geocode(lat: float, lon: float) -> Optional[str]:
    """Best-effort reverse geocode via OSM Nominatim. Returns place name or None."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lon, "format": "json", "zoom": 14},
                headers={
                    "User-Agent": "CyclingSegmentTracker2/1.0",
                    "Accept-Language": "en",
                },
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            addr = data.get("address", {}) or {}
            place = (
                addr.get("city")
                or addr.get("town")
                or addr.get("village")
                or addr.get("suburb")
                or addr.get("neighbourhood")
                or addr.get("hamlet")
                or addr.get("county")
                or addr.get("state")
            )
            return place
    except Exception as e:
        logger.warning(f"Reverse geocode failed: {e}")
        return None


def hash_ride(points: List[Dict[str, Any]]) -> str:
    # Include timestamps if available for uniqueness
    parts = []
    for p in points[:: max(1, len(points) // 200 or 1)]:
        parts.append(f"{round(p['lat'],5)},{round(p['lon'],5)},{p.get('t','')}")
    return hashlib.sha256(";".join(parts).encode()).hexdigest()


def detect_efforts(ride_points: List[Dict[str, Any]], segment: Dict[str, Any]) -> List[Dict[str, Any]]:
    seg_pts = segment["points"]
    if len(seg_pts) < 2 or not ride_points:
        return []
    seg_start = seg_pts[0]
    seg_end = seg_pts[-1]

    efforts = []
    i = 0
    n = len(ride_points)
    while i < n:
        # find entry into start radius
        start_idx = None
        best_start_dist = None
        while i < n:
            d = haversine_m(ride_points[i]["lat"], ride_points[i]["lon"], seg_start["lat"], seg_start["lon"])
            if d <= DETECTION_RADIUS_M:
                # find local minimum (closest approach)
                start_idx = i
                best_start_dist = d
                j = i + 1
                while j < n:
                    dj = haversine_m(ride_points[j]["lat"], ride_points[j]["lon"], seg_start["lat"], seg_start["lon"])
                    if dj <= DETECTION_RADIUS_M and dj < best_start_dist:
                        best_start_dist = dj
                        start_idx = j
                        j += 1
                    else:
                        break
                i = j
                break
            i += 1
        if start_idx is None:
            break

        # find exit to end point
        end_idx = None
        best_end_dist = None
        k = i
        while k < n:
            d = haversine_m(ride_points[k]["lat"], ride_points[k]["lon"], seg_end["lat"], seg_end["lon"])
            if d <= DETECTION_RADIUS_M:
                end_idx = k
                best_end_dist = d
                m = k + 1
                while m < n:
                    dm = haversine_m(ride_points[m]["lat"], ride_points[m]["lon"], seg_end["lat"], seg_end["lon"])
                    if dm <= DETECTION_RADIUS_M and dm < best_end_dist:
                        best_end_dist = dm
                        end_idx = m
                        m += 1
                    else:
                        break
                k = m
                break
            # if we wander far from the segment for too long, bail
            k += 1
        if end_idx is None or end_idx <= start_idx:
            break

        # compute effort metrics
        slice_ = ride_points[start_idx : end_idx + 1]
        t_start = slice_[0].get("t")
        t_end = slice_[-1].get("t")
        if not t_start or not t_end:
            i = end_idx + 1
            continue
        try:
            dt_start = datetime.fromisoformat(t_start.replace("Z", "+00:00"))
            dt_end = datetime.fromisoformat(t_end.replace("Z", "+00:00"))
        except Exception:
            i = end_idx + 1
            continue
        elapsed = (dt_end - dt_start).total_seconds()
        if elapsed <= 0:
            i = end_idx + 1
            continue

        powers = [p["power"] for p in slice_ if p.get("power") is not None]
        hrs = [p["hr"] for p in slice_ if p.get("hr") is not None]
        avg_power = round(sum(powers) / len(powers), 1) if powers else None
        avg_hr = round(sum(hrs) / len(hrs), 1) if hrs else None

        efforts.append(
            {
                "segment_id": segment["id"],
                "start_idx": start_idx,
                "end_idx": end_idx,
                "elapsed_s": elapsed,
                "avg_power": avg_power,
                "avg_hr": avg_hr,
                "datetime_utc": dt_start.isoformat(),
            }
        )
        i = end_idx + 1
    return efforts


# ---------- Models ----------
class SegmentSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    distance_m: float
    elevation_gain_m: float
    created_at: str
    point_count: int


class SegmentDetail(SegmentSummary):
    points: List[Dict[str, Any]]


class RideSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    source_type: str
    start_time: Optional[str]
    duration_s: float
    distance_m: float
    elevation_gain_m: float = 0.0
    point_count: int
    created_at: str
    effort_count: int


class RideDetail(RideSummary):
    points: List[Dict[str, Any]]
    efforts: List[Dict[str, Any]]


# ---------- Segment routes ----------
@api_router.post("/segments", response_model=SegmentDetail)
async def upload_segment(file: UploadFile = File(...)):
    content = await file.read()
    fname = (file.filename or "").lower()
    if not fname.endswith(".gpx"):
        raise HTTPException(status_code=400, detail="Segment must be a GPX file")
    try:
        parsed = parse_gpx(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"GPX parse error: {e}")
    if len(parsed["points"]) < 2:
        raise HTTPException(status_code=400, detail="Segment has too few points")

    h = hash_segment(parsed["points"])
    existing = await db.segments.find_one({"hash": h}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Duplicate segment")

    seg_id = str(uuid.uuid4())
    doc = {
        "id": seg_id,
        "name": parsed["name"] or file.filename.replace(".gpx", ""),
        "hash": h,
        "points": parsed["points"],
        "distance_m": round(total_distance_m(parsed["points"]), 1),
        "elevation_gain_m": round(elevation_gain_m(parsed["points"]), 1),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.segments.insert_one(doc)

    # Run detection on all existing rides
    rides = await db.rides.find({}, {"_id": 0}).to_list(10000)
    for r in rides:
        new_efforts = detect_efforts(r["points"], doc)
        for eff in new_efforts:
            eff_doc = {
                "id": str(uuid.uuid4()),
                "segment_id": seg_id,
                "ride_id": r["id"],
                "ride_name": r["name"],
                "elapsed_s": eff["elapsed_s"],
                "avg_power": eff["avg_power"],
                "avg_hr": eff["avg_hr"],
                "datetime_utc": eff["datetime_utc"],
                "start_idx": eff["start_idx"],
                "end_idx": eff["end_idx"],
            }
            await db.efforts.insert_one(eff_doc)
            eff_doc.pop("_id", None)

    return SegmentDetail(
        id=seg_id,
        name=doc["name"],
        distance_m=doc["distance_m"],
        elevation_gain_m=doc["elevation_gain_m"],
        created_at=doc["created_at"],
        point_count=len(doc["points"]),
        points=decimate(doc["points"]),
    )


@api_router.get("/segments", response_model=List[SegmentSummary])
async def list_segments():
    segs_full = await db.segments.find({}, {"_id": 0, "hash": 0}).to_list(10000)
    segs_full.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return [
        SegmentSummary(
            id=s["id"],
            name=s["name"],
            distance_m=s["distance_m"],
            elevation_gain_m=s["elevation_gain_m"],
            created_at=s["created_at"],
            point_count=len(s["points"]),
        )
        for s in segs_full
    ]


@api_router.get("/segments/{segment_id}", response_model=SegmentDetail)
async def get_segment(segment_id: str):
    s = await db.segments.find_one({"id": segment_id}, {"_id": 0, "hash": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Segment not found")
    return SegmentDetail(
        id=s["id"],
        name=s["name"],
        distance_m=s["distance_m"],
        elevation_gain_m=s["elevation_gain_m"],
        created_at=s["created_at"],
        point_count=len(s["points"]),
        points=decimate(s["points"]),
    )


@api_router.delete("/segments/{segment_id}")
async def delete_segment(segment_id: str):
    res = await db.segments.delete_one({"id": segment_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Segment not found")
    await db.efforts.delete_many({"segment_id": segment_id})
    return {"ok": True}


# ---------- Ride routes ----------
@api_router.post("/rides", response_model=RideDetail)
async def upload_ride(file: UploadFile = File(...)):
    content = await file.read()
    fname = (file.filename or "").lower()
    if fname.endswith(".gpx"):
        parsed = parse_gpx(content)
        source_type = "gpx"
    elif fname.endswith(".fit"):
        parsed = parse_fit(content)
        source_type = "fit"
    else:
        raise HTTPException(status_code=400, detail="Ride must be .gpx or .fit")

    points = parsed["points"]
    if len(points) < 2:
        raise HTTPException(status_code=400, detail="Ride has too few points")

    h = hash_ride(points)
    existing = await db.rides.find_one({"hash": h}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Duplicate ride")

    start_time = points[0].get("t")
    end_time = points[-1].get("t")
    duration_s = 0.0
    if start_time and end_time:
        try:
            dt_s = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            dt_e = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
            duration_s = (dt_e - dt_s).total_seconds()
        except Exception:
            pass

    ride_id = str(uuid.uuid4())

    # Auto-name based on starting place via reverse geocode (best-effort)
    auto_name = None
    if points:
        place = await reverse_geocode(points[0]["lat"], points[0]["lon"])
        if place:
            auto_name = f"Ride from {place}"

    base_filename = (file.filename or "ride").rsplit(".", 1)[0]
    parsed_name = (parsed.get("name") or "").strip()
    generic_markers = {"", "unnamed", "fit ride", "cycling ride", base_filename.lower()}
    use_auto = auto_name and (
        not parsed_name
        or parsed_name.lower() in generic_markers
        or parsed_name.lower().endswith("ride")
    )
    final_name = auto_name if use_auto else (parsed_name or base_filename)

    ride_doc = {
        "id": ride_id,
        "name": final_name,
        "hash": h,
        "source_type": source_type,
        "start_time": start_time,
        "duration_s": duration_s,
        "distance_m": round(total_distance_m(points), 1),
        "elevation_gain_m": round(elevation_gain_m(points), 1),
        "points": points,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.rides.insert_one(ride_doc)

    # Detect against all segments
    segs = await db.segments.find({}, {"_id": 0}).to_list(10000)
    all_efforts = []
    for seg in segs:
        new_efforts = detect_efforts(points, seg)
        for eff in new_efforts:
            eff_doc = {
                "id": str(uuid.uuid4()),
                "segment_id": seg["id"],
                "ride_id": ride_id,
                "ride_name": ride_doc["name"],
                "elapsed_s": eff["elapsed_s"],
                "avg_power": eff["avg_power"],
                "avg_hr": eff["avg_hr"],
                "datetime_utc": eff["datetime_utc"],
                "start_idx": eff["start_idx"],
                "end_idx": eff["end_idx"],
            }
            await db.efforts.insert_one(eff_doc)
            # insert_one mutates eff_doc adding Mongo ObjectId _id; strip before returning
            eff_doc.pop("_id", None)
            eff_doc["segment_name"] = seg["name"]
            eff_doc["points"] = decimate(
                points[eff["start_idx"] : eff["end_idx"] + 1], max_points=500
            )
            all_efforts.append(eff_doc)

    return RideDetail(
        id=ride_id,
        name=ride_doc["name"],
        source_type=source_type,
        start_time=start_time,
        duration_s=duration_s,
        distance_m=ride_doc["distance_m"],
        elevation_gain_m=ride_doc["elevation_gain_m"],
        point_count=len(points),
        created_at=ride_doc["created_at"],
        effort_count=len(all_efforts),
        points=decimate(points),
        efforts=all_efforts,
    )


@api_router.get("/rides", response_model=List[RideSummary])
async def list_rides():
    rides = await db.rides.find({}, {"_id": 0, "hash": 0}).to_list(10000)
    efforts = await db.efforts.find({}, {"_id": 0, "ride_id": 1}).to_list(100000)
    counts: Dict[str, int] = {}
    for e in efforts:
        counts[e["ride_id"]] = counts.get(e["ride_id"], 0) + 1
    rides.sort(key=lambda r: r.get("start_time") or r.get("created_at", ""), reverse=True)
    return [
        RideSummary(
            id=r["id"],
            name=r["name"],
            source_type=r["source_type"],
            start_time=r.get("start_time"),
            duration_s=r.get("duration_s", 0),
            distance_m=r.get("distance_m", 0),
            elevation_gain_m=r.get("elevation_gain_m") if r.get("elevation_gain_m") is not None else round(elevation_gain_m(r["points"]), 1),
            point_count=len(r["points"]),
            created_at=r["created_at"],
            effort_count=counts.get(r["id"], 0),
        )
        for r in rides
    ]


@api_router.get("/rides/{ride_id}", response_model=RideDetail)
async def get_ride(ride_id: str):
    r = await db.rides.find_one({"id": ride_id}, {"_id": 0, "hash": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Ride not found")
    efforts = await db.efforts.find({"ride_id": ride_id}, {"_id": 0}).to_list(10000)
    pts = r["points"]
    # Attach segment name + decimated slice for each effort so frontend can overlay it
    seg_cache: Dict[str, str] = {}
    for e in efforts:
        s_idx = e.get("start_idx")
        end_idx = e.get("end_idx")
        if isinstance(s_idx, int) and isinstance(end_idx, int) and 0 <= s_idx <= end_idx < len(pts):
            e["points"] = decimate(pts[s_idx : end_idx + 1], max_points=500)
        sid = e.get("segment_id")
        if sid:
            if sid not in seg_cache:
                seg = await db.segments.find_one({"id": sid}, {"_id": 0, "name": 1})
                seg_cache[sid] = seg["name"] if seg else "Unknown segment"
            e["segment_name"] = seg_cache[sid]
    return RideDetail(
        id=r["id"],
        name=r["name"],
        source_type=r["source_type"],
        start_time=r.get("start_time"),
        duration_s=r.get("duration_s", 0),
        distance_m=r.get("distance_m", 0),
        elevation_gain_m=r.get("elevation_gain_m") if r.get("elevation_gain_m") is not None else round(elevation_gain_m(pts), 1),
        point_count=len(pts),
        created_at=r["created_at"],
        effort_count=len(efforts),
        points=decimate(pts),
        efforts=efforts,
    )


class RenamePayload(BaseModel):
    name: str


@api_router.patch("/segments/{segment_id}")
async def rename_segment(segment_id: str, payload: RenamePayload):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    res = await db.segments.update_one({"id": segment_id}, {"$set": {"name": name}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Segment not found")
    return {"ok": True, "name": name}


@api_router.patch("/rides/{ride_id}")
async def rename_ride(ride_id: str, payload: RenamePayload):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    res = await db.rides.update_one({"id": ride_id}, {"$set": {"name": name}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ride not found")
    # Also update ride_name inside efforts for consistency
    await db.efforts.update_many({"ride_id": ride_id}, {"$set": {"ride_name": name}})
    return {"ok": True, "name": name}


@api_router.delete("/rides/{ride_id}")
async def delete_ride(ride_id: str):
    res = await db.rides.delete_one({"id": ride_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ride not found")
    await db.efforts.delete_many({"ride_id": ride_id})
    return {"ok": True}


# ---------- Efforts / Leaderboard ----------
@api_router.get("/segments/{segment_id}/efforts")
async def list_efforts(segment_id: str):
    efforts = await db.efforts.find({"segment_id": segment_id}, {"_id": 0}).to_list(10000)
    efforts.sort(key=lambda e: e["elapsed_s"])
    return efforts


# ---------- Backup / Restore ----------
@api_router.get("/backup")
async def backup():
    segments = await db.segments.find({}, {"_id": 0}).to_list(10000)
    rides = await db.rides.find({}, {"_id": 0}).to_list(10000)
    efforts = await db.efforts.find({}, {"_id": 0}).to_list(100000)
    return {
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "segments": segments,
        "rides": rides,
        "efforts": efforts,
    }


@api_router.post("/restore")
async def restore(payload: Dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid backup payload")
    segments = payload.get("segments", [])
    rides = payload.get("rides", [])
    efforts = payload.get("efforts", [])

    await db.segments.delete_many({})
    await db.rides.delete_many({})
    await db.efforts.delete_many({})

    if segments:
        await db.segments.insert_many(segments)
    if rides:
        await db.rides.insert_many(rides)
    if efforts:
        await db.efforts.insert_many(efforts)

    return {
        "ok": True,
        "segments": len(segments),
        "rides": len(rides),
        "efforts": len(efforts),
    }


@api_router.get("/stats")
async def stats():
    segs = await db.segments.count_documents({})
    rides = await db.rides.count_documents({})
    efforts = await db.efforts.count_documents({})
    return {"segments": segs, "rides": rides, "efforts": efforts}


@api_router.get("/")
async def root():
    return {"message": "Cycling Segment Tracker API", "version": 1}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
