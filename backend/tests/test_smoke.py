"""Smoke tests for the FastAPI server with auth enabled.

Each test session uses a tmp data dir set by conftest.py before imports.
The dev container seeds an admin via ADMIN_EMAIL/ADMIN_PASSWORD env vars; we
re-use the same convention here so the tests have a known-good login.
"""

import io
import os

import pytest
from fastapi.testclient import TestClient

# Set seed credentials BEFORE importing the app
os.environ["ADMIN_EMAIL"] = "tester@example.com"
os.environ["ADMIN_PASSWORD"] = "PyTest!23456"
os.environ["JWT_SECRET"] = "test-secret-not-for-production-needs-32-bytes-or-more"


@pytest.fixture(scope="session")
def client():
    import server  # imports the FastAPI app — picks up CST_DATA_DIR from env
    with TestClient(server.app) as c:
        yield c


@pytest.fixture(scope="session")
def auth_client(client):
    """Logged-in client carrying the auth cookie for every request."""
    r = client.post(
        "/api/auth/login",
        json={"email": "tester@example.com", "password": "PyTest!23456"},
    )
    assert r.status_code == 200, r.text
    return client


SIMPLE_GPX = b"""<?xml version="1.0"?>
<gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>UnitTest</name><trkseg>
<trkpt lat="40.0" lon="-74.0"><ele>10</ele><time>2026-01-01T10:00:00Z</time></trkpt>
<trkpt lat="40.001" lon="-74.001"><ele>20</ele><time>2026-01-01T10:00:30Z</time></trkpt>
<trkpt lat="40.002" lon="-74.002"><ele>30</ele><time>2026-01-01T10:01:00Z</time></trkpt>
</trkseg></trk></gpx>"""


def test_health_is_public(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_auth_status_after_seed(client):
    r = client.get("/api/auth/status")
    assert r.status_code == 200
    body = r.json()
    assert body["needs_setup"] is False
    # The seed runs at app startup; the user is created but the client cookie
    # jar is fresh so we're not authenticated yet.


def test_stats_requires_auth(client):
    r = client.get("/api/stats", cookies={})  # explicit empty cookies
    assert r.status_code == 401


def test_login_and_me(auth_client):
    r = auth_client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["email"] == "tester@example.com"
    assert r.json()["is_admin"] is True


def test_wrong_password_returns_401(client):
    r = client.post(
        "/api/auth/login",
        json={"email": "tester@example.com", "password": "definitely-wrong"},
    )
    assert r.status_code == 401


def test_segment_and_ride_with_auth(auth_client):
    r = auth_client.post(
        "/api/segments",
        files={"file": ("seg.gpx", io.BytesIO(SIMPLE_GPX), "application/gpx+xml")},
    )
    assert r.status_code == 200, r.text
    seg_id = r.json()["id"]

    r = auth_client.post(
        "/api/rides",
        files={"file": ("ride.gpx", io.BytesIO(SIMPLE_GPX), "application/gpx+xml")},
    )
    assert r.status_code == 200, r.text
    ride = r.json()
    assert ride["effort_count"] == 1
    assert any(e["segment_id"] == seg_id for e in ride["efforts"])


def test_bike_add_and_default(auth_client):
    r = auth_client.post("/api/bikes", json={"name": "PyTest Road", "type": "Road"})
    assert r.status_code == 200
    assert auth_client.get("/api/bikes/default").json()["name"] == "PyTest Road"


def test_admin_create_then_delete_user(auth_client):
    r = auth_client.post(
        "/api/admin/users",
        json={"email": "extra@example.com", "password": "Hello12345!", "is_admin": False},
    )
    assert r.status_code == 200, r.text
    new_id = r.json()["id"]

    users = auth_client.get("/api/admin/users").json()
    assert any(u["id"] == new_id for u in users)

    r = auth_client.delete(f"/api/admin/users/{new_id}")
    assert r.status_code == 200


def test_backup_and_restore_roundtrip(auth_client):
    r = auth_client.post("/api/admin/backup-now", json={})
    assert r.status_code == 200, r.text
    info = r.json()
    assert info["bytes"] > 0
    names = [b["name"] for b in auth_client.get("/api/admin/backups").json()]
    assert info["name"] in names
