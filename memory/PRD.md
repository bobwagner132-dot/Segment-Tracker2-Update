# Cycling Segment Tracker 2 — PRD

## Original Problem Statement
A personal, single-user cycling analysis web app. Upload GPX segments and GPX/FIT rides, detect segment efforts within 30m of start/end, calculate metrics (time, avg power, avg HR), show year-grouped leaderboards per segment. Data stored locally (MongoDB backend). UI inspired by Strava / Garmin Connect.

## User Choices
- Storage: MongoDB backend
- Maps: Leaflet + OpenStreetMap (CartoDB Dark Matter tiles)
- Auth: None (single-user)
- Detection tolerance: hardcoded 30m
- Backup: one-click JSON export + restore

## Architecture
- Backend: FastAPI + Motor (MongoDB), gpxpy, fitparse
- Frontend: React 19 + Tailwind + react-leaflet + recharts + sonner
- Collections: `segments`, `rides`, `efforts`
- Routes: `/api/segments`, `/api/rides`, `/api/segments/{id}/efforts`, `/api/backup`, `/api/restore`, `/api/stats`

## User Persona
Single cyclist who wants Strava-like segment analytics kept 100% locally.

## What's Implemented (Feb 2026)
- GPX segment upload, list, delete, dedup by content hash
- GPX + FIT ride upload, list sorted by date, dedup, delete
- Segment detection (30m haversine, direction-aware via time ordering)
- Effort metrics: elapsed_s, avg_power, avg_hr, datetime_utc
- Year-grouped leaderboards per segment with best effort highlight
- Map view (CartoDB Dark Matter), elevation profile (recharts)
- JSON backup / restore
- Dashboard with stats + recent rides/segments
- Search on segments & rides lists
- Dark tactical UI (Barlow Condensed + Manrope) per design_guidelines.json

## Backlog (P1)
- Overlay detected segment portion on ride map
- Filter rides by date range
- Rename segments/rides inline
- Highlight segment start/end markers on ride map when an effort is selected

## P2
- Multi-effort overlap detection (reverse passes)
- Smoothing for low-quality GPS tracks
- Speed/VAM derived metrics
- Mobile PWA install
