# Weather UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add weather indicators to calendar task blocks, redesign the weather section in TaskEditForm, split Where/Tools/Weather into three sections, fix the locate-me label, and add auto-icon for tasks everywhere task text is shown.

**Architecture:** A shared `taskIcon.js` utility handles emoji lookup (sync keyword map + async AI fallback via a React hook). Weather matching logic lives in a shared `weatherMatch.js` utility consumed by `ScheduleCard` and `DailyView`. `CalendarGrid` receives a new `weatherDay` prop (pre-sliced from `weatherByDate[dateKey]` by the parent view) and passes it to each `ScheduleCard`.

**Tech Stack:** React (no new deps), existing `togStyle` / `secStyle` / `secHead` patterns in `TaskEditForm`, two-overlapping-`<input type="range">` for dual-handle slider, Vertex AI (existing) for icon AI fallback via new backend endpoint.

---

## File Map

| Action | File |
|--------|------|
| Create | `juggler-frontend/src/utils/taskIcon.js` |
| Create | `juggler-frontend/src/utils/weatherMatch.js` |
| Create | `juggler-frontend/src/utils/__tests__/taskIcon.test.js` |
| Create | `juggler-frontend/src/utils/__tests__/weatherMatch.test.js` |
| Modify | `juggler-frontend/src/components/schedule/ScheduleCard.jsx` |
| Modify | `juggler-frontend/src/components/schedule/CalendarGrid.jsx` |
| Modify | `juggler-frontend/src/components/views/DayView.jsx` |
| Modify | `juggler-frontend/src/components/views/WeekView.jsx` |
| Modify | `juggler-frontend/src/components/views/ThreeDayView.jsx` |
| Modify | `juggler-frontend/src/components/views/DailyView.jsx` |
| Modify | `juggler-frontend/src/components/tasks/TaskCard.jsx` |
| Modify | `juggler-frontend/src/components/views/MonthView.jsx` |
| Modify | `juggler-frontend/src/components/views/ConflictsView.jsx` |
| Modify | `juggler-frontend/src/components/views/DependencyView.jsx` |
| Modify | `juggler-frontend/src/components/tasks/TaskEditForm.jsx` |
| Modify | `juggler-frontend/src/components/settings/SettingsPanel.jsx` |
| Modify | `juggler-backend/src/routes/task.routes.js` |

---

## Task 1: `taskIcon.js` + `useTaskIcon` hook

**Files:**
- Create: `juggler-frontend/src/utils/taskIcon.js`
- Create: `juggler-frontend/src/utils/__tests__/taskIcon.test.js`

- [ ] **Step 1: Write the failing tests**

Create `juggler-frontend/src/utils/__tests__/taskIcon.test.js`:
```js
import { getTaskIcon } from '../taskIcon';

test('returns null when text starts with emoji', () => {
  expect(getTaskIcon('🏃 Morning run')).toBeNull();
});
test('matches keyword run', () => {
  expect(getTaskIcon('Morning run')).toBe('🏃');
});
test('matches keyword gym', () => {
  expect(getTaskIcon('Go to gym')).toBe('💪');
});
test('matches keyword meeting (case-insensitive)', () => {
  expect(getTaskIcon('Team Meeting')).toBe('📞');
});
test('returns null for unrecognised text', () => {
  expect(getTaskIcon('Zylbx something')).toBeNull();
});
test('returns null for empty string', () => {
  expect(getTaskIcon('')).toBeNull();
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd juggler/juggler-frontend && npx jest src/utils/__tests__/taskIcon.test.js --no-coverage 2>&1 | tail -20
```

- [ ] **Step 3: Implement `taskIcon.js`**

