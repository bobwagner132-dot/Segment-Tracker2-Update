import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getStats, listRides, listSegments } from "../lib/api";
import { Map, Route, Trophy, Activity, ArrowRight } from "lucide-react";
import { fmtDistance, fmtTime, fmtDateLocal } from "../lib/api";

export default function Dashboard() {
  const [stats, setStats] = useState({ segments: 0, rides: 0, efforts: 0 });
  const [rides, setRides] = useState([]);
  const [segments, setSegments] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [s, r, sg] = await Promise.all([getStats(), listRides(), listSegments()]);
        setStats(s);
        setRides(r.slice(0, 5));
        setSegments(sg.slice(0, 5));
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const cards = [
    { label: "Segments", value: stats.segments, icon: Map, to: "/segments", testid: "stat-segments" },
    { label: "Rides", value: stats.rides, icon: Route, to: "/rides", testid: "stat-rides" },
    { label: "Detected Efforts", value: stats.efforts, icon: Trophy, to: "/leaderboards", testid: "stat-efforts" },
  ];

  return (
    <div className="space-y-10 animate-fade-up" data-testid="dashboard-page">
      <div>
        <div className="text-[10px] tracking-[0.4em] uppercase text-[#00E5FF] mb-3">
          / / Overview
        </div>
        <h1 className="font-display font-black text-5xl md:text-7xl uppercase tracking-tighter leading-[0.9]">
          Command
          <br />
          <span className="text-[#00E5FF]">Center</span>
        </h1>
        <p className="text-white/60 text-sm mt-4 max-w-xl">
          Every segment. Every ride. Every effort. Tracked locally, analysed with precision.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="stats-grid">
        {cards.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            data-testid={c.testid}
            className="border border-white/10 bg-[#0A0A0C] p-6 hover:bg-[#141418] hover:border-[#00E5FF]/50 transition-colors duration-150 group"
          >
            <div className="flex items-center justify-between">
              <div className="text-[10px] tracking-[0.3em] uppercase text-white/40">
                {c.label}
              </div>
              <c.icon className="w-4 h-4 text-white/30 group-hover:text-[#00E5FF]" strokeWidth={1.5} />
            </div>
            <div className="font-num text-7xl font-black mt-3 leading-none">{c.value}</div>
            <div className="mt-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-white/40 group-hover:text-[#00E5FF]">
              View <ArrowRight className="w-3 h-3" />
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-white/10 bg-[#0A0A0C] p-6" data-testid="recent-rides">
          <div className="flex items-center justify-between mb-4">
            <div className="font-display font-bold uppercase tracking-tight text-lg">
              Recent Rides
            </div>
            <Link to="/rides" className="text-[10px] uppercase tracking-[0.3em] text-[#00E5FF]">
              All →
            </Link>
          </div>
          {rides.length === 0 ? (
            <div className="text-white/40 text-sm">No rides uploaded yet.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {rides.map((r) => (
                <Link
                  key={r.id}
                  to={`/rides?id=${r.id}`}
                  data-testid={`recent-ride-${r.id}`}
                  className="flex items-center justify-between py-3 hover:bg-white/5 px-2 -mx-2"
                >
                  <div>
                    <div className="font-semibold text-sm truncate max-w-[240px]">{r.name}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-white/40">
                      {fmtDateLocal(r.start_time || r.created_at)} · {r.source_type.toUpperCase()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-num text-xl">{fmtDistance(r.distance_m)}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-white/40">
                      {fmtTime(r.duration_s)} · {r.effort_count} efforts
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="border border-white/10 bg-[#0A0A0C] p-6" data-testid="recent-segments">
          <div className="flex items-center justify-between mb-4">
            <div className="font-display font-bold uppercase tracking-tight text-lg">
              Segments
            </div>
            <Link to="/segments" className="text-[10px] uppercase tracking-[0.3em] text-[#00E5FF]">
              All →
            </Link>
          </div>
          {segments.length === 0 ? (
            <div className="text-white/40 text-sm">No segments defined yet.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {segments.map((s) => (
                <Link
                  key={s.id}
                  to={`/segments?id=${s.id}`}
                  data-testid={`recent-segment-${s.id}`}
                  className="flex items-center justify-between py-3 hover:bg-white/5 px-2 -mx-2"
                >
                  <div>
                    <div className="font-semibold text-sm truncate max-w-[240px]">{s.name}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-white/40 flex items-center gap-1">
                      <Activity className="w-3 h-3" /> {fmtDateLocal(s.created_at)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-num text-xl">{fmtDistance(s.distance_m)}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-white/40">
                      +{Math.round(s.elevation_gain_m)} m
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
