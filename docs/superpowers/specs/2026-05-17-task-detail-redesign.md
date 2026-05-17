# Task Detail Panel Redesign

**Date:** 2026-05-17  
**Status:** Spec — approved, pending implementation plan

## Problem

`TaskEditForm.jsx` (~2200 lines) displays all scheduling fields at once in a 380px sidebar. Rarely-used fields (recurrence, travel buffers, weather, tools, metadata) crowd out the fields users need every time. Information overload is the primary pain point.

## Decision

Collapsible sections + section extraction. `TaskEditForm.jsx` becomes an orchestrator (~350 lines); each section is its own component. A reusable `CollapsibleSection` wrapper drives show/hide. Collapse state persists to `localStorage`.

This approach was chosen over "wrap-in-place" (too little structural gain) and "full panel redesign" (too risky given the 700-line When section with scheduler-wired state).

---

## Architecture

### New file structure

```
juggler-frontend/src/components/tasks/
  TaskEditForm.jsx              ← orchestrator, ~350 lines (down from ~2200)
  TaskDetailHeader.jsx          ← always-visible rich header
  CollapsibleSection.jsx        ← reusable collapse wrapper
  sections/
    WhenSection.jsx             ← date/time/duration + nested Recurrence + Constraints
    WhereSection.jsx            ← location tag checkboxes
    WeatherSection.jsx          ← temp slider + condition toggles
    ToolsSection.jsx            ← tool checkboxes
    DependsOnSection.jsx        ← dependency search + dep list
    MetaSection.jsx             ← created date, scheduled window, slack, IDs
```

Helper functions (`addMinutesTo24h`, `minutesFrom24h`, `TimezoneSelector`, `WeatherTempSlider`, etc.) remain in `TaskEditForm.jsx` for now — extracting them is a follow-on, not part of this phase.

### Form state ownership

All form state stays in `TaskEditForm`. Sections receive only the slice they need via props. No prop-threading risk — children don't own state, they call back via handlers passed down from the orchestrator.

---

## Components

### CollapsibleSection

Thin chrome wrapper — no logic:

```jsx
function CollapsibleSection({ id, label, isOpen, onToggle, badge, TH, children }) {
  return (
    <div style={{ borderTop: '1px solid ' + TH.border }}>
      <button onClick={() => onToggle(id)} style={...}>
        <span>{isOpen ? '▼' : '▶'} {label}</span>
        {badge && <span style={badgeStyle}>{badge}</span>}
      </button>
      {isOpen && <div style={{ padding: '8px 12px' }}>{children}</div>}
    </div>
  );
}
```

`badge` shows a summary when collapsed so key info is visible without expanding:
- **When** → `"Today · 2:00–2:30 PM"` or `"No date"`
- **Where** → location icons if set, else nothing
- **Weather** → temp range if set, else nothing
- **Tools / Meta** → nothing (rarely needed at a glance)

### Collapse state

```js
const COLLAPSE_KEY = 'juggler_task_detail_collapse';
const COLLAPSE_DEFAULTS = { when: true, where: false, weather: false, tools: false, meta: false };
```

- Read from `localStorage` on mount, merged with defaults (new keys get default value)
- Written back to `localStorage` on every toggle
- Persists across task opens and browser sessions
- Scoped to the user's browser (no server sync needed)

---

## TaskDetailHeader

Always visible. Never collapses. Sits above all collapsible sections.

**Contents (top to bottom):**

1. **Action bar** — Save | Close | (spacer) | Delete
2. **Status row** — todo / wip / done / skip / cancel buttons + AI enrichment trigger
3. **Title** — large editable input
4. **Badge row** — project · priority · duration · tags · scheduled time range · URL link icon
5. **Notes preview** — first line of description, truncated; hidden if empty; click to expand inline

**Scheduled time badge** shows `"Today · 2:00–2:30 PM"` when both date and time are set; `"No date"` otherwise. Derived from task state, not editable here (editing happens in WhenSection).

---

## WhenSection

Three tiers. Section starts **expanded by default**.

### Tier 1 — Date & Time (always visible inside When)

Four fields on one row (wraps on narrow viewports):
- **Date** — date picker input
- **Start** — time input (24h internally, displayed as 12h AM/PM)
- **End** — time input, three-way bound with Start + Duration
- **Duration** — text input (`30m`, `1.5h`, etc.)

Editing any one of Start/End/Duration recalculates the other two (existing `addMinutesTo24h` / `minutesFrom24h` logic unchanged).

Float/Fixed badge and timezone selector stay in this tier, below the four fields.

The collapsed When badge mirrors this: `"Today · {start}–{end}"`.

### Tier 2 — Recurrence (nested collapsible, collapsed by default)

Contains: recurrence mode buttons (Daily / Weekly / Weekdays / Custom), times-per-cycle, date range. Collapsed badge shows mode if set (`"Daily"`), else `"none"`.

### Tier 3 — Constraints (nested collapsible, collapsed by default)

Contains: deadline, start-after, travel buffers, split toggle. Collapsed badge shows `"deadline set"` if deadline is set, else nothing.

Nested collapsibles use the same `CollapsibleSection` component. Their open/closed state is stored in the same `localStorage` key: `{ ..., when_recurrence: false, when_constraints: false }`.

---

## Remaining Sections

All collapsed by default. Internals unchanged — only wrapped in `CollapsibleSection`.

| Section | Default | Badge |
|---------|---------|-------|
| Where | collapsed | location icons if set |
| Weather | collapsed | temp range if set |
| Tools | collapsed | tool icons if set |
| Depends On | collapsed | dep count if set (`"2 deps"`) |
| Metadata | collapsed | — |

Section order: When → Where → Weather → Tools → Depends On → Metadata.

**Tags** move from the Task Description section into the `TaskDetailHeader` badge row (inline chips, editable). No separate Tags section needed.

**Dependencies** get their own `DependsOnSection.jsx`. Contents unchanged from current form (task search + dependency list). Extraction order: after WhereSection, before WhenSection (low risk).

---

## Extraction Order (safest → riskiest)

1. **MetaSection** — read-only display, no form state
2. **WhereSection** — simple checkbox array, one prop in / one callback out
3. **WeatherSection** — self-contained temp slider
4. **ToolsSection** — same pattern as Where
5. **DependsOnSection** — task search + dep list, reads `allTasks` prop
6. **WhenSection** — last; most complex due to three-way time binding, recurring logic, scheduler-wired fields

Each extraction is a separate commit. Do not batch.

---

## Testing

Each extracted section gets:

- **Unit test** — renders with expected props, no crashes
- **Screen test** — `TaskEditForm` renders, section is present, collapse toggle shows/hides content
- **Manual smoke** — open task → edit field in section → save → reopen → value persists

Additional collapse-state tests:
- Open task → collapse When → close → reopen → When is still collapsed
- First open (no `localStorage`) → When is expanded, all others collapsed
- `localStorage` key with missing sub-key → defaults applied for that key

---

## Out of Scope

- Extracting helper functions (`addMinutesTo24h`, `TimezoneSelector`, etc.) — follow-on
- Dark/light mode changes — design is theme-agnostic, uses existing `getTheme()`
- Mobile layout changes — existing full-screen overlay behavior unchanged
- Any new fields or scheduling features
