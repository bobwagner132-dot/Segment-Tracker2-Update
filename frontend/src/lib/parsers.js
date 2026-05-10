// Browser-side GPX and FIT parsers. Designed to produce the exact same
// point-shape as the previous Python backend (gpxpy / fitparse), so the
// downstream segment detector and UI are unchanged.
//
// Point shape:
//   { lat: Number, lon: Number, ele?: Number, t?: ISO-string, hr?, power?, cad? }

import FitParser from "fit-file-parser";

// ---------- GPX ----------
function textOfChild(el, tagNames) {
  for (const child of Array.from(el.children || [])) {
    const local = child.tagName.split(":").pop().toLowerCase();
    if (tagNames.includes(local)) return child.textContent;
    const deeper = textOfChild(child, tagNames);
    if (deeper != null) return deeper;
  }
  return null;
}

function parseExtensions(ptNode) {
  const extNode = Array.from(ptNode.children).find(
    (c) => c.tagName.split(":").pop().toLowerCase() === "extensions"
  );
  if (!extNode) return {};
  const hrTxt = textOfChild(extNode, ["hr", "heartrate"]);
  const powerTxt = textOfChild(extNode, ["power"]);
  const cadTxt = textOfChild(extNode, ["cad", "cadence"]);
  const out = {};
  if (hrTxt != null && !Number.isNaN(parseFloat(hrTxt))) out.hr = Math.round(parseFloat(hrTxt));
  if (powerTxt != null && !Number.isNaN(parseFloat(powerTxt)))
    out.power = Math.round(parseFloat(powerTxt));
  if (cadTxt != null && !Number.isNaN(parseFloat(cadTxt))) out.cad = Math.round(parseFloat(cadTxt));
  return out;
}

function pointFromGpxNode(node) {
  const latStr = node.getAttribute("lat");
  const lonStr = node.getAttribute("lon");
  if (!latStr || !lonStr) return null;
  const pt = { lat: parseFloat(latStr), lon: parseFloat(lonStr) };
  const eleEl = Array.from(node.children).find(
    (c) => c.tagName.split(":").pop().toLowerCase() === "ele"
  );
  if (eleEl && eleEl.textContent) {
    const e = parseFloat(eleEl.textContent);
    if (!Number.isNaN(e)) pt.ele = e;
  }
  const timeEl = Array.from(node.children).find(
    (c) => c.tagName.split(":").pop().toLowerCase() === "time"
  );
  if (timeEl && timeEl.textContent) {
    try {
      const d = new Date(timeEl.textContent);
      if (!Number.isNaN(d.getTime())) pt.t = d.toISOString();
    } catch {
      /* ignore */
    }
  }
  Object.assign(pt, parseExtensions(node));
  return pt;
}

export function parseGpx(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  const parseErr = doc.querySelector("parsererror");
  if (parseErr) throw new Error("Invalid GPX file");

  const points = [];
  let name = null;

  // <trk><trkseg><trkpt>
  const trks = doc.getElementsByTagName("trk");
  for (const trk of Array.from(trks)) {
    if (!name) {
      const nameEl = trk.getElementsByTagName("name")[0];
      if (nameEl && nameEl.textContent) name = nameEl.textContent.trim();
    }
    const trkpts = trk.getElementsByTagName("trkpt");
    for (const p of Array.from(trkpts)) {
      const pt = pointFromGpxNode(p);
      if (pt) points.push(pt);
    }
  }

  // Fall back to routes / waypoints
  if (points.length === 0) {
    for (const rte of Array.from(doc.getElementsByTagName("rte"))) {
      if (!name) {
        const nameEl = rte.getElementsByTagName("name")[0];
        if (nameEl && nameEl.textContent) name = nameEl.textContent.trim();
      }
      for (const p of Array.from(rte.getElementsByTagName("rtept"))) {
        const pt = pointFromGpxNode(p);
        if (pt) points.push(pt);
      }
    }
  }
  if (points.length === 0) {
    for (const p of Array.from(doc.getElementsByTagName("wpt"))) {
      const pt = pointFromGpxNode(p);
      if (pt) points.push(pt);
    }
  }

  if (!name) {
    const gpxName = doc.getElementsByTagName("name")[0];
    name = (gpxName && gpxName.textContent && gpxName.textContent.trim()) || "Unnamed";
  }

  return { name, points };
}

