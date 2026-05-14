"""/api/auth/* endpoints — login, logout, me, set-initial-password, status."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr

from . import auth
from .db import DEFAULT_USER_ID, get_conn

router = APIRouter(prefix="/api/auth")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class SignInBody(BaseModel):
    name: str


class SetInitialBody(BaseModel):
    email: EmailStr
    password: str


@router.get("/status")
def status(request: Request) -> dict:
    """Always open. The SPA uses this to decide between the sign-in screen
    and the main app. There's no longer a first-run/setup step — the first
    name typed in the sign-in form auto-creates that profile.
    """
    user = None
    token = request.cookies.get(auth.ACCESS_COOKIE)
    if token:
        try:
            payload = auth.decode_token(token, "access")
            row = auth.fetch_user(int(payload["sub"]))
            if row:
                user = auth.public_user(row)
        except Exception:
            user = None
    return {
        "authenticated": user is not None,
        "user": user,
    }


@router.post("/sign-in")
def sign_in(body: SignInBody, request: Request, response: Response) -> dict:
    """Passwordless sign-in by name. Auto-creates the profile on first use.

    Designed for the single-Mac local-first install where each "user" is just
    a separate data scope (separate rides, segments, bikes). macOS itself
    gates physical access; this endpoint exists solely to identify which
    profile to load.
    """
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    if len(name) > 60:
        raise HTTPException(status_code=400, detail="Name is too long (max 60 chars)")

    # Case-insensitive lookup (so "Bob" and "bob" map to the same profile)
    # but preserve the original casing on first creation so the header shows
    # the name the user actually typed.
    user = auth.fetch_user_by_email(name)
    if not user:
        with get_conn() as c:
            seed = c.execute(
                "SELECT id FROM users WHERE id = ? AND password_hash IS NULL "
                "AND NOT EXISTS (SELECT 1 FROM rides WHERE user_id = users.id) "
                "AND NOT EXISTS (SELECT 1 FROM segments WHERE user_id = users.id)",
                (DEFAULT_USER_ID,),
            ).fetchone()
            if seed:
                c.execute(
                    "UPDATE users SET email = ?, is_admin = 1 WHERE id = ?",
                    (name, DEFAULT_USER_ID),
                )
                new_id = DEFAULT_USER_ID
            else:
                c.execute(
                    "INSERT INTO users (email, is_admin, created_at) VALUES (?, 1, ?)",
                    (name, _now_iso()),
                )
                new_id = c.execute("SELECT last_insert_rowid() AS i").fetchone()["i"]
        user = auth.fetch_user(new_id)

    auth.register_successful_login(user["id"])
    auth.set_auth_cookies(response, request, user["id"], user["email"])
    return {"ok": True, "user": auth.public_user(auth.fetch_user(user["id"]))}


@router.post("/set-initial-password")
def set_initial_password(body: SetInitialBody, request: Request, response: Response) -> dict:
    """One-shot first-run endpoint. Adopts the seeded default_user row by
    setting its email + password, then logs the caller in. Refuses to run
    once any user has a password (use POST /api/auth/login from then on).
    """
    if auth.has_any_active_user():
        raise HTTPException(status_code=409, detail="Setup already completed")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    email = body.email.lower()
    with get_conn() as c:
        c.execute(
            "UPDATE users SET email = ?, password_hash = ?, is_admin = 1 WHERE id = ?",
            (email, auth.hash_password(body.password), DEFAULT_USER_ID),
        )
    auth.register_successful_login(DEFAULT_USER_ID)
    auth.set_auth_cookies(response, request, DEFAULT_USER_ID, email)
    row = auth.fetch_user(DEFAULT_USER_ID)
    return {"ok": True, "user": auth.public_user(row)}


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response) -> dict:
    user = auth.fetch_user_by_email(body.email)
    if not user or not user.get("password_hash"):
        # Don't leak which side failed.
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if auth.is_locked(user):
        raise HTTPException(
            status_code=423,
            detail=f"Account temporarily locked due to repeated failures. Try again in {auth.LOCKOUT_MINUTES} minutes.",
        )
    if not auth.verify_password(body.password, user["password_hash"]):
        auth.register_failed_attempt(user["id"])
        raise HTTPException(status_code=401, detail="Invalid email or password")
    auth.register_successful_login(user["id"])
    auth.set_auth_cookies(response, request, user["id"], user["email"])
    row = auth.fetch_user(user["id"])
    return {"ok": True, "user": auth.public_user(row)}


@router.post("/logout")
def logout(response: Response) -> dict:
    auth.clear_auth_cookies(response)
    return {"ok": True}


@router.get("/me")
def me(request: Request) -> dict:
    uid = auth.current_user_id(request)
    row = auth.fetch_user(uid)
    return auth.public_user(row)


# ---------- Admin user management ----------
class CreateUserBody(BaseModel):
    email: EmailStr
    password: str
    is_admin: bool = False


class ResetPasswordBody(BaseModel):
    password: str


admin_router = APIRouter(prefix="/api/admin")


@admin_router.get("/users")
def list_users(request: Request) -> list:
    auth.current_admin_id(request)
    with get_conn() as c:
        rows = c.execute(
            "SELECT id, email, is_admin, created_at, last_login_at, "
            "CASE WHEN password_hash IS NULL THEN 0 ELSE 1 END AS has_password "
            "FROM users ORDER BY id"
        ).fetchall()
    return [
        {
            "id": r["id"],
            "email": r["email"],
            "is_admin": bool(r["is_admin"]),
            "created_at": r["created_at"],
            "last_login_at": r["last_login_at"],
            "has_password": bool(r["has_password"]),
        }
        for r in rows
    ]


@admin_router.post("/users")
def create_user(body: CreateUserBody, request: Request) -> dict:
    auth.current_admin_id(request)
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    email = body.email.lower()
    if auth.fetch_user_by_email(email):
        raise HTTPException(status_code=409, detail="Email already registered")
    with get_conn() as c:
        c.execute(
            "INSERT INTO users (email, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)",
            (email, auth.hash_password(body.password), 1 if body.is_admin else 0, _now_iso()),
        )
        new_id = c.execute("SELECT last_insert_rowid() AS i").fetchone()["i"]
    return auth.public_user(auth.fetch_user(new_id))


@admin_router.delete("/users/{user_id}")
def delete_user(user_id: int, request: Request) -> dict:
    requester = auth.current_admin_id(request)
    if user_id == requester:
        raise HTTPException(status_code=400, detail="Refusing to delete yourself")
    with get_conn() as c:
        cur = c.execute("DELETE FROM users WHERE id = ?", (user_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


@admin_router.post("/users/{user_id}/reset-password")
def reset_user_password(user_id: int, body: ResetPasswordBody, request: Request) -> dict:
    auth.current_admin_id(request)
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if not auth.fetch_user(user_id):
        raise HTTPException(status_code=404, detail="User not found")
    with get_conn() as c:
        c.execute(
            "UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL "
            "WHERE id = ?",
            (auth.hash_password(body.password), user_id),
        )
    return {"ok": True}


@admin_router.post("/users/{user_id}/admin")
def set_admin(user_id: int, request: Request, body: dict = None) -> dict:
    requester = auth.current_admin_id(request)
    new_value = bool((body or {}).get("is_admin", True))
    if user_id == requester and not new_value:
        raise HTTPException(status_code=400, detail="Refusing to demote yourself")
    if not auth.fetch_user(user_id):
        raise HTTPException(status_code=404, detail="User not found")
    with get_conn() as c:
        c.execute("UPDATE users SET is_admin = ? WHERE id = ?", (1 if new_value else 0, user_id))
    return {"ok": True, "is_admin": new_value}
