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
export function parseFit(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const fitParser = new FitParser({
      force: true,
      speedUnit: "km/h",
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
        points.push(pt);
      }

      let name = null;
      const sessions = data.sessions || [];
      if (sessions.length > 0 && sessions[0].sport) {
        name = `${sessions[0].sport} ride`;
      }
      if (!name) name = "FIT Ride";

      resolve({ name, points });
    });
  });
}