// ---------- FIT ----------
function pickDeviceLabel(infos) {
  if (!infos || infos.length === 0) return null;
  // Prefer the entry that looks like the head unit: highest priority is one
  // with a product_name / garmin_product / manufacturer. Skip "sensor" types.
  const sorted = [...infos].sort((a, b) => {
    const score = (i) => {
      let s = 0;
      if (i.product_name) s += 4;
      if (i.garmin_product) s += 3;
      if (i.manufacturer && i.manufacturer !== "unknown") s += 2;
      if (i.device_index === "creator" || i.device_index === 0) s += 5;
      if ((i.source_type || "").toString() === "local") s += 1;
      return s;
    };
    return score(b) - score(a);
  });
  for (const d of sorted) {
    const product = d.product_name || d.garmin_product || d.product;
    const manu = d.manufacturer && d.manufacturer !== "unknown" ? d.manufacturer : null;
    if (product && manu) {
      const m = String(manu).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const p = String(product).replace(/_/g, " ");
      // Avoid duplicating if product already contains manufacturer
      return p.toLowerCase().includes(m.toLowerCase()) ? p : `${m} ${p}`;
    }
    if (product) return String(product).replace(/_/g, " ");
    if (manu) return String(manu).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return null;
}

function pickBikeName(data) {
  // Garmin sometimes stores per-bike profile names in `bike_profiles` or
  // `workout` messages. fit-file-parser exposes whatever it sees verbatim.
  const bp = data.bike_profiles || data.bike_profile;
  if (Array.isArray(bp) && bp.length > 0) {
    const named = bp.find((b) => b && b.name);
    if (named) return named.name;
  }
  // Some files include user_profile.weight + bike-related fields; ignore.
  return null;
}

function titleCase(s) {
  if (!s) return null;
  return String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseFit(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const fitParser = new FitParser({
      force: true,
      speedUnit: "m/s",
      lengthUnit: "m",
      temperatureUnit: "celsius",
      elapsedRecordField: true,
      mode: "list",
    });

    fitParser.parse(arrayBuffer, (err, data) => {
      if (err) return reject(new Error(typeof err === "string" ? err : err.message || "FIT parse error"));
      const records = data.records || [];
      const points = [];
      for (const r of records) {
        if (r.position_lat == null || r.position_long == null) continue;
        const pt = {
          lat: Number(r.position_lat),
          lon: Number(r.position_long),
        };
        if (r.altitude != null) pt.ele = Number(r.altitude);
        else if (r.enhanced_altitude != null) pt.ele = Number(r.enhanced_altitude);
        if (r.timestamp) {
          try {
            const d = r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp);
            if (!Number.isNaN(d.getTime())) pt.t = d.toISOString();
          } catch {
            /* ignore */
          }
        }
        if (r.heart_rate != null) pt.hr = Math.round(Number(r.heart_rate));
        if (r.power != null) pt.power = Math.round(Number(r.power));
        if (r.cadence != null) pt.cad = Math.round(Number(r.cadence));
        if (r.speed != null) pt.speed = Number(r.speed);
        else if (r.enhanced_speed != null) pt.speed = Number(r.enhanced_speed);
        if (r.temperature != null) pt.temp = Number(r.temperature);
        points.push(pt);
      }

      const sessions = data.sessions || [];
      const session = sessions.length > 0 ? sessions[0] : {};

      const sport = session.sport ? titleCase(session.sport) : null;
      const subSport = session.sub_sport ? titleCase(session.sub_sport) : null;
      const device = pickDeviceLabel(data.device_infos || data.devices || []);
      const bikeName = pickBikeName(data);

      const meta = {
        sport,
        sub_sport: subSport,
        device,
        bike_name: bikeName,
        // Session aggregates (preferred over our re-computed values when present)
        moving_time_s: session.total_timer_time != null ? Number(session.total_timer_time) : null,
        elapsed_time_s: session.total_elapsed_time != null ? Number(session.total_elapsed_time) : null,
        avg_speed_mps: session.avg_speed != null ? Number(session.avg_speed) : null,
        max_speed_mps: session.max_speed != null ? Number(session.max_speed) : null,
        avg_heart_rate: session.avg_heart_rate != null ? Number(session.avg_heart_rate) : null,
        max_heart_rate: session.max_heart_rate != null ? Number(session.max_heart_rate) : null,
        avg_cadence: session.avg_cadence != null ? Number(session.avg_cadence) : null,
        max_cadence: session.max_cadence != null ? Number(session.max_cadence) : null,
        avg_power: session.avg_power != null ? Number(session.avg_power) : null,
        max_power: session.max_power != null ? Number(session.max_power) : null,
        normalized_power: session.normalized_power != null ? Number(session.normalized_power) : null,
        total_ascent_m: session.total_ascent != null ? Number(session.total_ascent) : null,
        total_descent_m: session.total_descent != null ? Number(session.total_descent) : null,
        total_calories: session.total_calories != null ? Number(session.total_calories) : null,
        total_distance_m: session.total_distance != null ? Number(session.total_distance) : null,
        avg_temperature: session.avg_temperature != null ? Number(session.avg_temperature) : null,
        max_temperature: session.max_temperature != null ? Number(session.max_temperature) : null,
        min_temperature: session.min_temperature != null ? Number(session.min_temperature) : null,
      };

      let name = null;
      // We deliberately do NOT synthesize a name from sport/sub_sport here.
      // Returning null lets the upload pipeline pick the reverse-geocoded
      // "<Suburb> Ride" name when available, otherwise fall back to filename.
      // sport / sub_sport are still surfaced separately via `meta`.

      resolve({ name, points, meta });
    });
  });
}
