import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Bike,
  Plus,
  Star,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronRight,
  Clock,
  Mountain,
  Route as RouteIcon,
  Wrench,
} from "lucide-react";
import {
  addBike,
  BIKE_TYPES,
  deleteBikeEverywhere,
  fmtDateLocal,
  fmtDistance,
  fmtTime,
  getBikeStats,
  renameBike,
  setDefaultBike,
  updateBikeProfile,
} from "../lib/api";
import ConfirmDialog from "../components/ConfirmDialog";

export default function Equipment() {
  const [bikes, setBikes] = useState([]);
  const [unassigned, setUnassigned] = useState(null);
  const [newBike, setNewBike] = useState("");
  const [newType, setNewType] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  async function refresh() {
    const data = await getBikeStats();
    setBikes(data.bikes);
    setUnassigned(data.unassigned && data.unassigned.ride_count > 0 ? data.unassigned : null);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAdd() {
    const trimmed = newBike.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await addBike(trimmed, newType || null);
      setNewBike("");
      setNewType("");
      toast.success(
        newType ? `${trimmed} (${newType}) added` : `${trimmed} added`
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleSetDefault(name) {
    await setDefaultBike(name);
    toast.success(`${name} is the new default`);
    await refresh();
  }

  async function handleRename(oldName, newName) {
    if (!newName || oldName === newName) return;
    const res = await renameBike(oldName, newName);
    toast.success(`Renamed (${res.touched} activities updated)`);
    await refresh();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const name = pendingDelete.name;
    setPendingDelete(null);
    const res = await deleteBikeEverywhere(name);
    toast.success(`${name} removed (${res.touched} activities un-tagged)`);
    await refresh();
  }

  return (
    <div className="space-y-8 animate-fade-up max-w-5xl" data-testid="equipment-page">
      <div>
        <div className="font-display font-black text-2xl md:text-4xl tracking-[0.2em] uppercase text-accent">/ / Equipment</div>
        <p className="text-secondary text-sm mt-3 max-w-xl">
          Track which bike you rode for every activity. Set a default and it'll be applied to new
          uploads automatically.
        </p>
      </div>

      {/* Add bike */}
      <div className="border border-line bg-surface p-5">
        <div className="text-[10px] tracking-[0.3em] uppercase text-muted mb-3">Add a bike</div>
        <div className="flex flex-col sm:flex-row items-stretch gap-3">
          <input
            value={newBike}
            onChange={(e) => setNewBike(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            placeholder="e.g. S-Works Tarmac SL7"
            data-testid="new-bike-input"
            className="flex-1 bg-transparent border-b border-line-strong focus:border-accent text-sm py-2 focus:outline-none"
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            data-testid="new-bike-type"
            className="bg-surface border border-line px-3 py-2 text-sm focus:outline-none focus:border-accent sm:w-44"
          >
            <option value="">Type (optional)…</option>
            {BIKE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={busy || !newBike.trim()}
            data-testid="add-bike-btn"
            className="inline-flex items-center justify-center gap-2 bg-accent text-black font-bold uppercase tracking-[0.2em] text-xs px-4 py-2 disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
        <div className="text-[10px] tracking-[0.2em] uppercase text-muted mt-2">
          Pick a type so uploads with a matching FIT sub-sport auto-assign here.
        </div>
      </div>

      {/* Bike list */}
      <div className="space-y-3" data-testid="bike-list">
        {bikes.length === 0 ? (
          <div className="border border-line bg-surface p-12 text-center text-muted text-sm">
            No bikes yet. Add one above or upload an activity — bikes you assign get saved here
            automatically.
          </div>
        ) : (
          bikes.map((b) => (
            <BikeRow
              key={b.name}
              bike={b}
              busy={busy}
              onSetDefault={() => handleSetDefault(b.name)}
              onRename={(next) => handleRename(b.name, next)}
              onSetType={async (t) => {
                await updateBikeProfile(b.name, { type: t || null });
                toast.success(t ? `Type set to ${t}` : "Type cleared");
                await refresh();
              }}
              onDelete={() => setPendingDelete(b)}
            />
          ))
        )}
      </div>

      {/* Unassigned bucket */}
      {unassigned && (
        <div className="border border-dashed border-line-strong bg-surface p-5" data-testid="unassigned-bucket">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] tracking-[0.3em] uppercase text-muted mb-1">
                Activities without a bike
              </div>
              <div className="font-display font-bold uppercase text-lg">
                {unassigned.ride_count} unassigned
              </div>
            </div>
            <BikeStatsInline bike={unassigned} />
          </div>
          <Link
            to="/rides"
            className="mt-3 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.3em] text-accent hover:opacity-80"
          >
            Open Activities <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title={`Remove "${pendingDelete?.name}"?`}
        description={
          pendingDelete
            ? `The bike will be removed from the garage and un-tagged from all ${pendingDelete.ride_count} activities that used it. The activities themselves are kept.`
            : null
        }
        confirmLabel="Remove bike"
        cancelLabel="Keep"
        destructive
        testid="bike-delete-confirm"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function BikeRow({ bike, busy, onSetDefault, onRename, onSetType, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bike.name);

  useEffect(() => setDraft(bike.name), [bike.name]);

  async function commit() {
    const next = draft.trim();
    if (next === bike.name) {
      setEditing(false);
      return;
    }
    if (!next) {
      setDraft(bike.name);
      setEditing(false);
      return;
    }
    await onRename(next);
    setEditing(false);
  }

  return (
    <div
      className={`border bg-surface p-5 transition-colors ${
        bike.is_default ? "border-accent" : "border-line"
      }`}
      data-testid={`bike-row-${bike.name}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <Bike
            className={`w-5 h-5 mt-1 flex-shrink-0 ${bike.is_default ? "text-accent" : "text-muted"}`}
            strokeWidth={1.5}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              {editing ? (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit();
                      else if (e.key === "Escape") {
                        setDraft(bike.name);
                        setEditing(false);
                      }
                    }}
                    data-testid={`bike-rename-input-${bike.name}`}
                    className="flex-1 bg-transparent border-b border-accent text-base font-semibold focus:outline-none"
                  />
                  <button
                    onClick={commit}
                    data-testid={`bike-rename-save-${bike.name}`}
                    className="p-1 text-accent"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      setDraft(bike.name);
                      setEditing(false);
                    }}
                    className="p-1 text-muted hover:text-danger"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="font-display font-bold text-lg uppercase tracking-tight">
                    {bike.name}
                  </span>
                  {bike.is_default && (
                    <span className="text-[9px] tracking-[0.3em] uppercase bg-accent text-black px-2 py-0.5 font-bold">
                      Default
                    </span>
                  )}
                  <select
                    value={bike.type || ""}
                    onChange={(e) => onSetType(e.target.value)}
                    data-testid={`bike-type-${bike.name}`}
                    className="bg-surface border border-line px-2 py-1 text-[11px] tracking-[0.15em] uppercase focus:outline-none focus:border-accent"
                  >
                    <option value="">No type</option>
                    {BIKE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    aria-label="Rename"
                    data-testid={`bike-rename-${bike.name}`}
                    className="p-1 text-faint hover:text-accent"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
            <BikeStatsInline bike={bike} />
            {bike.last_used_iso && (
              <div className="text-[10px] tracking-[0.2em] uppercase text-muted mt-2">
                Last used · {fmtDateLocal(bike.last_used_iso)}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            to={`/equipment/${encodeURIComponent(bike.name)}`}
            data-testid={`bike-open-${bike.name}`}
            className="inline-flex items-center gap-1 border border-line-strong hover:border-accent px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-main hover:text-accent"
          >
            <Wrench className="w-3.5 h-3.5" />
            Maintenance
          </Link>
          {!bike.is_default && (
            <button
              type="button"
              onClick={onSetDefault}
              disabled={busy}
              data-testid={`bike-set-default-${bike.name}`}
              className="inline-flex items-center gap-1 border border-line-strong hover:border-accent px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-main hover:text-accent disabled:opacity-50"
            >
              <Star className="w-3.5 h-3.5" />
              Set default
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            aria-label="Remove bike"
            data-testid={`bike-delete-${bike.name}`}
            className="p-2 text-faint hover:text-danger disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function BikeStatsInline({ bike }) {
  const showTotal = bike && (bike.starting_km > 0 || bike.total_km != null);
  return (
    <div className="flex items-center gap-x-5 gap-y-1 flex-wrap mt-2 text-xs text-secondary">
      <Pair icon={RouteIcon} label="Rides" value={bike.ride_count} />
      <Pair label="Distance" value={fmtDistance(bike.distance_m)} />
      {showTotal && (
        <Pair
          label="Total"
          value={`${(bike.total_km || 0).toFixed(1)} km`}
          accent
        />
      )}
      <Pair icon={Clock} label="Time" value={fmtTime(bike.moving_time_s)} />
      <Pair icon={Mountain} label="Climbed" value={`+${bike.elevation_gain_m} m`} />
      {bike.added_at && <Pair label="Added" value={bike.added_at} />}
    </div>
  );
}

function Pair({ icon: Icon, label, value, accent }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {Icon && <Icon className="w-3 h-3 text-faint" strokeWidth={1.6} />}
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted">{label}</span>
      <span
        className={`font-num font-semibold ${accent ? "text-accent" : "text-main"}`}
      >
        {value}
      </span>
    </span>
  );
}
