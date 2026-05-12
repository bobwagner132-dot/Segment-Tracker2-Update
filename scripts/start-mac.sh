#!/usr/bin/env bash
# Cycling Segment Tracker 2 — local launcher for macOS.
#
# What this does:
#   * Sets the data directory to ~/Documents/CyclingTracker/data.nosync/
#     so SQLite + uploads live somewhere visible to Finder/Time Machine,
#     while the `.nosync` suffix tells iCloud Drive to leave the live DB alone.
#   * Activates (or creates) a Python virtualenv at .venv and installs
#     requirements.txt the first time.
#   * Builds the React frontend the first time (or whenever build/ is missing).
#   * Starts the FastAPI server on the configured port and opens your browser.
#
# Quit with Ctrl-C in this terminal. Re-run any time.
#
# Optional environment overrides:
#   CST_PORT           default 8765
#   CST_HOST           default 127.0.0.1 (use 0.0.0.0 to expose on LAN)
#   CST_DATA_DIR       default ~/Documents/CyclingTracker/data.nosync
#   CST_OPEN_BROWSER   set to "0" to skip auto-opening Safari/Chrome

set -euo pipefail

# Resolve the repo root regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

PORT="${CST_PORT:-8765}"
HOST="${CST_HOST:-127.0.0.1}"
DATA_DIR_DEFAULT="$HOME/Documents/CyclingTracker/data.nosync"
export CST_DATA_DIR="${CST_DATA_DIR:-$DATA_DIR_DEFAULT}"

# ---- Per-Mac server.env (auth secret + admin seed wiping) ----
# A repo .env may carry dev placeholder secrets and an auto-seeded admin
# account. Neither belongs on a real install. We generate a strong JWT secret
# the first time we run, store it INSIDE the data folder (which lives under
# the user's home, NOT in the repo, so a git pull never overwrites it), and
# load it via an env-file override.
SERVER_ENV="$CST_DATA_DIR/server.env"
mkdir -p "$CST_DATA_DIR"
if [ ! -f "$SERVER_ENV" ]; then
    NEW_SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(48))")
    cat > "$SERVER_ENV" <<ENV
# Auto-generated on first launch — do not commit, do not share.
JWT_SECRET=$NEW_SECRET
ENV
    chmod 600 "$SERVER_ENV"
    echo "==> Generated fresh JWT_SECRET at $SERVER_ENV"
fi
set -a
# shellcheck disable=SC1090
source "$SERVER_ENV"
set +a
# Belt-and-braces: make sure no leftover dev seed credentials leak in.
unset ADMIN_EMAIL ADMIN_PASSWORD

echo "==> Cycling Segment Tracker 2"
echo "    Data dir : $CST_DATA_DIR"
echo "    Host:Port: $HOST:$PORT"
echo

# ---- Python virtualenv ----
PYTHON_BIN=""
for cand in python3.12 python3.11 python3.10 python3; do
    if command -v "$cand" >/dev/null 2>&1; then
        PYTHON_BIN="$cand"
        break
    fi
done
if [ -z "$PYTHON_BIN" ]; then
    echo "Error: Python 3.10+ not found. Install via 'brew install python@3.11'." >&2
    exit 1
fi

if [ ! -d ".venv" ]; then
    echo "==> First run — creating virtualenv with $PYTHON_BIN"
    "$PYTHON_BIN" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

# Upgrade pip quietly and install/update deps if requirements changed.
HASH_FILE=".venv/.requirements.sha"
NEW_HASH=$(shasum backend/requirements.txt | awk '{print $1}')
if [ ! -f "$HASH_FILE" ] || [ "$(cat "$HASH_FILE")" != "$NEW_HASH" ]; then
    echo "==> Installing Python dependencies"
    pip install --upgrade pip >/dev/null
    pip install -r backend/requirements.txt
    echo "$NEW_HASH" > "$HASH_FILE"
fi

# ---- Frontend build ----
if [ ! -f "frontend/build/index.html" ]; then
    echo "==> Building React frontend (first run only — takes ~1 min)"
    if ! command -v yarn >/dev/null 2>&1; then
        echo "Error: yarn not found. Install via 'brew install yarn' or 'npm i -g yarn'." >&2
        exit 1
    fi
    pushd frontend >/dev/null
    yarn install --frozen-lockfile
    # Make the frontend talk to the same host:port (single-process Mac install).
    REACT_APP_BACKEND_URL="" yarn build
    popd >/dev/null
fi

# Ensure the data directory exists and is .nosync-tagged on macOS so iCloud
# never touches the live DB file.
mkdir -p "$CST_DATA_DIR"

# ---- Open the browser shortly after the server starts ----
if [ "${CST_OPEN_BROWSER:-1}" = "1" ]; then
    (
        sleep 1.5
        open "http://${HOST}:${PORT}" || true
    ) &
fi

# ---- Run uvicorn ----
echo "==> Server starting at http://${HOST}:${PORT}"
echo "    (Ctrl-C to stop)"
exec python -m uvicorn backend.server:app \
    --host "$HOST" --port "$PORT" --app-dir .