Create `juggler-frontend/src/utils/taskIcon.js`:
```js
// Emoji detection: starts with a common emoji range
var EMOJI_RE = /^[\u{1F300}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2702}-\u{27B0}]/u;

// Ordered keyword → emoji map. First match wins.
var KEYWORD_MAP = [
  // Exercise
  [/\b(run|jog|sprint)\b/, '🏃'],
  [/\b(walk|stroll|hike)\b/, '🚶'],
  [/\b(bike|cycle|cycling|bicycle)\b/, '🚴'],
  [/\b(gym|workout|lift|weights|exercise|strength)\b/, '💪'],
  [/\b(swim|swimming|pool|laps?)\b/, '🏊'],
  [/\b(yoga|stretch|pilates)\b/, '🧘'],
  [/\b(meditat|mindful|breathe)\b/, '🧘'],
  // Work
  [/\b(code|coding|debug|deploy|commit|refactor|build|pr|pull request)\b/, '💻'],
  [/\b(design|mockup|figma|wireframe|sketch)\b/, '🎨'],
  [/\b(write|writing|draft|essay|blog|report|article)\b/, '✍️'],
  [/\b(email|inbox|reply|respond)\b/, '📧'],
  [/\b(meeting|standup|sync|zoom|teams|call|interview|1:1)\b/, '📞'],
  [/\b(read|reading|study|learn|research|review)\b/, '📚'],
  [/\b(plan|planning|schedule|organise|organize|prep)\b/, '📋'],
  // Life
  [/\b(groceries|grocery|shopping|errands?|store|pharmacy)\b/, '🛒'],
  [/\b(cook|cooking|meal prep|dinner|lunch|breakfast|recipe|bake)\b/, '🍳'],
  [/\b(clean|cleaning|tidy|laundry|vacuum|dishes|mop|sweep|mow)\b/, '🧹'],
  [/\b(doctor|dentist|meds|medication|appointment|therapy|physio)\b/, '💊'],
  [/\b(sleep|nap|rest)\b/, '😴'],
  [/\b(pay|bill|invoice|budget|taxes|bank|finance)\b/, '💰'],
  [/\b(drive|commute|flight|airport|travel|trip|pack)\b/, '✈️'],
  [/\b(dinner with|lunch with|coffee with|hang|party|social)\b/, '🍽️'],
  [/\b(call mom|call dad|call family|catch up)\b/, '📱'],
];

// Module-level cache: text → emoji (populated by keyword map + async AI)
var iconCache = new Map();
// Pending AI requests (avoid duplicate fetches)
var pendingAI = new Set();

/**
 * Synchronous lookup. Returns emoji string or null.
 * For AI fallback, call requestAIIcon(text, callback) separately.
 */
export function getTaskIcon(text) {
  if (!text) return null;
  if (EMOJI_RE.test(text)) return null; // user typed emoji — don't override

  var cached = iconCache.get(text);
  if (cached !== undefined) return cached || null;

  var lower = text.toLowerCase();
  for (var [re, icon] of KEYWORD_MAP) {
    if (re.test(lower)) {
      iconCache.set(text, icon);
      return icon;
    }
  }

  iconCache.set(text, ''); // mark as "no keyword match" (empty = checked, no result)
  return null;
}

/**
 * Request AI icon for text that missed the keyword map.
 * Calls onResult(emoji) once resolved. No-ops if already cached or pending.
 */
export function requestAIIcon(text, onResult) {
  if (!text) return;
  if (iconCache.get(text)) return; // already have a result
  if (pendingAI.has(text)) return; // already in flight

  // Only request if we confirmed no keyword match (empty string set above)
  if (iconCache.get(text) !== '') return;

  pendingAI.add(text);
  fetch('/api/tasks/suggest-icon?text=' + encodeURIComponent(text))
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      pendingAI.delete(text);
      if (data && data.icon) {
        iconCache.set(text, data.icon);
        onResult(data.icon);
      }
    })
    .catch(function() { pendingAI.delete(text); });
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd juggler/juggler-frontend && npx jest src/utils/__tests__/taskIcon.test.js --no-coverage 2>&1 | tail -10
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd juggler/juggler-frontend && git add src/utils/taskIcon.js src/utils/__tests__/taskIcon.test.js
git commit -m "feat(icons): taskIcon utility — keyword map + AI fallback"
```

---

## Task 2: `weatherMatch.js` utility

**Files:**
- Create: `juggler-frontend/src/utils/weatherMatch.js`
- Create: `juggler-frontend/src/utils/__tests__/weatherMatch.test.js`

- [ ] **Step 1: Write the failing tests**

Create `juggler-frontend/src/utils/__tests__/weatherMatch.test.js`:
```js
import { checkWeatherMatch, hasWeatherRestrictions } from '../weatherMatch';

var RAINY_DAY = { high: 18, low: 10, precipPct: 70, code: 61,
  hourly: Array.from({length:24}, (_,i) => ({ hour:i, temp:14, precipProb:70, cloudcover:85, code:61 })) };
var SUNNY_DAY = { high: 25, low: 15, precipPct: 5, code: 1,
  hourly: Array.from({length:24}, (_,i) => ({ hour:i, temp:22, precipProb:5, cloudcover:10, code:1 })) };

test('hasWeatherRestrictions: false when all any/null', () => {
  expect(hasWeatherRestrictions({ weatherPrecip:'any', weatherCloud:'any', weatherTempMin:null, weatherTempMax:null })).toBe(false);
});
test('hasWeatherRestrictions: true when precip set', () => {
  expect(hasWeatherRestrictions({ weatherPrecip:'dry_only', weatherCloud:'any', weatherTempMin:null, weatherTempMax:null })).toBe(true);
});
test('dry_only fails on rainy day', () => {
  var r = checkWeatherMatch({ weatherPrecip:'dry_only', weatherCloud:'any', weatherTempMin:null, weatherTempMax:null }, RAINY_DAY);
  expect(r.ok).toBe(false);
  expect(r.reason).toMatch(/rain/i);
});
test('dry_only passes on sunny day', () => {
  var r = checkWeatherMatch({ weatherPrecip:'dry_only', weatherCloud:'any', weatherTempMin:null, weatherTempMax:null }, SUNNY_DAY);
  expect(r.ok).toBe(true);
});
test('temp_min fails when low is below min', () => {
  var r = checkWeatherMatch({ weatherPrecip:'any', weatherCloud:'any', weatherTempMin:60, weatherTempMax:null }, SUNNY_DAY);
  // SUNNY_DAY low is 15°C = 59°F → fails if min is 60°F
  // But weatherTempMin is stored in °F; SUNNY_DAY.low is 15 (°C in this mock)
  // We pass Fahrenheit values — test with F values matching the mock temps
  var r2 = checkWeatherMatch({ weatherPrecip:'any', weatherCloud:'any', weatherTempMin:60, weatherTempMax:null },
    { ...SUNNY_DAY, low: 55 }); // low 55°F < min 60°F
  expect(r2.ok).toBe(false);
  expect(r2.reason).toMatch(/below/i);
});
test('returns neutral when no weatherDay data', () => {
  var r = checkWeatherMatch({ weatherPrecip:'dry_only', weatherCloud:'any', weatherTempMin:null, weatherTempMax:null }, null);
  expect(r.ok).toBeNull(); // null = neutral, no data
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd juggler/juggler-frontend && npx jest src/utils/__tests__/weatherMatch.test.js --no-coverage 2>&1 | tail -20
```

