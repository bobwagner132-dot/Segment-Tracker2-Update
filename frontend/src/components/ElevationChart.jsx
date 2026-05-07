import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useMemo, useState } from "react";
import { fmtTime } from "../lib/api";

function haversine(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export default function ElevationChart({
  points = [],
  height = 180,
  testid = "elevation-chart",
  color = "#00E5FF",
}) {
  const [mode, setMode] = useState("distance"); // "distance" | "time"

  const { data, hasTime } = useMemo(() => {
    if (!points || points.length === 0) return { data: [], hasTime: false };
    let cum = 0;
    let t0 = null;
    let anyTime = false;
    const rows = points.map((p, i) => {
      if (i > 0) cum += haversine(points[i - 1], p);
      let secs = null;
      if (p.t) {
        const ts = new Date(p.t).getTime();
        if (!Number.isNaN(ts)) {
          if (t0 == null) t0 = ts;
          secs = (ts - t0) / 1000;
          anyTime = true;
        }
      }
      return {
        d: +(cum / 1000).toFixed(3),
        s: secs,
        ele: p.ele != null ? Math.round(p.ele) : null,
      };
    });
    return { data: rows, hasTime: anyTime };
  }, [points]);

  const hasEle = data.some((d) => d.ele != null);
  if (!hasEle) {
    return (
      <div
        data-testid={`${testid}-empty`}
        className="border border-line bg-surface flex items-center justify-center text-muted text-xs tracking-[0.2em] uppercase"
        style={{ height }}
      >
        No elevation data
      </div>
    );
  }

  const useTime = mode === "time" && hasTime;
  const xKey = useTime ? "s" : "d";
  const xLabel = useTime ? "time / m" : "km / m";

  return (
    <div data-testid={testid} className="border border-line bg-surface p-4" style={{ height }}>
      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="text-[10px] tracking-[0.3em] uppercase text-muted">Elevation Profile</div>
        <div className="flex items-center gap-2">
          <div
            className="inline-flex border border-line"
            role="tablist"
            aria-label="Elevation X axis"
            data-testid={`${testid}-mode`}
          >
            <button
              type="button"
              onClick={() => setMode("distance")}
              data-testid={`${testid}-mode-distance`}
              className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                !useTime ? "bg-accent text-black" : "text-muted hover:text-main"
              }`}
            >
              Distance
            </button>
            <button
              type="button"
              onClick={() => setMode("time")}
              disabled={!hasTime}
              data-testid={`${testid}-mode-time`}
              title={hasTime ? "Show against elapsed time" : "No timestamps in this track"}
              className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] transition-colors ${
                useTime
                  ? "bg-accent text-black"
                  : hasTime
                    ? "text-muted hover:text-main"
                    : "text-faint cursor-not-allowed"
              }`}
            >
              Time
            </button>
          </div>
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted">{xLabel}</div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height="80%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`eleFill-${testid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            type="number"
            dataKey={xKey}
            domain={["dataMin", "dataMax"]}
            stroke="rgba(255,255,255,0.3)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={useTime ? (v) => fmtTime(v) : (v) => `${v}`}
          />
          <YAxis
            stroke="rgba(255,255,255,0.3)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: "#0A0A0C",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 0,
              fontSize: 12,
            }}
            labelStyle={{ color: "#00E5FF" }}
            formatter={(v) => [`${v} m`, "Elevation"]}
            labelFormatter={(l) => (useTime ? fmtTime(l) : `${l} km`)}
          />
          <Area type="monotone" dataKey="ele" stroke={color} strokeWidth={2} fill={`url(#eleFill-${testid})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
