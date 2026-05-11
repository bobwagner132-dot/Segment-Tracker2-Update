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
import { Trash2, MapPin, Mountain, TrendingUp } from "lucide-react";
import { toast } from "sonner";

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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          <UploadZone
            onUpload={handleUpload}
            label="Drop Segment GPX"
            sublabel="single-track GPX defining start → end"
            testid="segment-upload"
          />
        </div>
        <div className="lg:col-span-4 grid grid-cols-2 gap-3">
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
      className="border border-line bg-surface p-5 flex flex-col justify-between"
      data-testid={testid}
    >
      <div className="text-[10px] tracking-[0.3em] uppercase text-muted">{label}</div>
      <div className="font-num text-5xl font-black mt-2 leading-none">{value}</div>
    </div>
  );
}
