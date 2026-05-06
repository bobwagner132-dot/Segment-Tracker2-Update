"""Backend API tests for Cycling Segment Tracker 2.

Covers: segments (CRUD + dedup), rides (CRUD + dedup + effort detection),
efforts list, backup/restore, and stats endpoints.
"""
import os
import io
import json
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to reading frontend env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

API = f"{BASE_URL}/api"


# ---------- GPX generators ----------
def build_gpx(points, name="TEST_SEGMENT"):
    """points: list of (lat, lon, ele, t_iso or None)"""
    head = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">'
        f"<trk><name>{name}</name><trkseg>"
    )
    body = []
    for lat, lon, ele, t in points:
        body.append(f'<trkpt lat="{lat}" lon="{lon}"><ele>{ele}</ele>')
        if t:
            body.append(f"<time>{t}</time>")
        body.append("</trkpt>")
    tail = "</trkseg></trk></gpx>"
    return (head + "".join(body) + tail).encode()


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def seg_gpx():
    """Short segment from A to B with a midpoint."""
    return build_gpx(
        [
            (45.00000, 7.00000, 100, None),
            (45.00050, 7.00050, 105, None),
            (45.00100, 7.00100, 110, None),
        ],
        name="TEST_SEG",
    )


def ride_gpx_over_segment():
    """Ride approaches segment start, traverses it, exits with timestamps."""
    t0 = datetime(2024, 5, 1, 10, 0, 0, tzinfo=timezone.utc)
    pts = []
    # approach points (far from segment)
    pts.append((45.02000, 7.02000, 95, iso(t0)))
    pts.append((45.01000, 7.01000, 97, iso(t0 + timedelta(seconds=30))))
    # at segment start
    pts.append((45.00000, 7.00000, 100, iso(t0 + timedelta(seconds=60))))
    pts.append((45.00050, 7.00050, 105, iso(t0 + timedelta(seconds=90))))
    # at segment end
    pts.append((45.00100, 7.00100, 110, iso(t0 + timedelta(seconds=120))))
    # continue past
    pts.append((45.00500, 7.00500, 115, iso(t0 + timedelta(seconds=180))))
    return build_gpx(pts, name="TEST_RIDE_WITH_EFFORT")


def ride_gpx_no_segment():
    """Ride nowhere near the segment."""
    t0 = datetime(2024, 6, 1, 10, 0, 0, tzinfo=timezone.utc)
    pts = [
        (46.00000, 8.00000, 200, iso(t0)),
        (46.00100, 8.00100, 202, iso(t0 + timedelta(seconds=60))),
        (46.00200, 8.00200, 204, iso(t0 + timedelta(seconds=120))),
    ]
    return build_gpx(pts, name="TEST_RIDE_NO_EFFORT")


def empty_gpx():
    return (
        b'<?xml version="1.0"?><gpx version="1.1" creator="test" '
        b'xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg></trkseg></trk></gpx>'
    )


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    yield s
    s.close()


@pytest.fixture(scope="module", autouse=True)
def clean_db(client):
    """Wipe all data via restore(empty) before & after module."""
    empty = {"segments": [], "rides": [], "efforts": []}
    client.post(f"{API}/restore", json=empty, timeout=30)
    yield
    client.post(f"{API}/restore", json=empty, timeout=30)


# ---------- Tests ----------
class TestStats:
    def test_stats_shape(self, client):
        r = client.get(f"{API}/stats", timeout=15)
        assert r.status_code == 200
        data = r.json()
        for k in ("segments", "rides", "efforts"):
            assert k in data
            assert isinstance(data[k], int)


