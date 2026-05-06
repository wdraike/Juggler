# Design: Calendar & Scheduling Fixes
Date: 2026-05-06

Three independent fixes: scheduler uses `time_remaining` as intended, reminder tasks no longer overlap regular tasks in the calendar, and calendar event cards use stylesheet-driven font scaling instead of hardcoded inline values.

---

## Fix 1 — Scheduler uses `time_remaining` correctly

### Problem
`effectiveDuration(t)` in `unifiedScheduleV2.js:56-59` checks `t.timeRemaining` (camelCase). `buildItems()` feeds it raw DB rows where the field is `t.time_remaining` (snake_case). The camelCase property is always `undefined`, so the function always falls back to `t.dur` (full duration), ignoring any user-set remaining time.

### Fix
Update `effectiveDuration` to check both field name forms:

```js
function effectiveDuration(t) {
  var rd = t.timeRemaining != null ? t.timeRemaining
         : t.time_remaining != null ? t.time_remaining
         : t.dur;
  return Math.min(rd > 0 ? rd : (rd === 0 ? 0 : 30), 720);
}
```

### Scope
- **File:** `juggler-backend/src/scheduler/unifiedScheduleV2.js`
- **No other changes needed.** `runSchedule.js:489-494` already reads `primaryRow.time_remaining` (snake_case) correctly for recurring chunk reconciliation.

---

## Fix 2 — Reminder tasks participate in column layout

### Problem
`DailyView.jsx:854-860` splits `allScheduled` into `scheduled` (regular tasks) and `markers` (reminders) before layout runs. Only `scheduled` enters `computeLayout()`. Markers are rendered separately at lines 1325-1351 with hardcoded `col={0} totalCols={1}`, painting them over whatever regular task already occupies the same slot.

### Fix
Remove the separation entirely. Markers enter `computeLayout()` alongside regular tasks and receive real `col`/`totalCols` assignments. They render through the same `TaskBlock` path as everything else.

Three targeted changes to `DailyView.jsx`:

1. **Remove the filter** at lines 854-860 — `allScheduled` feeds `computeLayout()` directly.
2. **Remove the separate marker render block** at lines 1325-1351.
3. **No changes to `computeLayout()`.** The layout builds placement objects via `{ dur: t.dur || 30 }` (line 943), so a zero-duration reminder gets a 30-minute visual end by default — enough to form a proper overlap cluster with any co-occupying task. `visualEnd` at line 213 then takes the max of that and `MIN_BLOCK_H`-derived minutes, which is already satisfied. No change needed.

The indigo tint, bell icon, and other visual marker distinctions are already encoded in the task data and applied inside `TaskBlock` — they are not dependent on the separate render path.

### Scope
- **File:** `juggler-frontend/src/components/views/DailyView.jsx`
- Lines 854-860 (filter removed), lines 1325-1351 (separate render block removed)

---

## Fix 3 — Stylesheet-driven font scaling on calendar event cards

### Problem
All font sizes in `ScheduleCard.jsx` are hardcoded inline style props. The only adaptive logic is a single boolean (`compact` at < 48px / `showDetails` at ≥ 60px). There is no CSS file for the component.

### Approach
JS derives a `size` string from `cardHeight` and sets `data-size` on the card root element. A new `ScheduleCard.css` file handles all font sizes, row visibility, and padding per tier via attribute selectors. The `compact` and `showDetails` booleans are removed.

### 4 tiers

| `data-size` | Height | Content shown |
|---|---|---|
| `lg` | ≥ 80px | Title (12px) + time range (10px) + badges row + details row |
| `md` | 48–80px | Title (11px) + time + priority inline (9px); no details row |
| `sm` | 28–48px | Title (10px) + start time only (8px); no badges or details |
| `xs` | < 28px | Title only (9px), single clipped line |

### CSS class structure
Elements within `ScheduleCard` get semantic class names. The CSS uses `[data-size]` attribute selectors to control font size and visibility:

```css
/* Example pattern */
.sc-title        { font-size: 12px; }
.sc-time         { font-size: 10px; }
.sc-badge        { font-size: 9px; }
.sc-details-row  { display: flex; }

[data-size="md"] .sc-title       { font-size: 11px; }
[data-size="md"] .sc-details-row { display: none; }

[data-size="sm"] .sc-title  { font-size: 10px; }
[data-size="sm"] .sc-time   { font-size: 8px; }
[data-size="sm"] .sc-badge  { display: none; }

[data-size="xs"] .sc-title  { font-size: 9px; }
[data-size="xs"] .sc-time   { display: none; }
[data-size="xs"] .sc-badge  { display: none; }
```

Mobile font tweaks use a `data-mobile` attribute handled in the same CSS file.

### What stays in JS
- Height measurement → derive `size` string (`lg`/`md`/`sm`/`xs`) → set `data-size`
- Color/theme tokens remain inline (dynamic per-user theme values)
- Conditional rendering based on data presence (e.g. "only show location if `task.location` exists") — this is data-driven, not size-driven, and stays in JSX

### Scope
- **New file:** `juggler-frontend/src/components/schedule/ScheduleCard.css`
- **Modified file:** `juggler-frontend/src/components/schedule/ScheduleCard.jsx`
  - Add `import './ScheduleCard.css'`
  - Replace `compact`/`showDetails` booleans with `size` tier derivation
  - Set `data-size={size}` and `data-mobile={isMobile ? '1' : undefined}` on root element
  - Replace all inline `fontSize:` values with CSS class names
  - Remove inline `display: none` visibility toggles (move to CSS)

---

## Out of scope
- `CalendarGrid.jsx` font sizes (hour labels, weather strip) — separate component, addressed separately if needed
- `ScheduledTaskBlock.jsx`, `TimelineBubble.jsx` — not part of this change
- Reminder visual styling (tint, bell icon) — unchanged
