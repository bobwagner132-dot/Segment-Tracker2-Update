// Local-first data layer for Cycling Segment Tracker 2.
// All former HTTP endpoints (FastAPI /api/...) are now implemented directly
// against IndexedDB via ./localdb, preserving the exact function signatures
// used by every page so the UI layer is unchanged.

import { parseGpx, parseFit } from "./parsers";
import {
  DETECTION_RADIUS_M,
  MAX_DISPLAY_POINTS,
  decimate,
  detectEfforts,
  elevationGainM,
  elevationLossM,
  hashRide,
  hashSegment,
  totalDistanceM,
} from "./detector";
import {
  bulkInsert,
  clearAll,
  count,
  deleteEffortsBy,
  findByIndex,
  findOneByIndex,
  getAll,
  getMeta,
  getOne,
  put,
  remove,
  setMeta,
  updateEffortsRideName,
} from "./localdb";
import { reverseGeocode } from "./geocode";

// Re-exported for parity / external use
export { DETECTION_RADIUS_M, MAX_DISPLAY_POINTS };

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Fallback — shouldn't be hit in any modern browser
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.readAsText(file);
  });
}

async function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.readAsArrayBuffer(file);
  });
}

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ApiError";
    // Shape matches axios errors so existing `e?.response?.data?.detail` paths keep working
    this.response = { data: { detail: message }, status };
  }
}

// ---------- Segments ----------
export async function listSegments() {
  const segs = await getAll("segments");
  segs.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return segs.map((s) => ({
    id: s.id,
    name: s.name,
    distance_m: s.distance_m,
    elevation_gain_m: s.elevation_gain_m,
    created_at: s.created_at,
    point_count: s.points.length,
  }));
}

export async function getSegment(id) {
  const s = await getOne("segments", id);
  if (!s) throw new ApiError("Segment not found", 404);
  return {
    id: s.id,
    name: s.name,
    distance_m: s.distance_m,
    elevation_gain_m: s.elevation_gain_m,
    created_at: s.created_at,
    point_count: s.points.length,
    points: decimate(s.points),
  };
}

export async function uploadSegment(file) {
  const fname = (file.name || "").toLowerCase();
  if (!fname.endsWith(".gpx")) throw new ApiError("Segment must be a GPX file");
  let parsed;
  try {
    const text = await readFileAsText(file);
    parsed = parseGpx(text);
  } catch (e) {
    throw new ApiError(`GPX parse error: ${e.message || e}`);
  }
  if (parsed.points.length < 2) throw new ApiError("Segment has too few points");

  const h = await hashSegment(parsed.points);
  const existing = await findOneByIndex("segments", "hash", h);
  if (existing) throw new ApiError("Duplicate segment", 409);

  const id = uuid();
  const doc = {
    id,
    name: parsed.name || file.name.replace(/\.gpx$/i, ""),
    hash: h,
    points: parsed.points,
    distance_m: Math.round(totalDistanceM(parsed.points) * 10) / 10,
    elevation_gain_m: Math.round(elevationGainM(parsed.points) * 10) / 10,
    created_at: new Date().toISOString(),
  };
  await put("segments", doc);

  // Detect this new segment against every existing ride
  const rides = await getAll("rides");
  for (const r of rides) {
    const newEfforts = detectEfforts(r.points, doc);
    for (const eff of newEfforts) {
      await put("efforts", {
        id: uuid(),
        segment_id: id,
        ride_id: r.id,
        ride_name: r.name,
        elapsed_s: eff.elapsed_s,
        avg_power: eff.avg_power,
        avg_hr: eff.avg_hr,
        datetime_utc: eff.datetime_utc,
        start_idx: eff.start_idx,
        end_idx: eff.end_idx,
      });
    }
  }

  return {
    id,
    name: doc.name,
    distance_m: doc.distance_m,
    elevation_gain_m: doc.elevation_gain_m,
    created_at: doc.created_at,
    point_count: doc.points.length,
    points: decimate(doc.points),
  };
}

export async function deleteSegment(id) {
  const existing = await getOne("segments", id);
  if (!existing) throw new ApiError("Segment not found", 404);
  await remove("segments", id);
  await deleteEffortsBy("segment_id", id);
  return { ok: true };
}

export async function renameSegment(id, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new ApiError("Name cannot be empty");
  const s = await getOne("segments", id);
  if (!s) throw new ApiError("Segment not found", 404);
  s.name = trimmed;
  await put("segments", s);
  return { ok: true, name: trimmed };
}

// ---------- Bike registry (user-managed) ----------
// Persisted in the IndexedDB `meta` store:
//   bike_names    : array of unique bike names (insertion-ordered, most-recent first)
//   default_bike  : string — bike to assign to new activities that don't carry one
const BIKE_LIST_KEY = "bike_names";
const DEFAULT_BIKE_KEY = "default_bike";