class TestSegments:
    def test_upload_valid_segment(self, client):
        files = {"file": ("test_seg.gpx", seg_gpx(), "application/gpx+xml")}
        r = client.post(f"{API}/segments", files=files, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"]
        assert d["point_count"] == 3
        assert d["distance_m"] > 0
        assert d["elevation_gain_m"] >= 10 - 0.01
        pytest.seg_id = d["id"]

    def test_duplicate_segment_returns_409(self, client):
        files = {"file": ("test_seg.gpx", seg_gpx(), "application/gpx+xml")}
        r = client.post(f"{API}/segments", files=files, timeout=30)
        assert r.status_code == 409

    def test_list_segments(self, client):
        r = client.get(f"{API}/segments", timeout=15)
        assert r.status_code == 200
        lst = r.json()
        assert isinstance(lst, list) and len(lst) >= 1
        s = lst[0]
        for k in ("id", "name", "distance_m", "elevation_gain_m", "point_count", "created_at"):
            assert k in s

    def test_get_segment_detail(self, client):
        r = client.get(f"{API}/segments/{pytest.seg_id}", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == pytest.seg_id
        assert isinstance(d["points"], list)
        assert len(d["points"]) >= 2

    def test_invalid_segment_rejected(self, client):
        # non-gpx filename
        files = {"file": ("seg.txt", b"not gpx", "text/plain")}
        r = client.post(f"{API}/segments", files=files, timeout=15)
        assert r.status_code == 400


class TestRidesAndEfforts:
    def test_upload_ride_empty_rejected(self, client):
        files = {"file": ("empty.gpx", empty_gpx(), "application/gpx+xml")}
        r = client.post(f"{API}/rides", files=files, timeout=15)
        assert r.status_code == 400

    def test_upload_ride_detects_effort(self, client):
        files = {"file": ("ride_effort.gpx", ride_gpx_over_segment(), "application/gpx+xml")}
        r = client.post(f"{API}/rides", files=files, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"]
        assert d["source_type"] == "gpx"
        assert d["effort_count"] >= 1, f"expected effort, got {d}"
        assert len(d["efforts"]) >= 1
        eff = d["efforts"][0]
        assert eff["segment_id"] == pytest.seg_id
        assert eff["elapsed_s"] > 0
        pytest.ride_id = d["id"]

    def test_duplicate_ride_returns_409(self, client):
        files = {"file": ("ride_effort.gpx", ride_gpx_over_segment(), "application/gpx+xml")}
        r = client.post(f"{API}/rides", files=files, timeout=30)
        assert r.status_code == 409

    def test_upload_ride_no_effort(self, client):
        files = {"file": ("ride_nope.gpx", ride_gpx_no_segment(), "application/gpx+xml")}
        r = client.post(f"{API}/rides", files=files, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["effort_count"] == 0

    def test_list_rides_sorted_desc(self, client):
        r = client.get(f"{API}/rides", timeout=15)
        assert r.status_code == 200
        rides = r.json()
        assert len(rides) >= 2
        for r_ in rides:
            assert "effort_count" in r_
        starts = [r_.get("start_time") or r_.get("created_at") for r_ in rides]
        assert starts == sorted(starts, reverse=True)

    def test_get_ride_detail(self, client):
        r = client.get(f"{API}/rides/{pytest.ride_id}", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == pytest.ride_id
        assert isinstance(d["efforts"], list)
        assert isinstance(d["points"], list) and len(d["points"]) >= 2

    def test_segment_efforts_list(self, client):
        r = client.get(f"{API}/segments/{pytest.seg_id}/efforts", timeout=15)
        assert r.status_code == 200
        efforts = r.json()
        assert len(efforts) >= 1
        elapsed = [e["elapsed_s"] for e in efforts]
        assert elapsed == sorted(elapsed)


class TestBackupRestore:
    def test_backup_has_data(self, client):
        r = client.get(f"{API}/backup", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "segments" in d and "rides" in d and "efforts" in d
        assert len(d["segments"]) >= 1 and len(d["rides"]) >= 1
        pytest.backup_payload = d

    def test_restore_replaces_data(self, client):
        # restore empty
        r = client.post(f"{API}/restore", json={"segments": [], "rides": [], "efforts": []}, timeout=30)
        assert r.status_code == 200
        stats = client.get(f"{API}/stats", timeout=15).json()
        assert stats["segments"] == 0 and stats["rides"] == 0 and stats["efforts"] == 0

        # restore back
        r2 = client.post(f"{API}/restore", json=pytest.backup_payload, timeout=30)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["segments"] == len(pytest.backup_payload["segments"])
        assert d2["rides"] == len(pytest.backup_payload["rides"])


class TestDeletion:
    def test_delete_ride_cascades_efforts(self, client):
        rid = pytest.ride_id
        r = client.delete(f"{API}/rides/{rid}", timeout=15)
        assert r.status_code == 200
        g = client.get(f"{API}/rides/{rid}", timeout=15)
        assert g.status_code == 404
        # Efforts for that ride should be gone
        efforts = client.get(f"{API}/segments/{pytest.seg_id}/efforts", timeout=15).json()
        assert all(e["ride_id"] != rid for e in efforts)

    def test_delete_segment_cascades_efforts(self, client):
        sid = pytest.seg_id
        r = client.delete(f"{API}/segments/{sid}", timeout=15)
        assert r.status_code == 200
        g = client.get(f"{API}/segments/{sid}", timeout=15)
        assert g.status_code == 404
        efforts = client.get(f"{API}/segments/{sid}/efforts", timeout=15).json()
        assert efforts == []
