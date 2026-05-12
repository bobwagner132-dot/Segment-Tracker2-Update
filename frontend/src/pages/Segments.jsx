import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import UploadZone from "../components/UploadZone";
import MapView from "../components/MapView";
import ElevationChart from "../components/ElevationChart";
import EditableName from "../components/EditableName";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  deleteSegment,
  getSegment,
  getStats,
  listSegments,
  uploadSegment,
  renameSegment,
  fmtDistance,
  fmtGradient,
} from "../lib/api";
import { Trash2, MapPin, Mountain, TrendingUp, Crown, Activity } from "lucide-react";
import { toast } from "sonner";

function fmtPR(secs) {
  if (secs == null || !Number.isFinite(secs)) return "—";
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

export default function Segments() {
  const [segments, setSegments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const [pendingDelete, setPendingDelete] = useState(null);
  const [totalEffortCount, setTotalEffortCount] = useState(0);

  async function refresh() {
    const [s, stats] = await Promise.all([listSegments(), getStats()]);
    setSegments(s);
    setTotalEffortCount(stats.efforts);
    const qid = params.get("id");
    if (qid) {
      try {
        const detail = await getSegment(qid);
        setSelected(detail);
        return;
      } catch {
        // stale id (e.g. just deleted) — fall through and pick the first segment
        setParams({}, { replace: true });
      }
    }
    if (s.length > 0) {
      const d = await getSegment(s[0].id);
      setSelected(d);
    } else {
      setSelected(null);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(file) {
    const detail = await uploadSegment(file);
    await refresh();
    setSelected(detail);
    setParams({ id: detail.id });
  }

  async function handleSelect(id) {
    const d = await getSegment(id);
    setSelected(d);
    setParams({ id });
  }

  function requestDelete(seg, e) {
    e?.stopPropagation();
    setPendingDelete({ id: seg.id, name: seg.name });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await deleteSegment(id);
    toast.success("Segment deleted");
    setSelected(null);
    setParams({}, { replace: true });
    await refresh();
  }

  const filtered = segments.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-fade-up" data-testid="segments-page">
      <div>
        <div className="font-display font-black text-2xl md:text-4xl tracking-[0.2em] uppercase text-accent">/ / Segments</div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch gap-3">
        <div className="flex-1 min-w-0">
          <UploadZone
            onUpload={handleUpload}
            label="Drop Segment GPX"
            sublabel="single-track GPX defining start → end"
            testid="segment-upload"
            compact
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:w-72 flex-shrink-0">
          <StatCard label="Segments" value={segments.length} testid="seg-count-card" />
          <StatCard label="Detected Efforts" value={totalEffortCount} testid="effort-count-card" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 border border-line bg-surface" data-testid="segments-list">
          <div className="p-4 border-b border-line">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search segments..."
              data-testid="segments-search"
              className="w-full bg-transparent border border-line px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div className="max-h-[600px] overflow-auto">
            {filtered.length === 0 ? (
              <div className="p-6 text-muted text-sm">No segments</div>
            ) : (
              filtered.map((s) => (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelect(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") handleSelect(s.id);
                  }}
                  data-testid={`segment-item-${s.id}`}
                  className={`w-full cursor-pointer text-left border-b border-line-subtle px-4 py-3 flex items-start gap-3 transition-colors ${
                    selected?.id === s.id ? "bg-elevated border-l-2 border-l-accent" : "hover:bg-subtle"
                  }`}
                >
                  <MapPin className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{s.name}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-muted mt-1">
                      {fmtDistance(s.distance_m)} · +{Math.round(s.elevation_gain_m)}m
                    </div>
                    {s.best_effort ? (
                      <div
                        className="mt-2 inline-flex items-center gap-1.5 border border-volt-40 bg-volt-5 px-1.5 py-0.5"
                        data-testid={`segment-pr-${s.id}`}
                      >
                        <Crown className="w-3 h-3 text-volt" strokeWidth={2} />
                        <span className="font-num text-xs font-black text-volt">
                          {fmtPR(s.best_effort.elapsed_s)}
                        </span>
                        <span className="text-[9px] tracking-[0.2em] uppercase text-muted">
                          PR · {s.effort_count}×
                        </span>
                      </div>
                    ) : (
                      <div className="mt-2 text-[9px] tracking-[0.2em] uppercase text-faint">
                        No efforts yet
                      </div>
                    )}
                  </div>
                  <button
                    onClick={(e) => requestDelete(s, e)}
                    data-testid={`segment-delete-${s.id}`}
                    className="p-1 text-faint hover:text-danger"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-4" data-testid="segment-detail-panel">
          {selected ? (
            <>
              <div className="border border-line bg-surface p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] tracking-[0.3em] uppercase text-accent mb-2">
                      Segment
                    </div>
                    <EditableName
                      value={selected.name}
                      testid="segment-name"
                      className="font-display font-black text-3xl uppercase tracking-tight leading-tight"
                      onSave={async (next) => {
                        await renameSegment(selected.id, next);
                        toast.success("Renamed");
                        setSelected({ ...selected, name: next });
                        await refresh();
                      }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 mt-6">
                  <Stat label="Distance" value={fmtDistance(selected.distance_m)} />
                  <Stat
                    label="Elev Gain"
                    value={`+${Math.round(selected.elevation_gain_m)} m`}
                    icon={Mountain}
                  />
                  <Stat
                    label="Avg Gradient"
                    value={fmtGradient(selected.elevation_gain_m, selected.distance_m)}
                    icon={TrendingUp}
                  />
                </div>
              </div>
              <MapView points={selected.points} color="#00E5FF" height={420} testid="segment-map" />
              {selected.best_effort && (
                <div
                  className="border border-volt-40 bg-volt-5 p-5 flex items-center gap-5"
                  data-testid="segment-pr-card"
                >
                  <Crown className="w-9 h-9 text-volt flex-shrink-0" strokeWidth={1.5} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] tracking-[0.3em] uppercase text-volt">
                      Personal Record · {selected.effort_count}× attempts
                    </div>
                    <div className="font-num text-4xl font-black mt-1">
                      {fmtPR(selected.best_effort.elapsed_s)}
                    </div>
                    <div className="text-xs text-secondary mt-1 truncate">
                      on{" "}
                      <button
                        type="button"
                        className="underline decoration-dotted hover:text-accent"
                        onClick={() =>
                          (window.location.href = `/rides?id=${encodeURIComponent(
                            selected.best_effort.ride_id,
                          )}`)
                        }
                        data-testid="segment-pr-ride-link"
                      >
                        {selected.best_effort.ride_name}
                      </button>
                      {selected.best_effort.avg_power != null && (
                        <> · AP {Math.round(selected.best_effort.avg_power)}W</>
                      )}
                      {selected.best_effort.avg_hr != null && (
                        <> · HR {Math.round(selected.best_effort.avg_hr)} bpm</>
                      )}
                    </div>
                  </div>
                  <Activity className="w-7 h-7 text-volt hidden md:block" strokeWidth={1.5} />
                </div>
              )}
              <ElevationChart points={selected.points} height={200} testid="segment-elevation" />
            </>
          ) : (
            <div className="border border-line bg-surface p-12 text-center text-muted">
              Select a segment to view details.
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this segment?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" and every detected effort against it will be permanently removed. This cannot be undone.`
            : null
        }
        confirmLabel="Delete segment"
        cancelLabel="Keep"
        destructive
        testid="delete-segment-confirm"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function Stat({ label, value, icon: Icon }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.3em] uppercase text-muted flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </div>
      <div className="font-num text-3xl font-black mt-1">{value}</div>
    </div>
  );
}

function StatCard({ label, value, testid }) {
  return (
    <div
      className="border border-line bg-surface px-4 py-2 flex items-center justify-between"
      data-testid={testid}
    >
      <div className="text-[10px] tracking-[0.3em] uppercase text-muted">{label}</div>
      <div className="font-num text-2xl font-black leading-none">{value}</div>
    </div>
  );
}
