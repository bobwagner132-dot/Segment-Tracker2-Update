# Deploying Cycling Segment Tracker 2 on macOS 10.15 (Catalina)

> A complete, single-user, self-hosted install. All data lives on **your** Mac.
> The server is a tiny Python (FastAPI) process; the UI is a static React bundle
> served from the same process; the database is one SQLite file.

---

## TL;DR — six commands

```bash
git clone <your-private-repo>.git ~/Apps/CyclingTracker     # or copy the folder
cd ~/Apps/CyclingTracker
brew install python@3.11 yarn                                # one-time
bash scripts/start-mac.sh                                    # builds + runs (Ctrl-C to stop)
bash scripts/install-app-icon.sh                             # puts a double-clickable icon on your Desktop
bash scripts/install-launchd.sh                              # OPTIONAL — auto-start at every login
```

Double-click **CyclingTracker** on your Desktop. Done.

---

## 1 · System prerequisites

macOS 10.15 ships with no Python 3 by default. The cleanest install path is **Homebrew**.

| Component | Version | Where it comes from |
|---|---|---|
| Python    | **3.11** (3.10 also works) | `brew install python@3.11` |
| pip       | bundled with Python | `python3 -m ensurepip --upgrade` |
| Yarn      | any 1.x | `brew install yarn` (Node 18+ is pulled in automatically) |
| Git       | any | `xcode-select --install` (ships with the Xcode CLT) |

If you don't have Homebrew yet:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

> On Catalina the default shell is `zsh`; everything below is plain Bash and works in either.

---

## 2 · Get the code

```bash
mkdir -p ~/Apps && cd ~/Apps
git clone <your-private-repo>.git CyclingTracker
cd CyclingTracker
```

Or just copy the folder over from another machine — there are no external services or secrets.

---

## 3 · First run

```bash
bash scripts/start-mac.sh
```

The launcher takes care of everything:

1. Creates a virtualenv at `./.venv` and installs `backend/requirements-mac.txt` (a slim, Mac-tested subset of the deps — *not* the larger `requirements.txt`, which is the Emergent dev-container baseline and includes ~100 unused packages plus a few that have no pre-built wheels for macOS 10.15).
2. Runs `yarn install` and `yarn build` if `frontend/build/` is missing.
3. Ensures the data folder exists at `~/Documents/CyclingTracker/data.nosync/`.
4. Starts `uvicorn` at `http://127.0.0.1:8765`.
5. Opens your default browser to the app.

Re-runs are fast (≈ 2 seconds): nothing rebuilds unless dependencies change.

---

## 3a · Double-clickable Desktop icon (recommended)

After the first successful `start-mac.sh` run, build a real macOS `.app` bundle and drop it on your Desktop:

```bash
bash scripts/install-app-icon.sh
```

This creates `CyclingTracker.app` in **two** places by default:

- `~/Applications/CyclingTracker.app` — for Spotlight / Launchpad / Cmd-Space
- `~/Desktop/CyclingTracker.app` — for daily double-clicking

Double-click the icon → a Terminal window opens showing live server logs → your browser opens automatically at `http://localhost:8765`. Close the Terminal window (or Ctrl-C) to quit the server.

> **First launch — Gatekeeper notice.** macOS will say *"CyclingTracker can't be opened because Apple cannot check it for malicious software"* the very first time. Right-click the icon → **Open** → **Open**. macOS remembers your choice forever after.

> **Already running?** Double-clicking when the server is already up just opens a new browser tab — it won't start a second instance.

### Customising the icon
The bundle ships with a generated cyan-segment placeholder. To use your own:

```bash
# Drop a 1024×1024 PNG here, then rerun:
cp ~/Pictures/my-icon.png scripts/icon.png
bash scripts/install-app-icon.sh
```

The script uses macOS's built-in `iconutil` + `sips` to render every required size.

### Uninstall the icon

