// 1:1 JS port of backend/server.py segment-effort detection.
// Uses the 30m haversine radius tolerance, matches start then end in order,
// and computes elapsed time / average power / average HR per effort.

export const DETECTION_RADIUS_M = 30.0;
export const MAX_DISPLAY_POINTS = 1500;

export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000.0;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function totalDistanceM(points) {
  let d = 0.0;
  for (let i = 1; i < points.length; i++) {
    d += haversineM(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return d;
}

export function elevationGainM(points) {
  let gain = 0.0;
  for (let i = 1; i < points.length; i++) {
    const e1 = points[i - 1].ele;
    const e2 = points[i].ele;
    if (e1 != null && e2 != null && e2 > e1) gain += e2 - e1;
  }
  return gain;
}

export function decimate(points, maxPoints = MAX_DISPLAY_POINTS) {
  if (points.length <= maxPoints) return points;
  const step = Math.max(1, Math.floor(points.length / maxPoints));
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1]);
  }
  return out;
}

export function detectEfforts(ridePoints, segment) {
  const segPts = segment.points;
  if (segPts.length < 2 || !ridePoints.length) return [];
  const segStart = segPts[0];
  const segEnd = segPts[segPts.length - 1];

  const efforts = [];
  let i = 0;
  const n = ridePoints.length;

  while (i < n) {
    // find entry into start radius
    let startIdx = null;
    let bestStartDist = null;
    while (i < n) {
      const d = haversineM(
        ridePoints[i].lat, ridePoints[i].lon, segStart.lat, segStart.lon
      );
      if (d <= DETECTION_RADIUS_M) {
        startIdx = i;
        bestStartDist = d;
        let j = i + 1;
        while (j < n) {
          const dj = haversineM(
            ridePoints[j].lat, ridePoints[j].lon, segStart.lat, segStart.lon
          );
          if (dj <= DETECTION_RADIUS_M && dj < bestStartDist) {
            bestStartDist = dj;
            startIdx = j;
            j += 1;
          } else {
            break;
          }
        }
        i = j;
        break;
      }
      i += 1;
    }
    if (startIdx === null) break;

    // find exit to end point
    let endIdx = null;
    let bestEndDist = null;
    let k = i;
    while (k < n) {
      const d = haversineM(
        ridePoints[k].lat, ridePoints[k].lon, segEnd.lat, segEnd.lon
      );
      if (d <= DETECTION_RADIUS_M) {
        endIdx = k;
        bestEndDist = d;
        let m = k + 1;
        while (m < n) {
          const dm = haversineM(
            ridePoints[m].lat, ridePoints[m].lon, segEnd.lat, segEnd.lon
          );
          if (dm <= DETECTION_RADIUS_M && dm < bestEndDist) {
            bestEndDist = dm;
            endIdx = m;
            m += 1;
          } else {
            break;
          }
        }
        k = m;
        break;
      }
      k += 1;
    }
    if (endIdx === null || endIdx <= startIdx) break;

    // compute effort metrics
    const slice = ridePoints.slice(startIdx, endIdx + 1);
    const tStart = slice[0].t;
    const tEnd = slice[slice.length - 1].t;
    if (!tStart || !tEnd) {
      i = endIdx + 1;
      continue;
    }
    const dtStart = new Date(tStart);
    const dtEnd = new Date(tEnd);
    if (Number.isNaN(dtStart.getTime()) || Number.isNaN(dtEnd.getTime())) {
      i = endIdx + 1;
      continue;
    }
    const elapsed = (dtEnd.getTime() - dtStart.getTime()) / 1000;
    if (elapsed <= 0) {
      i = endIdx + 1;
      continue;
    }

    const powers = slice.filter((p) => p.power != null).map((p) => p.power);
    const hrs = slice.filter((p) => p.hr != null).map((p) => p.hr);
    const cads = slice.filter((p) => p.cad != null).map((p) => p.cad);
    const speeds = slice.filter((p) => p.speed != null).map((p) => p.speed);
    const avgPower = powers.length
      ? Math.round((powers.reduce((a, b) => a + b, 0) / powers.length) * 10) / 10
      : null;
    const avgHr = hrs.length
      ? Math.round((hrs.reduce((a, b) => a + b, 0) / hrs.length) * 10) / 10
      : null;
    const avgCad = cads.length
      ? Math.round((cads.reduce((a, b) => a + b, 0) / cads.length) * 10) / 10
      : null;
    const maxPower = powers.length ? Math.max(...powers) : null;
    const maxHr = hrs.length ? Math.max(...hrs) : null;
    const maxCad = cads.length ? Math.max(...cads) : null;

    const distance = totalDistanceM(slice);
    const eleGain = elevationGainM(slice);
    const avgSpeed = elapsed > 0 ? distance / elapsed : null;
    const maxSpeed = speeds.length
      ? Math.max(...speeds)
      : avgSpeed; // fallback

    efforts.push({
      segment_id: segment.id,
      start_idx: startIdx,
      end_idx: endIdx,
      elapsed_s: elapsed,
      moving_time_s: elapsed, // GPX/FIT records have already been filtered
      distance_m: Math.round(distance * 10) / 10,
      elevation_gain_m: Math.round(eleGain * 10) / 10,
      avg_speed_mps: avgSpeed != null ? Math.round(avgSpeed * 100) / 100 : null,
      max_speed_mps: maxSpeed != null ? Math.round(maxSpeed * 100) / 100 : null,
      avg_power: avgPower,
      max_power: maxPower,
      avg_hr: avgHr,
      max_hr: maxHr,
      avg_cadence: avgCad,
      max_cadence: maxCad,
      datetime_utc: dtStart.toISOString(),
    });
    i = endIdx + 1;
  }
  return efforts;
}

// ---------- Hashing (SHA-256 via WebCrypto) ----------
async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashSegment(points) {
  const key = points
    .map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`)
    .join(";");
  return sha256Hex(key);
}

export async function hashRide(points) {
  const step = Math.max(1, Math.floor(points.length / 200) || 1);
  const parts = [];
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    parts.push(`${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.t || ""}`);
  }
  return sha256Hex(parts.join(";"));
}
