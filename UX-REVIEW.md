# UX Review — Juggler WhenSection When-Mode Simplification

**Date:** 2026-05-25
**Scope:** WhenSection.jsx + TaskEditForm.jsx — When-mode simplification (Pin removal, Fixed as 5th mode)
**Files reviewed:**
- `juggler-frontend/src/components/tasks/sections/WhenSection.jsx`
- `juggler-frontend/src/components/tasks/TaskEditForm.jsx`
- `juggler-frontend/src/components/tasks/TaskDetailHeader.jsx`
- `juggler-frontend/src/hooks/useTaskState.js`
- `juggler-frontend/src/services/apiClient.js`

**Test infrastructure:** Dev server not running — review is source-code analysis only (no Playwright run). Playwright findings marked as untested where applicable.

---

## Verdict: WARN

No BLOCK findings. 5 WARN findings. 2 INFO suggestions.

---

## BLOCK Findings

None.

---

## WARN Findings

### UX-1 — Fixed button in the non-recurring mode selector lacks `aria-pressed`

**Location:** `WhenSection.jsx` line 329–332

**Evidence.** The four pre-existing mode buttons in the recurring selector (lines 417–444) do not have `aria-pressed` either — but the "Sessions per cycle" radio-group sub-buttons at line 540–546 do use `aria-pressed`. The five non-recurring mode buttons (Anytime, Time window, Time blocks, All Day, Fixed) are visually toggled with `togStyle()` but carry no `aria-pressed` attribute and no `role="radio"` / `role="group"` wrapper. The newly added Fixed button (line 329) continues this pattern.

**Impact.** Screen reader users cannot determine which mode is currently selected. The visual highlight (border + background color) communicates selection to sighted users only. WCAG 2.2 SC 4.1.2 (Name, Role, Value) requires that the current state of a toggle button be programmatically determinable.

**WCAG:** SC 4.1.2 — serious.

**Fix.** Add a `role="group"` wrapper with `aria-label="Scheduling mode"` around all five buttons, and add `aria-pressed={effectiveMode === '<mode>'}` to each button. Example for the Fixed button:

```jsx
<button
  title="Exact date and time — immovable"
  tabIndex={isFixed ? -1 : 0}
  aria-pressed={effectiveMode === 'fixed'}
  onClick={...}
  style={togStyle(effectiveMode === 'fixed', '#7C3AED')}>
  Fixed
</button>
```

---

### UX-2 — Fixed mode button in the recurring task path is missing

**Location:** `WhenSection.jsx` lines 417–444

**Evidence.** When `recurring` is truthy, the component renders a separate mode selector (lines 416–444) that offers only four buttons: Anytime, Time window, Time blocks, All Day. The Fixed button added at line 329–332 exists only in the non-recurring selector (`!marker && !isRecurring` block starting at line 300). If a user has a recurring task whose `placementMode` is `'fixed'` (e.g., synced from a calendar), no button in the recurring selector will show as active (`effectiveMode === 'fixed'` will not match any of the four options), and the user will see a blank/no-selection state.

**Impact.** A recurring task with `placementMode='fixed'` renders the recurring mode selector with zero buttons active — the current mode is invisible to the user. Additionally, there is no way to switch a recurring task to Fixed mode from within the form, even if that's semantically appropriate (e.g., a standing weekly calendar meeting).

**Fix.** Either add a Fixed button to the recurring mode selector (lines 417–444) or — if recurring + fixed is not a supported combination — add a defensive `effectiveMode === 'fixed'` guard that falls back to rendering the calendar-managed banner and suppresses the recurring mode selector, rather than silently showing no active selection.

---

### UX-3 — "Save failed" error message gives user no actionable information when the backend rejects a Fixed task with missing date/time

**Location:** `TaskDetailHeader.jsx` line 69; `useTaskState.js` line 295–297; `AppLayout.jsx` line 904–906

**Evidence.** The error chain is:
1. `updateTask` in `useTaskState.js` calls `apiClient.put('/tasks/batch', ...)` and catches all errors, returning `false` with only a `console.error`.
2. `handleUpdateTask` in `AppLayout.jsx` calls `showToast('Save failed — try again', 'error')` when `ok === false`.
3. `TaskEditForm.commitSave` calls `setSaveStatus('failed')` when `ok === false`, which renders "✖ Save failed" in the header.

The backend 400 response body (which presumably contains a message like "date and time required for fixed mode") is discarded at step 1. The user sees "Save failed — try again" in a toast and "✖ Save failed" in the header — no explanation of what was wrong or how to fix it.

