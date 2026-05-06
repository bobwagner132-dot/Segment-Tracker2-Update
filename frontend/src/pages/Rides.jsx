import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import UploadZone from "../components/UploadZone";
import MapView from "../components/MapView";
import ElevationChart from "../components/ElevationChart";
import {
  deleteRide,
  getRide,
  listRides,
  uploadRide,
  fmtDistance,
  fmtTime,
  fmtDateLocal,
} from "../lib/api";
import { Trash2, Route as RouteIcon, Heart, Zap, Clock } from "lucide-react";
import { toast } from "sonner";

export default function Rides() {
  const [rides, setRides] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();

  async function refresh() {
    const r = await listRides();
    setRides(r);
    const qid = params.get("id");
    if (qid) {
      const detail = await getRide(qid);
      setSelected(detail);
    } else if (!selected && r.length > 0) {
      const d = await getRide(r[0].id);
      setSelected(d);
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

  // Compute overlay points for first effort (if any)
  let overlayPoints = null;
  if (selected?.efforts?.length > 0 && selected?.points) {
    const eff = selected.efforts[0];
    // Note: points are decimated; the stored indices may not map. Use time-range match instead.
    // For simplicity skip overlay; show all efforts in a list.
  }

  return (
    <div className="space-y-8 animate-fade-up" data-testid="rides-page">
      <div>
        <div className="text-[10px] tracking-[0.4em] uppercase text-[#00E5FF] mb-3">/ / Rides</div>
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
        <div className="lg:col-span-4 border border-white/10 bg-[#0A0A0C]" data-testid="rides-list">
          <div className="p-4 border-b border-white/10">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rides..."
              data-testid="rides-search"
              className="w-full bg-transparent border border-white/10 px-3 py-2 text-sm focus:outline-none focus:border-[#00E5FF]"
            />
          </div>
          <div className="max-h-[600px] overflow-auto">
            {filtered.length === 0 ? (
              <div className="p-6 text-white/40 text-sm">No rides</div>
            ) : (
              filtered.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleSelect(r.id)}
                  data-testid={`ride-item-${r.id}`}
                  className={`w-full text-left border-b border-white/5 px-4 py-3 flex items-start gap-3 transition-colors ${
                    selected?.id === r.id ? "bg-[#141418] border-l-2 border-l-[#00E5FF]" : "hover:bg-white/5"
                  }`}
                >
                  <RouteIcon className="w-4 h-4 text-[#00E5FF] mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{r.name}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-white/40 mt-1">
                      {fmtDateLocal(r.start_time || r.created_at)} ·{" "}
                      {fmtDistance(r.distance_m)} · {r.effort_count} eff
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(r.id, e)}
                    data-testid={`ride-delete-${r.id}`}
                    className="p-1 text-white/30 hover:text-[#FF3B30]"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-4" data-testid="ride-detail-panel">
          {selected ? (
            <>
              <div className="border border-white/10 bg-[#0A0A0C] p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[10px] tracking-[0.3em] uppercase text-[#00E5FF] mb-2">
                      Ride · {selected.source_type.toUpperCase()}
                    </div>
                    <h2 className="font-display font-black text-3xl uppercase tracking-tight leading-tight truncate">
                      {selected.name}
                    </h2>
                    <div className="text-xs text-white/50 mt-2">
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
                <div className="border border-white/10 bg-[#0A0A0C] p-6" data-testid="ride-efforts">
                  <div className="text-[10px] tracking-[0.3em] uppercase text-[#00E5FF] mb-3">
                    Detected Efforts · {selected.efforts.length}
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] tracking-[0.2em] uppercase text-white/40 border-b border-white/10">
                        <th className="text-left py-2">Segment</th>
                        <th className="text-right py-2">Time</th>
                        <th className="text-right py-2">Power</th>
                        <th className="text-right py-2">HR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.efforts.map((e, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-2 text-white/80">{e.segment_id?.slice(0, 8)}…</td>
                          <td className="py-2 text-right font-num text-lg">{fmtTime(e.elapsed_s)}</td>
                          <td className="py-2 text-right font-num">
                            {e.avg_power != null ? <>{Math.round(e.avg_power)}<span className="text-white/40 text-xs ml-1">W</span></> : "—"}
                          </td>
                          <td className="py-2 text-right font-num">
                            {e.avg_hr != null ? <>{Math.round(e.avg_hr)}<span className="text-white/40 text-xs ml-1">bpm</span></> : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="border border-white/10 bg-[#0A0A0C] p-12 text-center text-white/40">
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
      <div className="text-[10px] tracking-[0.3em] uppercase text-white/40 flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </div>
      <div className="font-num text-3xl font-black mt-1">{value}</div>
    </div>
  );
}
