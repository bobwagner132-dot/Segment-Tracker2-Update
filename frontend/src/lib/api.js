// REST client for Cycling Segment Tracker 2.
// All previously-IndexedDB-backed functions now talk to the FastAPI server at
// `${REACT_APP_BACKEND_URL}/api/...`. Function signatures and return shapes
// match the previous client-side implementation so no page code needs to
// change.

const BASE = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const DETECTION_RADIUS_M = 30;
export const MAX_DISPLAY_POINTS = 2000;

// ---------- HTTP plumbing ----------
class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
    this.response = { data: { detail: message }, status };
  }
}

async function _parseError(res, path = "") {
  const isLogin = path.endsWith("/auth/login");
  const friendlyByStatus = {
    400: "Bad request.",
    401: isLogin ? "Invalid email or password." : "Your session expired. Please sign in again.",
    403: "You don't have permission for that.",
    404: "Not found.",
    409: "Conflict — that record already exists.",
    422: "Some fields are invalid.",
    423: "Account is temporarily locked due to repeated failures.",
    500: "Server error — try again in a moment.",
  };
  let detail = friendlyByStatus[res.status] || (res.statusText && res.statusText.trim()) || `HTTP ${res.status}`;
  try {
    // Read body ONCE as text, then try to parse as JSON. Doing it this way
    // means a botched JSON body (or a service-worker-intercepted stream) won't
    // leave us with an empty error message.
    const text = await res.text();
    if (text) {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        try {
          const j = JSON.parse(text);
          detail = j.detail || j.message || j.error || detail;
        } catch {
          detail = text;
        }
      } else {
        detail = text;
      }
    }
  } catch {
    /* swallow — keep the status-mapped fallback */
  }
  return new ApiError(detail, res.status);
}