- [ ] **Step 3: Implement `weatherMatch.js`**

Create `juggler-frontend/src/utils/weatherMatch.js`:
```js
/**
 * Checks whether a day's forecast meets a task's weather requirements.
 *
 * Returns { ok: true|false|null, reason: string|null }
 *   ok=null  → no forecast data, show neutral icon
 *   ok=true  → forecast meets all requirements
 *   ok=false → at least one condition fails; reason describes the first failure
 */
export function checkWeatherMatch(task, weatherDay) {
  var precip = task.weatherPrecip || 'any';
  var cloud  = task.weatherCloud  || 'any';
  var tMin   = task.weatherTempMin  != null ? Number(task.weatherTempMin)  : null;
  var tMax   = task.weatherTempMax  != null ? Number(task.weatherTempMax)  : null;

  if (!weatherDay) return { ok: null, reason: null };

  var precipPct = weatherDay.precipPct || 0;
  var dailyHigh = weatherDay.high;
  var dailyLow  = weatherDay.low;

  // Average cloudcover for daytime hours (8–18)
  var daytimeHours = (weatherDay.hourly || []).filter(function(h) { return h.hour >= 8 && h.hour <= 18; });
  var cloudCoverDaytime = daytimeHours.length > 0
    ? daytimeHours.reduce(function(s, h) { return s + (h.cloudcover || 0); }, 0) / daytimeHours.length
    : 0;

  // Precipitation check
  if (precip === 'dry_only'  && precipPct >= 30) return { ok: false, reason: Math.round(precipPct) + '% rain chance — requires dry conditions' };
  if (precip === 'light_ok'  && precipPct >= 60) return { ok: false, reason: Math.round(precipPct) + '% rain chance — requires light rain or less' };
  if (precip === 'wet_ok'    && precipPct >= 90) return { ok: false, reason: Math.round(precipPct) + '% rain chance — heavy rain expected' };

  // Cloud cover check
  if (cloud === 'clear'       && cloudCoverDaytime > 20) return { ok: false, reason: 'Too cloudy — requires clear sky' };
  if (cloud === 'partly_ok'   && cloudCoverDaytime > 60) return { ok: false, reason: 'Too cloudy — requires partly cloudy or better' };
  if (cloud === 'overcast_ok' && cloudCoverDaytime > 90) return { ok: false, reason: 'Fully overcast — requires overcast or better' };

  // Temperature check
  if (tMin != null && dailyLow  != null && dailyLow  < tMin) return { ok: false, reason: 'Temp below minimum (' + tMin + '° min, forecast low ' + Math.round(dailyLow) + '°)' };
  if (tMax != null && dailyHigh != null && dailyHigh > tMax) return { ok: false, reason: 'Temp above maximum (' + tMax + '° max, forecast high ' + Math.round(dailyHigh) + '°)' };

  return { ok: true, reason: null };
}

/** True if any weather condition is set to a non-default value. */
export function hasWeatherRestrictions(task) {
  return (task.weatherPrecip && task.weatherPrecip !== 'any')
    || (task.weatherCloud && task.weatherCloud !== 'any')
    || task.weatherTempMin != null
    || task.weatherTempMax != null;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd juggler/juggler-frontend && npx jest src/utils/__tests__/weatherMatch.test.js --no-coverage 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
cd juggler/juggler-frontend && git add src/utils/weatherMatch.js src/utils/__tests__/weatherMatch.test.js
git commit -m "feat(weather): weatherMatch utility — forecast vs task requirements"
```

---

## Task 3: Backend `/api/tasks/suggest-icon` endpoint

**Files:**
- Modify: `juggler-backend/src/routes/task.routes.js`

- [ ] **Step 1: Open `task.routes.js` and find the router export line**

Read `juggler-backend/src/routes/task.routes.js`. Find the line `module.exports = router;` and add the new route before it.

- [ ] **Step 2: Add the endpoint**

