import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import UploadZone from "../components/UploadZone";
import MapView from "../components/MapView";
import ElevationChart from "../components/ElevationChart";
import EditableName from "../components/EditableName";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  deleteRide,
  getRide,
  listRides,
  uploadRide,
  renameRide,
  updateRideMeta,
  listBikes,
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
  Tag,
  ChevronDown,
  ChevronRight,
  Pencil,
  Check,
  X,
  Gauge,
  Heart,
  Zap,
  Flame,
  Thermometer,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { toast } from "sonner";

const SUB_SPORTS = [
  "Road",
  "Gravel",
  "Mountain",
  "Cyclocross",
  "Indoor",
  "Commute",
  "Touring",
  "E-bike",
  "Track",
  "Other",
];

export default function Rides() {
  const [rides, setRides] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const [activeEffortIdx, setActiveEffortIdx] = useState(null);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [bikes, setBikes] = useState([]);
  const [pendingDelete, setPendingDelete] = useState(null); // { id, name }

  async function refreshBikes() {
    setBikes(await listBikes());
  }

  async function refresh() {
    const r = await listRides();
    setRides(r);
    const qid = params.get("id");
    if (qid) {
      try {
        const detail = await getRide(qid);
        setSelected(detail);
        setActiveEffortIdx(detail.efforts?.length > 0 ? 0 : null);
        return;
      } catch {
        // stale id (e.g. just deleted) — fall through and pick the first ride
        setParams({}, { replace: true });
      }
    }
    if (r.length > 0) {
      const d = await getRide(r[0].id);
      setSelected(d);
      setActiveEffortIdx(d.efforts?.length > 0 ? 0 : null);
    } else {
      setSelected(null);
      setActiveEffortIdx(null);
    }
  }

  useEffect(() => {
    refresh();
    refreshBikes();
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

  function requestDelete(ride, e) {
    e?.stopPropagation();
    setPendingDelete({ id: ride.id, name: ride.name });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await deleteRide(id);
    toast.success("Activity deleted");
    setSelected(null);
    setActiveEffortIdx(null);
    setExpandedIdx(null);
    setParams({}, { replace: true });
    await refresh();
  }

  async function handleMetaUpdate(patch) {
    if (!selected) return;
    const res = await updateRideMeta(selected.id, patch);
    setSelected({ ...selected, ...res });
    await refresh();
    if ("bike_name" in patch) await refreshBikes();
    toast.success("Updated");
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
        <div className="font-display font-black text-2xl md:text-4xl tracking-[0.2em] uppercase text-accent">/ / Activities</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          <UploadZone
            onUpload={handleUpload}
            accept=".gpx,.fit"
            label="Drop Activity GPX or FIT"
            sublabel="timestamps, HR, power, cadence, temperature & calories extracted"
            testid="ride-upload"
          />
        </div>
        <div className="lg:col-span-4 grid grid-cols-1 gap-3">
          <StatCard label="Activities" value={rides.length} testid="ride-count-card" />
        </div>
      </div>

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
                      {r.bike_name && <> · {r.bike_name}</>}
                      {r.sub_sport && <> · {r.sub_sport}</>}
                      {" · "}
                      {fmtDistance(r.distance_m)} · {r.effort_count} eff
                    </div>
                  </div>
                  <button
                    onClick={(e) => requestDelete(r, e)}
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
                <div className="text-[10px] tracking-[0.3em] uppercase text-accent mb-2">
                  Activity · {selected.source_type.toUpperCase()}
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
                  <BikeField
                    value={selected.bike_name}
                    bikes={bikes}
                    onSave={(v) => handleMetaUpdate({ bike_name: v })}
                  />
                  <SubSportField
                    value={selected.sub_sport}
                    onSave={(v) => handleMetaUpdate({ sub_sport: v })}
                  />
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

              <ActivitySummary ride={selected} />
            </>
          ) : (
            <div className="border border-line bg-surface p-12 text-center text-muted">
              Select an activity to view details.
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this activity?"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" and all its detected efforts will be permanently removed from your local database. This cannot be undone.`
            : null
        }
        confirmLabel="Delete activity"
        cancelLabel="Keep"
        destructive
        testid="delete-activity-confirm"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

// ---------- Inline-editable bike name with autocomplete ----------
function BikeField({ value, bikes = [], onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(value || ""), [value]);

  async function commit() {
    const next = draft.trim();
    if (next === (value || "")) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(next || null);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-line p-3" data-testid="ride-bike-field">
      <div className="text-[10px] tracking-[0.3em] uppercase text-muted mb-1 flex items-center justify-between gap-1">
        <span className="flex items-center gap-1">
          <Bike className="w-3 h-3" /> Bike
        </span>
        {bikes.length > 0 && !editing && (
          <span className="text-[9px] tracking-[0.2em] text-faint normal-case">
            {bikes.length} saved
          </span>
        )}
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") {
                setDraft(value || "");
                setEditing(false);
              }
            }}
            disabled={busy}
            placeholder="e.g. S-Works Tarmac"
            list="cst-bike-suggestions"
            data-testid="ride-bike-input"
            className="flex-1 bg-transparent border-b border-accent text-sm focus:outline-none"
          />
          <datalist id="cst-bike-suggestions">
            {bikes.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
          <button
            onClick={commit}
            disabled={busy}
            data-testid="ride-bike-save"
            className="p-1 text-accent hover:bg-subtle"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setDraft(value || "");
              setEditing(false);
            }}
            disabled={busy}
            className="p-1 text-muted hover:text-danger"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          data-testid="ride-bike-edit"
          className="flex items-center justify-between w-full text-left hover:text-accent"
        >
          <span className={value ? "text-main text-sm font-semibold" : "text-faint text-sm italic"}>
            {value || "Add bike name…"}
          </span>
          <Pencil className="w-3.5 h-3.5 text-muted" />
        </button>
      )}
    </div>
  );
}

function SubSportField({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  useEffect(() => setDraft(value || ""), [value]);

  async function commit(next) {
    const v = (next ?? draft).trim();
    if (v === (value || "")) {
      setEditing(false);
      return;
    }
    await onSave(v || null);
    setEditing(false);
  }

  return (
    <div className="border border-line p-3" data-testid="ride-subsport-field">
      <div className="text-[10px] tracking-[0.3em] uppercase text-muted mb-1 flex items-center gap-1">
        <Tag className="w-3 h-3" /> Sub-sport
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <select
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              commit(e.target.value);
            }}
            data-testid="ride-subsport-select"
            className="flex-1 bg-transparent border-b border-accent text-sm focus:outline-none"
          >
            <option value="">— None —</option>
            {SUB_SPORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setDraft(value || "");
              setEditing(false);
            }}
            className="p-1 text-muted hover:text-danger"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          data-testid="ride-subsport-edit"
          className="flex items-center justify-between w-full text-left hover:text-accent"
        >
          <span className={value ? "text-main text-sm font-semibold" : "text-faint text-sm italic"}>
            {value || "Set sub-sport…"}
          </span>
          <Pencil className="w-3.5 h-3.5 text-muted" />
        </button>
      )}
    </div>
  );
}

// ---------- Per-effort expandable row ----------
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

// ---------- Activity-level full summary ----------
function ActivitySummary({ ride }) {
  const tempUnit = "°C";
  return (
    <div className="border border-line bg-surface p-6" data-testid="activity-summary">
      <div className="text-[10px] tracking-[0.3em] uppercase text-accent mb-5">
        Activity Summary
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
        <SummaryGroup label="Speed" icon={Gauge}>
          <Detail label="Average" value={fmtSpeed(ride.avg_speed_mps)} />
          <Detail label="Max" value={fmtSpeed(ride.max_speed_mps)} />
        </SummaryGroup>

        <SummaryGroup label="Elevation" icon={Mountain}>
          <Detail
            label={
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-accent" /> Total ascent
              </span>
            }
            value={
              ride.total_ascent_m != null
                ? `+${Math.round(ride.total_ascent_m)} m`
                : "—"
            }
          />
          <Detail
            label={
              <span className="flex items-center gap-1">
                <TrendingDown className="w-3 h-3 text-accent" /> Total descent
              </span>
            }
            value={
              ride.total_descent_m != null
                ? `−${Math.round(ride.total_descent_m)} m`
                : "—"
            }
          />
        </SummaryGroup>

        <SummaryGroup label="Power" icon={Zap}>
          <Detail
            label="Average"
            value={ride.avg_power != null ? `${Math.round(ride.avg_power)} W` : "—"}
          />
          <Detail
            label="Max"
            value={ride.max_power != null ? `${Math.round(ride.max_power)} W` : "—"}
          />
          <Detail
            label="Normalized"
            value={
              ride.normalized_power != null
                ? `${Math.round(ride.normalized_power)} W`
                : "—"
            }
          />
        </SummaryGroup>

        <SummaryGroup label="Heart rate" icon={Heart}>
          <Detail
            label="Average"
            value={ride.avg_heart_rate != null ? `${Math.round(ride.avg_heart_rate)} bpm` : "—"}
          />
          <Detail
            label="Max"
            value={ride.max_heart_rate != null ? `${Math.round(ride.max_heart_rate)} bpm` : "—"}
          />
        </SummaryGroup>

        <SummaryGroup label="Cadence" icon={Bike}>
          <Detail
            label="Average"
            value={ride.avg_cadence != null ? `${Math.round(ride.avg_cadence)} rpm` : "—"}
          />
          <Detail
            label="Max"
            value={ride.max_cadence != null ? `${Math.round(ride.max_cadence)} rpm` : "—"}
          />
        </SummaryGroup>

        <SummaryGroup label="Other" icon={Flame}>
          <Detail
            label="Calories"
            value={ride.total_calories != null ? `${Math.round(ride.total_calories)} kcal` : "—"}
          />
          <Detail
            label={
              <span className="flex items-center gap-1">
                <Thermometer className="w-3 h-3 text-accent" /> Temperature
              </span>
            }
            value={
              ride.avg_temperature != null
                ? `${Math.round(ride.avg_temperature)}${tempUnit}` +
                  (ride.max_temperature != null
                    ? ` (max ${Math.round(ride.max_temperature)}${tempUnit})`
                    : "")
                : "—"
            }
          />
        </SummaryGroup>
      </div>
    </div>
  );
}

function SummaryGroup({ label, icon: Icon, children }) {
  return (
    <div data-testid={`summary-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="text-[11px] tracking-[0.3em] uppercase font-semibold text-main mb-3 flex items-center gap-2 border-b border-line-subtle pb-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-accent" strokeWidth={1.8} />}
        {label}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="text-[10px] tracking-[0.25em] uppercase text-muted">{label}</div>
      <div className="font-num text-base">{value}</div>
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
