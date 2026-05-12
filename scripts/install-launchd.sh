#!/usr/bin/env bash
# Register Cycling Segment Tracker 2 with launchd so it starts at login
# (and restarts automatically if it crashes).
#
# Run from anywhere:
#     bash scripts/install-launchd.sh
#
# To remove it later: bash scripts/uninstall-launchd.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LABEL="com.local.cyclingtracker"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/CyclingTracker"
mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${LABEL}</string>
    <key>WorkingDirectory</key><string>${ROOT}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${ROOT}/scripts/start-mac.sh</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>CST_OPEN_BROWSER</key><string>0</string>
        <key>CST_HOST</key><string>${CST_HOST:-127.0.0.1}</string>
        <key>CST_PORT</key><string>${CST_PORT:-8765}</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key><false/>
    </dict>
    <key>StandardOutPath</key><string>${LOG_DIR}/server.log</string>
    <key>StandardErrorPath</key><string>${LOG_DIR}/server.err.log</string>
</dict>
</plist>
EOF

echo "==> Wrote ${PLIST}"

# Reload if already loaded
if launchctl list | grep -q "${LABEL}"; then
    launchctl unload "${PLIST}" 2>/dev/null || true
fi
launchctl load "${PLIST}"
echo "==> Loaded ${LABEL} — service will start at every login."
echo "    Logs: ${LOG_DIR}"
echo "    URL : http://${CST_HOST:-127.0.0.1}:${CST_PORT:-8765}"
