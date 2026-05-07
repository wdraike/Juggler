# Juggler UI Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five juggler UI issues: mobile form header coverage, timeRemaining revert on SSE, weather integrated into time-grid strip with hover popup, weather section in create mode, and status bar removal.

**Architecture:** All frontend-only changes. `CalendarGrid.jsx` gets the bulk of the weather work (precip bar + hover popup + strip width bump). `TaskEditForm.jsx` gets the mobile mini-header and the create-mode weather fix. `taskReducer.js` gets the PATCH_TASKS preserve-all fix. `WeatherBadge.jsx` and view headers lose the status bar pieces.

**Tech Stack:** React (functional components, hooks), inline styles, existing theme tokens from `getTheme()`, WMO weather codes.

**Spec:** `docs/superpowers/specs/2026-05-06-juggler-ui-fixes-design.md`

---

### Task 1: Remove status bar — humidity from WeatherBadge + done/total from view headers

**Files:**
- Modify: `juggler-frontend/src/components/features/WeatherBadge.jsx:52-60`
- Modify: `juggler-frontend/src/components/views/DayView.jsx` (~line 960-980)
- Modify: `juggler-frontend/src/components/views/DailyView.jsx` (~line 960-975)

- [ ] **Step 1: Remove humidity span from WeatherBadge**

In `WeatherBadge.jsx`, in the non-compact return (around line 52), delete the humidity span entirely:

```jsx
// REMOVE these two lines:
var humidity = weatherDay.humidityAvg != null ? Math.round(weatherDay.humidityAvg) : null;
// and:
{humidity != null && <span style={{ opacity: 0.7 }}>· {humidity}% RH</span>}
```

After removal the non-compact return renders: icon · high / low · precip% (when ≥30%). No humidity.

- [ ] **Step 2: Remove done/total progress row from DayView**

In `DayView.jsx`, find the fixed header section (around line 960–980) that renders a progress bar and `X/N done` text. It looks like:

```jsx
<div style={{ width: 60, height: 5, background: theme.bgTertiary, borderRadius: 3, overflow: 'hidden' }}>
  <div style={{ width: pct + '%', height: '100%', background: theme.accent }} />
</div>
```

Delete the entire `<div>` block containing the progress bar and the done/total text label alongside it.

- [ ] **Step 3: Remove same done/total progress row from DailyView**

Apply the identical deletion in `DailyView.jsx` — find the matching progress bar + done/total block in its fixed header and remove it.

- [ ] **Step 4: Verify**

Start the frontend (`npm start` in `juggler-frontend/`) and open the app. Confirm:
- No `· 58% RH` text in any view header
- No `X/N done` progress bar in DayView or DailyView headers
- WeatherBadge still shows icon + high/low + precip% correctly

- [ ] **Step 5: Commit**

```bash
git add juggler-frontend/src/components/features/WeatherBadge.jsx \
        juggler-frontend/src/components/views/DayView.jsx \
        juggler-frontend/src/components/views/DailyView.jsx
git commit -m "fix(ui): remove humidity from WeatherBadge and done/total status bar from view headers"
```

---

### Task 2: Fix weather constraints section in create mode

**Files:**
- Modify: `juggler-frontend/src/components/tasks/TaskEditForm.jsx` (~lines 1966, 1994)

- [ ] **Step 1: Remove `!isCreate` from Weather section guard**

Find line ~1966:
```jsx
{!isCreate && !marker &&
```
Change to:
```jsx
{!marker &&
```

- [ ] **Step 2: Fix `task.weatherTempUnit` crash in create mode**

Find line ~1994 inside the `WeatherTempSlider` usage:
```jsx
unit={task.weatherTempUnit || 'F'}
```
Change to:
```jsx
unit={(task && task.weatherTempUnit) || 'F'}
```

- [ ] **Step 3: Verify**

Open the app, click "+" to create a new task. Confirm the Weather section (Precipitation / Sky cover / Temp / Humidity sliders) is now visible in the create form. Confirm no crash.

- [ ] **Step 4: Commit**