```bash
rm -rf ~/Applications/CyclingTracker.app ~/Desktop/CyclingTracker.app
```

Your data is untouched (it lives in `~/Documents/CyclingTracker/`).

---

## 4 · Where your data lives

```
~/Documents/CyclingTracker/
├── data.nosync/          ← LIVE DB + uploads (excluded from iCloud sync)
│   ├── database.sqlite
│   ├── database.sqlite-wal
│   └── uploads/
│       ├── fit/
│       └── gpx/
└── backups/              ← Scheduled & manual backups (synced by iCloud / Time Machine)
```

### Why `.nosync`?

Catalina's iCloud Drive sync will happily upload partial-page writes from a hot SQLite file, leading to silent corruption. The `.nosync` suffix is a magic marker macOS uses to skip a folder. The live database is therefore **never** synced to iCloud — but the backup ZIPs in `backups/` **are**, giving you a durable, off-device copy you can recover from.

### Want to move the data folder?

Edit `scripts/start-mac.sh` and change `CST_DATA_DIR`, **or** run with an override:

```bash
CST_DATA_DIR=/Volumes/MyExternalSSD/CyclingTracker bash scripts/start-mac.sh
```

---

## 5 · Auto-start on every login

```bash
bash scripts/install-launchd.sh
```

This writes a `LaunchAgent` plist to `~/Library/LaunchAgents/com.local.cyclingtracker.plist`, loads it, and registers `KeepAlive` so the service self-recovers if it crashes. Logs go to `~/Library/Logs/CyclingTracker/`.

Stop and remove anytime:

```bash
bash scripts/uninstall-launchd.sh
```

---

## 5a · First-run account setup

The **first time** you open the app in any browser, the SPA shows a one-time **Create your admin account** screen. Enter the email + password you want; they're bcrypt-hashed and stored locally. All existing rides, segments and bikes (if you migrated from the IndexedDB build) become owned by that account automatically.

After that, every visit goes straight to a regular **Sign in** screen.

> The dev container ships with pre-seeded test credentials in `backend/.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`). On the Mac install those vars aren't set, so the first-run wizard is what you see.

### Add more accounts later

Sign in as the admin → **Admin → Users → + Invite user** → set their email + password (and tick **Admin** if they should be able to manage other users). The new account can then sign in from any device on the LAN.

### Forgot a password?

As admin, **Admin → Users → Reset password** for any account (including your own — useful if you locked yourself out and have another admin signed in).

If you lock the *only* admin out, drop to Terminal:

```bash
python3 -c "
import sqlite3
db = '~/Documents/CyclingTracker/data.nosync/database.sqlite'
import os; db = os.path.expanduser(db)
c = sqlite3.connect(db)
c.execute('UPDATE users SET password_hash = NULL WHERE id = 1')
c.commit(); c.close()
print('Done. Reload the app — first-run wizard will reappear.')"
```

### Security note

5 failed login attempts on any account triggers a **15-minute lockout** on that account. The lockout is per-email, not per-IP, so it doesn't accidentally lock out other users on the same LAN.

---

## 6 · Accessing the app from your phone / iPad / another Mac

By default the server binds to `127.0.0.1` and is only reachable from the same Mac. To open it to your home Wi-Fi:

```bash
CST_HOST=0.0.0.0 bash scripts/start-mac.sh
```

Find your Mac's local IP:

```bash
ipconfig getifaddr en0     # Wi-Fi
ipconfig getifaddr en1     # Ethernet
```

Then on the other device visit `http://<that-ip>:8765`.

> **Note on Catalina firewall:** the first time you bind to `0.0.0.0` macOS may prompt "Allow incoming connections to python". Click Allow once.

> **Note on security:** there is no login screen yet (single-user mode). Don't expose the port to the public internet without an authenticating reverse-proxy.

---

## 7 · Backups

