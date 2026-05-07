# Cycling Segment Tracker 2 — Running Locally on macOS

This is now a **single-user, local-first, fully offline-capable** web app. Once built, everything runs entirely in your browser — no backend, no MongoDB, no internet required after first load.

## One-time setup

```bash
cd /path/to/project/frontend
yarn install                  # only needed the first time
PUBLIC_URL=. yarn build       # produces ./build/
```

The `build/` folder is fully self-contained. Copy it anywhere you like (e.g. `~/Applications/cycling-tracker`).

## Run it

```bash
cd build
python3 -m http.server 8000
```

Then open **http://localhost:8000** in Chrome, Safari, Firefox or Edge.

> macOS tip: to keep the server running in the background, append `&` and visit the URL from any terminal; `pkill -f "http.server 8000"` to stop it.

## Where is my data stored?

- **Rides, segments, detected efforts** → your browser's IndexedDB, database name `cst2`.
- **Preferences (theme, map style)** → your browser's `localStorage` (keys `cst-theme`, `cst-map-style`).

Both are persistent across browser restarts, Mac reboots, and software updates. They are scoped to the browser profile that created them — if you switch browsers or use an incognito/private window you will see a fresh, empty database.

## Backing up (**do this regularly**)

The first time you click **Save Backup**, the browser asks you to pick a folder (e.g. `~/Documents/CyclingTracker`). The app remembers your choice and creates a `Backup/` subfolder inside it. Every subsequent export drops a timestamped JSON file in there — no folder picker, no Downloads dialog.

To restore:

1. Open the app → **Backup** tab.
2. Click **Browse Backup folder** — the app reads the `Backup/` subfolder of your chosen directory and shows every snapshot, newest first.
3. Click the snapshot you want; confirm; done.

> Browser support: the folder flow uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) which works in **Chrome, Edge, Brave, Arc** on macOS. **Safari and Firefox** fall back automatically — `Save Backup` triggers a normal download into `~/Downloads`, and `Restore` opens a single-file picker.

> Permissions: each browser session you open the app, the first export/restore re-prompts for folder access — this is enforced by the browser's security model and cannot be skipped. Click **Allow** once and the rest of the session is silent.

> Recommended folder: pick something inside iCloud Drive / Dropbox / Time-Machine-protected `~/Documents` so backups are also off-device.

## Offline behaviour

- The **app itself** (UI, parsers, segment detection) works fully offline thanks to a Service Worker that caches `index.html`, JS, CSS, and Google Fonts after the first successful load.
- **Map tiles** (OSM / CartoDB / OpenTopoMap) are cached per-tile as you pan/zoom. Areas you've previously viewed continue to render while offline; unexplored areas show grey.
- **Reverse-geocoded ride names** ("Fremont Ride") require the Nominatim public API. Offline, rides are named after their filename instead — no effect on data integrity.

## Upgrading or wiping data

- **Upgrading the app**: run `yarn build` again and replace the old `build/` contents. Your IndexedDB data is untouched — it's owned by the browser, not the build folder.
- **Full reset**: Chrome → DevTools → Application → IndexedDB → `cst2` → Delete. Or export a backup first, wipe, then restore.

## Known offline caveats

- `index.html` loads the Emergent badge script and PostHog analytics from CDNs. These calls **fail silently** when offline and do not affect the app. Remove them by editing `build/index.html` if you prefer a 100% offline-pure experience.
- IndexedDB can be wiped if you "Clear browsing data → Site data" for `localhost`. Regular JSON backups cover this.

## The old FastAPI + MongoDB backend

The legacy backend in `/app/backend/` is kept as a **dormant fallback**. It is not required and is not started by `python3 -m http.server`. If you ever want to run it again (e.g. for multi-device access), install Python deps in `backend/requirements.txt` and MongoDB, then `uvicorn server:app --port 8001`. The frontend would need `REACT_APP_BACKEND_URL` set and `src/lib/api.js` re-pointed at HTTP — it's currently 100% local.