```bash
git add juggler-frontend/src/components/tasks/TaskEditForm.jsx
git commit -m "fix(tasks): show weather constraints section in create mode"
```

---

### Task 3: Fix timeRemaining revert on SSE scheduler patch

**Files:**
- Modify: `juggler-frontend/src/state/taskReducer.js` — `PATCH_TASKS` case

- [ ] **Step 1: Locate PATCH_TASKS in taskReducer**

Open `juggler-frontend/src/state/taskReducer.js`. Find the `case 'PATCH_TASKS':` block. It applies scheduler patches to tasks in state. The patch object from the scheduler contains fields like `date`, `time`, `dur`, `scheduledAt` — but NOT `timeRemaining`.

- [ ] **Step 2: Verify the merge strategy**

The patch application will look something like:
```js
tasks: state.tasks.map(function(t) {
  var p = patchMap[t.id];
  if (!p) return t;
  return Object.assign({}, t, p.patch);  // ← this is correct IF existing
})
```

If it does `Object.assign({}, t, p.patch)` — existing fields not in `p.patch` (including `timeRemaining`) are already preserved. **If it instead replaces the whole task object with `p.patch`, that's the bug.**

Look for any path that discards the original task `t` when applying a patch. If you find one, fix it to use `Object.assign({}, t, p.patch)`.

- [ ] **Step 3: Add timeRemaining to the SCHEDULER_FIELDS exclusion list if needed**

