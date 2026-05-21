# Recurrence UI Redesign

**Date:** 2026-05-21
**File:** `juggler-frontend/src/components/tasks/sections/WhenSection.jsx`
**Scope:** UI-only — no backend or DB changes

---

## Goals

1. Add "Rolling" recurrence mode to WhenSection
2. Introduce sub-mode split (Option B) for weekly/biweekly flexible quota
3. Fix two existing labels: eligible days, biweekly option text

---

## 1. Rolling Mode

### Trigger
`recurType === 'rolling'`

### New select option
```
<option value="rolling">Rolling (after completion)</option>
```
Insert after `interval` in the dropdown.

### Fields shown
| Field | Implementation |
|-------|---------------|
| "Repeat every" interval | Reuse `recurEvery` (number) + `recurUnit` select |
| Unit options | days / weeks / months only — no years |
| Anchor card (read-only) | Derived from `task.rolling_anchor` |

### Anchor card logic
```
if task.rolling_anchor:
  display "Last completed: [formatted date]"
  display "Next due: [rolling_anchor + recurEvery recurUnit]"  ← computed in component, display only
else:
  display "Anchor not yet set — computed from first completion"
```

### Fields hidden when rolling
- Day picker (day-of-week buttons)
- Schedule type toggle (sub-mode split)
- Times-per-cycle (tpc) selector
- Fill policy block

### Props used
No new props. Rolling reuses `recurEvery`, `onRecurEveryChange`, `recurUnit`, `onRecurUnitChange`.
Anchor accessed via existing `task` prop as `task.rolling_anchor`.

---

## 2. Sub-mode Split (Weekly / Biweekly)

**Trigger:** `(recurType === 'weekly' || recurType === 'biweekly') && selectedCount > 1`

Replace the current bare tpc dropdown with:

### Step 1 — Schedule type toggle (always shown when selectedCount > 1)
Two buttons above the tpc row:

```
[ All N days ]  [ Flexible quota ]
```

- Active state: determined by `recurTpc === selectedCount` → "All N days", else → "Flexible quota"
- Switching to "All N days": call `onRecurTpcChange(selectedCount)` — tpc selector + fill policy disappear
- Switching to "Flexible quota": call `onRecurTpcChange(selectedCount - 1)` if tpc currently equals selectedCount; tpc selector + fill policy appear

### Step 2 — Tpc selector (only in Flexible quota sub-mode)
- Same select as today, range 1 to `selectedCount - 1`
- Label: "Complete per cycle" (replaces "Times per week/2 weeks")

### Step 3 — Fill policy block (only in Flexible quota sub-mode)
No change to FillPolicyBlock itself.

---

## 3. Label Fixes

| Location | Current | New |
|----------|---------|-----|
| Line 474 (day picker label) | `Days` | `Eligible days` |
| Line 466 (select option) | `Biweekly` | `Every 2 weeks` |

---

## Tests

Add to `WhenSection.test.jsx`:

1. Rolling mode — renders interval + anchor card; hides day picker / tpc / fill policy
2. Rolling mode — anchor card shows "not yet set" when `task.rolling_anchor` is null
3. Rolling mode — anchor card shows computed next due date when rolling_anchor is set
4. Sub-mode toggle — defaults to "All N days" when tpc === selectedCount
5. Sub-mode toggle — shows "Flexible quota" + tpc select when tpc < selectedCount
6. Sub-mode toggle — switching to "All N days" calls onRecurTpcChange(selectedCount)
7. Sub-mode toggle — switching to "Flexible quota" calls onRecurTpcChange(selectedCount - 1)

---

## Non-goals

- No backend changes
- No new API endpoints
- No change to how rolling_anchor is written (already handled by scheduler + cron + MCP — see branch fix-rolling-anchor-backfill)
- No Playwright E2E for this change (scheduler behavior already covered by existing tests)

---

## Edge Cases

**recurStart for rolling:** The `!!recurring && recurType !== 'none'` block (which renders recurStart/recurEnd) still renders for rolling mode — this is correct, as recurStart controls when the first instance is generated. The anchor asterisk (shown when `recurIsAnchorDependent`) should NOT fire for rolling mode (rolling_anchor is computed, not user-set). TaskEditForm must ensure `recurIsAnchorDependent` is false when `recurType === 'rolling'`.

**Minimum interval:** No guard beyond `min={1}` on the number input. Accept any positive integer.
