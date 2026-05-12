"""GPX + FIT parsing into the unified point structure used everywhere else.

Every parsed activity boils down to:
    {
        "name": <str or None>,
        "points": [
            {"lat", "lon", "ele", "t", "hr", "power", "cad", "speed", "temp"}, ...
        ],
        "meta": {
            "sport", "sub_sport", "device", "bike_name",
            "moving_time_s", "elapsed_time_s",
            "avg_speed_mps", "max_speed_mps",
            "avg_heart_rate", "max_heart_rate",
            "avg_cadence", "max_cadence",
            "avg_power", "max_power", "normalized_power",
            "total_ascent_m", "total_descent_m", "total_distance_m",
            "total_calories",
            "avg_temperature", "max_temperature", "min_temperature",
        },
    }
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import List, Optional

import gpxpy
from fitparse import FitFile


def _iso(t) -> Optional[str]:
    if t is None:
        return None
    if isinstance(t, str):
        return t
    if isinstance(t, datetime):
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t.isoformat()
    return str(t)


# ---------- GPX ----------
def parse_gpx(text: str) -> dict:
    gpx = gpxpy.parse(text)
    name = None
    if gpx.tracks and gpx.tracks[0].name:
        name = gpx.tracks[0].name.strip() or None
    points: List[dict] = []
    for trk in gpx.tracks:
        for seg in trk.segments:
            for p in seg.points:
                pt = {"lat": p.latitude, "lon": p.longitude}
                if p.elevation is not None:
                    pt["ele"] = float(p.elevation)
                if p.time is not None:
                    pt["t"] = _iso(p.time)
                # GPX extensions for hr/power/cad/temp
                for ext in p.extensions or []:
                    for child in list(ext):
                        tag = child.tag.split("}")[-1].lower()
                        if tag == "hr":
                            try:
                                pt["hr"] = int(child.text)
                            except Exception:
                                pass
                        elif tag == "power":
                            try:
                                pt["power"] = int(child.text)
                            except Exception:
                                pass
                        elif tag == "cad":
                            try:
                                pt["cad"] = int(child.text)
                            except Exception:
                                pass
                        elif tag in ("atemp", "temp"):
                            try:
                                pt["temp"] = float(child.text)
                            except Exception:
                                pass
                points.append(pt)
    return {"name": name, "points": points, "meta": {}}


# ---------- FIT ----------
def _title_case(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    return str(s).replace("_", " ").title()


def parse_fit(raw: bytes) -> dict:
    fit = FitFile(io.BytesIO(raw))
    points: List[dict] = []
    for rec in fit.get_messages("record"):
        v = rec.get_values()
        lat_raw = v.get("position_lat")
        lon_raw = v.get("position_long")
        if lat_raw is None or lon_raw is None:
            continue
        # FIT stores positions in semicircles; fitparse may already normalise
        # to degrees depending on field. Handle both.
        lat = lat_raw * (180 / 2 ** 31) if abs(lat_raw) > 180 else lat_raw
        lon = lon_raw * (180 / 2 ** 31) if abs(lon_raw) > 180 else lon_raw
        pt = {"lat": float(lat), "lon": float(lon)}
        ele = v.get("enhanced_altitude")
        if ele is None:
            ele = v.get("altitude")
        if ele is not None:
            pt["ele"] = float(ele)
        ts = v.get("timestamp")
        if ts is not None:
            pt["t"] = _iso(ts)
        for k_in, k_out in (
            ("heart_rate", "hr"),
            ("power", "power"),
            ("cadence", "cad"),
            ("temperature", "temp"),
        ):
            val = v.get(k_in)
            if val is not None:
                try:
                    pt[k_out] = int(val) if k_out != "temp" else float(val)
                except Exception:
                    pass
        speed = v.get("enhanced_speed")
        if speed is None:
            speed = v.get("speed")
        if speed is not None:
            pt["speed"] = float(speed)
        points.append(pt)

    sessions = list(fit.get_messages("session"))
    session = sessions[0].get_values() if sessions else {}

    # Best-effort bike name from device_info / activity messages
    bike_name = None
    for msg in fit.get_messages("device_info"):
        info = msg.get_values()
        prod = info.get("product_name") or info.get("descriptor")
        if prod and ("bike" in str(prod).lower() or "frame" in str(prod).lower()):
            bike_name = str(prod)
            break

    device = None
    for msg in fit.get_messages("device_info"):
        v = msg.get_values()
        prod = v.get("product_name") or v.get("manufacturer")
        if prod:
            device = str(prod)
            break

    meta = {
        "sport": _title_case(session.get("sport")),
        "sub_sport": _title_case(session.get("sub_sport")),
        "device": device,
        "bike_name": bike_name,
        "moving_time_s": _f(session.get("total_timer_time")),
        "elapsed_time_s": _f(session.get("total_elapsed_time")),
        "avg_speed_mps": _f(session.get("avg_speed")),
        "max_speed_mps": _f(session.get("max_speed")),
        "avg_heart_rate": _f(session.get("avg_heart_rate")),
        "max_heart_rate": _f(session.get("max_heart_rate")),
        "avg_cadence": _f(session.get("avg_cadence")),
        "max_cadence": _f(session.get("max_cadence")),
        "avg_power": _f(session.get("avg_power")),
        "max_power": _f(session.get("max_power")),
        "normalized_power": _f(session.get("normalized_power")),
        "total_ascent_m": _f(session.get("total_ascent")),
        "total_descent_m": _f(session.get("total_descent")),
        "total_distance_m": _f(session.get("total_distance")),
        "total_calories": _f(session.get("total_calories")),
        "avg_temperature": _f(session.get("avg_temperature")),
        "max_temperature": _f(session.get("max_temperature")),
        "min_temperature": _f(session.get("min_temperature")),
    }
    return {"name": None, "points": points, "meta": meta}


def _f(v):
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None
