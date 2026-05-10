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
  fmtSpeed,
  fmtTimeOfDay,
} from "../lib/api";
import {
  Trash2,
  Route as RouteIcon,
  Clock,
  Mountain,
  Bike,
  Cpu,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

export default function Rides() {
  const [rides, setRides] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const [activeEffortIdx, setActiveEffortIdx] = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(null);

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
    setExpandedIdx(null);
    setParams({ id });
  }

  async function handleDelete(id, e) {
    e?.stopPropagation();
    if (!window.confirm("Delete this activity?")) return;
    await deleteRide(id);
    toast.success("Activity deleted");
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
        <div className="text-[10px] tracking-[0.4em] uppercase text-accent mb-3">/ / Activities</div>
        <h1 className="font-display font-black text-4xl md:text-6xl uppercase tracking-tighter leading-[0.9]">
          Your Logbook
        </h1>
      </div>

      <UploadZone
        onUpload={handleUpload}
        accept=".gpx,.fit"
        label="Drop Activity GPX or FIT"
        sublabel="timestamps, HR, power, cadence, bike & device extracted"
        testid="ride-upload"
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 border border-line bg-surface" data-testid="rides-list">
          <div className="p-4 border-b border-line">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search activities..."
              data-testid="rides-search"
              className="w-full bg-transparent border border-line px-3 py-2 text-sm focus:outline-none focus:border-accent"
            />
          </div>
          <div className="max-h-[600px] overflow-auto">
            {filtered.length === 0 ? (
              <div className="p-6 text-muted text-sm">No activities</div>
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
                    <div className="text-[10px] tracking-[0.2em] uppercase text-muted mt-1 truncate">
                      {fmtDateLocal(r.start_time || r.created_at)}
                      {(r.bike_name || r.device) && (
                        <> · {[r.bike_name, r.device].filter(Boolean).join(" / ")}</>
                      )}
                      {" · "}
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
                      Activity · {selected.source_type.toUpperCase()}
                      {selected.sub_sport ? ` · ${selected.sub_sport}` : selected.sport ? ` · ${selected.sport}` : ""}
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
                    <div className="text-xs text-muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>{fmtDateLocal(selected.start_time || selected.created_at)}</span>
                      {selected.bike_name && (
                        <span className="flex items-center gap-1" data-testid="ride-bike">
                          <Bike className="w-3 h-3 text-accent" /> {selected.bike_name}
                        </span>
                      )}
                      {selected.device && (
                        <span className="flex items-center gap-1" data-testid="ride-device">
                          <Cpu className="w-3 h-3 text-accent" /> {selected.device}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                  <Stat label="Distance" value={fmtDistance(selected.distance_m)} />
                  <Stat label="Duration" value={fmtTime(selected.duration_s)} icon={Clock} />
                  <Stat
                    label="Elev Gain"
                    value={`+${Math.round(selected.elevation_gain_m || 0)} m`}
                    icon={Mountain}
                  />
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
                      Click row → highlight · click chevron → expand
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] tracking-[0.2em] uppercase text-muted border-b border-line">
                        <th className="w-8" />
                        <th className="text-left py-2">Segment</th>
                        <th className="text-right py-2">Time</th>
                        <th className="text-right py-2">Power</th>
                        <th className="text-right py-2">HR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.efforts.map((e, i) => (
                        <EffortRow
                          key={e.id || i}
                          effort={e}
                          index={i}
                          active={activeEffortIdx === i}
                          expanded={expandedIdx === i}
                          onSelect={() => setActiveEffortIdx(i)}
                          onToggleExpand={() =>
                            setExpandedIdx((cur) => (cur === i ? null : i))
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="border border-line bg-surface p-12 text-center text-muted">
              Select an activity to view details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EffortRow({ effort: e, index, active, expanded, onSelect, onToggleExpand }) {
  return (
    <>
      <tr
        onClick={onSelect}
        data-testid={`effort-row-${index}`}
        className={`border-b border-line-subtle cursor-pointer transition-colors ${
          active ? "bg-volt-5" : "hover:bg-subtle"
        }`}
      >
        <td className="w-8 text-center">
          <button
            onClick={(ev) => {
              ev.stopPropagation();
              onToggleExpand();
            }}
            data-testid={`effort-expand-${index}`}
            className="p-1 text-muted hover:text-accent"
            aria-label={expanded ? "Collapse details" : "Expand details"}
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        </td>
        <td className="py-2 text-main truncate max-w-[260px]">
          {active && <span className="text-volt mr-2">●</span>}
          {e.segment_name || (e.segment_id ? e.segment_id.slice(0, 8) + "…" : "—")}
        </td>
        <td className="py-2 text-right font-num text-lg">{fmtTime(e.elapsed_s)}</td>
        <td className="py-2 text-right font-num">
          {e.avg_power != null ? (
            <>
              {Math.round(e.avg_power)}
              <span className="text-muted text-xs ml-1">W</span>
            </>
          ) : (
            "—"
          )}
        </td>
        <td className="py-2 text-right font-num">
          {e.avg_hr != null ? (
            <>
              {Math.round(e.avg_hr)}
              <span className="text-muted text-xs ml-1">bpm</span>
            </>
          ) : (
            "—"
          )}
        </td>
      </tr>
      {expanded && (
        <tr
          data-testid={`effort-details-${index}`}
          className="bg-subtle border-b border-line-subtle"
        >
          <td colSpan={5} className="px-4 py-4">
            <div className="text-[10px] tracking-[0.3em] uppercase text-accent mb-3">
              Expanded details
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
              <Detail label="Date" value={fmtDateLocal(e.datetime_utc)} />
              <Detail label="Start time" value={fmtTimeOfDay(e.datetime_utc)} />
              <Detail label="Moving time" value={fmtTime(e.moving_time_s ?? e.elapsed_s)} />
              <Detail label="Distance" value={fmtDistance(e.distance_m)} />
              <Detail label="Avg speed" value={fmtSpeed(e.avg_speed_mps)} />
              <Detail label="Max speed" value={fmtSpeed(e.max_speed_mps)} />
              <Detail
                label="Avg HR"
                value={e.avg_hr != null ? `${Math.round(e.avg_hr)} bpm` : "—"}
              />
              <Detail
                label="Max HR"
                value={e.max_hr != null ? `${Math.round(e.max_hr)} bpm` : "—"}
              />
              <Detail
                label="Avg cadence"
                value={e.avg_cadence != null ? `${Math.round(e.avg_cadence)} rpm` : "—"}
              />
              <Detail
                label="Avg power"
                value={e.avg_power != null ? `${Math.round(e.avg_power)} W` : "—"}
              />
              <Detail
                label="Max power"
                value={e.max_power != null ? `${Math.round(e.max_power)} W` : "—"}
              />
              <Detail
                label="Elev gained"
                value={e.elevation_gain_m != null ? `+${Math.round(e.elevation_gain_m)} m` : "—"}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.25em] uppercase text-muted">{label}</div>
      <div className="font-num text-base mt-0.5">{value}</div>
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
