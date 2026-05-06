import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
});

export async function listSegments() {
  const { data } = await api.get("/segments");
  return data;
}
export async function getSegment(id) {
  const { data } = await api.get(`/segments/${id}`);
  return data;
}
export async function uploadSegment(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/segments", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
export async function deleteSegment(id) {
  const { data } = await api.delete(`/segments/${id}`);
  return data;
}

export async function listRides() {
  const { data } = await api.get("/rides");
  return data;
}
export async function getRide(id) {
  const { data } = await api.get(`/rides/${id}`);
  return data;
}
export async function uploadRide(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/rides", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
export async function deleteRide(id) {
  const { data } = await api.delete(`/rides/${id}`);
  return data;
}

export async function renameSegment(id, name) {
  const { data } = await api.patch(`/segments/${id}`, { name });
  return data;
}
export async function renameRide(id, name) {
  const { data } = await api.patch(`/rides/${id}`, { name });
  return data;
}

export async function listEfforts(segmentId) {
  const { data } = await api.get(`/segments/${segmentId}/efforts`);
  return data;
}

export async function getStats() {
  const { data } = await api.get("/stats");
  return data;
}

export async function downloadBackup() {
  const { data } = await api.get("/backup");
  return data;
}
export async function restoreBackup(payload) {
  const { data } = await api.post("/restore", payload);
  return data;
}

// ---- formatters ----
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