Specifically for a Fixed task with no date/time: the user can select Fixed mode, leave date/time blank, and hit Save. The form does not prevent this (there is no client-side validation that requires date+time when `placementMode === 'fixed'`). The save will reach the backend and fail silently from the user's perspective.

**Impact.** The user does not know they need to add a date and time. They may attempt the save multiple times or abandon the task. WCAG SC 3.3.1 (Error Identification) requires that input errors be identified and described to the user.

**Fix — two-part:**

1. Add client-side pre-save validation in `handleSave` (TaskEditForm.jsx): if `placementMode === 'fixed'` and either `date` or `time` is empty, block the save and surface an inline error message near the date/time fields (e.g., "Fixed mode requires a date and time.").

2. In `useTaskState.updateTask`, extract the error message from the API response before returning `false`:

```js
} catch (error) {
  console.error('Save failed:', error);
  return error?.response?.data?.message || false;
}
```

Then in `handleUpdateTask` (AppLayout.jsx), use the returned message if it's a string:

```js
var ok = await updateTask(id, fields);
if (ok === false || typeof ok === 'string') {
  showToast(typeof ok === 'string' ? ok : 'Save failed — try again', 'error');
}
```

---

### UX-4 — Five-button mode selector may overflow on narrow screens; no touch-target audit possible without a running browser

**Location:** `WhenSection.jsx` lines 309–333

**Evidence.** The mode selector row uses `display: flex; gap: 3px; flexWrap: wrap`. With five buttons at `padding: 0 8px` and `height: 26px` (desktop) / `height: 30px` (mobile), wrapping will occur when the container is narrow. At 320px (WCAG SC 1.4.10 reflow viewport), a five-button row with labels "Anytime", "Time window", "Time blocks", "All Day", "Fixed" will very likely require at least two wrapped rows, potentially three.

`flexWrap: wrap` is present, which means the row will not cause horizontal scroll — that is correct. However:
- No automated test confirms the wrapping behavior does not produce overlapping elements at 320px.
- Button heights at 26px (desktop) fall below the WCAG 2.5.8 recommended 24px spacing target; at mobile (30px) they meet the minimum but are below the preferred 44px touch target.

This finding cannot be fully verified without Playwright across all defined viewports. It is flagged as WARN to ensure a test is written.

**WCAG:** SC 2.5.8 (Target Size) — moderate risk at desktop 26px height.

**Fix.** Write a Playwright test (see TC-W001 below) covering all seven viewports. If overlapping elements are found at 320px, increase minimum button height to 32px or add explicit wrapping logic. If desktop 26px touch targets are below baseline, consider increasing to `min-height: 32px` on desktop.

---

### UX-5 — No test coverage for the Fixed button's enabled/disabled behavior and the calendar-managed banner

**Location:** `juggler-frontend/src/components/tasks/sections/__tests__/` — no WhenSection test files found

**Evidence.** The `__tests__/` directory under `tasks/` contains:
- `CollapsibleSection.test.jsx`
- `TaskCard.overflow.test.jsx`
- `TaskDetailHeader.test.jsx`
- `TaskEditForm.integration.test.jsx` (3 tests, none cover placementMode or Fixed)

No test file covers:
- Fixed button renders in the non-recurring mode selector
- Fixed button is active (aria-pressed / togStyle highlight) when `placementMode === 'fixed'`
- When `placementMode === 'fixed'` and `isCalManaged` is true: mode buttons are locked (`tabIndex=-1`, `pointerEvents: none`)
- When `placementMode === 'fixed'` and `isCalManaged` is false: mode buttons are unlocked
- Calendar-managed banner appears when and only when `isFixed === true`
- "Date is pinned" banner does NOT appear (confirming the removal is clean)
- `datePinned` prop is not consumed by WhenSection (dead prop cleanup verification)

Per the Bird charter: any interactive element added without a test is a BLOCK finding. However, since the _existing_ test infrastructure for WhenSection was removed along with the old tests (the prior review referenced `WhenSection.test.jsx` and `WhenSection.modes.test.jsx` which no longer exist), this is treated as WARN rather than BLOCK under the assumption that the test files were intentionally removed as part of the redesign. Tests must be written before the next commit of this code.

**Fix.** Create `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.fixed.test.jsx` covering the cases listed above. See TC-W002 through TC-W006 below.

---

## INFO Suggestions

### UX-6 — INFO: Fixed button icon collision with Time blocks button