async function _request(method, path, { body, headers, query } = {}) {
  // `BASE` is an absolute URL in dev (REACT_APP_BACKEND_URL is set), but on the
  // single-port Mac install it's just "/api". `new URL("/api/...")` throws
  // "Invalid URL", so we always supply window.location.origin as the base.
  const url = new URL(BASE + path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  const init = {
    method,
    credentials: "include",
    headers: { ...(headers || {}) },
  };
  if (body !== undefined) {
    if (body instanceof FormData) {
      init.body = body;
    } else {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
  }
  const res = await fetch(url, init);
  if (!res.ok) throw await _parseError(res, path);
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  if (ct.includes("text/")) return res.text();
  return res.blob();
}

const apiGet = (p, q) => _request("GET", p, { query: q });
const apiPost = (p, body) => _request("POST", p, { body });
const apiPatch = (p, body) => _request("PATCH", p, { body });
const apiDelete = (p) => _request("DELETE", p);

async function _uploadFile(path, file) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  return _request("POST", path, { body: fd });
}

// ---------- Error formatting ----------
export function formatApiError(err) {
  if (!err) return "Something went wrong.";
  const d = err.response?.data?.detail ?? err.message;
  if (typeof d === "string") return d;
  if (Array.isArray(d))
    return d
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .join(" · ");
  if (d && typeof d.msg === "string") return d.msg;
  return String(d);
}

// ---------- Auth ----------
export async function authStatus() {
  return apiGet("/auth/status");
}
export async function login(email, password) {
  return apiPost("/auth/login", { email, password });
}
export async function logout() {
  return apiPost("/auth/logout");
}
export async function setInitialPassword(email, password) {
  return apiPost("/auth/set-initial-password", { email, password });
}
export async function fetchMe() {
  return apiGet("/auth/me");
}

// ---------- Admin user management ----------
export async function adminListUsers() {
  return apiGet("/admin/users");
}
export async function adminCreateUser(email, password, isAdmin = false) {
  return apiPost("/admin/users", { email, password, is_admin: isAdmin });
}
export async function adminDeleteUser(userId) {
  return apiDelete(`/admin/users/${userId}`);
}
export async function adminResetPassword(userId, password) {
  return apiPost(`/admin/users/${userId}/reset-password`, { password });
}
export async function adminSetAdmin(userId, isAdmin) {
  return apiPost(`/admin/users/${userId}/admin`, { is_admin: isAdmin });
}

// ---------- Segments ----------
export async function listSegments() {
  return apiGet("/segments");
}

export async function getSegment(id) {
  return apiGet(`/segments/${encodeURIComponent(id)}`);
}

export async function uploadSegment(file) {
  return _uploadFile("/segments", file);
}

export async function deleteSegment(id) {
  return apiDelete(`/segments/${encodeURIComponent(id)}`);
}

export async function renameSegment(id, name) {
  return apiPatch(`/segments/${encodeURIComponent(id)}`, { name });
}

export async function deleteAllSegments() {
  return apiDelete("/segments");
}

export async function listEfforts(segmentId) {
  return apiGet(`/segments/${encodeURIComponent(segmentId)}/efforts`);
}

// ---------- Bike types & sub-sport matching (client-side hints only) ----------
export const BIKE_TYPES = [
  "Road", "Gravel", "Mountain", "Cyclocross", "Indoor",
  "Commute", "Touring", "E-bike", "Track", "Other",
];

const TYPE_SUB_SPORT_ALIASES = {
  road: ["road", "road cycling"],
  gravel: ["gravel", "gravel cycling"],
  mountain: ["mountain", "mountain biking"],
  cyclocross: ["cyclocross"],
  indoor: ["indoor", "indoor cycling", "spin"],
  commute: ["commute", "commuting"],
  touring: ["touring"],
  "e-bike": ["e-bike", "e bike", "ebike", "e_bike_fitness"],
  track: ["track", "track cycling"],
  other: ["other", "generic", "cycling"],
};
export function typeMatchesSubSport(type, subSport) {
  const t = (type || "").toString().trim().toLowerCase();
  const s = (subSport || "").toString().trim().toLowerCase();
  if (!t || !s) return false;
  if (t === s) return true;
  const aliases = TYPE_SUB_SPORT_ALIASES[t] || [t];
  return aliases.some((a) => s === a || s.includes(a) || a.includes(s));
}

// ---------- Bikes ----------
export async function listBikes() {
  return apiGet("/bikes/names");
}

export async function getDefaultBike() {
  const r = await apiGet("/bikes/default");
  return r?.name || null;
}

export async function setDefaultBike(name) {
  await apiPost("/bikes/default", { name: name || null });
  return name || null;
}

export async function addBike(name, type = null) {
  const r = await apiPost("/bikes", { name, type });
  return r.name;
}

export async function removeBike(name) {
  await apiDelete(`/bikes/${encodeURIComponent(name)}`);
}

export async function getBikeProfile(name) {
  if (!name) return null;
  try {
    return await apiGet(`/bikes/${encodeURIComponent(name)}/profile`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function getBikeProfileWithStats(name) {
  return getBikeProfile(name);
}

export async function updateBikeProfile(name, patch) {
  return apiPatch(`/bikes/${encodeURIComponent(name)}`, patch);
}

export async function addPartEvent(bikeName, partKey, event) {
  return apiPost(
    `/bikes/${encodeURIComponent(bikeName)}/parts/${encodeURIComponent(partKey)}/events`,
    event,
  );
}

export async function deletePartEvent(bikeName, partKey, eventId) {
  return apiDelete(
    `/bikes/${encodeURIComponent(bikeName)}/parts/${encodeURIComponent(partKey)}/events/${encodeURIComponent(eventId)}`,
  );
}

export async function addCustomPart(bikeName, category, partName) {
  return apiPost(
    `/bikes/${encodeURIComponent(bikeName)}/custom-parts`,
    { category, name: partName },
  );
}

export async function removeCustomPart(bikeName, category, partName) {
  return apiDelete(
    `/bikes/${encodeURIComponent(bikeName)}/custom-parts/${encodeURIComponent(category)}/${encodeURIComponent(partName)}`,
  );
}

export async function renameBike(oldName, newName) {
  return apiPost(
    `/bikes/${encodeURIComponent(oldName)}/rename`,
    { new_name: newName },
  );
}

export async function deleteBikeEverywhere(name) {
  return apiDelete(`/bikes/${encodeURIComponent(name)}`);
}

export async function getBikeStats() {
  return apiGet("/bikes");
}

// ---------- Rides ----------
export async function listRides() {
  return apiGet("/rides");
}

export async function getRide(id) {
  return apiGet(`/rides/${encodeURIComponent(id)}`);
}

export async function uploadRide(file) {
  return _uploadFile("/rides", file);
}

export async function deleteRide(id) {
  return apiDelete(`/rides/${encodeURIComponent(id)}`);
}

export async function renameRide(id, name) {
  return apiPatch(`/rides/${encodeURIComponent(id)}`, { name });
}

export async function deleteAllRides() {
  return apiDelete("/rides");
}

export async function updateRideMeta(id, patch) {
  return apiPatch(`/rides/${encodeURIComponent(id)}/meta`, patch);
}

// ---------- Stats ----------
export async function getStats() {
  return apiGet("/stats");
}

export async function getYearlyStats(year) {
  return apiGet("/stats/yearly", year ? { year } : undefined);
}

// ---------- Backup / Restore ----------
export async function downloadBackup() {
  return apiGet("/backup");
}

export async function restoreBackup(payload) {
  return apiPost("/restore", payload);
}

// ---------- Admin (Pass 1 introduces these) ----------
export async function getAdminStorage() {
  return apiGet("/admin/storage");
}

export async function listAdminBackups() {
  return apiGet("/admin/backups");
}

export async function deleteOrphanUploads() {
  return apiDelete("/admin/uploads/orphans");
}

export function backupZipUrl({ includeUploads = true } = {}) {
  const u = new URL(BASE + "/backup/zip");
  u.searchParams.set("include_uploads", includeUploads ? "true" : "false");
  return u.toString();
}

// ---------- Formatting helpers (kept identical to previous client) ----------
export function fmtTime(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

export function fmtDistance(m) {
  if (m == null || !Number.isFinite(m)) return "—";
  const km = m / 1000;
  return km >= 10 ? `${km.toFixed(1)} km` : `${km.toFixed(2)} km`;
}

export function fmtDateLocal(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

export function localYear(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.getFullYear();
  } catch {
    return null;
  }
}

export function fmtSpeed(mps) {
  if (mps == null || !Number.isFinite(mps)) return "—";
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

export function fmtTimeOfDay(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

export function fmtGradient(elevationM, distanceM) {
  if (!elevationM || !distanceM) return "0.0%";
  return `${((elevationM / distanceM) * 100).toFixed(1)}%`;
}
