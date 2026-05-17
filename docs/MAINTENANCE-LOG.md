# Bike Maintenance Log — How to use it

A practical guide to the **Equipment → [bike name] → Maintenance** feature.

---

## 1. Mental model

For every bike you've added, the app keeps a **per-part event log**. A "part"
is something like `Chain`, `Front Brake Pads`, `Rear Tyre`, `Headset Bearings`,
etc. — organised into 5 categories you can expand/collapse:

| Category | Example parts |
|---|---|
| **Drivetrain** | Chain · Cassette · Chainrings · Front Derailleur · Rear Derailleur · Bottom Bracket |
| **Brakes** | Front Brake Pads · Rear Brake Pads · Brake Cables · Brake Levers · Rotors |
| **Wheels** | Front Tyre · Rear Tyre · Front Tube · Rear Tube · Wheel Bearings · Spokes |
| **Cockpit** | Handlebar Tape · Bar Ends · Headset Bearings · Stem |
| **Etc.** | Saddle · Seat Post · Pedals · Frame · Suspension Fork |

You can also add **custom parts** to any category (e.g. `Di2 Battery` under
Drivetrain) — they're saved per-bike.

Each part holds a chronological **history** of events. An event is one of:

- `Inspected` — quick once-over, no parts changed
- `Cleaned` / `Lubed`
- `Adjusted`
- `Serviced` — bigger maintenance, may include parts
- `Replaced` — new part fitted

Plus the date, the bike's km reading on that date, and an optional note.

---

## 2. The two key numbers on every bike

Open **Equipment → [your bike]**. The four stats at the top:

| Stat | What it is |
|---|---|
| **Added** | Date you registered the bike in the app (dd-mm-yyyy). |
| **Starting km** | The mileage the bike already had when you started tracking. |
| **Ridden km** | Sum of every activity you've assigned to this bike, in km. |
| **Total km** | `Starting km + Ridden km` — the current odometer. |

The **Total km** is what the maintenance log uses as the default "at km" value
when you log a new event.

> 💡 If your bike has a real odometer (e.g. a Garmin computer that survived
> through multiple chains), set **Starting km** to that reading on the day
> you added the bike. Edit it any time by clicking the number.

---

## 3. Logging a maintenance event

1. **Equipment** tab → click your bike → scroll to the parts section.
2. Click the category (e.g. **Drivetrain**) → it expands to show parts.
3. Click the part (e.g. **Chain**) → an inline form appears.
4. Fill in:
   - **Action** — Inspected / Cleaned / Lubed / Adjusted / Serviced / Replaced
   - **Date** — defaults to today (dd-mm-yyyy)
   - **At km** — pre-filled with the bike's current Total km; override if
     you're back-logging an old event
   - **Notes** — optional (e.g. "KMC X11 nickel, $48 at LBS")
5. Click **Log**.

The event drops into the **History** list immediately. The latest event
shows up in the part's collapsed row so you can see "last touched" at a
glance:

```
Chain                    Replaced · 14-04-2026 · 4280 km
Front Tyre               Inspected · 12-05-2026 · 4612 km
Rear Brake Pads          No log entries
```

---

## 4. Reading the history

Click any part to expand and see the full timeline, **newest at the top**:

```
Chain
  History
  ├ Replaced · 14-04-2026 · 4280 km
  │    KMC X11 nickel — quick link 11-speed
  ├ Lubed · 22-03-2026 · 4055 km
  │    Wax-based, dry conditions
  ├ Inspected · 01-03-2026 · 3782 km
  └ Lubed · 14-02-2026 · 3611 km
```

To compute **km since last service** for any part, subtract the most recent
event's km from the current **Total km** shown at the top of the bike page.

> Example: Chain was last `Replaced` at 4280 km. Bike now shows Total 4612 km.
> Chain has done **4612 − 4280 = 332 km**.

---

## 5. Deleting / correcting entries

- **Wrong event** — expand the part, click the 🗑️ icon on the row to remove it.
- **Wrong km / date on an event** — there's no edit-in-place; the cleanest
  workflow is delete + re-log. Deletions are immediate (no confirmation
  dialog), so be deliberate.
- **Remove a custom part entirely** — open the part, click **Remove custom
  part** at the bottom of its panel. Its full history goes with it.

---

## 6. Suggested workflow

A pattern that works well in practice:

1. **Initial setup** (one-off, ~5 minutes per bike):
   - Add the bike with current real-world Starting km.
   - For each consumable that already has a known life on it (chain, tyres,
     cables, bar tape), log a single `Replaced` event with the original
     install date and km. This becomes the anchor for "km since".

2. **Every ride day** — nothing required. The app auto-attributes the
   activity's distance to the right bike via FIT sub-sport / bike name.

3. **After each service** (LBS or self) — log one event per touched part
   with action, today's date, current km, and a note about what was
   done / what part went on / where you got it.

4. **Quarterly tidy-up** — scan the part list for anything saying
   *"No log entries"* and add one if you remember.

---

## 7. Things it does NOT do (yet)

- ❌ Send reminders / alerts when a part is overdue.
- ❌ Display `km since last event` automatically.
- ❌ Track cost or budget.
- ❌ Sync between multiple bikes (no "shared parts" concept).
- ❌ Export to CSV.

Each of those is a small enhancement if you want one. Most popular first
ask is the **"days/km since last event" badge** next to each part name.

---

## 8. Where the data lives

All maintenance events are stored in the SQLite DB at:

```
~/Documents/CyclingTracker/data.nosync/database.sqlite
```

Inside the `bikes` table, in two JSON columns: `parts_json` (built-in parts)
and `custom_parts_json` (the parts you added yourself). They're included in
the nightly ZIP backup and in the Admin → Download as ZIP export, so you
won't lose them.
