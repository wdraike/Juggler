# Task Edit UX Audit

**Scope:** `juggler/juggler-frontend/src/components/tasks/sections/WhenSection.jsx` and its consumer `TaskEditForm.jsx`  
**Date:** 2026-05-24  
**Method:** Static code audit (no dev server)

---

## Disabled Control Inventory

| Control | Disabling condition | Visible explanation? | Severity |
|---------|--------------------|------------------------|----------|
| Scheduling mode button group (Anytime, Time window, Time blocks, All Day) | `isFixed` (`!!datePinned \|\| placementMode === 'fixed'`) | **No.** Buttons dim to `opacity: 0.35` and `pointerEvents: 'none'`, but there is no banner, tooltip, or inline text saying why. | **High** |
| "Scheduling mode" section label | `isFixed` | **No.** Label dims to `opacity: 0.4`, but no explanatory text. | Low |
| Time blocks tag selector (morning, lunch, afternoon, etc.) | `isFixed` | **No.** Same dim + `pointerEvents: 'none'` treatment, no reason given. | Medium |
| Day requirement picker (Any / Wkday / Wkend / Su…Sa) | `isFixed` | **No.** The entire block is **removed from the DOM** (`{!isFixed && …}`). It does not merely disable — it vanishes without explanation. | Medium |
| Travel before / after inputs | `marker \|\| isRecurring` | **No.** Inputs are hidden entirely when the task is a marker or recurring. | Low |
| Split toggle and min-chunk input | `marker \|\| isRecurring` | **No.** Hidden entirely with no placeholder or note. | Low |

### Additional lockout finding: `fixed` mode without `datePinned`

`isFixed` is true when **either** `datePinned` **or** `placementMode === 'fixed'`.  
If a task carries the legacy `fixed` placement mode (or is calendar-owned) but `datePinned` is `false`, the Pin button reads **"📌 Pin"** (unpinned) while the entire mode selector is still disabled. The user sees an unlocked pin yet cannot change scheduling mode, with no visible reason why. This is a silent lockout.

---

## Mode Transition Paths

| From mode | To mode | UI changes | Risk of lockout |
|-----------|---------|------------|-----------------|
| Any mode | **All Day** | `onDatePinnedChange(false)` is fired; Pin button flips to "📌 Pin". `time`, `endTime`, `dur` cleared in `TaskEditForm.handleModeChange`. `when`, `split`, `travelBefore`, `travelAfter` cleared in `WhenSection`. | **Low.** The Pin change is visible. However, `dur` becomes an empty string in state (`setDur('')`), which renders the Duration input blank until the user retypes or the fallback `parseInt(dur) \|\| 30` kicks in at save time. |
| All Day | Any non-all-day mode | `time`, `endTime`, `dur` are all set to `''` in `handleModeChange`. The Duration input shows empty/zero until user edits. | **Medium.** The user may not realize duration was wiped and could save with the fallback 30 min without intending to. There is no visual confirmation that duration was reset. |
| Non-recurring | Recurring (via Recurrence dropdown) | `setRecurring(true)` sets `dayReq='any'` and `split=false`. The non-recurring mode selector is replaced by the recurring one. | **Low.** State changes are expected, but the user loses access to **All Day** mode (see gap below). |

---

## Recurring Mode Gap

**Non-recurring mode selector offers 4 modes:** Anytime, Time window, Time blocks, All Day.  
**Recurring mode selector offers 3 modes:** Anytime, Time window, Time blocks.

**Missing:** `All Day` is absent from the recurring section (`WhenSection.jsx` lines 406–427).  
A user who converts a one-off all-day task into a recurring task has no UI path to keep it all-day; the mode silently reverts to the previous recurring default.

---

## Dead / Broken Flow

`ManageCalTaskDialog` (`TaskEditForm.jsx` lines 31–159) is declared and conditionally rendered (line 930), but **`setManageCalDialog(true)` is never called anywhere in the file.**  
Calendar-owned tasks therefore have **no UI path** to open the "Manage this task" dialog, making the "Take ownership" and "Open in calendar" actions unreachable.

---

## Recommendations

1. **Add a visible lockout banner** when `isFixed` is true. A small inline chip or label above the disabled mode buttons should state why:  
   - If `datePinned`: "Date is pinned — unpin to change scheduling mode."  
   - If `placementMode === 'fixed'` (calendar-owned): "Calendar-managed — take ownership to edit scheduling mode."  
   - This fixes the silent disable on both the mode buttons and the Day requirement block.

2. **Do not remove the Day requirement block from the DOM** when `isFixed`. Render it disabled with the same banner, so users do not think the feature has disappeared.

3. **Wire up `ManageCalTaskDialog`** or remove the dead code. If calendar-owned tasks are meant to show a management option, add the trigger (e.g., a banner bar inside the When section when `placementMode === 'fixed'`).

4. **Add `All Day` to the recurring mode selector** (lines 406–427) or document why it is intentionally excluded.

5. **Preserve duration on mode transitions** instead of blanking it to `''`. If a transition must clear duration, show a transient inline note: "Duration reset to default — update if needed."

6. **Ensure the Pin button and `isFixed` state stay consistent.** If `placementMode === 'fixed'`, consider forcing the Pin button to the pinned visual state (or showing a calendar icon instead) so the user understands the link between the two concepts.
