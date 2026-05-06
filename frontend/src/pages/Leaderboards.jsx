import { useEffect, useMemo, useState } from "react";
import {
  fmtDateLocal,
  fmtTime,
  listEfforts,
  listSegments,
  localYear,
} from "../lib/api";
import { Trophy, Crown } from "lucide-react";

export default function Leaderboards() {
  const [segments, setSegments] = useState([]);
  const [segmentId, setSegmentId] = useState(null);
  const [efforts, setEfforts] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());

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

  const filtered = useMemo(() => {
    return efforts
      .filter((e) => localYear(e.datetime_utc) === year)
      .sort((a, b) => a.elapsed_s - b.elapsed_s);
  }, [efforts, year]);

  const best = filtered[0];

  return (
    <div className="space-y-8 animate-fade-up" data-testid="leaderboards-page">
      <div>
        <div className="text-[10px] tracking-[0.4em] uppercase text-[#00E5FF] mb-3">
          / / Leaderboards
        </div>
        <h1 className="font-display font-black text-4xl md:text-6xl uppercase tracking-tighter leading-[0.9]">
          Fastest Times
        </h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-[10px] tracking-[0.3em] uppercase text-white/40 block mb-2">
            Segment
          </label>
          <select
            value={segmentId || ""}
            onChange={(e) => setSegmentId(e.target.value)}
            data-testid="leaderboard-segment-select"
            className="w-full bg-[#0A0A0C] border border-white/10 px-3 py-2 text-sm focus:outline-none focus:border-[#00E5FF]"
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
          <label className="text-[10px] tracking-[0.3em] uppercase text-white/40 block mb-2">
            Year
          </label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            data-testid="leaderboard-year-select"
            className="w-full bg-[#0A0A0C] border border-white/10 px-3 py-2 text-sm focus:outline-none focus:border-[#00E5FF]"
          >
            {years.length === 0 ? (
              <option value={year}>{year}</option>
            ) : (
              years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {best && (
        <div
          className="border border-[#CCFF00]/40 bg-[#CCFF00]/5 p-6 flex items-center gap-6"
          data-testid="best-effort-card"
        >
          <Crown className="w-10 h-10 text-[#CCFF00]" strokeWidth={1.5} />
          <div className="flex-1">
            <div className="text-[10px] tracking-[0.3em] uppercase text-[#CCFF00]">
              Best Effort · {year}
            </div>
            <div className="font-num text-5xl font-black mt-1">{fmtTime(best.elapsed_s)}</div>
            <div className="text-xs text-white/60 mt-1">
              {fmtDateLocal(best.datetime_utc)} ·{" "}
              {best.avg_power != null && <>AP {Math.round(best.avg_power)}W · </>}
              {best.avg_hr != null && <>HR {Math.round(best.avg_hr)} bpm</>}
            </div>
          </div>
          <Trophy className="w-8 h-8 text-[#CCFF00]/40 hidden md:block" strokeWidth={1.5} />
        </div>
      )}

      <div className="border border-white/10 bg-[#0A0A0C]" data-testid="leaderboard-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] tracking-[0.2em] uppercase text-white/40 border-b border-white/10">
              <th className="text-left py-3 px-4 w-12">Rank</th>
              <th className="text-left py-3 px-4">Date</th>
              <th className="text-right py-3 px-4">Time</th>
              <th className="text-right py-3 px-4">Avg Power</th>
              <th className="text-right py-3 px-4">Avg HR</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-white/40 text-xs tracking-[0.2em] uppercase">
                  No efforts for this year
                </td>
              </tr>
            ) : (
              filtered.map((e, i) => (
                <tr
                  key={e.id || i}
                  data-testid={`leaderboard-row-${i}`}
                  className={`border-b border-white/5 hover:bg-white/5 ${
                    i === 0 ? "bg-[#CCFF00]/5" : ""
                  }`}
                >
                  <td className="py-3 px-4 font-num text-xl font-black">
                    {i === 0 ? <span className="text-[#CCFF00]">#1</span> : `#${i + 1}`}
                  </td>
                  <td className="py-3 px-4">{fmtDateLocal(e.datetime_utc)}</td>
                  <td className="py-3 px-4 text-right font-num text-xl">{fmtTime(e.elapsed_s)}</td>
                  <td className="py-3 px-4 text-right font-num">
                    {e.avg_power != null ? <>{Math.round(e.avg_power)}<span className="text-white/40 text-xs ml-1">W</span></> : "—"}
                  </td>
                  <td className="py-3 px-4 text-right font-num">
                    {e.avg_hr != null ? <>{Math.round(e.avg_hr)}<span className="text-white/40 text-xs ml-1">bpm</span></> : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
