import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { deleteAllRides, getStats, listRides, listSegments } from "../lib/api";
import { ArrowRight, Trash2, Activity } from "lucide-react";
import { fmtDistance, fmtTime, fmtDateLocal } from "../lib/api";
import ConfirmDialog from "../components/ConfirmDialog";
import YearlyStatsBlock from "../components/YearlyStatsBlock";
import { toast } from "sonner";

export default function Dashboard() {
  const [stats, setStats] = useState({ segments: 0, rides: 0, efforts: 0 });
  const [rides, setRides] = useState([]);
  const [segments, setSegments] = useState([]);
  const [confirmingPurge, setConfirmingPurge] = useState(false);

  async function refresh() {
    try {
      const [s, r, sg] = await Promise.all([getStats(), listRides(), listSegments()]);
      setStats(s);
      setRides(r.slice(0, 5));
      setSegments(sg.slice(0, 5));
    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handlePurge() {
    setConfirmingPurge(false);
    await deleteAllRides();
    toast.success("All activities cleared");
    await refresh();
  }

  return (
    <div className="space-y-10 animate-fade-up" data-testid="dashboard-page">
      <div>
        <div className="font-display font-black text-2xl md:text-4xl tracking-[0.2em] uppercase text-accent">
          / / Overview
        </div>
        <p className="text-secondary text-sm mt-3 max-w-xl">
          Every segment. Every activity. Every effort. Tracked locally, analysed with precision.
        </p>

        {/* TEMP dev tool — remove once the app is finished */}
        <div className="mt-5 inline-flex items-center gap-3 border border-dashed border-line-strong px-4 py-2">
          <span className="text-[10px] tracking-[0.3em] uppercase text-muted">
            Dev tool
          </span>
          <button
            type="button"
            onClick={() => setConfirmingPurge(true)}
            disabled={stats.rides === 0}
            data-testid="dev-delete-all-rides"
            className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] font-bold text-danger hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete all activities ({stats.rides})
          </button>
        </div>
      </div>

      <YearlyStatsBlock />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border border-line bg-surface p-6" data-testid="recent-rides">
          <div className="flex items-center justify-between mb-4">
            <div className="font-display font-bold uppercase tracking-tight text-lg">
              Recent Activities
            </div>
            <Link to="/rides" className="text-[10px] uppercase tracking-[0.3em] text-accent">
              All →
            </Link>
          </div>
          {rides.length === 0 ? (
            <div className="text-muted text-sm">No activities uploaded yet.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {rides.map((r) => (
                <Link
                  key={r.id}
                  to={`/rides?id=${r.id}`}
                  data-testid={`recent-ride-${r.id}`}
                  className="flex items-center justify-between py-3 hover:bg-subtle px-2 -mx-2"
                >
                  <div>
                    <div className="font-semibold text-sm truncate max-w-[240px]">{r.name}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-muted">
                      {fmtDateLocal(r.start_time || r.created_at)} · {r.source_type.toUpperCase()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-num text-xl">{fmtDistance(r.distance_m)}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-muted">
                      {fmtTime(r.duration_s)} · {r.effort_count} efforts
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="border border-line bg-surface p-6" data-testid="recent-segments">
          <div className="flex items-center justify-between mb-4">
            <div className="font-display font-bold uppercase tracking-tight text-lg">
              Segments
            </div>
            <Link to="/segments" className="text-[10px] uppercase tracking-[0.3em] text-accent">
              All →
            </Link>
          </div>
          {segments.length === 0 ? (
            <div className="text-muted text-sm">No segments defined yet.</div>
          ) : (
            <div className="divide-y divide-white/5">
              {segments.map((s) => (
                <Link
                  key={s.id}
                  to={`/segments?id=${s.id}`}
                  data-testid={`recent-segment-${s.id}`}
                  className="flex items-center justify-between py-3 hover:bg-subtle px-2 -mx-2"
                >
                  <div>
                    <div className="font-semibold text-sm truncate max-w-[240px]">{s.name}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-muted flex items-center gap-1">
                      <Activity className="w-3 h-3" /> {fmtDateLocal(s.created_at)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-num text-xl">{fmtDistance(s.distance_m)}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-muted">
                      +{Math.round(s.elevation_gain_m)} m
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingPurge}
        title={`Delete all ${stats.rides} activities?`}
        description="Every uploaded activity AND every detected effort will be permanently removed. Segments and bike registry are kept. This cannot be undone."
        confirmLabel="Delete everything"
        cancelLabel="Keep"
        destructive
        testid="purge-activities-confirm"
        onConfirm={handlePurge}
        onCancel={() => setConfirmingPurge(false)}
      />
    </div>
  );
}