Add before `module.exports = router;`:
```js
// GET /api/tasks/suggest-icon?text=<task text>
// Returns { icon: '🏃' } — one emoji best representing the task name.
router.get('/suggest-icon', requireAuth, async (req, res) => {
  var text = (req.query.text || '').trim().slice(0, 200);
  if (!text) return res.json({ icon: null });

  try {
    var { VertexAI } = require('@google-cloud/vertexai');
    var vertexAI = new VertexAI({ project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env.VERTEX_AI_LOCATION || 'us-central1' });
    var model = vertexAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    var result = await model.generateContent(
      'Return exactly one emoji that best represents this task: "' + text.replace(/"/g, '') + '". Reply with only the emoji character, nothing else.'
    );
    var icon = result.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    // Validate it's a single emoji-ish string (1–2 chars)
    if (icon && icon.length > 4) icon = null;
    res.json({ icon });
  } catch (e) {
    res.json({ icon: null }); // fail silently — icon is non-critical
  }
});
```

- [ ] **Step 3: Manual test**

Start the backend locally and run:
```bash
curl "http://localhost:5002/api/tasks/suggest-icon?text=Morning+run" -H "Authorization: Bearer <your-jwt>"
```
Expected: `{"icon":"🏃"}` or similar.

- [ ] **Step 4: Commit**

```bash
cd juggler/juggler-backend && git add src/routes/task.routes.js
git commit -m "feat(icons): suggest-icon endpoint via Gemini Flash"
```

---

## Task 4: Auto-icon in `TaskCard` and `ScheduleCard`

**Files:**
- Modify: `juggler-frontend/src/components/tasks/TaskCard.jsx:72`
- Modify: `juggler-frontend/src/components/schedule/ScheduleCard.jsx:130`

`TaskCard` is used by ListView and PriorityView — both get auto-icon for free once TaskCard is updated.

- [ ] **Step 1: Update `TaskCard.jsx`**

In `juggler-frontend/src/components/tasks/TaskCard.jsx`, add import at top:
```js
import { getTaskIcon, requestAIIcon } from '../../utils/taskIcon';
```

Add state at the top of the component function (after the existing `var [expanded, ...]` or similar state):
```js
var [iconOverride, setIconOverride] = React.useState(null);
React.useEffect(function() {
  requestAIIcon(task.text, function(ic) { setIconOverride(ic); });
}, [task.text]);
var taskIcon = iconOverride || getTaskIcon(task.text);
```

Replace the line `{task.text}` (line ~72) with:
```jsx
{taskIcon && <span style={{ marginRight: 3, fontSize: 12 }}>{taskIcon}</span>}{task.text}
```

- [ ] **Step 2: Update `ScheduleCard.jsx`**

In `juggler-frontend/src/components/schedule/ScheduleCard.jsx`, add import at top:
```js
import { getTaskIcon, requestAIIcon } from '../../utils/taskIcon';
```

Add near top of component function:
```js
var [iconOverride, setIconOverride] = React.useState(null);
React.useEffect(function() {
  requestAIIcon(task.text, function(ic) { setIconOverride(ic); });
}, [task.text]);
var taskIcon = iconOverride || getTaskIcon(task.text);
```

Replace `{task.text}` (line ~130) with:
```jsx
{taskIcon && <span style={{ marginRight: 2, fontSize: 10 }}>{taskIcon}</span>}{task.text}
```

- [ ] **Step 3: Verify visually**

Start frontend (`npm start` in `juggler-frontend`). Open the app. Task blocks and TaskCards should show emoji prefixes for recognized task names. Tasks already starting with an emoji should be unchanged.

- [ ] **Step 4: Commit**

```bash
cd juggler/juggler-frontend && git add src/components/tasks/TaskCard.jsx src/components/schedule/ScheduleCard.jsx
git commit -m "feat(icons): auto-icon in TaskCard and ScheduleCard"
```

---

## Task 5: Auto-icon in remaining views

**Files:**
- Modify: `juggler-frontend/src/components/views/MonthView.jsx:68`
- Modify: `juggler-frontend/src/components/views/DailyView.jsx:597,647`
- Modify: `juggler-frontend/src/components/views/ConflictsView.jsx:206`
- Modify: `juggler-frontend/src/components/views/DependencyView.jsx:126,220`

These are all inline `{task.text}` / `{t.text}` renders that aren't already covered by TaskCard or ScheduleCard.

- [ ] **Step 1: MonthView task chips**

In `juggler-frontend/src/components/views/MonthView.jsx`, add import:
```js
import { getTaskIcon } from '../../utils/taskIcon';
```

Find line 68: `{t.text}`. The chip renders each task as a tiny item. Replace with:
```jsx
{(function(){ var ic = getTaskIcon(t.text); return ic ? <span style={{marginRight:2}}>{ic}</span> : null; })()}{t.text}
```

- [ ] **Step 2: DailyView task blocks**

In `juggler-frontend/src/components/views/DailyView.jsx`, add import:
```js
import { getTaskIcon } from '../../utils/taskIcon';
```