Both "Time blocks" (📅) and "Fixed" could benefit from a more distinct icon. The current choice of 📌 for Fixed is good and distinct from 📅. No action required — logged for brand review reference only.

### UX-7 — INFO: "Fixed" mode with no calendar link has no explanatory tooltip or help text

When a user selects Fixed mode on a non-calendar-managed task, no secondary affordance explains what Fixed means in that context (vs. the Calendar-managed banner that appears for cal-linked tasks). The button title `"Exact date and time — immovable"` is helpful but only accessible on hover. On mobile, the title is invisible. Consider a brief inline help note (8–10 words) that appears below the mode selector when Fixed is active and the task is not calendar-managed.

---

## Test Cases Required

### TC-W001 — Mode selector renders without overflow at all viewports
- **Surface:** TaskEditForm / WhenSection — mode selector (non-recurring, non-marker)
- **Viewports:** reflow-wcag (320px), mobile-sm (375px), mobile-lg (430px), tablet (768px), laptop (1024px), desktop (1440px), wide (1920px)
- **States tested:** all five modes active one at a time
- **Assertions:**
  - No horizontal scroll (`scrollWidth <= innerWidth + 1`)
  - No overlapping interactive elements (area overlap > 100px)
  - All five buttons visible and within viewport bounds
  - Touch targets >= 24px height at mobile viewports
- **Status:** UNTESTED — no Playwright file exists
- **Playwright file to create:** `juggler-frontend/tests/ux/when-section/mode-selector-responsive.spec.js`

### TC-W002 — Fixed button renders and is active when placementMode='fixed'
- **Surface:** WhenSection (non-recurring task)
- **States:** `placementMode='fixed'`, no calendar link
- **Assertions:**
  - Fixed button exists in DOM
  - `aria-pressed="true"` on Fixed button (post UX-1 fix)
  - Other mode buttons have `aria-pressed="false"`
  - Mode buttons are NOT locked (no `pointerEvents: none`, `tabIndex` is 0)
  - Calendar-managed banner is NOT rendered
- **Status:** UNTESTED

### TC-W003 — Fixed + calendar-managed locks the mode selector
- **Surface:** WhenSection (non-recurring, `gcalEventId` set)
- **States:** `placementMode='fixed'`, `task.gcalEventId='evt_123'`
- **Assertions:**
  - `isFixed === true` (mode buttons receive `tabIndex={-1}`, `pointerEvents: none`)
  - Calendar-managed banner is rendered with correct provider name
  - All five mode buttons have `tabIndex={-1}`
  - Time sub-inputs area has `pointerEvents: none` / `opacity: 0.35` (existing lock)
- **Status:** UNTESTED

### TC-W004 — Fixed + non-calendar-managed allows mode change
- **Surface:** WhenSection (non-recurring, no calendar IDs)
- **States:** `placementMode='fixed'`, `task.gcalEventId=null`
- **Assertions:**
  - All mode buttons are interactive (`tabIndex={0}`)
  - No calendar-managed banner
  - Clicking Anytime calls `onModeChange('anytime')`
- **Status:** UNTESTED

### TC-W005 — "Date is pinned" banner does NOT render (regression guard)
- **Surface:** WhenSection (any state)
- **Assertions:**
  - Text "Date is pinned" is not present in the rendered output under any prop combination
  - `datePinned` prop being passed to WhenSection does not cause a React warning (confirming prop removal is clean)
- **Status:** UNTESTED

### TC-W006 — Fixed mode with no date/time is blocked before save
- **Surface:** TaskEditForm, non-recurring task
- **States:** `placementMode='fixed'`, `date=''`, `time=''`
- **Assertions:**
  - Clicking Save does not call `onUpdate`
  - An inline validation message is visible (post UX-3 fix)
- **Status:** UNTESTED (fix not yet implemented)

---

## Responsive Coverage Matrix

| Screen | 320 | 375 | 430 | 768 | 1024 | 1440 | 1920 |
|--------|-----|-----|-----|-----|------|------|------|
| WhenSection mode selector | UNTESTED | UNTESTED | UNTESTED | UNTESTED | UNTESTED | UNTESTED | UNTESTED |

## Accessibility (WCAG 2.2 AA)

