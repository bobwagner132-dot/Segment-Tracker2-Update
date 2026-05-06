import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useMemo } from "react";

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

export default function ElevationChart({ points = [], height = 180, testid = "elevation-chart", color = "#00E5FF" }) {
  const data = useMemo(() => {
    if (!points || points.length === 0) return [];
    let cum = 0;
    return points.map((p, i) => {
      if (i > 0) cum += haversine(points[i - 1], p);
      return {
        d: +(cum / 1000).toFixed(3),
        ele: p.ele != null ? Math.round(p.ele) : null,
      };
    });
  }, [points]);

  const hasEle = data.some((d) => d.ele != null);

  if (!hasEle) {
    return (
      <div
        data-testid={`${testid}-empty`}
        className="border border-white/10 bg-[#0A0A0C] flex items-center justify-center text-white/40 text-xs tracking-[0.2em] uppercase"
        style={{ height }}
      >
        No elevation data
      </div>
    );
  }

  return (
    <div data-testid={testid} className="border border-white/10 bg-[#0A0A0C] p-4" style={{ height }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] tracking-[0.3em] uppercase text-white/40">Elevation Profile</div>
        <div className="text-[10px] tracking-[0.3em] uppercase text-white/40">km / m</div>
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="eleFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="d"
            stroke="rgba(255,255,255,0.3)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
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
            labelFormatter={(l) => `${l} km`}
          />
          <Area type="monotone" dataKey="ele" stroke={color} strokeWidth={2} fill="url(#eleFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
