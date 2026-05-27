// Monthly Goals panel for the Dashboard.
//
// Layout mirrors the user's existing Google-Sheets workflow:
//
//   ┌──────────── distance (km) ────────────┐  ┌──────────── climbing (m) ────────────┐
//   │ Goal · This month · To go             │  │ Goal · This month · To go            │
//   │ km/day required (hides on last day)   │  │ m/day required (hides on last day)   │
//   └────────────────────────────────────────┘  └───────────────────────────────────────┘
//
// Goals are inline-editable (click the value → input → blur/Enter to save).
// When a goal is met, a "🏁 Goal hit" pill replaces the "to-go" and
// "daily-pace" cards.

import { useEffect, useState } from "react";
import { Pencil, Flag, Mountain, Bike, Clock } from "lucide-react";
import { getMonthlyStats, updateMonthlyGoals, fmtTime } from "../lib/api";
import { toast } from "sonner";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function MonthlyGoals() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setData(await getMonthlyStats());
    } catch (e) {
      console.error("monthly stats failed:", e);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function saveGoals({ km, climb }) {
    setBusy(true);
    try {
      await updateMonthlyGoals({
        monthly_goal_km: km,
        monthly_goal_climbing_m: climb,
      });
      await refresh();
    } catch (e) {
      toast.error(`Failed to update goals: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  const monthLabel = `${MONTH_NAMES[data.month - 1]} ${data.year}`;
  const showDailyPace = data.days_remaining > 0;

  return (
    <section
      className="border border-line bg-surface"
      data-testid="monthly-goals"
    >
      <header className="px-6 py-4 border-b border-line-subtle flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Flag className="w-4 h-4 text-accent" strokeWidth={1.8} />
          <div>
            <div className="font-display font-bold uppercase tracking-tight text-lg">
              Monthly goals
            </div>
            <div className="text-[10px] tracking-[0.3em] uppercase text-muted mt-0.5">
              {monthLabel} · day {data.days_in_month - data.days_remaining + 1} of {data.days_in_month}
            </div>
          </div>
        </div>
        <div className="text-[10px] tracking-[0.3em] uppercase text-muted flex items-center gap-2">
          <Clock className="w-3.5 h-3.5" />
          Moving time · <span className="font-num text-main">{fmtTime(data.moving_time_s_this_month)}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-line-subtle">
        {/* DISTANCE */}
        <GoalBlock
          icon={Bike}
          accent="text-accent"
          stripe="bg-accent/10"
          unit="km"
          unitLabel="kilometres"
          goalValue={data.goal_km}
          currentValue={data.km_this_month}
          toGo={data.km_to_go}
          dailyRequired={data.km_per_day_required}
          showDailyPace={showDailyPace}
          goalHit={data.km_goal_hit}
          busy={busy}
          onSaveGoal={(v) => saveGoals({ km: v, climb: data.goal_climbing_m })}
          testid="goal-distance"
        />
        {/* CLIMBING */}
        <GoalBlock
          icon={Mountain}
          accent="text-volt"
          stripe="bg-volt-5"
          unit="m"
          unitLabel="climbing"
          goalValue={data.goal_climbing_m}
          currentValue={data.climbing_m_this_month}
          toGo={data.climbing_m_to_go}
          dailyRequired={data.m_per_day_required}
          showDailyPace={showDailyPace}
          goalHit={data.climbing_goal_hit}
          busy={busy}
          onSaveGoal={(v) => saveGoals({ km: data.goal_km, climb: v })}
          testid="goal-climbing"
        />
      </div>
    </section>
  );
}

function GoalBlock({
  icon: Icon,
  accent,
  stripe,
  unit,
  unitLabel,
  goalValue,
  currentValue,
  toGo,
  dailyRequired,
  showDailyPace,
  goalHit,
  busy,
  onSaveGoal,
  testid,
}) {
  return (
    <div className="p-6" data-testid={testid}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className={`w-4 h-4 ${accent}`} strokeWidth={1.8} />
        <div className={`text-[10px] tracking-[0.3em] uppercase ${accent} font-bold`}>
          Distance · {unitLabel}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <EditableNumber
          label={`Goal ${unit}/month`}
          value={goalValue}
          unit={unit}
          stripe={stripe}
          accent={accent}
          busy={busy}
          onSave={onSaveGoal}
          testid={`${testid}-goal`}
        />
        <ReadOnlyNumber
          label={`${unit === "km" ? "km" : "m"} this month`}
          value={currentValue}
          unit={unit}
          testid={`${testid}-current`}
        />
        {goalHit ? (
          <div className="col-span-1 flex flex-col justify-center items-center gap-1 border border-volt-40 bg-volt-5 p-3">
            <Flag className="w-5 h-5 text-volt" strokeWidth={1.6} />
            <div className="text-[10px] tracking-[0.3em] uppercase text-volt font-bold">
              Goal hit
            </div>
          </div>
        ) : (
          <ReadOnlyNumber
            label={`${unit} to goal`}
            value={toGo}
            unit={unit}
            faded={goalValue == null}
            testid={`${testid}-togo`}
          />
        )}
      </div>

      {showDailyPace && !goalHit && goalValue != null && (
        <div className="mt-5 border-t border-line-subtle pt-4 flex items-baseline justify-between gap-3">
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted">
            {unit}/day required
          </div>
          <div className="font-num text-2xl font-black">
            {dailyRequired != null ? dailyRequired : "—"}
            <span className="text-xs text-muted ml-1">{unit}/day</span>
          </div>
        </div>
      )}
      {goalValue == null && (
        <div className="mt-4 text-[10px] tracking-[0.25em] uppercase text-muted">
          Tap the goal number to set one
        </div>
      )}
    </div>
  );
}

function ReadOnlyNumber({ label, value, unit, faded, testid }) {
  return (
    <div data-testid={testid}>
      <div className="text-[10px] tracking-[0.3em] uppercase text-muted">
        {label}
      </div>
      <div className={`font-num text-2xl font-black mt-1 ${faded ? "text-faint" : ""}`}>
        {value != null ? value : "—"}
        {value != null && (
          <span className="text-xs text-muted ml-1">{unit}</span>
        )}
      </div>
    </div>
  );
}

function EditableNumber({ label, value, unit, stripe, accent, busy, onSave, testid }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => setDraft(value ?? ""), [value]);

  async function commit() {
    setEditing(false);
    const parsed = draft === "" ? null : Math.max(0, Math.round(Number(draft)));
    if (parsed === value) return;
    await onSave(parsed);
  }

  return (
    <div className={`${stripe} px-2 py-1 -m-2`} data-testid={testid}>
      <div className={`text-[10px] tracking-[0.3em] uppercase ${accent} font-bold`}>
        {label}
      </div>
      {editing ? (
        <input
          autoFocus
          type="number"
          min={0}
          step={1}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") {
              setDraft(value ?? "");
              setEditing(false);
            }
          }}
          className="font-num text-2xl font-black mt-1 bg-transparent border-b border-accent focus:outline-none w-full"
          data-testid={`${testid}-input`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="font-num text-2xl font-black mt-1 hover:opacity-80 text-left flex items-baseline gap-1 group"
          data-testid={`${testid}-edit`}
        >
          {value != null ? value : "Set"}
          {value != null && <span className="text-xs text-muted ml-1">{unit}</span>}
          <Pencil className="w-3 h-3 text-muted opacity-0 group-hover:opacity-100 ml-1" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
