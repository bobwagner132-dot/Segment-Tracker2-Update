import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getYearlyStats } from "../lib/api";
import { Route as RouteIcon, Mountain, Calendar } from "lucide-react";

const DISTANCE_COLOR = "#1E88E5"; // material blue 600 — bluer than the accent cyan
const ELEVATION_COLOR = "#4A8F2C"; // darker olive/leaf green for clear contrast on light bg

export default function YearlyStatsBlock() {
  const [year, setYear] = useState(null);
  const [data, setData] = useState(null);

  async function load(y) {
    const stats = await getYearlyStats(y);
    setData(stats);
    if (y == null) setYear(stats.year);
  }

  useEffect(() => {
    load(null);
  }, []);

  if (!data) {
    return (
      <div className="border border-line bg-surface p-8 text-muted text-sm text-center">
        Loading yearly stats…
      </div>
    );
  }

  const noData = data.years.length === 0;

  return (
    <div className="space-y-4" data-testid="yearly-stats-block">
      {/* Header: year picker + totals */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Calendar className="w-4 h-4 text-accent" strokeWidth={1.8} />
          <span className="text-[10px] tracking-[0.3em] uppercase text-muted">Showing year</span>
          {noData ? (
            <span className="font-display font-black text-2xl">{data.year}</span>
          ) : (
            <select
              value={year || data.year}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setYear(v);
                load(v);
              }}
              data-testid="year-picker"
              className="bg-transparent border-b border-line-strong focus:border-accent text-2xl font-display font-black uppercase tracking-tight px-1 py-1 focus:outline-none cursor-pointer"
            >
              {data.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-6 text-sm">
          <Total label="Distance" value={`${data.totals.distance_km.toFixed(1)} km`} color={DISTANCE_COLOR} />
          <Total label="Climbed" value={`+${data.totals.elevation_m} m`} color={ELEVATION_COLOR} />
          <Total label="Activities" value={data.totals.ride_count} />
        </div>
      </div>

      {/* Bar charts side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MonthlyBar
          data={data.months}
          dataKey="distance_km"
          unit="km"
          color={DISTANCE_COLOR}
          icon={RouteIcon}
          title="Distance per month"
          testid="bar-distance"
        />
        <MonthlyBar
          data={data.months}
          dataKey="elevation_m"
          unit="m"
          color={ELEVATION_COLOR}
          icon={Mountain}
          title="Elevation per month"
          testid="bar-elevation"
        />
      </div>

      {/* Full-width cumulative line chart */}
      <CumulativeChart cumulative={data.cumulative} year={data.year} />
    </div>
  );
}

function Total({ label, value, color }) {
  return (
    <div className="text-right">
      <div className="text-[10px] tracking-[0.3em] uppercase text-muted">{label}</div>
      <div className="font-num font-black text-xl" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function MonthlyBar({ data, dataKey, unit, color, title, icon: Icon, testid }) {
  return (
    <div className="border border-line bg-surface p-4" data-testid={testid}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] tracking-[0.3em] uppercase text-muted flex items-center gap-2">
          {Icon && <Icon className="w-3 h-3" style={{ color }} />}
          {title}
        </div>
        <div className="text-[10px] tracking-[0.2em] uppercase text-faint">{unit}</div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="rgba(127,127,127,0.12)" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="rgba(127,127,127,0.6)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke="rgba(127,127,127,0.6)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            cursor={{ fill: "rgba(127,127,127,0.06)" }}
            contentStyle={{
              background: "var(--t-surface)",
              border: "1px solid var(--t-border-strong)",
              borderRadius: 0,
              fontSize: 12,
            }}
            labelStyle={{ color }}
            formatter={(v) => [`${v} ${unit}`, dataKey === "distance_km" ? "Distance" : "Elevation"]}
          />
          <Bar dataKey={dataKey} fill={color} radius={[0, 0, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CumulativeChart({ cumulative, year }) {
  const yearStart = useMemo(() => new Date(year, 0, 1).getTime(), [year]);
  const yearEnd = useMemo(() => new Date(year, 11, 31, 23, 59).getTime(), [year]);

  // X axis: month ticks (one per month)
  const monthTicks = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => new Date(year, i, 1).getTime());
  }, [year]);

  return (
    <div className="border border-line bg-surface p-4" data-testid="cumulative-chart">
      <div className="flex items-center justify-between mb-3 gap-4">
        <div className="text-[10px] tracking-[0.3em] uppercase text-muted">
          Cumulative progress · {year}
        </div>
        <div className="flex items-center gap-4 text-[10px] tracking-[0.3em] uppercase">
          <span className="flex items-center gap-1" style={{ color: DISTANCE_COLOR }}>
            <span className="w-3 h-0.5" style={{ background: DISTANCE_COLOR }} />
            Distance
          </span>
          <span className="flex items-center gap-1" style={{ color: ELEVATION_COLOR }}>
            <span className="w-3 h-0.5" style={{ background: ELEVATION_COLOR }} />
            Elevation
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={cumulative} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(127,127,127,0.12)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={[yearStart, yearEnd]}
            ticks={monthTicks}
            tickFormatter={(t) =>
              new Date(t).toLocaleDateString(undefined, { month: "short" })
            }
            stroke="rgba(127,127,127,0.6)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="left"
            stroke={DISTANCE_COLOR}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v) => `${v} km`}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke={ELEVATION_COLOR}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v) => `${v} m`}
          />
          <Tooltip
            contentStyle={{
              background: "var(--t-surface)",
              border: "1px solid var(--t-border-strong)",
              borderRadius: 0,
              fontSize: 12,
            }}
            labelFormatter={(t) =>
              new Date(t).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            }
            formatter={(v, n) =>
              n === "Distance"
                ? [`${v} km`, "Distance"]
                : [`${v} m`, "Elevation"]
            }
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="distance_km"
            name="Distance"
            stroke={DISTANCE_COLOR}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="elevation_m"
            name="Elevation"
            stroke={ELEVATION_COLOR}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
