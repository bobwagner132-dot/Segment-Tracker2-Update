"""Smoke tests for the FastAPI server.

Each test session uses a tmp data dir set by conftest.py before imports.
"""

import io

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def client():
    import server  # imports the FastAPI app — picks up CST_DATA_DIR from env
    with TestClient(server.app) as c:
        yield c


SIMPLE_GPX = b"""<?xml version="1.0"?>
<gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>UnitTest</name><trkseg>
<trkpt lat="40.0" lon="-74.0"><ele>10</ele><time>2026-01-01T10:00:00Z</time></trkpt>
<trkpt lat="40.001" lon="-74.001"><ele>20</ele><time>2026-01-01T10:00:30Z</time></trkpt>
<trkpt lat="40.002" lon="-74.002"><ele>30</ele><time>2026-01-01T10:01:00Z</time></trkpt>
</trkseg></trk></gpx>"""


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_segment_then_ride_detects_effort(client):
    r = client.post(
        "/api/segments",
        files={"file": ("seg.gpx", io.BytesIO(SIMPLE_GPX), "application/gpx+xml")},
    )
    assert r.status_code == 200, r.text
    seg_id = r.json()["id"]

    r = client.post(
        "/api/rides",
        files={"file": ("ride.gpx", io.BytesIO(SIMPLE_GPX), "application/gpx+xml")},
    )
    assert r.status_code == 200, r.text
    ride = r.json()
    assert ride["effort_count"] == 1
    assert ride["distance_m"] > 0
    assert any(e["segment_id"] == seg_id for e in ride["efforts"])


def test_bike_add_and_default(client):
    r = client.post("/api/bikes", json={"name": "PyTest Road", "type": "Road"})
    assert r.status_code == 200
    r = client.get("/api/bikes/default")
    assert r.json()["name"] == "PyTest Road"


def test_backup_and_restore_roundtrip(client):
    r = client.post("/api/admin/backup-now", json={})
    assert r.status_code == 200, r.text
    info = r.json()
    assert info["bytes"] > 0
    r = client.get("/api/admin/backups")
    names = [b["name"] for b in r.json()]
    assert info["name"] in names
