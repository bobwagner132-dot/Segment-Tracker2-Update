// One-shot migration: read everything from the legacy IndexedDB (`cst2` DB)
// and POST it to the new SQLite-backed /api/restore endpoint. Safe to run
// repeatedly — the server fully replaces the user's data each call, so the
// last successful migration wins.

import { getAll, getMeta } from "./localdb";
import { restoreBackup } from "./api";

export async function readIndexedDbSnapshot() {
  const [segments, rides, efforts, bikeNames, defaultBike, bikeProfiles] =
    await Promise.all([
      getAll("segments"),
      getAll("rides"),
      getAll("efforts"),
      getMeta("bike_names").then((v) => v || []),
      getMeta("default_bike").then((v) => v || null),
      getMeta("bike_profiles").then((v) => v || {}),
    ]);

  // Reshape bikes into rows the server's /api/restore expects
  const bikes = (bikeNames || []).map((name) => {
    const profKey = Object.keys(bikeProfiles).find(
      (k) => k.toLowerCase() === String(name).toLowerCase(),
    );
    const prof = (profKey && bikeProfiles[profKey]) || {};
    return {
      name,
      type: prof.type || null,
      is_default: defaultBike && String(defaultBike).toLowerCase() === String(name).toLowerCase(),
      added_at: prof.added_at || null,
      starting_km: prof.starting_km || 0,
      parts: prof.parts || {},
      custom_parts: prof.custom_parts || {},
    };
  });

  return {
    segments,
    rides,
    efforts,
    bikes,
    counts: {
      segments: segments.length,
      rides: rides.length,
      efforts: efforts.length,
      bikes: bikes.length,
    },
  };
}

export async function migrateFromIndexedDb() {
  const snap = await readIndexedDbSnapshot();
  const result = await restoreBackup({
    segments: snap.segments,
    rides: snap.rides,
    efforts: snap.efforts,
    bikes: snap.bikes,
  });
  return { counts: snap.counts, result };
}
