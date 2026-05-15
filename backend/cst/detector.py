"""Geometry + segment-effort matching ported from the previous JS implementation.

This is a 1:1 port of `frontend/src/lib/detector.js` (including the hysteresis
elevation-gain algorithm we tuned in Pass 1 of the previous session).
"""

from __future__ import annotations

import math
from typing import Iterable, List, Sequence

EARTH_R_M = 6371000.0
DETECTION_RADIUS_M = 30.0
MAX_DISPLAY_POINTS = 2000
ELE_THRESHOLD_M = 3.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    a = math.radians(lat1)
    b = math.radians(lat2)
    dlat = b - a
    dlon = math.radians(lon2 - lon1)
    s = math.sin(dlat / 2) ** 2 + math.cos(a) * math.cos(b) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_R_M * math.asin(min(1.0, math.sqrt(s)))


def total_distance_m(points: Sequence[dict]) -> float:
    d = 0.0
    for i in range(1, len(points)):
        p, q = points[i - 1], points[i]
        d += haversine_m(p["lat"], p["lon"], q["lat"], q["lon"])
    return d


def elevation_gain_m(points: Sequence[dict], threshold: float = ELE_THRESHOLD_M) -> float:
    gain = 0.0
    base = None
    peak = None
    for p in points:
        e = p.get("ele")
        if e is None:
            continue
        if base is None:
            base = peak = e
            continue
        if e > peak:
            peak = e
        elif peak - e >= threshold:
            if peak > base:
                gain += peak - base
            base = peak = e
        elif e < base:
            base = peak = e
    if base is not None and peak is not None and peak > base:
        gain += peak - base
    return gain


def elevation_loss_m(points: Sequence[dict], threshold: float = ELE_THRESHOLD_M) -> float:
    loss = 0.0
    crest = None
    trough = None
    for p in points:
        e = p.get("ele")
        if e is None:
            continue
        if crest is None:
            crest = trough = e
            continue
        if e < trough:
            trough = e
        elif e - trough >= threshold:
            if crest > trough:
                loss += crest - trough
            crest = trough = e
        elif e > crest:
            crest = trough = e
    if crest is not None and trough is not None and crest > trough:
        loss += crest - trough
    return loss


