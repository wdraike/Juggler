# Task Sidebar UX Redesign

**Date:** 2026-05-15  
**File:** `juggler-frontend/src/components/tasks/TaskEditForm.jsx`  
**Status:** Approved for implementation

---

## Goal

Reduce visual density of the task detail sidebar without removing any functionality. Four targeted changes:

1. Smart-collapse Where/Weather/Tools when at defaults
2. Advanced scheduling accordion in the When section
3. Bigger task name + more prominent status strip
4. Move Save/Delete to a sticky bottom footer

---

## Change 1: Smart-collapse Where / Weather / Tools

### Behaviour

Each section gets a "collapsed header" state. When all fields are at default values the section renders as a single row instead of its full expanded form. Clicking the row expands it in-place.

**Collapse conditions:**

| Section | Default (collapsed) |
|---------|-------------------|
| Where   | `taskLoc.length === 0` (Anywhere) |
| Weather | `weatherPrecip === 'any'` AND `weatherCloud === 'any'` AND temp/humidity fields all empty |
| Tools   | `taskTools.length === 0` |

**Auto-expand on load** if any field is non-default (so existing configured tasks don't silently hide data).

**Collapsed row layout:**
```
[icon] Section name   [summary chip]   ˅
```

Examples:
- `📍 Where   Anywhere   ˅`
- `⛅ Weather   No constraints   ˅`
- `⛅ Weather   Dry only · < 75°F   ˅` ← configured state shows summary
- `🔧 Tools   Phone, Car   ˅`

Chevron toggles `˅` / `˄`. No animation required.

### Collapse state persistence

Session-only. No localStorage. If user collapses a configured section and navigates away, it re-opens on next task open (safe default).

### Implementation notes

- Add `const [whereOpen, setWhereOpen]`, `weatherOpen`, `toolsOpen` state vars (init: `true` if non-default, `false` if default).
- Wrap each section's body in `{sectionOpen && <div>…</div>}`.
- Replace section header `<div style={secHead}>` with a clickable `<button>` that renders the label + summary chip + chevron.
- Summary chip function: pure helper, no AI, string concatenation only.

---

## Change 2: Advanced Scheduling Accordion (within When)

### Behaviour

The When section keeps its primary controls always visible. Secondary controls collapse under "Advanced" (collapsed by default, auto-opens if any field is non-default on load).

**Always visible (primary):**
- Date / Time / Finish / Duration three-way binding
- `Float` / `Fixed` toggle button directly below the time row (no icon; amber highlight on fields + inline message when Fixed active; mode/windows dim when Fixed)
- Scheduling mode buttons: `Anytime` | `All Day` (labeled sub-group)
- Time window tags: user-defined `uniqueTags` rendered with their own `icon`+`name` (labeled sub-group "Preferred time windows") — icons unchanged, sourced from config
- Timezone selector
- Recurrence (stays at bottom of When)

**Collapsed under "⚙ Advanced" (secondary):**
- Split toggle + splitMin
- Travel before / Travel after
- Day requirement buttons
- Deadline + Not before
- Remaining / Start override fields

**Auto-expand Advanced if any of these are non-default on load:**
- `dayReq !== 'any'`
- `deadline` is truthy
- `startAfter` is truthy
- `travelBefore > 0`
- `travelAfter > 0`
- `split === true`
- `timeRemaining` is truthy

**Collapsed row:**
```
⚙ Advanced   [summary if configured]   ˅
```

Summary examples:
- `⚙ Advanced   ˅` (nothing set)
- `⚙ Advanced   Deadline · Wkday   ˅` (configured)

### Implementation notes

- Add `advancedOpen` boolean state (init: auto-expand logic above).
- Wrap advanced fields in `{advancedOpen && <div>…</div>}`.
- Accordion header is a `<button>` with the same collapsed-row pattern as Change 1.
- The existing conditional rendering for `!marker` / `!recurring` / `!isFixed` guards on the inner fields stays unchanged — they still apply within the accordion body.

---

## Change 3: Bigger Task Name + Prominent Status Strip

### Task name

- Input font-size: **15px** (up from ~12px)
- Remove the "Name" label — the field speaks for itself as the first element
- Keep the Project field alongside it (unchanged)

### Status strip (edit mode only)

Current: tiny pill buttons (~22px height, 10px text)  
New: segmented control row, **28px height**, **11px bold** text

- Active button gets solid background fill (existing color system, `s.bg` / `s.bgDark`)
- Inactive buttons get transparent background with muted border
- Buttons keep their existing `s.value`, `s.label`, `s.tip`, `s.color` / `s.bg` from `STATUS_OPTIONS`
- "Noticed" and "Placed" sub-status indicators stay below, unchanged

No change to status logic — purely visual sizing.

---

## Change 4: Sticky Bottom Footer (Save / Delete)

### Layout

Remove Save and Delete from the top header row. Add a sticky footer pinned to the bottom of the sidebar panel.

```
┌─────────────────────────────────────┐
│  [sticky top: task title header]    │  ← title + close ×, unchanged
│                                     │
│  [form body, scrollable]            │
│                                     │
│ ─────────────────────────────────── │
│  [Delete]              [Save]       │  ← sticky bottom footer
└─────────────────────────────────────┘
```

- Footer `position: sticky; bottom: 0` with a `border-top` separator and `padding: 8px 12px`
- **Save** button: right-aligned, green, primary (same style as current)
- **Delete** button: left-aligned, red-outlined (not filled) — same existing delete/confirm flow
- In **create** mode: only Save ("Create") shown, no Delete
- Footer background: `TH.bgCard` (matches sidebar)

### Implementation notes

The sidebar container (`AppLayout.jsx` line ~1320) already has `overflowY: auto`. The sticky footer needs to live *inside* that scrollable container, not outside it — `position: sticky; bottom: 0` works correctly within a scroll container.

TaskEditForm renders its own top header row (Save/Delete + close ×). Remove Save and Delete from that row; keep only the task title / mode label + close ×. Add the sticky footer as the last element inside the form's scroll container.

---

## Files changed

| File | Change |
|------|--------|
| `TaskEditForm.jsx` | All 4 changes — state vars, collapsed sections, status sizing, footer |

No backend changes. No API changes. No other frontend files.

---

## What does NOT change

- All field logic, conditional rendering, scheduler integration
- Existing save/delete/confirm flows
- Mobile layout (`isMobile` path already separate)
- The form's external API (`props`, `onUpdate`, `onClose`, etc.)
- Timezone selector, recurrence, and all other fields not mentioned above
