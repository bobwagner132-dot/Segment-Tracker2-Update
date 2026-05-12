# Cycling Segment Tracker 2 — PRD

## Original Problem Statement
A personal cycling analysis web app. Define segments (GPX), upload rides (GPX/FIT), detect segment efforts within 30 m of segment endpoints, track performance over time grouped by year. Now being prepared for self-hosted local deployment on macOS with SQLite + persistent file storage + multi-user-ready schema.

## User Choices (locked)
- Storage engine: **SQLite** (FastAPI + sqlite3 stdlib). WAL mode on.
- Data folder on Mac: `~/Documents/CyclingTracker/` with live DB inside `data.nosync/` (excluded from iCloud sync) and `backups/` synced. Configurable via `CST_DATA_DIR` env var.
- Multi-user: schema includes `user_id` on every row from day one. Pass 1 ships single-user with hard-wired `default_user` (id=1). Pass 2 will add a real login.
- Existing IndexedDB data: one-click migration button on Settings page.
- Dormant FastAPI MongoDB code: **deleted**; replaced with this new SQLite-backed server.
- Emergent preview: still functional — the dev container runs the same FastAPI server users will run on Mac.

## Architecture (Pass 1, May 2026)

```
/app/
├── backend/
│   ├── server.py                 # FastAPI bootstrap + CORS + startup init
│   ├── requirements.txt          # gpxpy, fitparse, httpx, FastAPI, bcrypt (for Pass 2), PyJWT
│   ├── .env                      # CST_DATA_DIR, JWT_SECRET
│   └── cst/
│       ├── db.py                 # SQLite schema, migrations, WAL, seed default_user
│       ├── parsers.py            # GPX (gpxpy) + FIT (fitparse) → unified point dicts
│       ├── detector.py           # haversine, hysteresis elevation gain, effort detection
│       ├── deps.py               # current_user_id dep (returns 1 in Pass 1), bike-type aliases, reverse-geocoding
│       └── routes.py             # All REST routes under /api/...
├── frontend/
│   └── src/
│       ├── lib/
│       │   ├── api.js            # REST client (fetch) — same exported surface as the old IndexedDB lib
│       │   ├── migrate.js        # IndexedDB → SQLite one-shot migration
│       │   ├── localdb.js        # Kept for migration + fsbackup helpers
│       │   ├── fsbackup.js       # Folder-based File System Access backup (legacy, still usable)
│       │   ├── theme.jsx
│       │   └── utils.js
│       └── pages/                # Unchanged — call functions in lib/api.js
└── data/                         # Created at runtime
    ├── database.sqlite
    ├── uploads/{fit,gpx}/        # Original uploaded files preserved
    └── backups/
```

## REST API surface (under /api)
- **Segments**: `GET/POST/DELETE /segments`, `GET/PATCH/DELETE /segments/{id}`, `GET /segments/{id}/efforts`
- **Rides**: `GET/POST/DELETE /rides`, `GET/PATCH/DELETE /rides/{id}`, `PATCH /rides/{id}/meta`
- **Bikes**: `GET /bikes` (with stats), `GET /bikes/names`, `GET /bikes/default`, `POST /bikes`, `POST /bikes/default`, `PATCH /bikes/{name}`, `GET /bikes/{name}/profile`, `POST /bikes/{name}/parts/{part}/events`, `DELETE /bikes/{name}/parts/{part}/events/{id}`, `POST /bikes/{name}/custom-parts`, `DELETE /bikes/{name}/custom-parts/{cat}/{name}`, `POST /bikes/{name}/rename`, `DELETE /bikes/{name}`
- **Stats**: `GET /stats`, `GET /stats/yearly?year=...`
- **Backup**: `GET /backup` (JSON), `POST /restore`, `GET /backup/zip?include_uploads=...`
- **Admin**: `GET /admin/storage`, `GET /admin/backups`, `DELETE /admin/uploads/orphans`
- **Health**: `GET /api/health`