def decimate(points: Sequence[dict], max_points: int = MAX_DISPLAY_POINTS) -> List[dict]:
    """Reduce a point series to at most `max_points` for transport/display."""
    if len(points) <= max_points:
        return list(points)
    step = max(1, len(points) // max_points)
    out = list(points[::step])
    if out[-1] is not points[-1]:
        out.append(points[-1])
    return out


def _closest_index(points: Sequence[dict], target: dict) -> tuple[int, float]:
    """Index + distance of the point closest to `target` (linear scan)."""
    best_i = -1
    best_d = float("inf")
    tlat, tlon = target["lat"], target["lon"]
    for i, p in enumerate(points):
        d = haversine_m(p["lat"], p["lon"], tlat, tlon)
        if d < best_d:
            best_d = d
            best_i = i
    return best_i, best_d


def _cluster_indices(indices: Sequence[int], max_gap: int = 8) -> List[List[int]]:
    """Group a sorted list of ride-point indices into contiguous clusters.

    A cluster is a run of indices whose gap to the previous one is ≤ max_gap.
    Used to collapse the dozen-or-so consecutive in-disc points that one
    physical pass produces into a single logical entry/exit event. The 8-
    point default tolerates ~8 s of GPS dropout / under-bridge noise without
    splitting a single physical pass into two phantom passes, while still
    leaving real out-and-back loops as separate clusters (the rider has to
    leave the disc for many more seconds to come back).
    """
    out: List[List[int]] = []
    for i in indices:
        if out and i - out[-1][-1] <= max_gap:
            out[-1].append(i)
        else:
            out.append([i])
    return out


def detect_efforts(
    ride_points: Sequence[dict],
    segment_points: Sequence[dict],
    radius: float = DETECTION_RADIUS_M,
) -> List[dict]:
    """Find every contiguous slice of `ride_points` that starts within `radius`
    of the segment start, passes through the middle, and ends within `radius`
    of the segment end. Returns a list of effort summaries.

    The matcher clusters consecutive in-disc points so that a single physical
    pass (which yields ~12 GPS points inside the 30 m disc at typical cycling
    speeds) becomes one logical "start" + one logical "end" event, not 12.
    """
    if len(ride_points) < 2 or len(segment_points) < 2:
        return []
    seg_start = segment_points[0]
    seg_end = segment_points[-1]

    # Compute distance to seg_start / seg_end for every ride point once.
    start_disc_idxs: List[int] = []
    end_disc_idxs: List[int] = []
    for i, p in enumerate(ride_points):
        if haversine_m(p["lat"], p["lon"], seg_start["lat"], seg_start["lon"]) <= radius:
            start_disc_idxs.append(i)
        if haversine_m(p["lat"], p["lon"], seg_end["lat"], seg_end["lon"]) <= radius:
            end_disc_idxs.append(i)
    if not start_disc_idxs or not end_disc_idxs:
        return []

    # Collapse runs of consecutive in-disc points (one physical pass = one cluster).
    # Inside each cluster we keep the index closest to the segment endpoint —
    # that yields the tightest slice timing.
    def _best_in_cluster(cluster: List[int], target: dict) -> int:
        best_i = cluster[0]
        best_d = float("inf")
        for i in cluster:
            p = ride_points[i]
            d = haversine_m(p["lat"], p["lon"], target["lat"], target["lon"])
            if d < best_d:
                best_d = d
                best_i = i
        return best_i

    start_clusters = _cluster_indices(start_disc_idxs)
    end_clusters = _cluster_indices(end_disc_idxs)
    starts = [_best_in_cluster(c, seg_start) for c in start_clusters]
    ends = [_best_in_cluster(c, seg_end) for c in end_clusters]

    used_end = -1
    efforts: List[dict] = []
    mid = segment_points[len(segment_points) // 2]
    seg_distance = total_distance_m(segment_points)
    min_slice_distance = seg_distance * 0.6  # reject slices that obviously didn't cover the segment
    for s in starts:
        # A start that falls inside an already-consumed slice is a duplicate
        # caused by GPS jitter splitting a single physical entry into two
        # nearby start clusters — skip it.
        if s <= used_end:
            continue
        e = next((j for j in ends if j > s and j > used_end), None)
        if e is None:
            continue
        slice_pts = ride_points[s : e + 1]
        # Sanity 1: must pass near the segment midpoint — guards against
        # spurious matches where the rider entered the start disc but
        # didn't actually traverse the segment (e.g. they crossed a road
        # tangentially, or did a U-turn).
        _, mid_d = _closest_index(slice_pts, mid)
        if mid_d > radius * 4:
            continue
        # Sanity 2: the slice must cover at least 60% of the segment's own
        # length. This filters out the "GPS jitter created a fake second
        # cluster a few metres from the first" failure mode that produced
        # duplicate near-identical efforts in earlier builds.
        if total_distance_m(slice_pts) < min_slice_distance:
            continue
        used_end = e
        efforts.append(_summarise_effort(slice_pts, s, e))
    return efforts


def _summarise_effort(slice_pts: Sequence[dict], s: int, e: int) -> dict:
    t0 = slice_pts[0].get("t")
    t1 = slice_pts[-1].get("t")
    elapsed = 0.0
    if t0 and t1:
        from datetime import datetime

        try:
            dt0 = datetime.fromisoformat(t0.replace("Z", "+00:00"))
            dt1 = datetime.fromisoformat(t1.replace("Z", "+00:00"))
            elapsed = (dt1 - dt0).total_seconds()
        except Exception:
            elapsed = 0.0

    def _avg(key: str) -> float | None:
        vals = [p[key] for p in slice_pts if p.get(key) is not None]
        return sum(vals) / len(vals) if vals else None

    def _max(key: str) -> float | None:
        vals = [p[key] for p in slice_pts if p.get(key) is not None]
        return max(vals) if vals else None

    # Moving time = elapsed minus long stationary gaps (>5 s apart).
    moving = elapsed
    if t0 and t1 and len(slice_pts) > 2:
        from datetime import datetime

        try:
            stops = 0.0
            for i in range(1, len(slice_pts)):
                a = slice_pts[i - 1].get("t")
                b = slice_pts[i].get("t")
                if not a or not b:
                    continue
                da = datetime.fromisoformat(a.replace("Z", "+00:00"))
                db = datetime.fromisoformat(b.replace("Z", "+00:00"))
                dt = (db - da).total_seconds()
                if dt > 5:
                    dx = haversine_m(
                        slice_pts[i - 1]["lat"],
                        slice_pts[i - 1]["lon"],
                        slice_pts[i]["lat"],
                        slice_pts[i]["lon"],
                    )
                    if dx < 2:
                        stops += dt
            moving = max(0.0, elapsed - stops)
        except Exception:
            pass

    distance = total_distance_m(slice_pts)
    avg_speed = (distance / moving) if moving > 0 else None
    max_speed_pt = _max("speed")
    if max_speed_pt is None:
        # derive from consecutive points
        m = 0.0
        from datetime import datetime

        for i in range(1, len(slice_pts)):
            a = slice_pts[i - 1]
            b = slice_pts[i]
            if not a.get("t") or not b.get("t"):
                continue
            try:
                da = datetime.fromisoformat(a["t"].replace("Z", "+00:00"))
                db = datetime.fromisoformat(b["t"].replace("Z", "+00:00"))
                dt = (db - da).total_seconds()
                if dt <= 0:
                    continue
                v = haversine_m(a["lat"], a["lon"], b["lat"], b["lon"]) / dt
                if v > m:
                    m = v
            except Exception:
                continue
        max_speed_pt = m if m > 0 else None

    return {
        "start_idx": s,
        "end_idx": e,
        "elapsed_s": elapsed,
        "moving_time_s": moving,
        "distance_m": distance,
        "avg_power": _avg("power"),
        "max_power": _max("power"),
        "avg_hr": _avg("hr"),
        "max_hr": _max("hr"),
        "avg_cadence": _avg("cad"),
        "avg_speed_mps": avg_speed,
        "max_speed_mps": max_speed_pt,
        "elevation_gain_m": elevation_gain_m(slice_pts),
        "datetime_utc": t0,
    }


def hash_segment_points(points: Iterable[dict]) -> str:
    """Stable hash of segment geometry (rounded coordinates)."""
    import hashlib

    h = hashlib.sha256()
    for p in points:
        h.update(f"{round(p['lat'], 6)},{round(p['lon'], 6)};".encode())
    return h.hexdigest()


def hash_ride_points(points: Iterable[dict]) -> str:
    """Stable hash of a ride: start coordinate + time + point count."""
    import hashlib

    pts = list(points)
    h = hashlib.sha256()
    if pts:
        first = pts[0]
        last = pts[-1]
        h.update(
            f"{round(first['lat'], 5)},{round(first['lon'], 5)},{first.get('t','')},"
            f"{round(last['lat'], 5)},{round(last['lon'], 5)},{last.get('t','')},"
            f"{len(pts)}".encode()
        )
    return h.hexdigest()
