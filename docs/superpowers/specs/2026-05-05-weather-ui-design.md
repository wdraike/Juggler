# Weather UI Design
**Date:** 2026-05-05  
**Status:** Approved

---

## Overview

Five related changes to make weather a first-class UI concept across Juggler:

1. Weather indicators on task blocks (calendar views)
2. Weather section redesign in TaskEditForm
3. Split "Where & Tools" into three separate sections
4. "Locate me" label improvement
5. Auto-icon for tasks (keyword map + AI fallback)

---

## 1. Weather Indicators on Task Blocks

### Where
`ScheduledTaskBlock` — shown in DayView and WeekView grid columns.

### Behaviour
- If a task has **no** weather restrictions (all fields are `'any'` or null): show nothing.
- If a task has **any** weather restriction set: show a small ⛅ icon in the title row.
  - **Forecast OK** — icon at full opacity, green drop-shadow (`drop-shadow(0 0 2px #2D9E6B88)`).
  - **Forecast not OK** — icon at full opacity (no dimming), red ⊘ slash overlay on top.
  - **No forecast available** (no coords, no cache) — show icon with no tint (neutral).

### Forecast match logic
Look up `weatherByDate[task.date]` (the task's scheduled date). If not found, treat as neutral.

Check each non-`'any'` condition:

| Field | Fail condition |
|-------|---------------|
| `weather_precip = 'dry_only'` | `precipPct >= 30` |
| `weather_precip = 'light_ok'` | `precipPct >= 60` |
| `weather_precip = 'wet_ok'` | `precipPct >= 90` |
| `weather_cloud = 'clear'` | `cloudCoverDaytime > 20` (avg 8am–6pm hourly cloudcover) |
| `weather_cloud = 'partly_ok'` | `cloudCoverDaytime > 60` |
| `weather_cloud = 'overcast_ok'` | `cloudCoverDaytime > 90` |
| `weather_temp_min` | `dailyLow < temp_min` |
| `weather_temp_max` | `dailyHigh > temp_max` |

`cloudCoverDaytime` = average of hourly cloudcover values for hours 8–18 from `weatherByDate[date].hourly`.

Any single condition failing → overall `ok = false`.

### Tooltip
On hover: one sentence explaining the first failing condition, e.g.  
`"Requires dry — 70% rain chance today"` or `"Temp below minimum (min 45°F, forecast low 41°F)"`.

### Implementation notes
- Thread `weatherByDate` from AppLayout → DayView / WeekView / ThreeDayView → ScheduledTaskBlock (DayView and WeekView already receive it from AppLayout; ThreeDayView needs to be wired the same way).
- The indicator sits after the existing location icon and pin icon in the title row.

---

## 2. Weather Section Redesign in TaskEditForm

### Current state
A separate `div` below the section system using `<select>` dropdowns and `<input type="number">` fields, only shown for `!isCreate && !marker`.

### New design
A proper named section using `secStyle` / `secHead` — same visual treatment as Where, Tools, When. Keep the `!isCreate && !marker` guard.

**Section header:** `⛅ Weather`

### Precipitation — button group
```
🌦️ Any  |  🌧️ Rain OK  |  🌂 Light OK  |  ☀️ Dry only
```
Uses `togStyle()`. Maps to `weather_precip` values: `any | wet_ok | light_ok | dry_only`.

### Sky cover — button group
```
⛅ Any  |  ☁️ Overcast OK  |  🌤️ Partly OK  |  ☀️ Clear
```
Uses `togStyle()`. Maps to `weather_cloud` values: `any | overcast_ok | partly_ok | clear`.

### Temperature — range slider
- Track range: −20°F to 120°F (or −29°C to 49°C, driven by `config.temperatureUnit`).
- Two thumb handles: min and max.
- When both handles are at the extremes → `weatherTempMin = null`, `weatherTempMax = null` ("No restriction").
- Labels above track show tick positions; value display below shows current selected range or "No restriction".
- Dragging either thumb to its extreme end clears that bound.
- Implemented as a custom CSS slider (two `<input type="range">` overlaid, or a single controlled div with mouse/touch handlers). Native `<input type="range">` doesn't support dual handles — use the two-overlapping-inputs technique.

---

## 3. Section Order in TaskEditForm

Replace the current "Where & Tools" section with three consecutive sections:

```
… When section …
┌─────────────────────────────┐
│  📍 Where                   │  (location buttons — existing)
└─────────────────────────────┘
┌─────────────────────────────┐
│  🔧 Tools                   │  (tool buttons — moved out)
└─────────────────────────────┘
┌─────────────────────────────┐
│  ⛅ Weather                  │  (redesigned — see §2)
└─────────────────────────────┘
… Metadata footer …
```

The "Where & Tools" `secHead` label becomes `📍 Where`. Tools gets its own `secStyle` / `secHead` block immediately after. Weather follows.

---

## 4. "Locate me" Label

### Current
When coords are set, shows two lines:
```
📍 42.3601, -71.0589
(device location)
```

### New
Single line:
```
📍  Boston, Massachusetts  (42.3601, -71.0589)
         [Clear]
```

- For geocode lookup: use the `displayName` returned from `/api/weather/geocode`.
- For "Locate me" (browser geolocation, no city name): show `"Current location (lat, lon)"`.
- Coordinates shown to 4 decimal places.
- "Clear" button remains inline at the right.

**Change is in `LocationRow` in `SettingsPanel.jsx`** — the `hasCoords` branch currently renders coords and display name separately; consolidate into one `<span>`.

---

## 5. Auto-Icon for Tasks

### Behaviour
- Every place a task's text is rendered, prefix it with a computed emoji icon.
- Icon is **never stored** in the database — computed at render time from `task.text`.
- If the user has typed an emoji at the start of `task.text`, skip auto-icon (the manual emoji takes precedence).
- Renders as a `<span>` prefix before the task text string, e.g. `🏃 Morning run`.

### Where it appears
Every component that renders task text:
- `ScheduledTaskBlock` (calendar grid)
- `TaskCard`
- `ListView` task rows
- `MonthView` task chips
- `ThreeDayView` task blocks (via `ScheduledTaskBlock`)
- `PriorityView`, `ConflictsView`, `TimelineView` rows

### Implementation — `getTaskIcon(text)`
A shared utility at `src/utils/taskIcon.js`.

**Step 1 — manual override check:**  
If `text` starts with an emoji character (Unicode general category So/Sm/Sk or ranges `\u{1F300}–\u{1FFFF}`, `\u{2600}–\u{27BF}`), return `null` (let the text speak for itself).

**Step 2 — keyword map:**  
Lowercase the text, test against ordered keyword patterns. Return the first match. The map covers ~80 patterns across categories:

| Category | Keywords → Icon |
|----------|----------------|
| Running / walking | run, jog, sprint, walk, hike → 🏃 |
| Cycling | bike, cycle, cycling → 🚴 |
| Gym / weights | gym, workout, lift, weights, exercise → 💪 |
| Swimming | swim, pool, lap → 🏊 |
| Dev work | code, debug, deploy, pr, commit, refactor, build → 💻 |
| Writing | write, draft, essay, blog, report → ✍️ |
| Email | email, inbox, reply → 📧 |
| Meetings / calls | meeting, call, standup, sync, zoom, teams, interview → 📞 |
| Reading / study | read, study, review, learn, research → 📚 |
| Groceries / errands | groceries, shopping, errands, store, pharmacy → 🛒 |
| Cooking | cook, meal prep, dinner, lunch, breakfast, recipe → 🍳 |
| Chores | clean, tidy, laundry, vacuum, dishes, mow → 🧹 |
| Health | doctor, dentist, meds, medication, appointment, therapy → 💊 |
| Mindfulness | meditat, yoga, stretch, breathe, mindful → 🧘 |
| Sleep / rest | sleep, nap, rest → 😴 |
| Finance | pay, bill, invoice, budget, taxes, bank → 💰 |
| Travel | drive, commute, flight, airport, travel, trip → ✈️ |
| Social | dinner with, lunch with, coffee with, hang out, party → 🍽️ |
| Planning | plan, schedule, organise, organize, prep for → 📋 |
| Design | design, mockup, figma, sketch, wireframe → 🎨 |

**Step 3 — async AI fallback (Gemini Flash):**  
If the keyword map returns no match, queue an async call to a new backend endpoint:
```
GET /api/tasks/suggest-icon?text=<urlencoded task text>
```
The backend sends a one-shot Gemini Flash prompt:
```
Return exactly one emoji that best represents this task: "<text>". Reply with only the emoji character, nothing else.
```
Result is cached in a module-level `Map<taskText, emoji>` (session lifetime, not persisted). On next render the cached emoji is used.

**Step 4 — render:**
```jsx
import { getTaskIcon } from '../../utils/taskIcon';

// In render:
var icon = getTaskIcon(task.text);
// <span>{icon && <span style={{ marginRight: 3 }}>{icon}</span>}{task.text}</span>
```

The async path: `getTaskIcon` initially returns `null` for unknown text (no flicker), then triggers a side-effect that resolves asynchronously and updates a shared cache; components that subscribe to the cache re-render once the icon arrives.

**Cache strategy:**  
Module-level `Map<string, string>` keyed by task text (not ID, since text is the signal). Populated by both the keyword map (synchronously) and the AI fallback (async). No persistence across page loads — re-computed cheaply from keyword map on reload; AI results re-requested only for tasks that missed the keyword map.

---

## Out of Scope

- Storing the auto-icon in the database.
- Letting users pick/override the auto-icon through a UI (typing emoji at start of task name is the override mechanism).
- Weather indicator in MonthView task chips (chips are too small; header badge is sufficient).
- Temperature unit threading into `TaskEditForm` (deferred — hardcoded °F label is a known open item).