## SQLite schema (key tables)
- `users(id, email, password_hash, is_admin, created_at)` — Pass 1 seeds id=1.
- `segments(id, user_id, name, hash, distance_m, elevation_gain_m, point_count, points_json, created_at)`
- `rides(id, user_id, name, hash, source_type, source_filename, source_path, start_time, duration_s, distance_m, elevation_gain_m, elevation_loss_m, points_json, ...FIT metadata...)` — original file preserved on disk at `source_path`.
- `efforts(id, user_id, ride_id, segment_id, datetime_utc, elapsed_s, moving_time_s, distance_m, avg/max power/hr/cadence/speed, elevation_gain_m, start_idx, end_idx)`
- `bikes(id, user_id, name, type, is_default, added_at, starting_km, parts_json, custom_parts_json, created_at)`
- `meta(user_id, key, value)`

## Completed work — Pass 1 (May 2026)
- New FastAPI + SQLite backend with full schema and seeded `default_user`.
- Original uploaded FIT/GPX preserved in `data/uploads/<type>/`.
- All endpoints mirror the previous IndexedDB function surface (so pages didn't need any rewrites).
- Hysteresis elevation, FIT session-preferred totals, speed fallback — all ported to Python.
- Reverse geocoding (Nominatim) moved server-side.
- Frontend `lib/api.js` rewritten as a thin fetch client.
- Settings page got a **Migrate from browser storage** card (scan + run) that pulls everything out of the legacy IndexedDB and POSTs to `/api/restore`.
- Old Python FastAPI MongoDB code in `/app/backend/server.py` and any MongoDB references deleted.
- Backup ZIP endpoint (DB + uploads) + Admin storage endpoint scaffolded for Pass 2/3.

## Verified end-to-end (Pass 1)
- `curl POST /api/segments` (GPX) → row inserted, file saved, detail returned with decimated points.
- `curl POST /api/rides` (same GPX) → ride row, effort row, default bike auto-assigned, original file kept.
- Dashboard, Activities, Equipment, Settings all render with no console errors, charts populate, bike default + type round-trip persists.

## Pass 2 (May 2026) — Backups + Admin (DONE)
- Background scheduler (APScheduler) runs configurable interval backups; default every 24 h, keep newest 14.
- ZIP backup uses SQLite's online backup API (crash-safe) and bundles uploads when enabled.
- New Admin tab with: storage usage tiles, schedule editor (interval / retention / include-uploads / target folder), Backup-now, Download-as-ZIP, Restore-from-server-backup, Restore-from-uploaded-ZIP, Orphan-uploads sweeper, backup list with per-row Restore.
- Schedule settings persist to `meta` table per user.
- `pytest` smoke suite at `backend/tests/test_smoke.py` (health, segment+ride effort detection, bike add/default, backup roundtrip — all green).

## Pass 3 (May 2026) — Mac packaging (DONE)
- `backend/server.py` now serves the React production bundle from `frontend/build/` as a SPA when present (single-process Mac deployment); falls back to JSON root in dev container.
- `scripts/start-mac.sh` — idempotent launcher: creates venv, installs deps if requirements changed, builds frontend on first run, sets CST_DATA_DIR to `~/Documents/CyclingTracker/data.nosync`, launches uvicorn, opens browser.
- `scripts/install-launchd.sh` / `uninstall-launchd.sh` — registers a `LaunchAgent` plist (`com.local.cyclingtracker`) with `KeepAlive` so the service auto-starts at login and self-recovers.
- `docs/DEPLOYMENT-macOS-10.15.md` — full step-by-step guide covering Homebrew, Python 3.11, iCloud `.nosync` rationale, LAN access (`CST_HOST=0.0.0.0`), backups, migration, troubleshooting.

## Pass 4 (May 2026) — Auth activation (DONE)
- **bcrypt + JWT-in-HttpOnly-cookie** auth. Access token 15 min, refresh 7 days. Implementation follows the verified `integration_playbook_expert_v2` pattern (cookie-first, Authorization-header fallback, SameSite=Lax, Secure flag auto-detected from `x-forwarded-proto`/scheme).
- Endpoints in `cst/auth_routes.py`:
  - `GET /api/auth/status` (open) — drives the SPA's gate.
  - `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.
  - `POST /api/auth/set-initial-password` — first-run-only.
  - Admin user CRUD under `/api/admin/users` (+ `/admin/users/{id}/reset-password` and `/admin/users/{id}/admin`).
- `current_user_id` dependency rewritten in `cst/auth.py` to decode the cookie/header JWT. All existing routes pick this up automatically.
- Schema migration: `users` table now has `last_login_at`, `failed_attempts`, `locked_until`. Idempotent `ALTER TABLE` runs in `init_db()` to upgrade existing DBs.
- **Brute-force**: 5 failed attempts on an email → 15-minute account lockout (returns HTTP 423).
- **Admin-invites-only**: open signup endpoint deliberately omitted. The only way to add users after first-run is from the Admin → Users panel.
- **Dev container seed**: `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars in `backend/.env` auto-seed the default user on first boot (Mac install leaves these blank → first-run wizard shows). Credentials documented in `/app/memory/test_credentials.md`.
- **Frontend**:
  - `lib/auth.jsx` — AuthProvider + useAuth() exposing `state` (`loading` | `needs_setup` | `logged_out` | `logged_in`), `user`, `login`, `logout`, `completeSetup`.
  - `pages/LoginPage.jsx` — branded login card + first-run setup wizard, picks itself based on auth state.
  - `App.js` wraps the router in `<AuthProvider>` and gates every route via `<Gate>`. Pre-login, only LoginPage renders.
  - `Layout.jsx` shows the logged-in user email + admin badge + logout button in the header.
  - Admin nav item visible only when `user.is_admin`.
  - Admin → Users section with invite form, role toggle, password reset, delete.
- CORS upgraded from `allow_origins=["*"]` to `allow_origin_regex=".*"` so cookies survive (browsers reject `*` + credentials).
- pytest smoke suite expanded (`backend/tests/test_smoke.py`): 9/9 green covering health, auth flow, lockout-adjacent paths, segment+ride+effort with auth, admin user CRUD, backup roundtrip.

## Pass 5 (May 2026) — Preview iframe login fix + Best-Effort highlighting (DONE)
- **Fix: login on Emergent Preview** — auth cookies are now `SameSite=None; Secure` when served over HTTPS (the preview is loaded inside an iframe at `app.emergent.sh`, so cookies must be cross-site-eligible). `SameSite=Lax + Secure=off` is kept for plain-HTTP Mac install. See `cst/auth._cookie_kwargs()`.
- `clear_auth_cookies` issues both a `None+Secure` delete and a `Lax+insecure` overwrite so logout works in both environments.
- `lib/api.js::_parseError` no longer mis-maps any 401 to "Invalid email or password" — that message is now scoped to the `/auth/login` path, every other 401 reads "Your session expired. Please sign in again."
- **Best-effort highlighting** — `GET /api/segments` and `/api/segments/{id}` now include `best_effort` (PR row: `effort_id, ride_id, ride_name, elapsed_s, datetime_utc, avg_power, avg_hr`) and `effort_count`. PR is computed as the row with `MIN(e.elapsed_s)` joined with the ride name.
- `pages/Segments.jsx` shows a PR badge per row (`crown + elapsed + Nx attempts`) and a hero **PR card** above the elevation chart on the detail panel (clicking the ride name jumps to the matching Activity). When no efforts exist yet, both render gracefully as "No efforts yet".
- Regression tests: new `backend/tests/test_auth_and_pr.py` (7/7 green) — covers cookie attributes, cookie persistence across `/me /rides /segments /stats`, 401 message wording, logout, PR shape, PR populated after a ride upload, and MIN(elapsed_s) tie-break.

## Backlog / Future
- ⚠️ Legacy `backend/tests/backend_test.py` (27 tests) hasn't been migrated to a logged-in session — they assert 200 on auth-protected routes and now fail with 401. Action: add a shared `_login_session()` fixture (pattern in `test_auth_and_pr.py`) and update each test to login first.
- Filter / search Activities by date range / year / sub-sport / bike (P2).
- First-launch welcome overlay explaining data folder + backup configuration (P2, suggested).
- Year-over-year overlay on cumulative dashboard charts.
- Export individual ride as GPX.

## Files of reference
- `/app/backend/cst/db.py`, `routes.py`, `detector.py`, `parsers.py`, `deps.py`, `auth.py`, `auth_routes.py`
- `/app/backend/server.py`
- `/app/frontend/src/lib/api.js`, `migrate.js`, `auth.jsx`
- `/app/frontend/src/pages/Preferences.jsx` (migration section), `Segments.jsx`, `LoginPage.jsx`