export async function listBikes() {
  const list = (await getMeta(BIKE_LIST_KEY)) || [];
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

export async function getDefaultBike() {
  const v = await getMeta(DEFAULT_BIKE_KEY);
  return v || null;
}

export async function setDefaultBike(name) {
  if (!name) {
    await setMeta(DEFAULT_BIKE_KEY, null);
    return null;
  }
  const trimmed = String(name).trim();
  await setMeta(DEFAULT_BIKE_KEY, trimmed);
  return trimmed;
}

// Add (or move-to-front) a bike in the registry, and adopt it as the default.
export async function addBike(name) {
  const trimmed = (name || "").toString().trim();
  if (!trimmed) return null;
  const existing = await listBikes();
  const filtered = existing.filter(
    (b) => b.toLowerCase() !== trimmed.toLowerCase()
  );
  filtered.unshift(trimmed);
  // De-dup case-insensitive while preserving the user's original casing
  await setMeta(BIKE_LIST_KEY, filtered);
  await setMeta(DEFAULT_BIKE_KEY, trimmed);
  return trimmed;
}

export async function removeBike(name) {
  const trimmed = (name || "").toString().trim();
  const list = await listBikes();
  const next = list.filter((b) => b.toLowerCase() !== trimmed.toLowerCase());
  await setMeta(BIKE_LIST_KEY, next);
  const def = await getDefaultBike();
  if (def && def.toLowerCase() === trimmed.toLowerCase()) {
    await setMeta(DEFAULT_BIKE_KEY, next[0] || null);
  }
  return next;
}

// Helper to build the FIT-extra metadata block returned by the API surface.
function rideMetadataView(r) {
  return {
    sport: r.sport ?? null,
    sub_sport: r.sub_sport ?? null,
    device: r.device ?? null,
    bike_name: r.bike_name ?? null,
    moving_time_s: r.moving_time_s ?? null,
    avg_speed_mps: r.avg_speed_mps ?? null,
    max_speed_mps: r.max_speed_mps ?? null,
    avg_heart_rate: r.avg_heart_rate ?? null,
    max_heart_rate: r.max_heart_rate ?? null,
    avg_cadence: r.avg_cadence ?? null,
    max_cadence: r.max_cadence ?? null,
    avg_power: r.avg_power ?? null,
    max_power: r.max_power ?? null,
    normalized_power: r.normalized_power ?? null,
    total_calories: r.total_calories ?? null,
    total_ascent_m: r.total_ascent_m ?? r.elevation_gain_m ?? null,
    total_descent_m: r.total_descent_m ?? r.elevation_loss_m ?? null,
    avg_temperature: r.avg_temperature ?? null,
    max_temperature: r.max_temperature ?? null,
    min_temperature: r.min_temperature ?? null,
  };
}

// ---------- Rides ----------
export async function listRides() {
  const [rides, efforts] = await Promise.all([getAll("rides"), getAll("efforts")]);
  const counts = {};
  for (const e of efforts) counts[e.ride_id] = (counts[e.ride_id] || 0) + 1;
  rides.sort(
    (a, b) =>
      (b.start_time || b.created_at || "").localeCompare(a.start_time || a.created_at || "")
  );
  return rides.map((r) => ({
    id: r.id,
    name: r.name,
    source_type: r.source_type,
    start_time: r.start_time || null,
    duration_s: r.duration_s || 0,
    distance_m: r.distance_m || 0,
    elevation_gain_m:
      r.elevation_gain_m != null
        ? r.elevation_gain_m
        : Math.round(elevationGainM(r.points) * 10) / 10,
    point_count: r.points.length,
    created_at: r.created_at,
    effort_count: counts[r.id] || 0,
    ...rideMetadataView(r),
  }));
}

export async function getRide(id) {
  const r = await getOne("rides", id);
  if (!r) throw new ApiError("Ride not found", 404);
  const efforts = await findByIndex("efforts", "ride_id", id);
  const pts = r.points;
  const segCache = {};
  for (const e of efforts) {
    if (
      Number.isInteger(e.start_idx) &&
      Number.isInteger(e.end_idx) &&
      e.start_idx >= 0 &&
      e.start_idx <= e.end_idx &&
      e.end_idx < pts.length
    ) {
      e.points = decimate(pts.slice(e.start_idx, e.end_idx + 1), 500);
    }
    if (e.segment_id) {
      if (!(e.segment_id in segCache)) {
        const seg = await getOne("segments", e.segment_id);
        segCache[e.segment_id] = seg ? seg.name : "Unknown segment";
      }
      e.segment_name = segCache[e.segment_id];
    }
  }
  return {
    id: r.id,
    name: r.name,
    source_type: r.source_type,
    start_time: r.start_time || null,
    duration_s: r.duration_s || 0,
    distance_m: r.distance_m || 0,
    elevation_gain_m:
      r.elevation_gain_m != null
        ? r.elevation_gain_m
        : Math.round(elevationGainM(pts) * 10) / 10,
    point_count: pts.length,
    created_at: r.created_at,
    effort_count: efforts.length,
    points: decimate(pts),
    efforts,
    ...rideMetadataView(r),
  };
}

export async function uploadRide(file) {
  const fname = (file.name || "").toLowerCase();
  let parsed;
  let sourceType;
  if (fname.endsWith(".gpx")) {
    const text = await readFileAsText(file);
    try {
      parsed = parseGpx(text);
    } catch (e) {
      throw new ApiError(`GPX parse error: ${e.message || e}`);
    }
    sourceType = "gpx";
  } else if (fname.endsWith(".fit")) {
    const ab = await readFileAsArrayBuffer(file);
    try {
      parsed = await parseFit(ab);
    } catch (e) {
      throw new ApiError(`FIT parse error: ${e.message || e}`);
    }
    sourceType = "fit";
  } else {
    throw new ApiError("Ride must be .gpx or .fit");
  }

  const points = parsed.points;
  if (points.length < 2) throw new ApiError("Ride has too few points");

  const h = await hashRide(points);
  const existing = await findOneByIndex("rides", "hash", h);
  if (existing) throw new ApiError("Duplicate ride", 409);

  const startTime = points[0].t || null;
  const endTime = points[points.length - 1].t || null;
  let durationS = 0;
  if (startTime && endTime) {
    const dts = new Date(startTime);
    const dte = new Date(endTime);
    if (!Number.isNaN(dts.getTime()) && !Number.isNaN(dte.getTime())) {
      durationS = (dte.getTime() - dts.getTime()) / 1000;
    }
  }

  const rideId = uuid();

  // Auto-name via Nominatim (best-effort, silent failure)
  let autoName = null;
  const place = await reverseGeocode(points[0].lat, points[0].lon);
  if (place) autoName = `${place} Ride`;

  const baseFilename = (file.name || "ride").replace(/\.[^.]+$/, "");
  const parsedName = (parsed.name || "").trim();
  const generic = new Set(["", "unnamed", "fit ride", "cycling ride", baseFilename.toLowerCase()]);
  const useAuto =
    autoName &&
    (!parsedName ||
      generic.has(parsedName.toLowerCase()) ||
      parsedName.toLowerCase().endsWith("ride"));
  const finalName = useAuto ? autoName : parsedName || baseFilename;

  // Resolve bike: file metadata wins, otherwise the user's default bike.
  let bikeName = parsed.meta?.bike_name || null;
  if (!bikeName) {
    const defaultBike = await getDefaultBike();
    if (defaultBike) bikeName = defaultBike;
  } else {
    // FIT supplied a bike name — make sure it's in the registry too
    await addBike(bikeName);
  }

  const rideDoc = {
    id: rideId,
    name: finalName,
    hash: h,
    source_type: sourceType,
    start_time: startTime,
    duration_s: durationS,
    distance_m: Math.round(totalDistanceM(points) * 10) / 10,
    elevation_gain_m: Math.round(elevationGainM(points) * 10) / 10,
    elevation_loss_m: Math.round(elevationLossM(points) * 10) / 10,
    points,
    created_at: new Date().toISOString(),
    // FIT metadata (null for GPX rides)
    sport: parsed.meta?.sport || null,
    sub_sport: parsed.meta?.sub_sport || null,
    device: parsed.meta?.device || null,
    bike_name: bikeName,
    moving_time_s: parsed.meta?.moving_time_s || null,
    avg_speed_mps: parsed.meta?.avg_speed_mps || null,
    max_speed_mps: parsed.meta?.max_speed_mps || null,
    avg_heart_rate: parsed.meta?.avg_heart_rate || null,
    max_heart_rate: parsed.meta?.max_heart_rate || null,
    avg_cadence: parsed.meta?.avg_cadence || null,
    max_cadence: parsed.meta?.max_cadence || null,
    avg_power: parsed.meta?.avg_power || null,
    max_power: parsed.meta?.max_power || null,
    normalized_power: parsed.meta?.normalized_power || null,
    total_calories: parsed.meta?.total_calories || null,
    total_ascent_m: parsed.meta?.total_ascent_m || null,
    total_descent_m: parsed.meta?.total_descent_m || null,
    avg_temperature: parsed.meta?.avg_temperature || null,
    max_temperature: parsed.meta?.max_temperature || null,
    min_temperature: parsed.meta?.min_temperature || null,
  };
  await put("rides", rideDoc);

  // Detect against all segments
  const segs = await getAll("segments");
  const allEfforts = [];
  for (const seg of segs) {
    const newEfforts = detectEfforts(points, seg);
    for (const eff of newEfforts) {
      const effDoc = {
        id: uuid(),
        segment_id: seg.id,
        ride_id: rideId,
        ride_name: rideDoc.name,
        elapsed_s: eff.elapsed_s,
        avg_power: eff.avg_power,
        avg_hr: eff.avg_hr,
        datetime_utc: eff.datetime_utc,
        start_idx: eff.start_idx,
        end_idx: eff.end_idx,
      };
      await put("efforts", effDoc);
      allEfforts.push({
        ...effDoc,
        segment_name: seg.name,
        points: decimate(points.slice(eff.start_idx, eff.end_idx + 1), 500),
      });
    }
  }

  return {
    id: rideId,
    name: rideDoc.name,
    source_type: sourceType,
    start_time: startTime,
    duration_s: durationS,
    distance_m: rideDoc.distance_m,
    elevation_gain_m: rideDoc.elevation_gain_m,
    point_count: points.length,
    created_at: rideDoc.created_at,
    effort_count: allEfforts.length,
    points: decimate(points),
    efforts: allEfforts,
    ...rideMetadataView(rideDoc),
  };
}

export async function deleteRide(id) {
  const existing = await getOne("rides", id);
  if (!existing) throw new ApiError("Ride not found", 404);
  await remove("rides", id);
  await deleteEffortsBy("ride_id", id);
  return { ok: true };
}

export async function renameRide(id, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) throw new ApiError("Name cannot be empty");
  const r = await getOne("rides", id);
  if (!r) throw new ApiError("Ride not found", 404);
  r.name = trimmed;
  await put("rides", r);
  await updateEffortsRideName(id, trimmed);
  return { ok: true, name: trimmed };
}

