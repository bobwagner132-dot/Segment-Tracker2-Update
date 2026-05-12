#!/usr/bin/env bash
# Generate a native macOS .app bundle that launches Cycling Segment Tracker 2
# with a double-click. By default the bundle is installed to ~/Applications
# AND a copy is placed on the Desktop. Re-run any time to refresh.
#
# Usage:
#     bash scripts/install-app-icon.sh           # default install
#     CST_INSTALL_DESKTOP=0 bash …               # skip Desktop copy
#     CST_INSTALL_APPS=0 bash …                  # skip ~/Applications
#     CST_APP_NAME="My Tracker" bash …           # custom name
#
# To uninstall:
#     rm -rf "~/Applications/CyclingTracker.app" "~/Desktop/CyclingTracker.app"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_NAME="${CST_APP_NAME:-CyclingTracker}"
APP_DISPLAY_NAME="${CST_APP_DISPLAY_NAME:-Cycling Tracker}"
BUNDLE_ID="${CST_BUNDLE_ID:-com.local.cyclingtracker}"
BUNDLE_VERSION="${CST_BUNDLE_VERSION:-2.0}"

STAGE="$ROOT/dist/${APP_NAME}.app"
rm -rf "$STAGE"
mkdir -p "$STAGE/Contents/MacOS" "$STAGE/Contents/Resources"

# ---- Info.plist ----
cat > "$STAGE/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>${APP_DISPLAY_NAME}</string>
    <key>CFBundleDisplayName</key><string>${APP_DISPLAY_NAME}</string>
    <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
    <key>CFBundleVersion</key><string>${BUNDLE_VERSION}</string>
    <key>CFBundleShortVersionString</key><string>${BUNDLE_VERSION}</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleSignature</key><string>????</string>
    <key>CFBundleExecutable</key><string>launcher</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>LSMinimumSystemVersion</key><string>10.15</string>
    <!-- A pure-CLI launcher; we don't want a Dock icon when minimised. -->
    <key>LSUIElement</key><false/>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF

# ---- Launcher binary (bash script) ----
cat > "$STAGE/Contents/MacOS/launcher" <<EOF
#!/usr/bin/env bash
# Generated launcher for ${APP_DISPLAY_NAME}.
# Resolves the repo path stored at bundle build-time, hands off to start-mac.sh
# inside a Terminal window so the user can see logs and Ctrl-C to quit.

REPO="${ROOT}"
LOG_DIR="\$HOME/Library/Logs/CyclingTracker"
mkdir -p "\$LOG_DIR"

# If a server is already listening on the configured port, just open the
# browser instead of starting a second instance.
PORT="\${CST_PORT:-8765}"
if curl -fs "http://127.0.0.1:\${PORT}/api/health" >/dev/null 2>&1; then
    open "http://127.0.0.1:\${PORT}"
    exit 0
fi

# Otherwise spawn a visible Terminal window running the launcher script.
osascript <<APPLESCRIPT
tell application "Terminal"
    activate
    do script "cd \\"\${REPO}\\" && bash scripts/start-mac.sh"
end tell
APPLESCRIPT
EOF
chmod +x "$STAGE/Contents/MacOS/launcher"

# ---- Icon ----
# If the user dropped a custom icon at scripts/icon.png (1024×1024 PNG),
# convert it to .icns. Otherwise generate a simple placeholder.
ICON_PNG="$ROOT/scripts/icon.png"
ICON_ICNS="$STAGE/Contents/Resources/AppIcon.icns"

if [ -f "$ICON_PNG" ] && command -v iconutil >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
    echo "==> Building AppIcon.icns from $ICON_PNG"
    ICONSET="$(mktemp -d)/AppIcon.iconset"
    mkdir -p "$ICONSET"
    for SIZE in 16 32 64 128 256 512 1024; do
        sips -z "$SIZE" "$SIZE" "$ICON_PNG" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
        HALF=$((SIZE / 2))
        if [ "$HALF" -ge 16 ]; then
            cp "$ICONSET/icon_${SIZE}x${SIZE}.png" "$ICONSET/icon_${HALF}x${HALF}@2x.png"
        fi
    done
    iconutil -c icns "$ICONSET" -o "$ICON_ICNS" >/dev/null
else
    # No custom icon supplied — bundle without one. macOS shows the default
    # app silhouette. To add a custom icon later: drop a 1024x1024 PNG at
    # scripts/icon.png and re-run this script.
    rm -f "$ICON_ICNS"
fi

# ---- Install ----
INSTALLS=()
if [ "${CST_INSTALL_APPS:-1}" = "1" ]; then
    mkdir -p "$HOME/Applications"
    rsync -a --delete "$STAGE/" "$HOME/Applications/${APP_NAME}.app/"
    INSTALLS+=("$HOME/Applications/${APP_NAME}.app")
fi
if [ "${CST_INSTALL_DESKTOP:-1}" = "1" ]; then
    rsync -a --delete "$STAGE/" "$HOME/Desktop/${APP_NAME}.app/"
    INSTALLS+=("$HOME/Desktop/${APP_NAME}.app")
fi

echo
echo "==> Installed:"
for p in "${INSTALLS[@]}"; do
    echo "    $p"
done
echo
echo "Double-click the icon to launch. A Terminal window will open showing the"
echo "server log; close it (or Ctrl-C) to stop the app. Visit the browser tab"
echo "that opens automatically at http://127.0.0.1:8765."
echo
echo "First launch from Finder may show 'cannot be opened because Apple cannot"
echo "check it for malicious software'. Right-click the icon → Open → Open."
echo "macOS remembers your choice from then on."