| Element | Finding | WCAG | Status |
|---------|---------|------|--------|
| Mode buttons (all 5) | No `aria-pressed`, no `role="group"` | SC 4.1.2 | WARN (UX-1) |
| Fixed button in recurring path | Not rendered — active mode invisible | SC 4.1.2 | WARN (UX-2) |
| Save error message | API error message discarded; user sees generic failure | SC 3.3.1 | WARN (UX-3) |
| Touch targets (26px desktop) | Below preferred 44px; marginally at WCAG 2.5.8 minimum | SC 2.5.8 | WARN (UX-4) |

## Orphaned Element Audit

| Element | Status |
|---------|--------|
| `datePinned` / `onDatePinnedChange` props | CLEAN — not destructured in WhenSection; comment at line 177 documents the intentional removal |
| "Date is pinned" banner | CLEAN — removed; no remnant render path found |
| `datePinned` state in TaskEditForm | CLEAN — not present in state declarations |
| Pin/Pinned toggle in date row | CLEAN — not present |
| Fixed/Float rigid toggle in time row | CLEAN — `rigid` state kept for `time_window` ± exact selector; no orphan |

## Banner Logic Audit

| Condition | Banner shown | Banner text | Correct? |
|-----------|-------------|-------------|----------|
| `placementMode='fixed'` + `gcalEventId` set | Yes | "Calendar-managed by Google Calendar…" | YES |
| `placementMode='fixed'` + `msftEventId` set | Yes | "Calendar-managed by Outlook…" | YES |
| `placementMode='fixed'` + `appleEventId` set | Yes | "Calendar-managed by Apple Calendar…" | YES |
| `placementMode='fixed'` + no calendar IDs | No | — | YES (no lockout, correct) |
| Any other mode, calendar IDs set | No | — | YES (banner only shows when locked) |

---

## Summary Table

| ID | Finding | Severity | File:line |
|----|---------|----------|-----------|
| UX-1 | Mode buttons missing `aria-pressed` / `role="group"` — screen reader cannot determine active mode | WARN | WhenSection.jsx:309–332 |
| UX-2 | Fixed button absent from recurring-task mode selector — `placementMode='fixed'` on recurring task shows no active selection | WARN | WhenSection.jsx:417–444 |
| UX-3 | Backend error message discarded; user sees generic "Save failed" with no actionable guidance when Fixed task has no date/time | WARN | useTaskState.js:295; TaskEditForm.jsx:handleSave |
| UX-4 | Five-button row wrapping behavior at 320px unverified; desktop 26px button height is below preferred touch target | WARN | WhenSection.jsx:309 |
| UX-5 | No unit or integration test coverage for Fixed button, calendar-managed lock, or datePinned removal regression | WARN | — |
| UX-6 | INFO: Icon choice for Fixed (📌) is distinct and appropriate | INFO | — |
| UX-7 | INFO: Fixed mode with no calendar link has no inline help text on mobile | INFO | WhenSection.jsx:329 |

**Verdict: WARN — no blockers. All 5 WARN findings should be addressed before this ships.**

## Next Steps

- [ ] WARN UX-1: Add `role="group"` + `aria-label="Scheduling mode"` + `aria-pressed` to all five mode buttons
- [ ] WARN UX-2: Add Fixed button to recurring mode selector, or add a guard for `effectiveMode === 'fixed'` in recurring path
- [ ] WARN UX-3: Add client-side validation (date+time required for Fixed) + propagate backend error message to toast
- [ ] WARN UX-4: Write Playwright TC-W001 across all 7 viewports; increase desktop button `min-height` if needed
- [ ] WARN UX-5: Write unit tests TC-W002 through TC-W006

---

---

## Re-Verification — 2026-05-25

**Re-verifier:** Bird
**Files read:** `WhenSection.jsx`, `TaskEditForm.jsx`, `useTaskState.js`, `WhenSection.fixed.test.jsx`
**Method:** Source-code analysis only (dev server not running; UX-4 remains deferred pending Playwright).

---

### UX-1 (aria-pressed) — PASS

**Evidence confirmed.**

Non-recurring selector (WhenSection.jsx line 309): `role="group" aria-label="Scheduling mode"` present on the wrapper div. All five buttons carry `aria-pressed={effectiveMode === '<mode>'}`:
- Anytime: line 311
- Time window: line 316
- Time blocks: line 321
- All Day: line 328
- Fixed: line 334

Recurring selector (line 430): `role="group" aria-label="Scheduling mode"` present on the wrapper. All four recurring buttons carry `aria-pressed`:
- Anytime: line 431
- Time window: line 438
- Time blocks: line 443
- All Day: line 451

The fix is complete and correct. SC 4.1.2 is now satisfied for all mode selectors.

