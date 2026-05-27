// Leaderboards page.
//
// Shows every effort against a chosen segment, grouped by calendar year.
// Indoor efforts (sub_sport in {Indoor, Generic}) are flagged with a tint
// + pill and are hidden by default — controlled by a "Show indoor efforts"
// toggle. The "Best Effort" hero card and the #1 rank are always computed
// from OUTDOOR efforts only, so indoor PRs can never displace your real
// outdoor record.

import { useEffect, useMemo, useState } from "react";
import {
  fmtDateLocal,
  fmtTime,
  listEfforts,
  listSegments,
  localYear,
} from "../lib/api";
import { Trophy, Crown, Home } from "lucide-react";

export default function Leaderboards() {
  const [segments, setSegments] = useState([]);
  const [segmentId, setSegmentId] = useState(null);
  const [efforts, setEfforts] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [showIndoor, setShowIndoor] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await listSegments();
      setSegments(s);
      if (s.length > 0) setSegmentId(s[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!segmentId) return;
    (async () => {
      const e = await listEfforts(segmentId);
      setEfforts(e);
    })();
  }, [segmentId]);

  const years = useMemo(() => {
    const ys = new Set();
    efforts.forEach((e) => {
      const y = localYear(e.datetime_utc);
      if (y) ys.add(y);
    });
    return Array.from(ys).sort((a, b) => b - a);
  }, [efforts]);

  useEffect(() => {
    if (years.length > 0 && !years.includes(year)) {
      setYear(years[0]);
    }
  }, [years, year]);

  // Outdoor-only subset for the chosen year — always sorted, always used
  // for the #1 rank and the Best Effort hero. Indoor efforts never beat it.
  const outdoorThisYear = useMemo(() => {
    return efforts
      .filter((e) => !e.is_indoor && localYear(e.datetime_utc) === year)
      .sort((a, b) => a.elapsed_s - b.elapsed_s);
  }, [efforts, year]);

  // What we actually render in the table — outdoor + (optionally) indoor,
  // merged into one ranking. Indoor rows still get an INDOOR pill + tint
  // so they're visually distinct.
  const tableRows = useMemo(() => {
    const inYear = efforts.filter((e) => localYear(e.datetime_utc) === year);
    const filtered = showIndoor ? inYear : inYear.filter((e) => !e.is_indoor);
    return filtered.sort((a, b) => a.elapsed_s - b.elapsed_s);
  }, [efforts, year, showIndoor]);

  const indoorCountThisYear = useMemo(
    () => efforts.filter((e) => e.is_indoor && localYear(e.datetime_utc) === year).length,
    [efforts, year],
  );

  const best = outdoorThisYear[0]; // outdoor-only by design

  return (
    <div className="space-y-8 animate-fade-up" data-testid="leaderboards-page">
      <div>
        <div className="font-display font-black text-2xl md:text-4xl tracking-[0.2em] uppercase text-accent">
          / / Leaderboards
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div>
          <label className="text-[10px] tracking-[0.3em] uppercase text-muted block mb-2">
            Segment
          </label>
          <select
            value={segmentId || ""}
            onChange={(e) => setSegmentId(e.target.value)}
            data-testid="leaderboard-segment-select"
            className="w-full bg-surface border border-line px-3 py-2 text-sm focus:outline-none focus:border-accent"
          >
            {segments.length === 0 && <option>No segments</option>}
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] tracking-[0.3em] uppercase text-muted block mb-2">
            Year
          </label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            data-testid="leaderboard-year-select"
            className="w-full bg-surface border border-line px-3 py-2 text-sm focus:outline-none focus:border-accent"
          >
            {years.length === 0 ? (
              <option>No data</option>
            ) : (
              years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))
            )}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[10px] tracking-[0.3em] uppercase text-muted">
            Indoor efforts
          </span>
          <label
            className="inline-flex items-center gap-2 cursor-pointer select-none"
            data-testid="leaderboard-indoor-toggle"
          >
            <input
              type="checkbox"
              checked={showIndoor}
              onChange={(e) => setShowIndoor(e.target.checked)}
              className="w-4 h-4 accent-amber-400"
            />
            <span className="text-sm">
              Show indoor efforts
              {indoorCountThisYear > 0 && (
                <span className="text-muted ml-2 text-xs">
                  ({indoorCountThisYear} this year)
                </span>
              )}
            </span>
          </label>
        </div>
      </div>

      {best && (
        <div
          className="border border-volt-40 bg-volt-5 p-6 flex items-center gap-6"
          data-testid="best-effort-card"
        >
          <Crown className="w-10 h-10 text-volt" strokeWidth={1.5} />
          <div className="flex-1">
            <div className="text-[10px] tracking-[0.3em] uppercase text-volt">
              Best Effort · {year} · outdoor only
            </div>
            <div className="font-num text-5xl font-black mt-1">{fmtTime(best.elapsed_s)}</div>
            <div className="text-xs text-secondary mt-1">
              {fmtDateLocal(best.datetime_utc)} ·{" "}
              {best.avg_power != null && <>AP {Math.round(best.avg_power)}W · </>}
              {best.avg_hr != null && <>HR {Math.round(best.avg_hr)} bpm</>}
            </div>
          </div>
          <Trophy className="w-8 h-8 text-volt hidden md:block" strokeWidth={1.5} />
        </div>
      )}

      <div className="border border-line bg-surface" data-testid="leaderboard-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] tracking-[0.2em] uppercase text-muted border-b border-line">
              <th className="text-left py-3 px-4 w-12">Rank</th>
              <th className="text-left py-3 px-4">Date</th>
              <th className="text-right py-3 px-4">Time</th>
              <th className="text-right py-3 px-4">Avg Power</th>
              <th className="text-right py-3 px-4">Avg HR</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted text-xs tracking-[0.2em] uppercase">
                  {indoorCountThisYear > 0 && !showIndoor
                    ? `No outdoor efforts for ${year} — ${indoorCountThisYear} indoor hidden`
                    : "No efforts for this year"}
                </td>
              </tr>
            ) : (
              tableRows.map((e, i) => {
                const isIndoor = !!e.is_indoor;
                const isBestOutdoor = !isIndoor && best && e.id === best.id;
                return (
                  <tr
                    key={e.id || i}
                    data-testid={`leaderboard-row-${i}`}
                    className={
                      "border-b border-line-subtle hover:bg-subtle " +
                      (isIndoor
                        ? "bg-amber-50/40 dark:bg-amber-900/10 text-secondary"
                        : isBestOutdoor
                        ? "bg-volt-5"
                        : "")
                    }
                  >
                    <td className="py-3 px-4 font-num text-xl font-black">
                      {isBestOutdoor ? (
                        <span className="text-volt">#1</span>
                      ) : (
                        `#${i + 1}`
                      )}
                    </td>
                    <td className="py-3 px-4 flex items-center gap-2">
                      <span>{fmtDateLocal(e.datetime_utc)}</span>
                      {isIndoor && (
                        <span
                          className="inline-flex items-center gap-1 text-[9px] tracking-[0.2em] uppercase font-bold text-amber-700 dark:text-amber-300 border border-amber-400/50 px-1.5 py-0.5"
                          title="Indoor / trainer ride — excluded from outdoor PR"
                          data-testid={`leaderboard-row-${i}-indoor-pill`}
                        >
                          <Home className="w-2.5 h-2.5" strokeWidth={2.2} />
                          Indoor
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-num text-xl">{fmtTime(e.elapsed_s)}</td>
                    <td className="py-3 px-4 text-right font-num">
                      {e.avg_power != null ? <>{Math.round(e.avg_power)}<span className="text-muted text-xs ml-1">W</span></> : "—"}
                    </td>
                    <td className="py-3 px-4 text-right font-num">
                      {e.avg_hr != null ? <>{Math.round(e.avg_hr)}<span className="text-muted text-xs ml-1">bpm</span></> : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
