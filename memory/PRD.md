# Cycling Segment Tracker 2 — PRD

## Original Problem Statement
A personal, single-user cycling analysis web app. Upload GPX segments and GPX/FIT rides, detect segment efforts within 30m of start/end, calculate metrics (time, avg power, avg HR), show year-grouped leaderboards per segment. Data stored locally. UI inspired by Strava / Garmin Connect.

## User Choices
- Storage: **IndexedDB (browser-local, database `cst2`)** — migrated from MongoDB Feb 2026
- Maps: Leaflet + OpenStreetMap (CartoDB Dark Matter / Light / OSM / OpenTopo tiles)
- Auth: None (single-user, single-device)
- Detection tolerance: hardcoded 30m
- Backup: one-click JSON export + restore
- Offline: Service Worker caches app shell + previously-viewed map tiles

## Architecture
- **Runtime**: 100% client-side. Static build served by `python3 -m http.server 8000` on Mac.
- **Frontend**: React 19 + Tailwind + react-leaflet + recharts + sonner + idb + fit-file-parser
- **Legacy (dormant fallback)**: FastAPI + MongoDB backend still present at `/app/backend/` but not used by the app
- **Local stores** (IndexedDB `cst2`): `segments`, `rides`, `efforts`, `meta`
- **Local public API** (`src/lib/api.js`): same signatures as old HTTP endpoints so pages are untouched
  - `listSegments`, `getSegment`, `uploadSegment`, `deleteSegment`, `renameSegment`
  - `listRides`, `getRide`, `uploadRide`, `deleteRide`, `renameRide`
  - `listEfforts`, `getStats`, `downloadBackup`, `restoreBackup`

## User Persona
Single cyclist who wants Strava-like segment analytics kept 100% locally on their Mac — offline-capable, long-term personal use.

## What's Implemented
### Feb 2026 (earlier)
- GPX segment upload, list, delete, dedup by content hash
- GPX + FIT ride upload, list sorted by date, dedup, delete
- Segment detection (30m haversine, direction-aware via time ordering)
- Effort metrics: elapsed_s, avg_power, avg_hr, datetime_utc
- Year-grouped leaderboards per segment with best effort highlight
- Map view (CartoDB Dark Matter / Light / OSM / OpenTopo), elevation profile (recharts)
- JSON backup / restore
- Dashboard with stats + recent rides/segments
- Search on segments & rides lists
- Inline rename of rides/segments
- Auto-naming rides via OSM Nominatim reverse geocoding ("Suburb Ride")
- Light/dark theme, map style picker persisted in localStorage

### Feb 2026 — Local-first migration
- Replaced FastAPI + MongoDB data layer with IndexedDB (via `idb`)
- Ported GPX parser to browser DOMParser (`src/lib/parsers.js`)
- Replaced Python `fitparse` with `fit-file-parser` npm package
- 1:1 JS port of haversine-based effort detector (`src/lib/detector.js`)
- SHA-256 dedup hashes via `crypto.subtle`
- Reverse geocoding moved client-side with graceful offline fallback
- Service worker (`public/sw.js`) caches app shell + map tiles for offline use
- Production build (`yarn build`, `PUBLIC_URL=.`) is a single self-contained folder
- Added `/app/README-mac.md` with Mac usage instructions
- Backup page copy updated: MongoDB → IndexedDB

## Backlog / Future
### P1
- Highlight best effort per segment across ALL years (currently best-effort is per year)
- Filter rides by date range / year

### P2
- Export individual ride as GPX
- Import from Strava API
- Optional PWA install prompt
- Pre-cache tiles for a defined area ahead of a trip (offline ride prep)

## Files of Reference
- `/app/frontend/src/lib/api.js` — unified local API (replaces former axios layer)
- `/app/frontend/src/lib/localdb.js` — IndexedDB wrapper via `idb`
- `/app/frontend/src/lib/parsers.js` — GPX + FIT parsers (browser)
- `/app/frontend/src/lib/detector.js` — haversine, decimation, effort detection, hashing
- `/app/frontend/src/lib/geocode.js` — Nominatim reverse geocode (offline-safe)
- `/app/frontend/public/sw.js` — Service worker for offline tile + app shell caching
- `/app/frontend/src/pages/*` — unchanged, call `lib/api.js` which now runs locally
- `/app/backend/server.py` — legacy FastAPI backend (dormant, not used)
- `/app/README-mac.md` — Mac-specific build & run instructions

## Testing status
- Smoke test via Playwright (Feb 2026): upload GPX segment + GPX ride, verify effort auto-detected (1 segment / 1 ride / 1 effort), reload persists stats, leaderboard renders best effort, Nominatim reverse-geocoded name "Fremont Ride" applied.
- Production build verified via `python3 -m http.server`: index.html 200, sw.js 200, main.js 200, relative asset paths.
