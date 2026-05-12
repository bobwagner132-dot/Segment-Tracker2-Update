"""Helpers shared by route handlers.

* Auth dependency now backed by `cst.auth` (JWT cookies, admin gate).
* Bike-type ↔ FIT sub_sport matching ported from the JS implementation.
* Reverse-geocoding via OpenStreetMap Nominatim.
"""

from __future__ import annotations

import json
import os
from typing import Iterable, Optional

import httpx
from fastapi import Depends, Request

from .auth import current_admin_id, current_user_id  # re-exported for routes


# ---------- Bike-type aliases (Garmin sub_sport variants) ----------
BIKE_TYPES = [
    "Road", "Gravel", "Mountain", "Cyclocross", "Indoor",
    "Commute", "Touring", "E-bike", "Track", "Other",
]

TYPE_SUB_SPORT_ALIASES = {
    "road":       ["road", "road cycling"],
    "gravel":     ["gravel", "gravel cycling"],
    "mountain":   ["mountain", "mountain biking", "downhill", "enduro_mountain", "enduro mountain"],
    "cyclocross": ["cyclocross", "cyclo cross", "cyclo_cross"],
    "indoor":     ["indoor", "indoor cycling", "spin", "virtual cycling", "virtual_activity"],
    "commute":    ["commute", "commuting"],
    "touring":    ["touring", "bike touring"],
    "e-bike":     ["e-bike", "e bike", "ebike", "e_bike_fitness", "e bike fitness", "electric bike", "electric_bike"],
    "track":      ["track", "track cycling"],
    "other":      ["other", "generic", "cycling"],
}


def type_matches_sub_sport(t: Optional[str], s: Optional[str]) -> bool:
    if not t or not s:
        return False
    tl, sl = t.strip().lower(), s.strip().lower()
    if tl == sl:
        return True
    aliases = TYPE_SUB_SPORT_ALIASES.get(tl, [tl])
    for a in aliases:
        al = a.lower()
        if sl == al or al in sl or sl in al:
            return True
    return False


# ---------- Reverse geocoding ----------
async def reverse_geocode(lat: float, lon: float) -> Optional[str]:
    """Best-effort suburb/city name for ride auto-naming.

    Silently returns None on any error so an offline Mac install never blocks
    an upload — the activity will just keep its filename.
    """
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lon, "format": "json", "zoom": 14},
                headers={"User-Agent": "CyclingSegmentTracker/2 (local)"},
            )
            if r.status_code != 200:
                return None
            data = r.json()
            addr = data.get("address") or {}
            for key in ("suburb", "neighbourhood", "village", "town", "city", "city_district", "county"):
                v = addr.get(key)
                if v:
                    return str(v)
            return data.get("name") or None
    except Exception:
        return None


# ---------- JSON helpers ----------
def loads_or(default, raw):
    if raw is None or raw == "":
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def dumps(v) -> str:
    return json.dumps(v, separators=(",", ":"))