### Automatic
The Admin tab in the UI shows the current schedule. By default a ZIP backup of `database.sqlite` + (optionally) uploads is created every **24 hours**, the latest **14** are kept, and they land in `~/Documents/CyclingTracker/backups/`. iCloud will pick those up automatically if Documents sync is enabled.

### Manual
- **Admin → Backup now** writes a ZIP immediately.
- **Admin → Download as ZIP** streams a fresh ZIP to your browser.
- **Admin → Restore from upload** accepts any previously-downloaded ZIP and atomically replaces the live database (uploads are merged in).
- **Admin → Restore** (per row) restores from a ZIP already present in the configured backup folder.

### Anywhere else?
Set the **Target folder** in Admin to an external drive path, a Dropbox folder, an iCloud Drive sub-path — anything macOS can write to.

---

## 8 · Persistent storage across updates

The `data.nosync/` folder lives in `~/Documents`, **outside** the application directory. Updating the app — git-pulling new code, `yarn build`-ing again, even copying a fresh repo over the old one — never touches your data.

The launcher detects requirements / dependency changes and only reinstalls when needed (it caches a SHA of `requirements.txt`). The database has a built-in schema versioning hook (`init_db`) that runs migrations idempotently.

If you ever need to start fresh: `rm -rf ~/Documents/CyclingTracker/data.nosync` and re-launch.

---

## 9 · Migrating from the previous browser-only build

If you were using the IndexedDB-based version of this app, your existing data still lives in your browser. To pull it into the new SQLite store:

1. Launch the new app and open it in the **same browser** you used before.
2. Go to **Settings → Migrate from browser storage**.
3. Click **Scan browser** to confirm counts, then **Migrate now**.

The migration is idempotent: if you re-run it after adding more rides on the new server, you'll overwrite the new data with the old browser snapshot. Use **Admin → Backup now** before re-running if you're unsure.

---

## 10 · Troubleshooting

| Symptom | Fix |
|---|---|
| Browser shows "This site can't be reached" | `tail -f ~/Library/Logs/CyclingTracker/server.log` — server probably failed to start. |
| Port already in use | Another process owns `8765`. Set `CST_PORT=8770` and re-launch. |
| "yarn: command not found" | `brew install yarn`. |
| Catalina says python is unsafe | First-time Gatekeeper prompt — System Preferences → Security & Privacy → Allow. |
| Database is locked | Two server instances are running on the same data dir. Kill the older one (`launchctl unload …` and/or quit duplicate terminals). |
| Want to wipe everything | `bash scripts/uninstall-launchd.sh && rm -rf ~/Documents/CyclingTracker/data.nosync` |

---

## 11 · Quick file-layout reference

```
~/Apps/CyclingTracker/
├── backend/
│   ├── server.py                  # FastAPI app + SPA fallback
│   ├── requirements.txt
│   ├── .env                       # (not really needed on Mac; CST_DATA_DIR comes from the launcher)
│   └── cst/                       # routes, db, parsers, detector, scheduler
├── frontend/
│   ├── build/                     # built by the launcher
│   ├── src/                       # React source
│   └── package.json
├── scripts/
│   ├── start-mac.sh             # double-click-friendly launcher
│   ├── install-app-icon.sh      # generates CyclingTracker.app + Desktop icon
│   ├── install-launchd.sh       # auto-start at login
│   ├── uninstall-launchd.sh
│   ├── make_icon.py             # regenerate placeholder icon.png
│   └── icon.png                 # 1024×1024 source for the .app icon
└── docs/
    └── DEPLOYMENT-macOS-10.15.md  # ← you are here
```

---

## Optional next steps

- **HTTPS on the LAN:** put `caddy` or `nginx` in front of `127.0.0.1:8765` with a self-signed cert.
- **Remote access:** Tailscale will let your phone reach the Mac from anywhere with zero port forwarding.
- **Multi-user:** when you're ready, flip on the auth flag (Pass-4 work) — the schema already carries `user_id` everywhere, so adding accounts is purely additive.
