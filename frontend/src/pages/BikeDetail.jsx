import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bike,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Wrench,
  Calendar,
  Route as RouteIcon,
} from "lucide-react";
import {
  addCustomPart,
  addPartEvent,
  BIKE_TYPES,
  deletePartEvent,
  getBikeProfileWithStats,
  removeCustomPart,
  updateBikeProfile,
} from "../lib/api";
import { PARTS_CATALOGUE, MAINTENANCE_ACTIONS } from "../lib/partsCatalogue";

export default function BikeDetail() {
  const { name } = useParams();
  const decoded = decodeURIComponent(name);
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [openCats, setOpenCats] = useState(() => new Set(["Drivetrain"]));
  const [openPart, setOpenPart] = useState(null);

  async function refresh() {
    const p = await getBikeProfileWithStats(decoded);
    setProfile(p);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded]);

  if (!profile) {
    return (
      <div className="text-muted text-sm">Loading…</div>
    );
  }

  async function saveAddedAt(value) {
    await updateBikeProfile(decoded, { added_at: value });
    await refresh();
  }
  async function saveStartingKm(value) {
    await updateBikeProfile(decoded, { starting_km: value });
    await refresh();
  }
  async function saveType(value) {
    await updateBikeProfile(decoded, { type: value || null });
    await refresh();
  }

  function toggleCat(cat) {
    setOpenCats((cur) => {
      const next = new Set(cur);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  return (
    <div className="space-y-6 animate-fade-up" data-testid="bike-detail-page">
      <div>
        <Link
          to="/equipment"
          className="inline-flex items-center gap-2 text-[10px] tracking-[0.3em] uppercase text-muted hover:text-accent"
        >
          <ArrowLeft className="w-3 h-3" /> Equipment
        </Link>
        <div className="mt-3 font-display font-black text-2xl md:text-4xl tracking-[0.2em] uppercase text-accent">
          / / {decoded}
        </div>
      </div>

      {/* Top bar — stats & editable fields */}
      <div className="border border-line bg-surface p-5 grid grid-cols-2 md:grid-cols-5 gap-5">
        <Stat label="Activities" value={`${profile.ridden_km.toFixed(1)} km`} icon={RouteIcon} />
        <Stat label="Starting km" editable value={profile.starting_km} onChange={saveStartingKm} suffix="km" testid="bike-starting-km" />
        <Stat label="Total km" value={`${profile.total_km.toFixed(1)} km`} highlight />
        <Stat
          label="Added"
          editable
          type="date"
          value={profile.added_at || ""}
          onChange={saveAddedAt}
          icon={Calendar}
          testid="bike-added-at"
        />
        <div data-testid="bike-type">
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted">Type</div>
          <select
            value={profile.type || ""}
            onChange={(e) => saveType(e.target.value)}
            className="mt-1 w-full font-num text-2xl font-black bg-transparent border-b border-line hover:border-accent focus:border-accent focus:outline-none"
          >
            <option value="">—</option>
            {BIKE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Maintenance log */}
      <div className="space-y-3" data-testid="maintenance-log">
        <div className="flex items-center gap-3">
          <Wrench className="w-4 h-4 text-accent" strokeWidth={1.8} />
          <div className="font-display font-bold uppercase tracking-tight text-lg">
            Maintenance log
          </div>
        </div>

        {PARTS_CATALOGUE.map((group) => {
          const customParts = profile.custom_parts[group.category] || [];
          const allParts = [...group.parts, ...customParts];
          const isOpen = openCats.has(group.category);
          return (
            <div
              key={group.category}
              className="border border-line bg-surface"
              data-testid={`cat-${group.category}`}
            >
              <button
                type="button"
                onClick={() => toggleCat(group.category)}
                className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-subtle"
              >
                <div className="flex items-center gap-3">
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-accent" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted" />
                  )}
                  <span className="font-display font-bold uppercase tracking-tight">
                    {group.category}
                  </span>
                  <span className="text-[10px] tracking-[0.3em] uppercase text-muted">
                    {allParts.length} parts
                  </span>
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-line-subtle">
                  {allParts.map((partName) => (
                    <PartRow
                      key={partName}
                      partName={partName}
                      isCustom={customParts.includes(partName)}
                      profilePart={profile.parts[partName]}
                      currentKm={profile.total_km}
                      open={openPart === `${group.category}::${partName}`}
                      onToggle={() =>
                        setOpenPart((cur) =>
                          cur === `${group.category}::${partName}`
                            ? null
                            : `${group.category}::${partName}`
                        )
                      }
                      onAddEvent={async (evt) => {
                        await addPartEvent(decoded, partName, evt);
                        toast.success(`${partName} · ${evt.action}`);
                        await refresh();
                      }}
                      onDeleteEvent={async (evtId) => {
                        await deletePartEvent(decoded, partName, evtId);
                        await refresh();
                      }}
                      onDeleteCustom={
                        customParts.includes(partName)
                          ? async () => {
                              if (!window) return;
                              await removeCustomPart(decoded, group.category, partName);
                              toast.success("Custom part removed");
                              setOpenPart(null);
                              await refresh();
                            }
                          : null
                      }
                    />
                  ))}
                  <AddCustomPart
                    category={group.category}
                    onAdd={async (n) => {
                      await addCustomPart(decoded, group.category, n);
                      toast.success(`${n} added`);
                      await refresh();
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, editable, type = "number", onChange, suffix, highlight, testid }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  async function commit() {
    setEditing(false);
    if (String(draft) === String(value)) return;
    await onChange(draft);
  }

  return (
    <div data-testid={testid}>
      <div className="text-[10px] tracking-[0.3em] uppercase text-muted flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />} {label}
      </div>
      {editable ? (
        editing ? (
          <input
            autoFocus
            type={type}
            value={draft || ""}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              else if (e.key === "Escape") {
                setDraft(value);
                setEditing(false);
              }
            }}
            step={type === "number" ? "0.1" : undefined}
            className="font-num text-2xl font-black mt-1 bg-transparent border-b border-accent focus:outline-none w-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={`font-num text-2xl font-black mt-1 hover:text-accent text-left ${highlight ? "text-accent" : ""}`}
          >
            {value || "—"} {suffix && value ? <span className="text-sm text-muted">{suffix}</span> : null}
          </button>
        )
      ) : (
        <div className={`font-num text-2xl font-black mt-1 ${highlight ? "text-accent" : ""}`}>
          {value}
        </div>
      )}
    </div>
  );
}

function PartRow({
  partName,
  isCustom,
  profilePart,
  currentKm,
  open,
  onToggle,
  onAddEvent,
  onDeleteEvent,
  onDeleteCustom,
}) {
  const events = profilePart?.events || [];
  const latest = events[0];
  return (
    <div className="border-t border-line-subtle" data-testid={`part-${partName}`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-5 py-2.5 flex items-center justify-between text-left hover:bg-subtle"
      >
        <div className="flex items-center gap-3 min-w-0">
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-accent flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted flex-shrink-0" />
          )}
          <span className="text-sm text-main">{partName}</span>
          {isCustom && (
            <span className="text-[9px] tracking-[0.2em] uppercase text-muted bg-subtle px-1.5 py-0.5">
              custom
            </span>
          )}
        </div>
        <div className="text-[10px] tracking-[0.2em] uppercase text-muted truncate ml-4">
          {latest
            ? `${latest.action} · ${latest.date}${latest.at_km ? ` · ${latest.at_km} km` : ""}`
            : "No log entries"}
        </div>
      </button>
      {open && (
        <div className="px-5 pb-4 pt-1 bg-subtle border-t border-line-subtle">
          <AddEventForm partName={partName} currentKm={currentKm} onAdd={onAddEvent} />
          {events.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-[10px] tracking-[0.3em] uppercase text-muted">History</div>
              {events.map((e) => (
                <div
                  key={e.id}
                  className="flex items-start justify-between gap-3 border border-line p-3 bg-surface"
                  data-testid={`event-${e.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-main">
                      {e.action}
                      <span className="text-muted font-normal"> · {e.date}</span>
                      {e.at_km != null && (
                        <span className="text-muted font-normal"> · {e.at_km} km</span>
                      )}
                    </div>
                    {e.notes && (
                      <div className="text-xs text-secondary mt-1 break-words">{e.notes}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteEvent(e.id)}
                    className="p-1 text-faint hover:text-danger"
                    aria-label="Delete entry"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {onDeleteCustom && (
            <button
              type="button"
              onClick={onDeleteCustom}
              className="mt-4 text-[10px] tracking-[0.2em] uppercase text-muted hover:text-danger"
            >
              Remove custom part
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AddEventForm({ partName, currentKm, onAdd }) {
  const [action, setAction] = useState("Inspected");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [atKm, setAtKm] = useState(currentKm ? String(currentKm) : "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e?.preventDefault?.();
    setBusy(true);
    try {
      await onAdd({
        action,
        date,
        at_km: atKm === "" ? null : parseFloat(atKm),
        notes,
      });
      setNotes("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-1 sm:grid-cols-12 gap-2 mt-3"
      data-testid={`add-event-${partName}`}
    >
      <select
        value={action}
        onChange={(e) => setAction(e.target.value)}
        className="sm:col-span-3 bg-surface border border-line px-2 py-2 text-sm focus:outline-none focus:border-accent"
      >
        {MAINTENANCE_ACTIONS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="sm:col-span-3 bg-surface border border-line px-2 py-2 text-sm focus:outline-none focus:border-accent"
      />
      <input
        type="number"
        step="0.1"
        placeholder="at km"
        value={atKm}
        onChange={(e) => setAtKm(e.target.value)}
        className="sm:col-span-2 bg-surface border border-line px-2 py-2 text-sm focus:outline-none focus:border-accent"
      />
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="sm:col-span-3 bg-surface border border-line px-2 py-2 text-sm focus:outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={busy}
        className="sm:col-span-1 bg-accent text-black font-bold uppercase tracking-[0.2em] text-[10px] px-2 py-2 disabled:opacity-50"
      >
        Log
      </button>
    </form>
  );
}

function AddCustomPart({ category, onAdd }) {
  const [draft, setDraft] = useState("");

  async function commit() {
    const v = draft.trim();
    if (!v) return;
    await onAdd(v);
    setDraft("");
  }

  return (
    <div className="border-t border-line-subtle p-3 flex items-center gap-2 bg-subtle">
      <Plus className="w-3.5 h-3.5 text-muted flex-shrink-0" />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        placeholder={`Add custom part to ${category}…`}
        data-testid={`add-custom-part-${category}`}
        className="flex-1 bg-transparent text-sm py-1 focus:outline-none border-b border-line focus:border-accent"
      />
      <button
        type="button"
        onClick={commit}
        disabled={!draft.trim()}
        className="text-[10px] tracking-[0.2em] uppercase text-accent disabled:opacity-30"
      >
        Add
      </button>
    </div>
  );
}