Find the two `{task.text}` renders (lines ~597 and ~647). Both are inside a `<span>` with `flex: 1, overflow: hidden`. Wrap each with:
```jsx
{(function(){ var ic = getTaskIcon(task.text); return ic ? <span style={{marginRight:2,flexShrink:0}}>{ic}</span> : null; })()}{task.text}
```

- [ ] **Step 3: ConflictsView**

In `juggler-frontend/src/components/views/ConflictsView.jsx` line ~206:
```js
import { getTaskIcon } from '../../utils/taskIcon';
```

Find `{sug.text}`. Replace with:
```jsx
{(function(){ var ic = getTaskIcon(sug.text); return ic ? <span style={{marginRight:2}}>{ic}</span> : null; })()}{sug.text}
```

- [ ] **Step 4: DependencyView**

In `juggler-frontend/src/components/views/DependencyView.jsx`, add import:
```js
import { getTaskIcon } from '../../utils/taskIcon';
```

Line ~126 `{ct.text}` (plain render):
```jsx
{(function(){ var ic = getTaskIcon(ct.text); return ic ? <span style={{marginRight:2}}>{ic}</span> : null; })()}{ct.text}
```

Line ~220 `{ot.text}`:
```jsx
{(function(){ var ic = getTaskIcon(ot.text); return ic ? <span style={{marginRight:2}}>{ic}</span> : null; })()}{ot.text}
```

