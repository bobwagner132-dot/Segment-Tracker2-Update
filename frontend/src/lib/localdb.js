// IndexedDB-backed local storage for Cycling Segment Tracker 2.
// Schema mirrors the original MongoDB collections so backup/restore JSON
// remains compatible across the FastAPI and local-only versions of the app.

import { openDB } from "idb";

const DB_NAME = "cst2";
const DB_VERSION = 1;

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("segments")) {
          const s = db.createObjectStore("segments", { keyPath: "id" });
          s.createIndex("hash", "hash", { unique: true });
          s.createIndex("created_at", "created_at");
        }
        if (!db.objectStoreNames.contains("rides")) {
          const r = db.createObjectStore("rides", { keyPath: "id" });
          r.createIndex("hash", "hash", { unique: true });
          r.createIndex("start_time", "start_time");
          r.createIndex("created_at", "created_at");
        }
        if (!db.objectStoreNames.contains("efforts")) {
          const e = db.createObjectStore("efforts", { keyPath: "id" });
          e.createIndex("segment_id", "segment_id");
          e.createIndex("ride_id", "ride_id");
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

// ---------- Generic helpers ----------
export async function getAll(store) {
  const db = await getDB();
  return db.getAll(store);
}

export async function getOne(store, id) {
  const db = await getDB();
  return db.get(store, id);
}

export async function put(store, value) {
  const db = await getDB();
  return db.put(store, value);
}

export async function remove(store, id) {
  const db = await getDB();
  return db.delete(store, id);
}

export async function findByIndex(store, indexName, value) {
  const db = await getDB();
  return db.getAllFromIndex(store, indexName, value);
}

export async function findOneByIndex(store, indexName, value) {
  const db = await getDB();
  return db.getFromIndex(store, indexName, value);
}

export async function count(store) {
  const db = await getDB();
  return db.count(store);
}

export async function clearAll() {
  const db = await getDB();
  const tx = db.transaction(["segments", "rides", "efforts"], "readwrite");
  await Promise.all([
    tx.objectStore("segments").clear(),
    tx.objectStore("rides").clear(),
    tx.objectStore("efforts").clear(),
  ]);
  await tx.done;
}

export async function bulkInsert(store, items) {
  if (!items || items.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(store, "readwrite");
  for (const item of items) {
    await tx.store.put(item);
  }
  await tx.done;
}

export async function deleteEffortsBy(indexName, value) {
  const db = await getDB();
  const tx = db.transaction("efforts", "readwrite");
  const index = tx.store.index(indexName);
  let cursor = await index.openCursor(value);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function updateEffortsRideName(rideId, name) {
  const db = await getDB();
  const tx = db.transaction("efforts", "readwrite");
  const index = tx.store.index("ride_id");
  let cursor = await index.openCursor(rideId);
  while (cursor) {
    const val = cursor.value;
    val.ride_name = name;
    await cursor.update(val);
    cursor = await cursor.continue();
  }
  await tx.done;
}
