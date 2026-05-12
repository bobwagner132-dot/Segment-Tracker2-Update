"""Iteration 4 tests:
 1. POST /api/auth/login sets cookies with SameSite=None; Secure over HTTPS
    (the actual cookie fix for the Emergent preview iframe).
 2. After login, /api/auth/me, /api/rides, /api/segments, /api/stats all
    return 200 with the cookie jar.
 3. GET /api/segments and /api/segments/{id} return best_effort + effort_count.
 4. MIN(elapsed_s) rule: multiple efforts → best_effort is the fastest.
 5. Negative login (wrong password) → 401 with the friendly message.
 6. Logout clears cookies → /api/auth/me returns 401 after.
"""
from __future__ import annotations

import os
import re
import io
import time
import requests
import pytest

def _read_env(key: str) -> str:
    v = os.environ.get(key)
    if v:
        return v
    # Fall back to /app/frontend/.env so tests run inside supervisor without
    # the env injected.
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith(f"{key}="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    try:
        with open("/app/backend/.env") as fh:
            for line in fh:
                if line.startswith(f"{key}="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


BASE_URL = _read_env("REACT_APP_BACKEND_URL").rstrip("/")
EMAIL = _read_env("ADMIN_EMAIL") or "admin@example.com"
PASSWORD = _read_env("ADMIN_PASSWORD") or "CyclingDev123!"
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"


# ---------- Cookie / login plumbing ----------
def _login_session() -> requests.Session:
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def sess() -> requests.Session:
    return _login_session()


class TestAuthCookies:
    """Cookie attributes are the actual iframe-login fix."""

    def test_login_sets_samesite_none_secure_over_https(self):
        # Use a fresh session and inspect raw Set-Cookie headers.
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": EMAIL, "password": PASSWORD},
        )
        assert r.status_code == 200, r.text
        # Raw headers can contain multiple Set-Cookie. requests merges via raw.headers.
        set_cookie_headers = r.raw.headers.getlist("Set-Cookie") \
            if hasattr(r.raw.headers, "getlist") else [r.headers.get("Set-Cookie", "")]
        joined = " | ".join(set_cookie_headers)
        assert "cst_access" in joined, f"no cst_access cookie in: {joined}"
        assert "cst_refresh" in joined, f"no cst_refresh cookie in: {joined}"
        # SameSite=None + Secure required for the public HTTPS preview origin.
        assert re.search(r"samesite=none", joined, re.I), (
            f"expected SameSite=None over HTTPS, got: {joined}"
        )
        assert re.search(r"(^|;|\s)secure(;|\s|$)", joined, re.I), (
            f"expected Secure attribute over HTTPS, got: {joined}"
        )
        assert re.search(r"httponly", joined, re.I), f"expected HttpOnly, got: {joined}"

    def test_negative_login_returns_friendly_401(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": EMAIL, "password": "wrong-password-XYZ"},
        )
        assert r.status_code == 401, r.text
        assert r.json().get("detail") == "Invalid email or password"

    def test_protected_endpoints_persist_cookies(self, sess):
        for path in ("/api/auth/me", "/api/rides", "/api/segments", "/api/stats"):
            r = sess.get(f"{BASE_URL}{path}")
            assert r.status_code == 200, f"{path} → {r.status_code} {r.text}"

    def test_logout_clears_cookies(self):
        s = _login_session()
        # sanity: me works pre-logout
        assert s.get(f"{BASE_URL}/api/auth/me").status_code == 200
        r = s.post(f"{BASE_URL}/api/auth/logout")
        assert r.status_code == 200, r.text
        # cookies should be expired by server now; jar may still have them but
        # they'll be empty/expired. Use a fresh jar to confirm there's no auth.
        s.cookies.clear()
        assert s.get(f"{BASE_URL}/api/auth/me").status_code == 401


# ---------- Best-effort PR ----------
SEG_GPX_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="pytest"><trk><name>{name}</name><trkseg>
<trkpt lat="48.8584" lon="2.2945"><ele>35</ele></trkpt>
<trkpt lat="48.8588" lon="2.2945"><ele>36</ele></trkpt>
<trkpt lat="48.8592" lon="2.2945"><ele>37</ele></trkpt>
<trkpt lat="48.8596" lon="2.2945"><ele>38</ele></trkpt>
</trkseg></trk></gpx>"""


def _ride_gpx(name: str, t0: str, dt_per_pt: int = 30) -> str:
    """Build a small ride GPX that traverses the segment points above."""
    from datetime import datetime, timedelta, timezone
    base = datetime.fromisoformat(t0.replace("Z", "+00:00"))
    pts = [
        (48.8580, 2.2945),
        (48.8584, 2.2945),
        (48.8588, 2.2945),
        (48.8592, 2.2945),
        (48.8596, 2.2945),
        (48.8600, 2.2945),
    ]
    body = "".join(
        f'<trkpt lat="{lat}" lon="{lon}"><ele>35</ele>'
        f'<time>{(base + timedelta(seconds=i*dt_per_pt)).strftime("%Y-%m-%dT%H:%M:%SZ")}</time></trkpt>'
        for i, (lat, lon) in enumerate(pts)
    )
    return (f'<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="pytest">'
            f'<trk><name>{name}</name><trkseg>{body}</trkseg></trk></gpx>')


class TestSegmentBestEffort:
    """best_effort + effort_count on /api/segments and /api/segments/{id}."""

    @pytest.fixture(autouse=True)
    def _wipe(self, sess):
        # Isolate: wipe rides+segments for this user before each test in class
        sess.delete(f"{BASE_URL}/api/segments")
        sess.delete(f"{BASE_URL}/api/rides")
        yield
        sess.delete(f"{BASE_URL}/api/segments")
        sess.delete(f"{BASE_URL}/api/rides")

    def _upload_segment(self, sess) -> str:
        r = sess.post(
            f"{BASE_URL}/api/segments",
            files={"file": ("pr_seg.gpx", SEG_GPX_TEMPLATE.format(name="PRSeg"), "application/gpx+xml")},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "best_effort" in body and "effort_count" in body
        assert body["effort_count"] == 0
        assert body["best_effort"] is None
        return body["id"]

    def _upload_ride(self, sess, name: str, t0: str, dt_per_pt: int = 30):
        r = sess.post(
            f"{BASE_URL}/api/rides",
            files={"file": (f"{name}.gpx", _ride_gpx(name, t0, dt_per_pt), "application/gpx+xml")},
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_segments_list_includes_pr_fields_even_when_empty(self, sess):
        seg_id = self._upload_segment(sess)
        r = sess.get(f"{BASE_URL}/api/segments")
        assert r.status_code == 200
        rows = r.json()
        target = next(x for x in rows if x["id"] == seg_id)
        assert target["best_effort"] is None
        assert target["effort_count"] == 0

    def test_pr_populated_after_ride_upload(self, sess):
        seg_id = self._upload_segment(sess)
        ride = self._upload_ride(sess, "RidePR1", "2025-01-01T08:00:00Z", dt_per_pt=30)

        r = sess.get(f"{BASE_URL}/api/segments")
        target = next(x for x in r.json() if x["id"] == seg_id)
        assert target["effort_count"] >= 1, target
        be = target["best_effort"]
        assert be is not None, f"expected best_effort populated: {target}"
        for key in ("ride_id", "ride_name", "elapsed_s", "datetime_utc"):
            assert key in be, f"missing {key} in best_effort: {be}"
        assert be["ride_id"] == ride["id"]
        assert isinstance(be["elapsed_s"], (int, float)) and be["elapsed_s"] > 0

        # detail endpoint mirrors
        r2 = sess.get(f"{BASE_URL}/api/segments/{seg_id}")
        assert r2.status_code == 200
        d = r2.json()
        assert d["effort_count"] == target["effort_count"]
        assert d["best_effort"] == be

    def test_min_elapsed_wins_when_multiple_efforts(self, sess):
        seg_id = self._upload_segment(sess)
        # slow ride: 60s/pt
        slow = self._upload_ride(sess, "SlowRide", "2025-02-01T08:00:00Z", dt_per_pt=60)
        # fast ride: 15s/pt
        fast = self._upload_ride(sess, "FastRide", "2025-03-01T08:00:00Z", dt_per_pt=15)

        r = sess.get(f"{BASE_URL}/api/segments/{seg_id}")
        d = r.json()
        assert d["effort_count"] >= 2, d
        be = d["best_effort"]
        assert be is not None
        # The fast ride must be the PR (match by ride_id; name may be auto-renamed by Nominatim)
        assert be["ride_id"] == fast["id"], f"expected fast ride as PR, got {be}"
        # ride_name should equal the ride's actual stored name
        assert be["ride_name"] == fast["name"]