Line ~152 already has `{icon}` before `{ct.text}` — leave that `{icon}` in place (it's a different indicator, not task auto-icon).

- [ ] **Step 5: Commit**

```bash
cd juggler/juggler-frontend && git add \
  src/components/views/MonthView.jsx \
  src/components/views/DailyView.jsx \
  src/components/views/ConflictsView.jsx \
  src/components/views/DependencyView.jsx
git commit -m "feat(icons): auto-icon in MonthView, DailyView, ConflictsView, DependencyView"
```

---

## Task 6: Weather indicator on `ScheduleCard` via `CalendarGrid`

**Files:**
- Modify: `juggler-frontend/src/components/schedule/ScheduleCard.jsx`
- Modify: `juggler-frontend/src/components/schedule/CalendarGrid.jsx:127-131,547-558`
- Modify: `juggler-frontend/src/components/views/DayView.jsx` (CalendarGrid call)
- Modify: `juggler-frontend/src/components/views/WeekView.jsx` (CalendarGrid call)
- Modify: `juggler-frontend/src/components/views/ThreeDayView.jsx` (CalendarGrid call)

- [ ] **Step 1: Add `weatherDay` prop to `ScheduleCard` — weather indicator**

In `juggler-frontend/src/components/schedule/ScheduleCard.jsx`, add import:
```js
import { checkWeatherMatch, hasWeatherRestrictions } from '../../utils/weatherMatch';
```

Add `weatherDay` to the props destructure:
```js
export default function ScheduleCard({ item, status, ..., weatherDay }) {
```

After `var task = item.task;` (near top of function), add:
```js
var weatherResult = hasWeatherRestrictions(task) ? checkWeatherMatch(task, weatherDay) : null;
```

In the title row (the `<div>` containing `task.text`), add after the existing location/pin icons:
```jsx
{weatherResult && (
  <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, flexShrink: 0 }}
    title={weatherResult.ok === false ? weatherResult.reason : 'Forecast OK for this task'}>
    <span style={{ fontSize: 11, filter: weatherResult.ok ? 'drop-shadow(0 0 2px #2D9E6B88)' : 'none' }}>⛅</span>
    {weatherResult.ok === false && (
      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: '#e05252', textShadow: '0 0 3px #1a1a1a', lineHeight: 1, pointerEvents: 'none' }}>⊘</span>
    )}
  </span>
)}
```

- [ ] **Step 2: Add `weatherDay` prop to `CalendarGrid`, pass to `ScheduleCard`**

In `juggler-frontend/src/components/schedule/CalendarGrid.jsx`, add `weatherDay` to the props destructure (line ~128):
```js
export default function CalendarGrid({
  dateKey, placements, statuses, onStatusChange, onDelete, onExpand,
  gridZoom, darkMode, schedCfg, nowMins, isToday, onGridDrop, locations,
  onHourLocationOverride, blockedTaskIds, onZoomChange, isMobile, layoutMode,
  onMarkerDrag, weatherDay   // ← add
}) {
```

In the `<ScheduleCard ... />` call (line ~547), add:
```jsx
weatherDay={weatherDay}
```

- [ ] **Step 3: Pass `weatherDay` from DayView to CalendarGrid**

In `juggler-frontend/src/components/views/DayView.jsx`, find the `<CalendarGrid ... />` call(s). Add:
```jsx
weatherDay={weatherByDate && weatherByDate[selectedDateKey]}
```

- [ ] **Step 4: Pass `weatherDay` from WeekView to CalendarGrid**

In `juggler-frontend/src/components/views/WeekView.jsx`, find each `<CalendarGrid ... />` call (one per day column). Each already has a `dateKey={d.key}` prop. Add:
```jsx
weatherDay={weatherByDate && weatherByDate[d.key]}
```

- [ ] **Step 5: Pass `weatherDay` from ThreeDayView to CalendarGrid**

Same pattern in `juggler-frontend/src/components/views/ThreeDayView.jsx`:
```jsx
weatherDay={weatherByDate && weatherByDate[d.key]}
```

- [ ] **Step 6: Verify visually**

Open DayView or WeekView. Tasks with weather restrictions (set via TaskEditForm) should show ⛅ in their block. If forecast data is loaded (location has coords set), the icon will be green-glowing or have ⊘.

- [ ] **Step 7: Commit**

```bash
cd juggler/juggler-frontend && git add \
  src/components/schedule/ScheduleCard.jsx \
  src/components/schedule/CalendarGrid.jsx \
  src/components/views/DayView.jsx \
  src/components/views/WeekView.jsx \
  src/components/views/ThreeDayView.jsx
git commit -m "feat(weather): weather indicator on ScheduleCard blocks"
```

---

## Task 7: Weather indicator in `DailyView` inline blocks

`DailyView` renders its own task blocks (not via ScheduleCard/CalendarGrid) and already receives `weatherByDate`.

**Files:**
- Modify: `juggler-frontend/src/components/views/DailyView.jsx`

- [ ] **Step 1: Add weatherMatch import**

In `juggler-frontend/src/components/views/DailyView.jsx`, add:
```js
import { checkWeatherMatch, hasWeatherRestrictions } from '../../utils/weatherMatch';
```

- [ ] **Step 2: Locate the scheduled task block render function**

Find the inner component/function that renders a scheduled task block (around line 570–610, the function that takes `task`, `status`, uses `isDone`, renders `task.text`). Add weather indicator computation at the top:
```js
var weatherResult = hasWeatherRestrictions(task)
  ? checkWeatherMatch(task, weatherByDate && weatherByDate[selectedDateKey])
  : null;
```

Then in the title row JSX, after the existing pin/recurring/status icons and before `{task.text}`, add the same indicator used in ScheduleCard:
```jsx
{weatherResult && (
  <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, flexShrink: 0 }}
    title={weatherResult.ok === false ? weatherResult.reason : 'Forecast OK'}>
    <span style={{ fontSize: 10, filter: weatherResult.ok ? 'drop-shadow(0 0 2px #2D9E6B88)' : 'none' }}>⛅</span>
    {weatherResult.ok === false && (
      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#e05252', textShadow: '0 0 3px #1a1a1a', lineHeight: 1, pointerEvents: 'none' }}>⊘</span>
    )}
  </span>
)}
```

Note: `selectedDateKey` is a prop of DailyView — already available in scope.

- [ ] **Step 3: Commit**

```bash
cd juggler/juggler-frontend && git add src/components/views/DailyView.jsx
git commit -m "feat(weather): weather indicator in DailyView inline blocks"
```

---

## Task 8: TaskEditForm — Where/Tools/Weather section redesign

**Files:**
- Modify: `juggler-frontend/src/components/tasks/TaskEditForm.jsx`

This task has three sub-changes: (a) split Where/Tools, (b) redesign Weather section using button groups + range slider, (c) move Weather inside the section system.

- [ ] **Step 1: Split "Where & Tools" → "Where" + "Tools"**

Find the section starting with (around line 1803):
```jsx
{/* ═══ SECTION: Where & Tools ═══ */}
{!marker &&
<div style={secStyle}>
  <div style={secHead}>Where & Tools</div>
  <label style={{ ...lStyle, marginBottom: 5 }}>
    ...location buttons...
  </label>
  <label style={lStyle}>
    <span ...>🔧 Tools needed</span>
    ...tool buttons...
  </label>
</div>}
```

Replace with two separate sections:
```jsx
{/* ═══ SECTION: Where ═══ */}
{!marker &&
<div style={secStyle}>
  <div style={secHead}>📍 Where</div>
  <label style={{ ...lStyle, marginBottom: 5 }}>
    <span title="Where this task can be done. The scheduler only places it where you're at a matching location.">Location</span>
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
      <button onClick={() => setTaskLoc([])} title="Task can be done at any location"
        style={togStyle(taskLoc.length === 0, '#2D6A4F')}>{'🌍'} Anywhere</button>
      {(locations || []).map(loc => {
        var isOn = taskLoc.indexOf(loc.id) !== -1;
        var anywhere = taskLoc.length === 0;
        return (
          <button key={loc.id} title={'Restrict to ' + loc.name} onClick={() => {
            if (anywhere) { setTaskLoc([loc.id]); }
            else { setTaskLoc(isOn ? taskLoc.filter(x => x !== loc.id) : [...taskLoc, loc.id]); }
          }} style={{ ...togStyle(isOn && !anywhere), opacity: anywhere ? 0.4 : 1 }}>
            {loc.icon} {loc.name}
          </button>
        );
      })}
    </div>
  </label>
</div>}

{/* ═══ SECTION: Tools ═══ */}
{!marker && (tools || []).length > 0 &&
<div style={secStyle}>
  <div style={secHead}>🔧 Tools</div>
  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
    {(tools || []).map(tool => {
      var isOn = taskTools.indexOf(tool.id) !== -1;
      return (
        <button key={tool.id} title={'Requires ' + tool.name} onClick={() => {
          setTaskTools(isOn ? taskTools.filter(x => x !== tool.id) : [...taskTools, tool.id]);
        }} style={togStyle(isOn)}>{tool.icon} {tool.name}</button>
      );
    })}
  </div>
</div>}
```

- [ ] **Step 2: Remove old weather section, add new one**

Find and delete the existing weather section block (around line 1847–1891):
```jsx
{/* Weather Conditions */}
{!isCreate && !marker && (
  <div style={{ padding: '8px 12px', borderTop: '1px solid ' + TH.border }}>
    ...selects and number inputs...
  </div>
)}
```

After the Tools section (but before the metadata footer), add the new Weather section:
```jsx
{/* ═══ SECTION: Weather ═══ */}
{!isCreate && !marker && (
<div style={secStyle}>
  <div style={secHead}>⛅ Weather</div>

  {/* Precipitation */}
  <div style={{ ...lStyle, marginBottom: 6 }}>
    <span>Precipitation</span>
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
      {[
        { val: 'any',      label: '🌦️ Any' },
        { val: 'wet_ok',   label: '🌧️ Rain OK' },
        { val: 'light_ok', label: '🌂 Light OK' },
        { val: 'dry_only', label: '☀️ Dry only' },
      ].map(function(o) {
        return <button key={o.val} onClick={() => setWeatherPrecip(o.val)} style={togStyle(weatherPrecip === o.val)}>{o.label}</button>;
      })}
    </div>
  </div>

  {/* Sky cover */}
  <div style={{ ...lStyle, marginBottom: 6 }}>
    <span>Sky cover</span>
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
      {[
        { val: 'any',         label: '⛅ Any' },
        { val: 'overcast_ok', label: '☁️ Overcast OK' },
        { val: 'partly_ok',   label: '🌤️ Partly OK' },
        { val: 'clear',       label: '☀️ Clear' },
      ].map(function(o) {
        return <button key={o.val} onClick={() => setWeatherCloud(o.val)} style={togStyle(weatherCloud === o.val)}>{o.label}</button>;
      })}
    </div>
  </div>

  {/* Temperature range slider */}
  <WeatherTempSlider
    tempMin={weatherTempMin}
    tempMax={weatherTempMax}
    unit={task.weatherTempUnit || 'F'}
    onChange={function(min, max) { setWeatherTempMin(min); setWeatherTempMax(max); }}
    TH={TH}
    isMobile={isMobile}
  />
</div>
)}
```

- [ ] **Step 3: Implement `WeatherTempSlider` component**

Add this component inside `TaskEditForm.jsx` above the main `export default` function (after the `TimezoneSelector` component):

```jsx
var TEMP_RANGES = { F: { min: -20, max: 120 }, C: { min: -29, max: 49 } };

function WeatherTempSlider({ tempMin, tempMax, unit, onChange, TH, isMobile }) {
  var range = TEMP_RANGES[unit] || TEMP_RANGES.F;
  var totalSpan = range.max - range.min;

  // Controlled values: null = at extreme (no restriction)
  var lo = tempMin !== '' && tempMin !== null ? Number(tempMin) : range.min;
  var hi = tempMax !== '' && tempMax !== null ? Number(tempMax) : range.max;

  function pct(val) { return ((val - range.min) / totalSpan) * 100; }

  var noMin = (lo <= range.min);
  var noMax = (hi >= range.max);
  var noRestriction = noMin && noMax;

  function handleLoChange(e) {
    var v = Number(e.target.value);
    var newLo = Math.min(v, hi - 1);
    onChange(newLo <= range.min ? null : newLo, noMax ? null : hi);
  }
  function handleHiChange(e) {
    var v = Number(e.target.value);
    var newHi = Math.max(v, lo + 1);
    onChange(noMin ? null : lo, newHi >= range.max ? null : newHi);
  }

  return (
    <div style={{ ...{fontSize: 8, color: TH.textMuted, display: 'flex', flexDirection: 'column', gap: 2, fontWeight: 600} }}>
      <span>Temperature</span>
      <div style={{ position: 'relative', height: 20, marginTop: 4 }}>
        {/* Track */}
        <div style={{ position: 'absolute', top: 8, left: 0, right: 0, height: 4, background: TH.border, borderRadius: 2 }} />
        {/* Fill */}
        {!noRestriction && (
          <div style={{ position: 'absolute', top: 8, height: 4, background: TH.accent, borderRadius: 2,
            left: pct(lo) + '%', right: (100 - pct(hi)) + '%' }} />
        )}
        {/* Min thumb */}
        <input type="range" min={range.min} max={range.max} value={lo}
          onChange={handleLoChange}
          style={{ position: 'absolute', width: '100%', top: 0, margin: 0, opacity: 0, cursor: 'pointer', height: 20, zIndex: 2 }} />
        {/* Max thumb (overlaid) */}
        <input type="range" min={range.min} max={range.max} value={hi}
          onChange={handleHiChange}
          style={{ position: 'absolute', width: '100%', top: 0, margin: 0, opacity: 0, cursor: 'pointer', height: 20, zIndex: 3 }} />
        {/* Visible thumb dots */}
        <div style={{ position: 'absolute', top: 4, left: 'calc(' + pct(lo) + '% - 6px)', width: 12, height: 12,
          background: TH.accent, borderRadius: '50%', border: '2px solid ' + TH.bgCard,
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 4, left: 'calc(' + pct(hi) + '% - 6px)', width: 12, height: 12,
          background: TH.accent, borderRadius: '50%', border: '2px solid ' + TH.bgCard,
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)', pointerEvents: 'none' }} />
      </div>
      <div style={{ fontSize: 9, color: TH.text, fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
        <span>{noMin ? 'No min' : lo + '°' + unit}</span>
        <span style={{ color: TH.textMuted, fontWeight: 400 }}>{noRestriction ? 'No temperature restriction' : ''}</span>
        <span>{noMax ? 'No max' : hi + '°' + unit}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify visually**

Open a task in edit mode. Confirm:
- "Where" section shows location buttons only (no tools)
- "Tools" section shows tool buttons (only visible if tools exist)
- "Weather" section shows precipitation buttons, sky cover buttons, temperature range slider
- Drag slider thumbs — values update, dragging to extreme shows "No min" / "No max"
- Saving changes to weather fields still persists correctly (check the API payload in network tab)

- [ ] **Step 5: Commit**

```bash
cd juggler/juggler-frontend && git add src/components/tasks/TaskEditForm.jsx
git commit -m "feat(weather): TaskEditForm — button groups + range slider + section split"
```

---

## Task 9: "Locate me" label fix in `SettingsPanel`

**Files:**
- Modify: `juggler-frontend/src/components/settings/SettingsPanel.jsx:253-261`

- [ ] **Step 1: Update the `hasCoords` display branch**

In `juggler-frontend/src/components/settings/SettingsPanel.jsx`, find the `hasCoords` display branch (around line 253):
```jsx
{hasCoords ? (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
    <span style={{ fontSize: 11, color: theme.textMuted }}>
      {'📍 ' + loc.lat.toFixed(4) + ', ' + loc.lon.toFixed(4)}
    </span>
    <button onClick={clearCoords} ...>Clear</button>
  </div>
) : (
```

Replace the inner `<span>` with:
```jsx
<span style={{ fontSize: 11, color: theme.textMuted }}>
  {'📍 '}
  <span style={{ color: theme.text, fontWeight: 600 }}>{displayName || 'Current location'}</span>
  {' (' + loc.lat.toFixed(4) + ', ' + loc.lon.toFixed(4) + ')'}
</span>
```

- [ ] **Step 2: Verify**

Open Settings → Templates → Locations. Add a location, click "Locate me" or type a city and press Enter. Confirm it shows e.g. `📍 **Boston, Massachusetts** (42.3601, -71.0589)` on one line with a Clear button.

- [ ] **Step 3: Commit**

```bash
cd juggler/juggler-frontend && git add src/components/settings/SettingsPanel.jsx
git commit -m "feat(location): locate-me shows name with coords in parens"
```

---

## Self-Review

**Spec coverage check:**
1. ✅ Weather indicators on task blocks — Tasks 6, 7
2. ✅ Weather section redesign (button groups + slider) — Task 8
3. ✅ Where/Tools/Weather section split — Task 8
4. ✅ Locate-me label — Task 9
5. ✅ Auto-icon keyword map — Task 1
6. ✅ Auto-icon AI fallback endpoint — Task 3
7. ✅ Auto-icon applied everywhere — Tasks 4, 5
8. ✅ `weatherMatch` utility with forecast logic — Task 2

**Potential issues:**
- Task 8 `WeatherTempSlider` — two overlapping `<input type="range">` both covering the full track; the upper z-index (`zIndex: 3`) wins when dragging. On some browsers, thumb z-index depends on value proximity — test dragging each thumb to ensure both respond. If a thumb gets stuck behind the other, increase pointer-events granularity with a `z-index` toggle based on which value is closer to the drag point.
- `requestAIIcon` in Task 4 checks `iconCache.get(text) !== ''` to avoid queuing AI for texts that hit the keyword map — but `getTaskIcon` sets `iconCache.set(text, '')` for no-match and `iconCache.set(text, icon)` for a match. The `requestAIIcon` guard `if (iconCache.get(text)) return` would skip texts whose cached value is a non-empty icon string (truthy) — correct. Empty string is falsy, so it won't skip, and the `!== ''` check ensures we only AI-query confirmed no-keyword-match texts. Logic is correct.