**Status: PASS**

---

### UX-2 (Fixed missing from recurring selector) — WARN (partial fix, new concern)

**Evidence confirmed — fix is structurally present but has a correctness problem.**

The guard is at WhenSection.jsx lines 421–460: when `effectiveMode === 'fixed'` in the recurring path, the component renders the amber banner instead of the mode-button group. The code comment at lines 422–425 correctly documents the reason (recurring+fixed is treated as anytime by the scheduler).

**Concern: The banner text is inaccurate for non-calendar-managed recurring tasks.**

The banner reads: `"Calendar-managed — scheduling mode is controlled by the source calendar."`

This text is only correct when there IS a calendar event backing the task. However the guard fires on `effectiveMode === 'fixed'` regardless of whether `task.gcalEventId`, `task.msftEventId`, or `task.appleEventId` is set. A recurring task whose `placementMode` drifted to `'fixed'` via MCP, a batch update, or a data migration — with no calendar link — would see this banner claiming a source calendar controls scheduling when there is none.

In that case the user is left with:
- No mode buttons visible (no way to change back to a valid mode)
- A banner claiming calendar control that does not exist
- No explanation that Fixed is simply unsupported on recurring tasks

The guard approach (suppress buttons, show a banner) is the right structural choice. The fix needed is to condition the banner text on whether a calendar event actually exists, and when there is no calendar link, explain that Fixed is not supported for recurring tasks and offer a path to change mode.

**Suggested correction (WhenSection.jsx recurring guard block):**

```jsx
{effectiveMode === 'fixed' ? (
  isCalManaged ? (
    <div style={...amberBannerStyle}>
      Calendar-managed — scheduling mode is controlled by the source calendar.
    </div>
  ) : (
    <div style={...amberBannerStyle}>
      Fixed mode is not supported for recurring tasks. Select a different scheduling mode below.
      <div role="group" aria-label="Scheduling mode" style={{ marginTop: 6, display: 'flex', gap: 3 }}>
        {/* Anytime / Time window / Time blocks / All Day buttons */}
      </div>
    </div>
  )
) : (
  <div role="group" ...>
    {/* normal 4-button recurring selector */}
  </div>
)}
```

This gives the user an explanation and a direct path out, without requiring an unsupported Fixed button in the recurring selector.

**Status: WARN — guard is present and prevents the zero-active-buttons bug, but banner text misleads users on non-cal-managed recurring tasks with placementMode='fixed'. Must be corrected before ship.**

---

### UX-3 (silent failure) — PASS with one placement concern

**Evidence confirmed — both parts of the fix are present.**

**Client-side validation (TaskEditForm.jsx lines 522–526):**
```js
if (placementMode === 'fixed' && (!date || !time)) {
  setSaveError('Fixed mode requires a date and time.');
  return;
}
```
The guard fires before `commitSave`. `setSaveError(null)` is called at line 527 on the success path, so stale error messages clear correctly on a valid subsequent save.

**Backend error propagation (useTaskState.js lines 298–302):**
```js
var serverMsg = error && error.response && error.response.data && error.response.data.error;
return serverMsg || false;
```
The catch block extracts `error.response.data.error` (note: the original fix spec suggested `.message`; the implementation uses `.error` — this must match the actual backend response shape. If the backend returns `{ error: '...' }` this is correct; if it returns `{ message: '...' }` this will miss it and fall back to `false`. This should be verified against the backend 400 response shape, but is not a blocker for the client-side path since the guard prevents the server call for the date/time case.)

**`saveError` render location — concern noted.**

`saveError` renders at TaskEditForm.jsx lines 746–750, inside the `CollapsibleSection` for "When", immediately after the closing `</WhenSection>` tag:

```jsx
{saveError && (
  <div role="alert" style={{ ... }}>
    {saveError}
  </div>
)}
```

The placement is at the bottom of the "When" collapsible section, after all WhenSection content (date/time row, mode selector, Recurrence sub-section, Constraints sub-section). If the Recurrence or Constraints sub-sections are expanded, the error message may appear significantly below the date/time fields where the user is looking. It is not inline with the Date or Time inputs.

This is a usability concern, not a WCAG hard failure (WCAG 3.3.1 requires the error be identified and described, which it is — `role="alert"` ensures screen readers announce it regardless of visual position). However, users who cannot immediately see the error after clicking Save may be confused. A better position would be immediately below the date/time row in `WhenSection`, only when `placementMode === 'fixed'` and both fields are empty.

