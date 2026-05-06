import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import UploadZone from "../components/UploadZone";
import MapView from "../components/MapView";
import ElevationChart from "../components/ElevationChart";
import {
  deleteSegment,
  getSegment,
  listSegments,
  uploadSegment,
  fmtDistance,
} from "../lib/api";
import { Trash2, MapPin, Mountain } from "lucide-react";
import { toast } from "sonner";

export default function Segments() {
  const [segments, setSegments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();

  async function refresh() {
    const s = await listSegments();
    setSegments(s);
    const qid = params.get("id");
    if (qid) {
      const detail = await getSegment(qid);
      setSelected(detail);
    } else if (!selected && s.length > 0) {
      const d = await getSegment(s[0].id);
      setSelected(d);
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

  async function handleDelete(id, e) {
    e?.stopPropagation();
    if (!window.confirm("Delete this segment and all its efforts?")) return;
    await deleteSegment(id);
    toast.success("Segment deleted");
    if (selected?.id === id) setSelected(null);
    setParams({});
    await refresh();
  }

  const filtered = segments.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-fade-up" data-testid="segments-page">
      <div>
        <div className="text-[10px] tracking-[0.4em] uppercase text-[#00E5FF] mb-3">/ / Segments</div>
        <h1 className="font-display font-black text-4xl md:text-6xl uppercase tracking-tighter leading-[0.9]">
          Define Your Arena
        </h1>
      </div>

      <UploadZone
        onUpload={handleUpload}
        label="Drop Segment GPX"
        sublabel="single-track GPX defining start → end"
        testid="segment-upload"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 border border-white/10 bg-[#0A0A0C]" data-testid="segments-list">
          <div className="p-4 border-b border-white/10">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search segments..."
              data-testid="segments-search"
              className="w-full bg-transparent border border-white/10 px-3 py-2 text-sm focus:outline-none focus:border-[#00E5FF]"
            />
          </div>
          <div className="max-h-[600px] overflow-auto">
            {filtered.length === 0 ? (
              <div className="p-6 text-white/40 text-sm">No segments</div>
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
                  className={`w-full cursor-pointer text-left border-b border-white/5 px-4 py-3 flex items-start gap-3 transition-colors ${
                    selected?.id === s.id ? "bg-[#141418] border-l-2 border-l-[#00E5FF]" : "hover:bg-white/5"
                  }`}
                >
                  <MapPin className="w-4 h-4 text-[#00E5FF] mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{s.name}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-white/40 mt-1">
                      {fmtDistance(s.distance_m)} · +{Math.round(s.elevation_gain_m)}m
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(s.id, e)}
                    data-testid={`segment-delete-${s.id}`}
                    className="p-1 text-white/30 hover:text-[#FF3B30]"
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
              <div className="border border-white/10 bg-[#0A0A0C] p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] tracking-[0.3em] uppercase text-[#00E5FF] mb-2">
                      Segment
                    </div>
                    <h2 className="font-display font-black text-3xl uppercase tracking-tight leading-tight">
                      {selected.name}
                    </h2>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 mt-6">
                  <Stat label="Distance" value={fmtDistance(selected.distance_m)} />
                  <Stat
                    label="Elev Gain"
                    value={`+${Math.round(selected.elevation_gain_m)} m`}
                    icon={Mountain}
                  />
                  <Stat label="Points" value={selected.point_count} />
                </div>
              </div>
              <MapView points={selected.points} color="#00E5FF" height={420} testid="segment-map" />
              <ElevationChart points={selected.points} height={200} testid="segment-elevation" />
            </>
          ) : (
            <div className="border border-white/10 bg-[#0A0A0C] p-12 text-center text-white/40">
              Select a segment to view details.
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