// Patch user-editable activity metadata (bike_name, sub_sport).
// Pass empty string or null to clear a field.
const EDITABLE_META_KEYS = ["bike_name", "sub_sport"];
export async function updateRideMeta(id, patch) {
  const r = await getOne("rides", id);
  if (!r) throw new ApiError("Ride not found", 404);
  for (const k of EDITABLE_META_KEYS) {
    if (k in patch) {
      const v = patch[k];
      r[k] = v == null || (typeof v === "string" && !v.trim()) ? null : String(v).trim();
    }
  }
  await put("rides", r);
  // Side-effect: if a bike name was set, register it as the new default
  if ("bike_name" in patch && r.bike_name) {
    await addBike(r.bike_name);
  }
  return { ok: true, ...rideMetadataView(r) };
}

// ---------- Efforts ----------
export async function listEfforts(segmentId) {
  const efforts = await findByIndex("efforts", "segment_id", segmentId);
  efforts.sort((a, b) => a.elapsed_s - b.elapsed_s);
  return efforts;
}

// ---------- Stats ----------
export async function getStats() {
  const [segments, rides, efforts] = await Promise.all([
    count("segments"),
    count("rides"),
    count("efforts"),
  ]);
  return { segments, rides, efforts };
}

// ---------- Backup / Restore ----------
export async function downloadBackup() {
  const [segments, rides, efforts] = await Promise.all([
    getAll("segments"),
    getAll("rides"),
    getAll("efforts"),
  ]);
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    segments,
    rides,
    efforts,
  };
}

export async function restoreBackup(payload) {
  if (!payload || typeof payload !== "object") throw new ApiError("Invalid backup payload");
  const segments = Array.isArray(payload.segments) ? payload.segments : [];
  const rides = Array.isArray(payload.rides) ? payload.rides : [];
  const efforts = Array.isArray(payload.efforts) ? payload.efforts : [];

  await clearAll();
  await bulkInsert("segments", segments);
  await bulkInsert("rides", rides);
  await bulkInsert("efforts", efforts);

  return {
    ok: true,
    segments: segments.length,
    rides: rides.length,
    efforts: efforts.length,
  };
}

// ---------- Formatters (unchanged, re-exported) ----------
export function fmtTime(seconds) {
  if (seconds == null || isNaN(seconds)) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtDistance(m) {
  if (m == null) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

export function fmtDateLocal(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function localYear(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).getFullYear();
  } catch {
    return null;
  }
}

export function fmtSpeed(mps) {
  if (mps == null || isNaN(mps)) return "—";
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

export function fmtTimeOfDay(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export function fmtGradient(elevationM, distanceM) {
  if (!distanceM || distanceM <= 0 || elevationM == null) return "—";
  const pct = (elevationM / distanceM) * 100;
  return `${pct.toFixed(1)}%`;
}