In `useTaskState.js` around line 63, there is a list of fields called `SCHEDULER_FIELDS` or similar (the fields a save considers "scheduler-owned"). Confirm `timeRemaining` is NOT in that list (it's user-set, not scheduler-set). If it is, remove it.

- [ ] **Step 4: Verify**

In the app at `https://strivers.localdev.raikegroup.com/`:
1. Open a task with Duration = 2 hrs
2. Set Remaining = 30 min, save
3. Wait for scheduler to run (~5s)
4. Duration field should still show 2 hrs, Remaining should still show 30 min
5. Confirm the form does NOT revert to showing 2 hrs in the Remaining field

- [ ] **Step 5: Commit**

```bash
git add juggler-frontend/src/state/taskReducer.js
git commit -m "fix(tasks): preserve timeRemaining through SSE scheduler patch merge"
```

---

### Task 4: Mobile form mini-header strip

**Files:**
- Modify: `juggler-frontend/src/components/tasks/TaskEditForm.jsx` — mobile return (~line 2106)

- [ ] **Step 1: Add mini-header to the mobile return**

Find the mobile return block starting at ~line 2106:
```jsx
// Mobile: full-screen overlay
return (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 600, background: TH.bgCard, overflowY: 'auto'
  }}>
    {dialogContent}
  </div>
);
```

Replace with:
```jsx
// Mobile: full-screen overlay with sticky mini-header
return (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 600, background: TH.bgCard, overflowY: 'auto'
  }}>
    <div style={{
      position: 'sticky', top: 0, zIndex: 10,
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px',
      background: TH.headerBg,
      borderBottom: '2px solid ' + TH.accent,
    }}>
      <button onClick={onClose} style={{
        border: 'none', background: 'transparent', color: TH.accent,
        fontSize: 20, cursor: 'pointer', padding: '2px 4px', lineHeight: 1
      }}>←</button>
      <div style={{
        fontFamily: "'Playfair Display', serif",
        fontWeight: 700, fontSize: 16, color: TH.headerText, lineHeight: 1.1
      }}>
        Strive<span style={{ color: TH.accent }}>RS</span>
        <span style={{
          fontFamily: "'Inter', sans-serif", fontWeight: 400,
          fontSize: 11, color: TH.textMuted, marginLeft: 6
        }}>/ {isCreate ? 'New Task' : 'Edit Task'}</span>
      </div>
      <div style={{ flex: 1 }} />
      {isCreate ? (
        <button onClick={handleCreate} style={{
          fontSize: 11, fontWeight: 700, padding: '5px 14px',
          border: 'none', borderRadius: 4,
          background: '#2D6A4F', color: '#FDFAF5', cursor: 'pointer'
        }}>+ Create</button>
      ) : (
        isDirty && <button onClick={handleSave} style={{
          fontSize: 11, fontWeight: 700, padding: '5px 14px',
          border: 'none', borderRadius: 4,
          background: TH.accent, color: '#FDFAF5', cursor: 'pointer'
        }}>✔ Save</button>
      )}
      <button onClick={onClose} style={{
        border: 'none', background: 'transparent', color: TH.textMuted,
        fontSize: 22, cursor: 'pointer', padding: '2px 4px', lineHeight: 1
      }}>×</button>
    </div>
    {dialogContent}
  </div>
);
```

Note: `TH` is already defined earlier in the component as `var TH = getTheme(darkMode)...` or similar — check the exact variable name in the file (may be `theme` or `TH`). `handleCreate`, `handleSave`, `isDirty`, `isCreate`, `onClose` are all already in scope.

- [ ] **Step 2: Verify at mobile width**

Open the app in browser devtools at 480px viewport width. Open a task. Confirm:
- Mini-header strip is visible at top: ← StriveRS / Edit Task … ×
- The rest of the form scrolls beneath it
- ← and × both close the form
- Save button appears when you dirty the form

- [ ] **Step 3: Verify desktop unaffected**

At full desktop width, confirm the sidebar form looks identical to before (mini-header only renders in the mobile `isMobile` path).

- [ ] **Step 4: Commit**

```bash
git add juggler-frontend/src/components/tasks/TaskEditForm.jsx
git commit -m "fix(mobile): add sticky mini-header strip to full-screen task form overlay"
```

---

### Task 5: Weather in CalendarGrid — precip bar + hover popup + strip width

**Files:**
- Modify: `juggler-frontend/src/components/schedule/CalendarGrid.jsx`

- [ ] **Step 1: Bump STRIP_W constants**

At the top of `CalendarGrid.jsx` (lines 35-38), update:
```js
var STRIP_W = 52;          // was 44
var STRIP_W_M = 38;        // was 32
var STRIP_W_COMPACT = 38;  // was 32
var STRIP_W_MINI = 24;     // unchanged
```

- [ ] **Step 2: Add WMO-code-to-label helper**

After the existing `weatherCodeIcon()` function (around line 32), add:
```js
function weatherCodeLabel(code) {
  if (code == null || code === 0) return 'Clear';
  if (code <= 3) return 'Partly Cloudy';
  if (code <= 48) return 'Foggy';
  if (code === 51 || code === 53) return 'Light Drizzle';
  if (code === 55) return 'Drizzle';
  if (code === 61 || code === 63) return 'Light Rain';
  if (code === 65) return 'Heavy Rain';
  if (code === 66 || code === 67) return 'Freezing Rain';
  if (code === 71 || code === 73) return 'Light Snow';
  if (code === 75) return 'Heavy Snow';
  if (code === 77) return 'Snow Grains';
  if (code === 80 || code === 81) return 'Rain Showers';
  if (code === 82) return 'Heavy Showers';
  if (code === 85 || code === 86) return 'Snow Showers';
  return 'Stormy';
}

function precipColor(code) {
  if (code >= 66 && code <= 67) return '#9b59b6'; // freezing — purple
  if (code >= 71 && code <= 86) return '#c8d8f0'; // snow — light blue/grey
  return '#1e90ff'; // rain default — blue
}
```

- [ ] **Step 3: Add hover state and precip bar to center strip**

Locate the center strip `<div>` block starting around line 358. Add a `useState` for the hovered hour at the top of the render function (before the `return`):

```js
var [hoveredHour, setHoveredHour] = React.useState(null);
```

Inside the `Array.from({ length: GRID_HOURS_COUNT }, ...)` loop that renders each hour row (around line 360), add the precip bar segment and wrap the row in hover handlers.

Replace the current hour row `<div key={i} onClick=... style={{ position:'absolute', top: i*hourHeight, ...}}>` with:

```jsx
<div key={i}
  onClick={onHourLocationOverride && locations ? function(e) {
    e.stopPropagation();
    setLocMenuHour(locMenuHour === hour ? null : hour);
  } : undefined}
  onMouseEnter={hourlyByHour[hour] ? function() { setHoveredHour(hour); } : undefined}
  onMouseLeave={hourlyByHour[hour] ? function() { setHoveredHour(null); } : undefined}
  title={onHourLocationOverride ? 'Click to change location for ' + formatHour(hour) : undefined}
  style={{ position: 'absolute', top: i * hourHeight, left: 0, width: '100%', textAlign: 'center',
    pointerEvents: (onHourLocationOverride || hourlyByHour[hour]) ? 'auto' : 'none',
    cursor: onHourLocationOverride ? 'pointer' : 'default' }}
>
```

- [ ] **Step 4: Add the precip bar segment inside each hour row**

As the FIRST child inside the hour row div (before the time label), add:
```jsx
{hourlyByHour[hour] && (function() {
  var hw = hourlyByHour[hour];
  var prob = hw.precipProb || 0;
  if (prob < 5) return null;
  var col = precipColor(hw.code);
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0,
      width: 4, height: hourHeight,
      background: col,
      opacity: Math.min(1, prob / 100),
      pointerEvents: 'none'
    }} />
  );
})()}
```

- [ ] **Step 5: Update inline weather display — remove humidity, extend beyond full mode**

Find the weather block inside the hour row (around line 384):
```jsx
{mode === 'full' && hourlyByHour[hour] && (function() {
  ...
  {hw.humidity > 0 && <div style={{ fontSize: 7 }}>{hw.humidity}%↕</div>}
  ...
```

Change to (removes humidity, extends to all non-mini modes):
```jsx
{mode !== 'mini' && hourlyByHour[hour] && (function() {
  var hw = hourlyByHour[hour];
  var icon = weatherCodeIcon(hw.code);
  if (!icon) return null;
  var unit = (schedCfg && schedCfg.temperatureUnit) || 'F';
  return (
    <div style={{
      fontSize: 8, color: theme.textMuted, lineHeight: 1.2,
      marginTop: 1, userSelect: 'none', opacity: 0.8,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <span style={{ fontSize: 9 }}>{icon}</span>
        <span>{Math.round(hw.temp)}°{unit}</span>
      </div>
    </div>
  );
})()}
```

- [ ] **Step 6: Add hover popup**

After the weather block (still inside the hour row div), add the popup:
```jsx
{hoveredHour === hour && hourlyByHour[hour] && (function() {
  var hw = hourlyByHour[hour];
  var unit = (schedCfg && schedCfg.temperatureUnit) || 'F';
  var locId = resolveLocationId(dateKey, hour, schedCfg, blocks);
  var loc = (locations || []).find(function(l) { return l.id === locId; });
  var locLabel = loc ? (locIcon(locId) + ' ' + loc.name) : '';
  var isRightHalf = stripX > (cw / 2);
  return (
    <div style={{
      position: 'absolute',
      top: -4,
      ...(isRightHalf ? { right: dm.STRIP_W + 6 } : { left: dm.STRIP_W + 6 }),
      zIndex: 999,
      background: theme.bgCard,
      border: '1px solid ' + theme.border,
      borderRadius: 6,
      padding: '8px 10px',
      width: 160,
      textAlign: 'left',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      pointerEvents: 'none',
      fontSize: 10,
      color: theme.text,
      lineHeight: 1.6
    }}>
      <div style={{ fontWeight: 700, color: theme.accent, marginBottom: 4, borderBottom: '1px solid ' + theme.border, paddingBottom: 3 }}>
        {formatHour(hour)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: theme.textMuted }}>Condition</span>
        <span>{weatherCodeIcon(hw.code)} {weatherCodeLabel(hw.code)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: theme.textMuted }}>Temp</span>
        <span>{Math.round(hw.temp)}°{unit}</span>
      </div>
      {hw.precipProb > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: theme.textMuted }}>Precip</span>
          <span style={{ color: hw.precipProb >= 30 ? '#1e90ff' : theme.text, fontWeight: hw.precipProb >= 30 ? 700 : 400 }}>
            {hw.precipProb}%
          </span>
        </div>
      )}
      {hw.cloudcover > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: theme.textMuted }}>Cloud</span>
          <span>{hw.cloudcover}%</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: theme.textMuted }}>Humidity</span>
        <span>{hw.humidity}%</span>
      </div>
      {locLabel && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: theme.textMuted }}>Location</span>
          <span>{locLabel}</span>
        </div>
      )}
    </div>
  );
})()}
```

- [ ] **Step 7: Verify CalendarGrid at multiple zoom levels**

In the app, switch to the "Flex" view (DayView). Verify:
- Strip is slightly wider (52px) with no layout breakage
- Precip bar shows on the left edge when weather data has precipitation
- Hour ticks show icon + temp (no humidity text)
- Hovering an hour shows the popup with condition, temp, precip%, cloud, humidity, location
- Test at gridZoom 60, 80, 100 — popup and bar must not break layout

- [ ] **Step 8: Commit**

```bash
git add juggler-frontend/src/components/schedule/CalendarGrid.jsx
git commit -m "feat(weather): precip bar, hover popup, and extended weather display in CalendarGrid"
```

---

### Task 6: Weather in DailyView — match CalendarGrid pattern

**Files:**
- Modify: `juggler-frontend/src/components/views/DailyView.jsx`

- [ ] **Step 1: Locate DailyView's hour column rendering**

In `DailyView.jsx`, find where hour labels are rendered (search for `formatHour` or `GRID_START`). This is the equivalent of CalendarGrid's center strip — DailyView has its own grid layout.

- [ ] **Step 2: Add hourlyByHour map**

Before the hour column render loop, add the same weather map used in CalendarGrid:
```js
var hourlyByHourDV = {};
if (weatherByDate && weatherByDate[selectedDateKey] && weatherByDate[selectedDateKey].hourly) {
  weatherByDate[selectedDateKey].hourly.forEach(function(entry) {
    hourlyByHourDV[entry.hour] = entry;
  });
}
```

- [ ] **Step 3: Add precip bar segments and hover popup**

Add `var [dvHoveredHour, setDvHoveredHour] = React.useState(null);` at the top of the component.

Inside each hour row in DailyView's hour column, apply the same precip bar, onMouseEnter/Leave, weather icon+temp display, and popup code from Task 5 Steps 4–6. Use `dvHoveredHour`/`setDvHoveredHour` instead of `hoveredHour`/`setHoveredHour`. Use `hourlyByHourDV` instead of `hourlyByHour`.

Reference Task 5 for exact JSX — the pattern is identical.

- [ ] **Step 4: Verify**

Switch to "Day" view (DailyView). Confirm precip bar, weather icon+temp at hour ticks, and hover popup all work as in the Flex view.

- [ ] **Step 5: Commit**

```bash
git add juggler-frontend/src/components/views/DailyView.jsx
git commit -m "feat(weather): precip bar and hover popup in DailyView hour column"
```

---

### Task 7: Final verification pass

- [ ] **Step 1: Mobile form at 480px**

Open DevTools → set viewport to 480px. Open a task. Verify mini-header is sticky, ← closes the form, main nav is gone (expected — form is full-screen) but the mini-header provides clear orientation.

- [ ] **Step 2: Remaining field survives scheduler run**

Set a task's Remaining to 30 min on a task with Duration 2 hrs. Save. Wait 5-10s for scheduler. Remaining must still show 30 min after the SSE update lands.

- [ ] **Step 3: Weather section in new task**

Click +. Scroll to Weather section. Confirm Precipitation, Sky cover, Temp range, Humidity range controls are visible and functional.

- [ ] **Step 4: No status bar**

Confirm no `58% RH` or `0/12 done` rows appear in DayView or DailyView headers.

- [ ] **Step 5: Weather popup in all time-grid views**

Switch to Flex, 3-Day, Week, and Day views. Hover an hour tick on a day with precipitation. Confirm popup appears in each view.

- [ ] **Step 6: Final commit if anything was missed**

```bash
git status
# stage any loose changes
git commit -m "fix(ui): juggler UI fixes — mobile form, weather grid, status bar, create mode"
```
