import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import UploadZone from "../components/UploadZone";
import MapView from "../components/MapView";
import ElevationChart from "../components/ElevationChart";
import EditableName from "../components/EditableName";
import {
  deleteRide,
  getRide,
  listRides,
  uploadRide,
  renameRide,
  fmtDistance,
  fmtTime,
  fmtDateLocal,
} from "../lib/api";
import { Trash2, Route as RouteIcon, Clock } from "lucide-react";
import { toast } from "sonner";

export default function Rides() {
  const [rides, setRides] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const [activeEffortIdx, setActiveEffortIdx] = useState(null);

  async function refresh() {
    const r = await listRides();
    setRides(r);
    const qid = params.get("id");
    if (qid) {
      const detail = await getRide(qid);
      setSelected(detail);
      setActiveEffortIdx(detail.efforts?.length > 0 ? 0 : null);
    } else if (!selected && r.length > 0) {
      const d = await getRide(r[0].id);
      setSelected(d);
      setActiveEffortIdx(d.efforts?.length > 0 ? 0 : null);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(file) {
    const detail = await uploadRide(file);
    await refresh();
    setSelected(detail);
    setParams({ id: detail.id });
  }

  async function handleSelect(id) {
    const d = await getRide(id);
    setSelected(d);
    setActiveEffortIdx(d.efforts?.length > 0 ? 0 : null);
    setParams({ id });
  }

  async function handleDelete(id, e) {
    e?.stopPropagation();
    if (!window.confirm("Delete this ride?")) return;
    await deleteRide(id);
    toast.success("Ride deleted");
    if (selected?.id === id) setSelected(null);
    setParams({});
    await refresh();
  }

  const filtered = rides.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase())
  );

  const overlayPoints =
    selected?.efforts?.length > 0 && activeEffortIdx != null
      ? selected.efforts[activeEffortIdx]?.points || null
      : null;

  return (
    <div className="space-y-8 animate-fade-up" data-testid="rides-page">
      <div>
        <div className="text-[10px] tracking-[0.4em] uppercase text-accent mb-3">/ / Rides</div>
        <h1 className="font-display font-black text-4xl md:text-6xl uppercase tracking-tighter leading-[0.9]">
          Your Logbook
        </h1>
      </div>

      <UploadZone
        onUpload={handleUpload}
        accept=".gpx,.fit"
        label="Drop Ride GPX or FIT"
        sublabel="timestamps, HR, power & cadence extracted"
        testid="ride-upload"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 border border-line bg-surface" data-testid="rides-list">
          <div className="p-4 border-b border-line">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rides..."
              data-testid="rides-search"
              className="w-full bg-transparent border border-line px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div className="max-h-[600px] overflow-auto">
            {filtered.length === 0 ? (
              <div className="p-6 text-muted text-sm">No rides</div>
            ) : (
              filtered.map((r) => (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelect(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") handleSelect(r.id);
                  }}
                  data-testid={`ride-item-${r.id}`}
                  className={`w-full cursor-pointer text-left border-b border-line-subtle px-4 py-3 flex items-start gap-3 transition-colors ${
                    selected?.id === r.id ? "bg-elevated border-l-2 border-l-accent" : "hover:bg-subtle"
                  }`}
                >
                  <RouteIcon className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{r.name}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-muted mt-1">
                      {fmtDateLocal(r.start_time || r.created_at)} ·{" "}
                      {fmtDistance(r.distance_m)} · {r.effort_count} eff
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(r.id, e)}
                    data-testid={`ride-delete-${r.id}`}
                    className="p-1 text-faint hover:text-danger"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-4" data-testid="ride-detail-panel">
          {selected ? (
            <>
              <div className="border border-line bg-surface p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] tracking-[0.3em] uppercase text-accent mb-2">
                      Ride · {selected.source_type.toUpperCase()}
                    </div>
                    <EditableName
                      value={selected.name}
                      testid="ride-name"
                      className="font-display font-black text-3xl uppercase tracking-tight leading-tight"
                      onSave={async (next) => {
                        await renameRide(selected.id, next);
                        toast.success("Renamed");
                        setSelected({ ...selected, name: next });
                        await refresh();
                      }}
                    />
                    <div className="text-xs text-muted mt-2">
                      {fmtDateLocal(selected.start_time || selected.created_at)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                  <Stat label="Distance" value={fmtDistance(selected.distance_m)} />
                  <Stat label="Duration" value={fmtTime(selected.duration_s)} icon={Clock} />
                  <Stat label="Points" value={selected.point_count} />
                  <Stat label="Efforts" value={selected.effort_count} />
                </div>
              </div>

              <MapView
                points={selected.points}
                color="#FF3B30"
                overlayPoints={overlayPoints}
                height={420}
                testid="ride-map"
              />
              <ElevationChart points={selected.points} height={200} color="#FF3B30" testid="ride-elevation" />

              {selected.efforts?.length > 0 && (
                <div className="border border-line bg-surface p-6" data-testid="ride-efforts">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px] tracking-[0.3em] uppercase text-accent">
                      Detected Efforts · {selected.efforts.length}
                    </div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-muted">
                      Click row → highlight on map
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] tracking-[0.2em] uppercase text-muted border-b border-line">
                        <th className="text-left py-2">Segment</th>
                        <th className="text-right py-2">Time</th>
                        <th className="text-right py-2">Power</th>
                        <th className="text-right py-2">HR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.efforts.map((e, i) => (
                        <tr
                          key={e.id || i}
                          onClick={() => setActiveEffortIdx(i)}
                          data-testid={`effort-row-${i}`}
                          className={`border-b border-line-subtle cursor-pointer transition-colors ${
                            activeEffortIdx === i ? "bg-volt-5" : "hover:bg-subtle"
                          }`}
                        >
                          <td className="py-2 text-main truncate max-w-[260px]">
                            {activeEffortIdx === i && (
                              <span className="text-volt mr-2">●</span>
                            )}
                            {e.segment_name || e.segment_id?.slice(0, 8) + "…"}
                          </td>
                          <td className="py-2 text-right font-num text-lg">{fmtTime(e.elapsed_s)}</td>
                          <td className="py-2 text-right font-num">
                            {e.avg_power != null ? <>{Math.round(e.avg_power)}<span className="text-muted text-xs ml-1">W</span></> : "—"}
                          </td>
                          <td className="py-2 text-right font-num">
                            {e.avg_hr != null ? <>{Math.round(e.avg_hr)}<span className="text-muted text-xs ml-1">bpm</span></> : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="border border-line bg-surface p-12 text-center text-muted">
              Select a ride to view details.
            </div>
          )}
        </div>
      </div>
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