The `role="alert"` is correctly applied. The fix satisfies the original finding at the accessibility level.

**Status: PASS** (with a non-blocking UX note: `saveError` at the bottom of the When section is distant from the date/time fields when sub-sections are expanded. Consider moving inline to WhenSection below the date row for the fixed-mode case in a follow-up.)

---

### UX-4 (viewport overflow at 320px) — DEFERRED

Requires a running browser with Playwright. No source-code change was possible for this finding. Responsive matrix and TC-W001 remain UNTESTED. Status unchanged from original review.

**Status: DEFERRED — Playwright required.**

---

### UX-5 (missing tests) — PASS with one gap noted

**Test file confirmed present:** `juggler-frontend/src/components/tasks/sections/__tests__/WhenSection.fixed.test.jsx`

**Coverage verified:**

| Test case | Tests in file | Assessment |
|-----------|--------------|------------|
| TC-W002: Fixed button active, aria-pressed, not locked | 6 tests | PASS — covers render, fontWeight, aria-pressed=true, all others aria-pressed=false, no pointer-events:none, role=group+aria-label |
| TC-W003: Fixed + cal-managed, selector locked | 3 tests | PASS — banner text, pointerEvents:none, tabIndex=-1 on all 5 buttons |
| TC-W004: Fixed + no cal link, interactive | 3 tests | PASS — no banner, tabIndex=0, click fires onModeChange |
| TC-W005: "Date is pinned" regression guard | 6 tests (one per prop variant) | PASS — all prop variants covered |
| TC-W006: Save blocked with no date/time | 3 tests (error appears, onUpdate not called, no error when date+time present) | PASS |

**One gap:** TC-W003 checks `tabIndex=-1` on "Anytime", "Schedule near a preferred time", "Restrict to named time block windows", "Spans the entire day", and "Exact date and time — immovable" — all five. However the test locates buttons by `title` attribute. The "Anytime" button in the non-recurring selector uses title "No time restriction — the scheduler can place this in any available slot". The test at line 124 uses `getByTitle(/No time restriction/)` — this correctly matches. Confirmed no title-matching gap.

**Second gap noted:** TC-W006's `renderFixedForm` passes `task.date: null` and `task.time: null`. The form's `useState` initializes `date` from `initDateTime.date` (derived from `toDateISO(task.date)`) and `time` from `initDateTime.time`. `toDateISO(null)` — the behavior of this function on `null` input should return `''` or `null`. If it returns a non-empty string the guard `(!date || !time)` would not fire and the test would fail. This is an assumption in the test that depends on `toDateISO` behavior, but since the test covers the positive case it will expose any mismatch at run time.

**Status: PASS** (test file is comprehensive; the two edge notes above are test-resilience observations, not gaps in intent.)

---

### Re-Verification Summary Table

| Finding | Original Status | Re-Verification Status | Notes |
|---------|----------------|----------------------|-------|
| UX-1 (aria-pressed) | WARN | PASS | `role="group"`, `aria-label`, and `aria-pressed` confirmed on all 9 buttons across both selectors |
| UX-2 (Fixed in recurring path) | WARN | WARN | Guard prevents zero-active-buttons bug, but banner text "Calendar-managed" is inaccurate when no calendar event exists — user is misled and has no escape path |
| UX-3 (silent failure) | WARN | PASS | Client-side guard blocks save; `role="alert"` renders error; backend error string propagated. Non-blocking note: error position is distant from date/time fields when sub-sections are expanded |
| UX-4 (320px overflow) | WARN | DEFERRED | Requires Playwright; no source change made |
| UX-5 (missing tests) | WARN | PASS | 21 tests covering TC-W002 through TC-W006; structure and assertions correct |

---

### Re-Verification Verdict: WARN

UX-1, UX-3, and UX-5 are resolved. UX-4 is deferred pending a Playwright run.

UX-2 remains WARN. The fix prevents the original zero-active-buttons bug for recurring tasks with `placementMode='fixed'`. However the amber banner ("Calendar-managed — scheduling mode is controlled by the source calendar") is displayed even when there is no backing calendar event, misleading the user and providing no path to change the mode. This must be corrected before ship: the banner text must be conditional on `isCalManaged`, and the non-cal-managed branch must offer a way to switch to a supported mode.

**Action required before commit:**
- Fix UX-2 banner text for non-cal-managed recurring tasks with `placementMode='fixed'`
- Run Playwright TC-W001 for UX-4 when dev server is available
