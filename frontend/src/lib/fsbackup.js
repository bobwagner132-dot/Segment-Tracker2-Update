// Folder-based backup/restore using the File System Access API.
// https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
//
// The user picks a root folder once (e.g. ~/Documents/Cycling). We store the
// directory handle in IndexedDB (`meta.backup_dir`) and create a `Backup/`
// subfolder inside it. Subsequent exports/restores reuse that folder with a
// single permission prompt per browser session.
//
// Falls back gracefully: this API ships in Chromium-based browsers on Mac but
// not in Safari or Firefox (as of early 2026). Callers should check
// `isFsAccessSupported()` first.

import { getMeta, setMeta, deleteMeta } from "./localdb";

const HANDLE_KEY = "backup_dir";
const SUBFOLDER = "Backup";

export function isFsAccessSupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

// ---------- Persisted handle ----------
export async function getSavedDirHandle() {
  return (await getMeta(HANDLE_KEY)) || null;
}

export async function clearSavedDir() {
  await deleteMeta(HANDLE_KEY);
}

async function ensurePermission(handle, mode = "readwrite") {
  if (!handle) return false;
  const opts = { mode };
  const q = await handle.queryPermission(opts);
  if (q === "granted") return true;
  const r = await handle.requestPermission(opts);
  return r === "granted";
}

// Pick a fresh folder and persist the handle.
export async function pickBackupDir() {
  if (!isFsAccessSupported()) throw new Error("FS Access API not supported");
  const handle = await window.showDirectoryPicker({
    id: "cst2-backup",
    mode: "readwrite",
    startIn: "documents",
  });
  const ok = await ensurePermission(handle, "readwrite");
  if (!ok) throw new Error("Permission denied");
  await setMeta(HANDLE_KEY, handle);
  return handle;
}

// Load persisted handle and re-verify permission. Returns null if missing
// or permission was denied.
export async function ensureBackupDir({ prompt = false } = {}) {
  const saved = await getSavedDirHandle();
  if (saved) {
    const ok = await ensurePermission(saved, "readwrite");
    if (ok) return saved;
  }
  if (!prompt || !isFsAccessSupported()) return null;
  return pickBackupDir();
}

async function getOrCreateSubfolder(parentHandle) {
  return parentHandle.getDirectoryHandle(SUBFOLDER, { create: true });
}

// ---------- Export ----------
export async function exportToFolder(dirHandle, jsonPayload) {
  const backupDir = await getOrCreateSubfolder(dirHandle);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const filename = `segment-tracker-backup-${stamp}.json`;
  const fileHandle = await backupDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(jsonPayload, null, 2));
  await writable.close();
  return { filename, subfolder: SUBFOLDER, dir: dirHandle.name };
}

// ---------- Restore ----------
// List all *.json files in the Backup subfolder, newest first (by filename).
export async function listBackupsInFolder(dirHandle) {
  let backupDir;
  try {
    backupDir = await parentHandle(dirHandle);
  } catch {
    return [];
  }
  const items = [];
  for await (const [name, entry] of backupDir.entries()) {
    if (entry.kind === "file" && name.toLowerCase().endsWith(".json")) {
      const file = await entry.getFile();
      items.push({
        name,
        size: file.size,
        lastModified: file.lastModified,
        handle: entry,
      });
    }
  }
  items.sort((a, b) => b.lastModified - a.lastModified);
  return items;
}

// Small helper so we don't create the subfolder on read-only list calls
async function parentHandle(dirHandle) {
  try {
    return await dirHandle.getDirectoryHandle(SUBFOLDER, { create: false });
  } catch {
    return await getOrCreateSubfolder(dirHandle);
  }
}

export async function readBackupFile(fileHandle) {
  const f = await fileHandle.getFile();
  const text = await f.text();
  return JSON.parse(text);
}

export const BACKUP_SUBFOLDER_NAME = SUBFOLDER;
