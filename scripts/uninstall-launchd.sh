#!/usr/bin/env bash
# Remove the launchd plist installed by install-launchd.sh.
set -euo pipefail
LABEL="com.local.cyclingtracker"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
if [ -f "$PLIST" ]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "==> Removed ${LABEL}"
else
    echo "Nothing to do — ${PLIST} not present."
fi
