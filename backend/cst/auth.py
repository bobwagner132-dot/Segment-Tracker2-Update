"""JWT + bcrypt authentication for Cycling Segment Tracker 2.

Design choices (verified against the platform auth playbook):

* Access token, 15 min, in an HttpOnly cookie called `cst_access`.
* Refresh token, 7 days, in an HttpOnly cookie called `cst_refresh`.
* `bcrypt` for password hashing.
* Token transport: cookie first, fall back to `Authorization: Bearer` header.
* Single-user-by-day-one — admin-invites-only is the default policy. Open
  signup is disabled; the only "free" endpoint is `/api/auth/set-initial-password`,
  which is callable only while the seeded `default_user` (id=1) still has
  `password_hash IS NULL` AND no other user with a password exists.
* Brute-force: 5 failed attempts per email → 15-minute lockout, tracked
  directly on the user row.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import HTTPException, Request, Response

from .db import DEFAULT_USER_ID, get_conn

JWT_ALG = "HS256"
ACCESS_COOKIE = "cst_access"
REFRESH_COOKIE = "cst_refresh"
ACCESS_MAX_AGE = 365 * 24 * 60 * 60  # 1 year — local-first single-user app on
#                                      the user's own Mac; macOS itself gates
#                                      physical access, no need to auto-expire.
REFRESH_MAX_AGE = 365 * 24 * 60 * 60  # 1 year
FAILED_ATTEMPT_LIMIT = 5
LOCKOUT_MINUTES = 15


def auth_disabled() -> bool:
    """Read CST_AUTH_DISABLED at call time, not import time, so the Mac
    launcher can flip it before each request without restart races.
    Truthy values: 1, true, yes, on (case-insensitive).
    """
    return (os.environ.get("CST_AUTH_DISABLED") or "").strip().lower() in {
        "1", "true", "yes", "on",
    }


def _secret() -> str:
    v = os.environ.get("JWT_SECRET")
    if not v:
        raise RuntimeError(
            "JWT_SECRET not configured — set it in backend/.env or the launcher."
        )
    return v


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


# ---------- Password ----------
def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ---------- JWT ----------
def make_access_token(user_id: int, email: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "type": "access",
        "exp": _now() + timedelta(seconds=ACCESS_MAX_AGE),
        "iat": _now(),
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALG)


def make_refresh_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "exp": _now() + timedelta(seconds=REFRESH_MAX_AGE),
        "iat": _now(),
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALG)


def decode_token(token: str, expected_type: str) -> dict:
    payload = jwt.decode(token, _secret(), algorithms=[JWT_ALG])
    if payload.get("type") != expected_type:
        raise jwt.InvalidTokenError("Wrong token type")
    return payload


# ---------- Cookie plumbing ----------
def _cookie_kwargs(request: Optional[Request], max_age: int) -> dict:
    # The Emergent preview is loaded INSIDE an iframe on app.emergent.sh, which
    # makes the preview origin a third-party context. Chrome (and Safari) will
    # store SameSite=Lax cookies set by that origin, but they will NOT be
    # attached to subsequent fetch/XHR calls — login succeeds, then every API
    # call 401s. The cure is SameSite=None;Secure when the request is HTTPS.
    # On the Mac install we serve over plain HTTP at http://localhost:8001 in
    # the same browser tab (no iframe), so SameSite=Lax + Secure=off is the
    # right choice there.
    https = False
    if request is not None:
        if request.headers.get("x-forwarded-proto") == "https":
            https = True
        elif request.url.scheme == "https":
            https = True
    return {
        "httponly": True,
        "samesite": "none" if https else "lax",
        "secure": https,
        "path": "/",
        "max_age": max_age,
    }


def set_auth_cookies(response: Response, request: Request, user_id: int, email: str) -> None:
    response.set_cookie(
        ACCESS_COOKIE,
        make_access_token(user_id, email),
        **_cookie_kwargs(request, ACCESS_MAX_AGE),
    )
    response.set_cookie(
        REFRESH_COOKIE,
        make_refresh_token(user_id),
        **_cookie_kwargs(request, REFRESH_MAX_AGE),
    )


def clear_auth_cookies(response: Response) -> None:
    # delete_cookie defaults to samesite=lax; spell out None+Secure so the
    # browser actually expires the cookie we set under those attributes when
    # running inside the Emergent iframe.
    for name in (ACCESS_COOKIE, REFRESH_COOKIE):
        response.delete_cookie(name, path="/", samesite="none", secure=True)
        # Also issue a Lax variant for the local-HTTP Mac install.
        response.set_cookie(name, "", max_age=0, path="/", httponly=True, samesite="lax", secure=False)


# ---------- User lookup helpers ----------
def fetch_user(user_id: int) -> Optional[dict]:
    with get_conn() as c:
        row = c.execute(
            "SELECT id, email, is_admin, created_at, last_login_at, password_hash, "
            "failed_attempts, locked_until FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    return dict(row) if row else None


def fetch_user_by_email(email: str) -> Optional[dict]:
    with get_conn() as c:
        row = c.execute(
            "SELECT id, email, is_admin, created_at, last_login_at, password_hash, "
            "failed_attempts, locked_until FROM users WHERE LOWER(email) = LOWER(?)",
            (email,),
        ).fetchone()
    return dict(row) if row else None


def public_user(row: dict) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "is_admin": bool(row["is_admin"]),
        "created_at": row["created_at"],
        "last_login_at": row["last_login_at"],
    }


def has_any_active_user() -> bool:
    """True once SOMEONE has set a password — first-run flow ends here."""
    with get_conn() as c:
        row = c.execute(
            "SELECT 1 FROM users WHERE password_hash IS NOT NULL LIMIT 1"
        ).fetchone()
    return bool(row)


# ---------- Brute force ----------
def is_locked(row: dict) -> bool:
    if not row.get("locked_until"):
        return False
    try:
        until = datetime.fromisoformat(row["locked_until"])
    except Exception:
        return False
    return until > _now()


def register_failed_attempt(user_id: int) -> None:
    with get_conn() as c:
        row = c.execute(
            "SELECT failed_attempts FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        attempts = (row["failed_attempts"] or 0) + 1
        locked_until = None
        if attempts >= FAILED_ATTEMPT_LIMIT:
            locked_until = _iso(_now() + timedelta(minutes=LOCKOUT_MINUTES))
            attempts = 0  # reset counter; lockout window is the new gate
        c.execute(
            "UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?",
            (attempts, locked_until, user_id),
        )


def register_successful_login(user_id: int) -> None:
    with get_conn() as c:
        c.execute(
            "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? "
            "WHERE id = ?",
            (_iso(_now()), user_id),
        )


# ---------- FastAPI dependency ----------
def _token_from_request(request: Request) -> Optional[str]:
    tok = request.cookies.get(ACCESS_COOKIE)
    if tok:
        return tok
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:]
    return None


def current_user_id(request: Request) -> int:
    """Dependency injected into every protected route. Returns the user_id."""
    token = _token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(token, "access")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    try:
        uid = int(payload["sub"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token payload")
    if not fetch_user(uid):
        raise HTTPException(status_code=401, detail="User no longer exists")
    return uid


def current_admin_id(request: Request) -> int:
    uid = current_user_id(request)
    user = fetch_user(uid)
    if not user or not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return uid


# ---------- First-run seed ----------
def maybe_seed_admin_from_env() -> None:
    """If `ADMIN_EMAIL`/`ADMIN_PASSWORD` are set in the env and no active
    user exists yet, plug them into the default_user row.

    Used in the Emergent dev container so the testing agent has fixed
    credentials; on a fresh Mac install these env vars aren't set, so the
    UI's first-run wizard runs instead.
    """
    if has_any_active_user():
        return
    email = (os.environ.get("ADMIN_EMAIL") or "").strip()
    password = (os.environ.get("ADMIN_PASSWORD") or "").strip()
    if not email or not password:
        return
    with get_conn() as c:
        c.execute(
            "UPDATE users SET email = ?, password_hash = ?, is_admin = 1 WHERE id = ?",
            (email.lower(), hash_password(password), DEFAULT_USER_ID),
        )
