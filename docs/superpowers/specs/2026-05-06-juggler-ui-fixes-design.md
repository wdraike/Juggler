# Juggler UI Fixes — Design Spec
Date: 2026-05-06
Status: Approved

## Scope

Five issues from the 2026-05-06 session handoff. All frontend (juggler-frontend), no backend schema changes required.

---

## Issue 1 — Mobile form covers header at ≤600px

**Root cause:** `TaskEditForm` renders `position:fixed; top:0; left:0; right:0; bottom:0; zIndex:600` on mobile (`isMobile=true`, breakpoint ≤600px). Header has `zIndex:300`. Form completely covers the header, leaving no visible navigation.

**Fix — Option B (approved):** Keep the full-screen overlay. Add a sticky mini-header strip inside the form as the first child of the fixed container, rendered before `dialogContent`:

```
[ ← ]  StriveRS / Edit Task         [ ✔ Save ]  [ × ]
```

- `←` and `×` both call `onClose`
- "StriveRS / Edit Task" (or "StriveRS / New Task" in create mode)
- Save button only shown when `isDirty && !isCreate`; Create button shown in create mode
- Strip is `position:sticky; top:0; zIndex:10` so it stays visible while form scrolls
- Strip uses `theme.headerBg` + `borderBottom: 2px solid theme.accent` — matches main header brand

**File:** `juggler-frontend/src/components/tasks/TaskEditForm.jsx` — mobile return path (line ~2107)

---

## Issue 2 — Remaining reverts after save on mobile

**Root cause:** After saving, the scheduler runs and emits `schedule:changed` SSE. The SSE handler in `useTaskState` patches the task in `allTasks` using only the fields present in the scheduler output — which does not include `time_remaining`. If the patch overwrites the task object without preserving `timeRemaining`, the task in state has `timeRemaining: null`. When the form re-syncs from the updated task prop, it shows the full `dur` value instead of the saved remaining time.

**Fix:** In `useTaskState`'s SSE task-merge logic, preserve existing fields not present in the incoming patch — specifically ensure `timeRemaining` (and any other non-scheduler fields) survive a scheduler-patch merge via `Object.assign({}, existingTask, patch)` rather than replacement.

**File:** `juggler-frontend/src/hooks/useTaskState.js` — SSE `tasks:changed` / `schedule:changed` handler

---

## Issue 3 — Weather in time grid (CalendarGrid + DailyView)

**Approved design:**

### Center strip (hour ticks only — no :30 or :15 content)

Each hour row in the center strip shows, stacked top-to-bottom:
1. Hour label (`formatHour(hour)`) — existing
2. Location icon (circular badge) — existing
3. Weather icon + temp — existing in `mode='full'` only → **extend to all modes except `mini`**
4. Precip% text — **removed** from inline display (moved to popup only)
5. Humidity `↕` display — **removed** from inline display (moved to popup)

### Precip bar

- 4px wide strip on the left edge of the center strip (`left:0`)
- Continuous — one segment per hour row, height = `hourHeight`
- Color by WMO type: blue (`#1e90ff`) = rain (codes 51–67, 80–82), white-grey (`#c8d8e8`) = snow (71–77, 85–86), purple (`#9b59b6`) = freezing (66–67)
- Opacity scales with `precipProb / 100` — invisible at 0%, full color at 100%
- `STRIP_W` bumped from 44 → 52px to absorb the bar without squeezing labels

### Hover popup

Triggered by `onMouseEnter`/`onMouseLeave` on each hour row (`useState` per-row hover, no library). Shows:

| Field | Source |
|-------|--------|
| Time | `formatHour(hour)` |
| Condition | WMO code → plain label ("Rain", "Light Snow", "Freezing Rain", "Partly Cloudy", etc.) |
| Temp | `hw.temp` in user unit |
| Precip chance | `hw.precipProb` — blue + bold when ≥ 30% |
| Cloud cover | `hw.cloudcover` — omitted when 0 |
| Humidity | `hw.humidity` |
| Location | Resolved location name for that hour |

Popup positioned to the right of the strip; flips left when near right viewport edge (check `getBoundingClientRect`). Uses `position:absolute` inside a `position:relative` wrapper with `overflow:visible`.

### Views affected

- **CalendarGrid** (`schedule/CalendarGrid.jsx`) — primary change: precip bar + popup, extend weather to non-`full` modes, remove humidity inline
- **DailyView** (`views/DailyView.jsx`) — has its own hour column; add the same precip bar + popup pattern there
- **ThreeDayView / WeekView** — both use CalendarGrid; inherit changes automatically

### Strip width change

`STRIP_W = 44 → 52`, `STRIP_W_M = 32 → 38`, `STRIP_W_COMPACT = 32 → 38`. Update `getDims()` and all layout calculations that reference these constants.

---

## Issue 4 — Weather constraints hidden in create mode

**Root cause:** `TaskEditForm.jsx` line ~1966: `{!isCreate && !marker && <div>…Weather section…</div>}`. The `!isCreate` guard hides the entire precipitation/sky/temp/humidity constraint section when creating a task.

**Fix:** Remove `!isCreate` from the condition: `{!marker && <div>…Weather section…</div>}`.

Also fix: `unit={task.weatherTempUnit || 'F'}` at line ~1994 crashes in create mode since `task` is undefined. Change to: `unit={(task && task.weatherTempUnit) || 'F'}`.

**File:** `juggler-frontend/src/components/tasks/TaskEditForm.jsx`

---

## Issue 5 — Status bar showing "58% RH — 0/12" removed

**Root cause:** `WeatherBadge.jsx` line 58 renders `· {humidity}% RH` inline. This appears in view headers where `WeatherBadge` is used with the full (non-compact) variant.

**Fix:** Remove the humidity line from `WeatherBadge` entirely — humidity is now surfaced in the hover popup (Issue 3). The `showLow` variant retains `high / low` display; `compact` variant is unchanged.

Also remove: the done/total progress row (`X/12 done` + progress bar) that appears in `DayView` and `DailyView` fixed headers (around line ~975 in DayView, ~967 in DailyView). This is the `0/12` part of the status bar. The HeaderBar inline week strip already shows per-day done/total on hover — the in-view bar is redundant.

**Files:** `juggler-frontend/src/components/features/WeatherBadge.jsx`, `juggler-frontend/src/components/views/DayView.jsx`, `juggler-frontend/src/components/views/DailyView.jsx`

---

## Constraints

- No backend changes
- No new npm packages
- All five issues ship as a single commit batch (or atomic per-issue commits)
- `STRIP_W` change must not break CalendarGrid layout at any zoom level — verify at `gridZoom` 60, 80, 100
