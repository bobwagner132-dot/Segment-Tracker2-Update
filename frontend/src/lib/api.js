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
  clearStores,
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
  // Alphabetical by name (case-insensitive); ties broken by created_at desc
  segs.sort((a, b) => {
    const an = (a.name || "").toLowerCase();
    const bn = (b.name || "").toLowerCase();
    if (an !== bn) return an.localeCompare(bn);
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
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
//   bike_profiles : map name -> { added_at, starting_km, type, parts, custom_parts }
const BIKE_LIST_KEY = "bike_names";
const DEFAULT_BIKE_KEY = "default_bike";

// User-facing bike types — also used to match FIT `sub_sport` on upload.
export const BIKE_TYPES = [
  "Road",
  "Gravel",
  "Mountain",
  "Cyclocross",
  "Indoor",
  "Commute",
  "Touring",
  "E-bike",
  "Track",
  "Other",
];

// Aliases for Garmin sub_sport values that may come in as either the raw
// snake_case form or the parsers' Title Case form (e.g. "Gravel Cycling").
const TYPE_SUB_SPORT_ALIASES = {
  road: ["road", "road cycling"],
  gravel: ["gravel", "gravel cycling"],
  mountain: ["mountain", "mountain biking", "downhill", "enduro_mountain", "enduro mountain"],
  cyclocross: ["cyclocross", "cyclo cross", "cyclo_cross"],
  indoor: ["indoor", "indoor cycling", "spin", "virtual cycling", "virtual_activity"],
  commute: ["commute", "commuting"],
  touring: ["touring", "bike touring"],
  "e-bike": ["e-bike", "e bike", "ebike", "e_bike_fitness", "e bike fitness", "electric bike", "electric_bike"],
  track: ["track", "track cycling"],
  other: ["other", "generic", "cycling"],
};

function _norm(s) {
  return (s || "").toString().trim().toLowerCase();
}

// Returns true if a bike's `type` field matches an activity's `sub_sport`.
export function typeMatchesSubSport(type, subSport) {
  const t = _norm(type);
  const s = _norm(subSport);
  if (!t || !s) return false;
  if (t === s) return true;
  const aliases = TYPE_SUB_SPORT_ALIASES[t] || [t];
  return aliases.some((a) => {
    const al = _norm(a);
    return s === al || s.includes(al) || al.includes(s);
  });
}

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
// Optionally persist a `type` (Road, Gravel, …) in the bike's profile.
export async function addBike(name, type = null) {
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
  // Seed / update the profile with the optional type
  if (type !== undefined) {
    const profiles = await getProfiles();
    const key =
      Object.keys(profiles).find((k) => k.toLowerCase() === trimmed.toLowerCase()) ||
      trimmed;
    const prof = profiles[key] || blankProfile();
    if (type) prof.type = type;
    profiles[key] = prof;
    await saveProfiles(profiles);
  }
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

// ---------- Per-bike profiles (added date, starting km, maintenance log) ----------
const BIKE_PROFILES_KEY = "bike_profiles";

async function getProfiles() {
  return (await getMeta(BIKE_PROFILES_KEY)) || {};
}
async function saveProfiles(map) {
  await setMeta(BIKE_PROFILES_KEY, map);
}

function blankProfile() {
  return {
    added_at: new Date().toISOString().slice(0, 10),
    starting_km: 0,
    type: null, // Road, Gravel, Mountain, …
    parts: {}, // partKey -> { events: [...] }
    custom_parts: {}, // category -> [partName,...]
  };
}

export async function getBikeProfile(name) {
  if (!name) return null;
  const all = await getProfiles();
  return all[name] || null;
}

// Sum of distance_m for all rides tagged with this bike (in metres).
async function distanceForBike(name) {
  const rides = await getAll("rides");
  let m = 0;
  for (const r of rides) {
    if (r.bike_name && r.bike_name.toLowerCase() === name.toLowerCase()) {
      m += r.distance_m || 0;
    }
  }
  return m;
}

// Returns the bike profile augmented with computed totals.
//   ridden_km     — total km from activities tagged with this bike
//   total_km      — starting_km + ridden_km
export async function getBikeProfileWithStats(name) {
  if (!name) return null;
  const all = await getProfiles();
  const prof = all[name] || blankProfile();
  const riddenM = await distanceForBike(name);
  const ridden_km = Math.round((riddenM / 1000) * 10) / 10;
  return {
    name,
    added_at: prof.added_at || null,
    starting_km: prof.starting_km || 0,
    type: prof.type || null,
    parts: prof.parts || {},
    custom_parts: prof.custom_parts || {},
    ridden_km,
    total_km: Math.round((prof.starting_km + ridden_km) * 10) / 10,
  };
}

export async function updateBikeProfile(name, patch) {
  if (!name) throw new ApiError("Bike name required");
  const all = await getProfiles();
  const prof = all[name] || blankProfile();
  if ("added_at" in patch) prof.added_at = patch.added_at || null;
  if ("starting_km" in patch) {
    const n = parseFloat(patch.starting_km);
    prof.starting_km = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if ("type" in patch) prof.type = patch.type || null;
  all[name] = prof;
  await saveProfiles(all);
  return prof;
}

export async function addPartEvent(bikeName, partKey, event) {
  if (!bikeName || !partKey) throw new ApiError("bikeName and partKey required");
  const all = await getProfiles();
  const prof = all[bikeName] || blankProfile();
  if (!prof.parts[partKey]) prof.parts[partKey] = { events: [] };
  prof.parts[partKey].events.unshift({
    id: (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}`,
    date: event.date || new Date().toISOString().slice(0, 10),
    at_km: event.at_km != null ? parseFloat(event.at_km) : null,
    action: event.action || "Note",
    notes: event.notes || "",
  });
  all[bikeName] = prof;
  await saveProfiles(all);
  return prof.parts[partKey];
}

export async function deletePartEvent(bikeName, partKey, eventId) {
  const all = await getProfiles();
  const prof = all[bikeName];
  if (!prof?.parts?.[partKey]) return null;
  prof.parts[partKey].events = (prof.parts[partKey].events || []).filter(
    (e) => e.id !== eventId
  );
  all[bikeName] = prof;
  await saveProfiles(all);
  return prof.parts[partKey];
}

export async function addCustomPart(bikeName, category, partName) {
  if (!bikeName || !category || !partName) return null;
  const all = await getProfiles();
  const prof = all[bikeName] || blankProfile();
  if (!prof.custom_parts[category]) prof.custom_parts[category] = [];
  const exists = prof.custom_parts[category].some(
    (p) => p.toLowerCase() === partName.toLowerCase()
  );
  if (!exists) prof.custom_parts[category].push(partName);
  all[bikeName] = prof;
  await saveProfiles(all);
  return prof.custom_parts[category];
}

export async function removeCustomPart(bikeName, category, partName) {
  const all = await getProfiles();
  const prof = all[bikeName];
  if (!prof?.custom_parts?.[category]) return null;
  prof.custom_parts[category] = prof.custom_parts[category].filter(
    (p) => p.toLowerCase() !== partName.toLowerCase()
  );
  // Also clear any events recorded against the deleted part
  if (prof.parts[partName]) delete prof.parts[partName];
  all[bikeName] = prof;
  await saveProfiles(all);
  return prof.custom_parts[category];
}

// Rename a bike everywhere it appears: in the registry, in the default-bike
// pointer, and on every ride tagged with the old name. Pass null/empty as
// newName to merge into "unassigned".
export async function renameBike(oldName, newName) {
  const oldTrim = (oldName || "").toString().trim();
  const newTrim = (newName || "").toString().trim();
  if (!oldTrim) return { ok: false };

  // Update registry list
  const list = await listBikes();
  if (newTrim) {
    const filtered = list.filter(
      (b) => b.toLowerCase() !== oldTrim.toLowerCase() && b.toLowerCase() !== newTrim.toLowerCase()
    );
    filtered.unshift(newTrim);
    await setMeta(BIKE_LIST_KEY, filtered);
  } else {
    await setMeta(
      BIKE_LIST_KEY,
      list.filter((b) => b.toLowerCase() !== oldTrim.toLowerCase())
    );
  }

  // Update default pointer
  const def = await getDefaultBike();
  if (def && def.toLowerCase() === oldTrim.toLowerCase()) {
    await setMeta(DEFAULT_BIKE_KEY, newTrim || null);
  }

  // Update every ride tagged with the old bike
  const rides = await getAll("rides");
  let touched = 0;
  for (const r of rides) {
    if (r.bike_name && r.bike_name.toLowerCase() === oldTrim.toLowerCase()) {
      r.bike_name = newTrim || null;
      await put("rides", r);
      touched += 1;
    }
  }

  // Migrate the profile (added_at, starting_km, parts, custom_parts)
  const profiles = await getProfiles();
  const oldKey = Object.keys(profiles).find(
    (k) => k.toLowerCase() === oldTrim.toLowerCase()
  );
  if (oldKey) {
    if (newTrim) {
      profiles[newTrim] = profiles[oldKey];
    }
    if (oldKey !== newTrim) delete profiles[oldKey];
    await saveProfiles(profiles);
  }
  return { ok: true, touched };
}

// Clear the bike tag from every ride that uses `name` AND remove it from the
// registry. Used by the Equipment page when the user wants to fully delete a bike.
export async function deleteBikeEverywhere(name) {
  const trimmed = (name || "").toString().trim();
  if (!trimmed) return { ok: false };
  const rides = await getAll("rides");
  let touched = 0;
  for (const r of rides) {
    if (r.bike_name && r.bike_name.toLowerCase() === trimmed.toLowerCase()) {
      r.bike_name = null;
      await put("rides", r);
      touched += 1;
    }
  }
  await removeBike(trimmed);
  // Also drop the maintenance profile
  const profiles = await getProfiles();
  const key = Object.keys(profiles).find(
    (k) => k.toLowerCase() === trimmed.toLowerCase()
  );
  if (key) {
    delete profiles[key];
    await saveProfiles(profiles);
  }
  return { ok: true, touched };
}

// Aggregate usage stats per bike across every activity.
// Returns: [{ name, ride_count, distance_m, moving_time_s, elevation_gain_m, last_used_iso, is_default,
//             added_at, starting_km, total_km }]
// plus an `unassigned` entry at the end if any rides have no bike.
export async function getBikeStats() {
  const [rides, defBike, registry, profiles] = await Promise.all([
    getAll("rides"),
    getDefaultBike(),
    listBikes(),
    getProfiles(),
  ]);

  const buckets = new Map();
  function add(key, ride) {
    if (!buckets.has(key)) {
      buckets.set(key, {
        name: key,
        ride_count: 0,
        distance_m: 0,
        moving_time_s: 0,
        elevation_gain_m: 0,
        last_used_iso: null,
      });
    }
    const b = buckets.get(key);
    b.ride_count += 1;
    b.distance_m += ride.distance_m || 0;
    b.moving_time_s += ride.moving_time_s || ride.duration_s || 0;
    b.elevation_gain_m += ride.elevation_gain_m || 0;
    const t = ride.start_time || ride.created_at;
    if (t && (!b.last_used_iso || t > b.last_used_iso)) b.last_used_iso = t;
  }

  for (const r of rides) {
    const key = r.bike_name && r.bike_name.trim() ? r.bike_name.trim() : null;
    if (key) add(key, r);
    else add("__unassigned__", r);
  }

  // Ensure every registered bike has a row, even with zero rides
  for (const name of registry) {
    if (!buckets.has(name)) {
      buckets.set(name, {
        name,
        ride_count: 0,
        distance_m: 0,
        moving_time_s: 0,
        elevation_gain_m: 0,
        last_used_iso: null,
      });
    }
  }

  // Round + flag default + merge profile fields
  const list = [];
  for (const [, b] of buckets) {
    if (b.name === "__unassigned__") continue;
    const profKey = Object.keys(profiles).find((k) => k.toLowerCase() === b.name.toLowerCase());
    const prof = profKey ? profiles[profKey] : null;
    const startingKm = prof?.starting_km || 0;
    const riddenKm = b.distance_m / 1000;
    list.push({
      ...b,
      distance_m: Math.round(b.distance_m * 10) / 10,
      moving_time_s: Math.round(b.moving_time_s),
      elevation_gain_m: Math.round(b.elevation_gain_m),
      is_default: defBike && b.name.toLowerCase() === defBike.toLowerCase(),
      added_at: prof?.added_at || null,
      starting_km: startingKm,
      type: prof?.type || null,
      total_km: Math.round((startingKm + riddenKm) * 10) / 10,
    });
  }
  // Sort: default first, then most-recently-used, then by ride count
  list.sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    if (a.last_used_iso && b.last_used_iso && a.last_used_iso !== b.last_used_iso)
      return b.last_used_iso.localeCompare(a.last_used_iso);
    if (a.last_used_iso !== b.last_used_iso) return a.last_used_iso ? -1 : 1;
    return b.ride_count - a.ride_count;
  });

  const unassigned = buckets.get("__unassigned__");
  return {
    bikes: list,
    unassigned: unassigned
      ? {
          ...unassigned,
          name: null,
          distance_m: Math.round(unassigned.distance_m * 10) / 10,
          moving_time_s: Math.round(unassigned.moving_time_s),
          elevation_gain_m: Math.round(unassigned.elevation_gain_m),
        }
      : null,
  };
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

  // Resolve bike. Precedence:
  //   1. The FIT file's own bike_name (if present)
  //   2. Else if the activity has a sub_sport:
  //        a. Default bike, if its `type` matches the sub_sport
  //        b. Else the first other bike whose `type` matches
  //        c. Else null (leave blank)
  //   3. Else (GPX or no sub_sport) the user's default bike
  let bikeName = parsed.meta?.bike_name || null;
  const subSport = parsed.meta?.sub_sport || null;
  if (bikeName) {
    // FIT supplied a bike name — make sure it's in the registry too
    await addBike(bikeName);
  } else if (subSport) {
    const [defaultBike, registry, profiles] = await Promise.all([
      getDefaultBike(),
      listBikes(),
      getProfiles(),
    ]);
    const findProf = (n) =>
      profiles[
        Object.keys(profiles).find((k) => k.toLowerCase() === (n || "").toLowerCase())
      ];
    const defProf = defaultBike ? findProf(defaultBike) : null;
    if (defProf?.type && typeMatchesSubSport(defProf.type, subSport)) {
      bikeName = defaultBike;
    } else {
      const match = registry.find((b) => {
        if (defaultBike && b.toLowerCase() === defaultBike.toLowerCase()) return false;
        const p = findProf(b);
        return p?.type && typeMatchesSubSport(p.type, subSport);
      });
      bikeName = match || null;
    }
  } else {
    const defaultBike = await getDefaultBike();
    if (defaultBike) bikeName = defaultBike;
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

// TEMP (dev/testing only) — clears every ride + every effort but leaves
// segments and the bike registry intact. Wired to a button on the Dashboard.
export async function deleteAllRides() {
  await clearStores(["rides", "efforts"]);
  return { ok: true };
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

// Yearly aggregates for Dashboard graphs.
// Returns:
//   year, years[]              — available years derived from ride start_time
//   months[12]                 — { month, label, distance_km, elevation_m, ride_count }
//   cumulative[]               — running totals over the year, one entry per ride
//                                (plus a leading Jan-1 zero and a trailing year-end pad)
//   totals                     — { distance_km, elevation_m, ride_count } for the year
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export async function getYearlyStats(year) {
  const rides = await getAll("rides");

  const yearsSet = new Set();
  for (const r of rides) {
    const t = r.start_time || r.created_at;
    if (t) {
      const d = new Date(t);
      if (!Number.isNaN(d.getTime())) yearsSet.add(d.getFullYear());
    }
  }
  const years = [...yearsSet].sort((a, b) => b - a);
  const targetYear = year || years[0] || new Date().getFullYear();

  const months = MONTH_LABELS.map((label, idx) => ({
    month: idx,
    label,
    distance_km: 0,
    elevation_m: 0,
    ride_count: 0,
  }));

  const inYear = rides
    .filter((r) => {
      const t = r.start_time || r.created_at;
      if (!t) return false;
      const d = new Date(t);
      return !Number.isNaN(d.getTime()) && d.getFullYear() === targetYear;
    })
    .sort((a, b) => {
      const ta = new Date(a.start_time || a.created_at).getTime();
      const tb = new Date(b.start_time || b.created_at).getTime();
      return ta - tb;
    });

  for (const r of inYear) {
    const d = new Date(r.start_time || r.created_at);
    const m = d.getMonth();
    months[m].distance_km += (r.distance_m || 0) / 1000;
    months[m].elevation_m += r.elevation_gain_m || 0;
    months[m].ride_count += 1;
  }
  for (const m of months) {
    m.distance_km = Math.round(m.distance_km * 10) / 10;
    m.elevation_m = Math.round(m.elevation_m);
  }

  let cd = 0;
  let ce = 0;
  const cumulative = [
    {
      t: new Date(targetYear, 0, 1).getTime(),
      distance_km: 0,
      elevation_m: 0,
    },
  ];
  for (const r of inYear) {
    cd += (r.distance_m || 0) / 1000;
    ce += r.elevation_gain_m || 0;
    cumulative.push({
      t: new Date(r.start_time || r.created_at).getTime(),
      distance_km: Math.round(cd * 10) / 10,
      elevation_m: Math.round(ce),
    });
  }
  // Pad to year-end so the line extends fully across the chart
  const now = Date.now();
  const yearEnd = Math.min(new Date(targetYear, 11, 31, 23, 59).getTime(), now);
  if (cumulative[cumulative.length - 1].t < yearEnd) {
    cumulative.push({
      ...cumulative[cumulative.length - 1],
      t: yearEnd,
    });
  }

  return {
    year: targetYear,
    years,
    months,
    cumulative,
    totals: {
      distance_km: Math.round(cd * 10) / 10,
      elevation_m: Math.round(ce),
      ride_count: inYear.length,
    },
  };
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
