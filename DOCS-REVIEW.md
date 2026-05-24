# Documentation Review — Juggler Task Configuration Review Artifacts

**Reviewer:** Prairie Dawn
**Date:** 2026-05-24
**Scope:** 5 review/audit artifacts generated for juggler-backend and juggler-frontend

---

## Files Reviewed

| # | File | Type | Service | BLOCK | WARN |
|---|------|------|---------|-------|------|
| 1 | `juggler-backend/docs/ELMO-SECURITY-AUDIT.md` | Security audit | juggler-backend | 3 | 3 |
| 2 | `juggler-frontend/docs/ERNIE-CODE-REVIEW.md` | Code review | juggler-frontend / juggler-backend | 2 | 6 |
| 3 | `juggler-frontend/docs/TASK-EDIT-UX-AUDIT.md` | UX audit | juggler-frontend | 3 | 6 |
| 4 | `juggler-frontend/docs/ZOE-TEST-AUDIT.md` | Test quality audit | juggler-frontend / juggler-backend | 7 | 11 |
| 5 | `juggler-backend/docs/TASK-CONFIGURATION-MATRIX.md` | Design reference | juggler-backend | 0 | 0 |

**Aggregate: 15 BLOCK, 26 WARN**

---

## Cross-Cutting Themes (De-duplicated)

These are the distinct problem areas that surface in multiple audits from different angles.

### Theme 1 — `batch_update_tasks` is under-guarded and under-tested
- **Elmo CRITICAL-1 (BLOCK):** `batch_update_tasks` has zero calendar-sync guard; any field is writable on externally-synced tasks, including `date_pinned` and `placement_mode`.
- **Ernie C1 (BLOCK):** `batch_update_tasks` (both locked and transaction paths) silently omits the auto-pin backstop present in single-task `create_task` and `update_task`.
- **Elmo MEDIUM-1 (WARN):** Auto-pin / all-day inference in `batch_update_tasks` can silently mutate calendar-synced tasks when combined with the missing guard.

### Theme 2 — Silent lockout scenarios are unhandled and untested
- **UX Audit (BLOCK):** Scheduling mode buttons are disabled via CSS `pointerEvents: 'none'` with no visible explanation, banner, or tooltip.
- **UX Audit (BLOCK):** `fixed` mode without `datePinned` creates a contradictory UI state: the Pin button reads "Pin" (unpinned) while the mode selector is disabled, with no explanation.
- **Zoe F2 (BLOCK):** The `fixed` + `datePinned=false` silent lockout is not exercised in the 166-test mode matrix.
- **Zoe F3 (BLOCK):** The missing visible explanation for disabled controls is not tested.
- **Ernie W1 (WARN):** The frontend disabling-test checks the HTML `disabled` property, but the real mechanism is CSS `pointerEvents`, giving false confidence.
- **Ernie W2 (WARN):** The `isFixed` test only asserts on label opacity, not on the interactive button container.
- **Ernie W5 (WARN):** Keyboard users can still activate mode buttons when `isFixed` is true because there is no `disabled` attribute or keyboard intercept.

### Theme 3 — Placement mode / `datePinned` validation is inconsistent across API, MCP, and UI
- **Elmo HIGH-1 (BLOCK):** `placementMode: 'fixed'` is accepted without requiring `date`, `time`, or `scheduledAt`, creating contradictory scheduler input.
- **Elmo HIGH-2 (BLOCK):** `taskToRow` passes `placement_mode` through unchecked; the MCP Zod enum is the sole gate, and the REST path has no enforcement.
- **Elmo MEDIUM-2 (WARN):** API `checkCalSyncEditGuard` allows `datePinned` on calendar-synced tasks, but MCP `update_task` blocks it entirely. The immutability policy is not uniform across channels.
- **Elmo LOW-1 (WARN):** Explicit `datePinned: false` + `date` creates an un-pinned dated task; scheduler and frontend must not assume `scheduled_at !== null` implies `date_pinned = 1`.
- **Ernie W3 (WARN):** Auto-pin guard uses truthiness on create (`task.date || task.time`) but presence on update (`fields.date !== undefined`), so sending `date: ''` to unschedule a task accidentally pins it on update.
- **Ernie W4 (WARN):** The "All Day" mode handler preserves stale `time`, `endTime`, and `dur` in parent state, allowing contradictory `placementMode: 'all_day'` + non-empty `time` to reach the backend.
- **Zoe F12 (WARN):** Backend tests send no contradictory parameter combinations (e.g., `all_day` + `time`, `fixed` without date/time).

### Theme 4 — Test quality is dangerously misleading
- **Ernie C2 (BLOCK):** Three backend test names in `mcp-task-config.test.js` describe the exact opposite of what they assert. A future developer "fixing" the code to match the name would break the tests and the fix.
- **Zoe F1 (BLOCK):** 160 of 166 parameterized tests in `WhenSection.modes.test.jsx` are shallow "renders without crashing" + DOM presence checks that do not exercise interactivity, lockout conditions, or invalid combinations.
- **Zoe F15 (WARN):** A backend test name claims `datePinned:true without date/time does NOT set date_pinned`, but the assertion expects `date_pinned` to be `1`.
- **Zoe F8 (WARN):** Baseline frontend tests assert `fontWeight === '600'` to prove a button is active, not actual click behavior.
- **Zoe F9 (WARN):** No negative interaction tests exist that click a control that should be disabled and assert the handler is NOT called.
- **Ernie W6 (WARN):** The `fixed mode` test uses `.closest('div')`, which is brittle to layout wrapper changes.

### Theme 5 — Recurring, All Day, and `rigid` gaps
- **UX Audit (WARN):** The recurring mode selector offers only 3 modes (Anytime, Time window, Time blocks); `All Day` is absent, so converting a one-off all-day task to recurring silently reverts the mode.
- **Zoe F6 (BLOCK):** The recurring All Day gap is not tested.
- **Zoe F7 (BLOCK):** `rigid` is included in the parameter matrix but never meaningfully asserted in any of the 160 parameterized tests.
- **Zoe F14 (WARN):** Recurring task inference (`recurring=true` + `preferredTimeMins` + `timeFlex=0`) is completely absent from backend tests.
- **Ernie I2 (Info):** `placementMode: 'reminder'` is a valid MCP enum value but absent from the frontend UI mode selector.

### Theme 6 — Dead / unreachable code
- **UX Audit (BLOCK):** `ManageCalTaskDialog` in `TaskEditForm.jsx` is declared and conditionally rendered, but `setManageCalDialog(true)` is never called anywhere in the file. Calendar-owned tasks have no UI path to "Take ownership" or "Open in calendar".

---

## Per-File Detail

### 1. ELMO-SECURITY-AUDIT.md
Clean audit structure with reproduction steps, attack vectors, and impact statements. Severity mapping is consistent. All three audited files are explicitly named. Remediation instructions are specific and actionable. No doc-quality defects.

- **BLOCK (3):** `batch_update_tasks` missing calendar-sync guard; `placementMode: 'fixed'` without date/time; unchecked `placement_mode` passthrough in `taskToRow`.
- **WARN (3):** Auto-pin inference mutating calendar-synced tasks; API vs MCP `datePinned` divergence; `datePinned: false` + `date` edge case.

### 2. ERNIE-CODE-REVIEW.md
Accurate line references and code snippets. Clear distinction between Critical, Warning, and Info. C1 and C2 are both well-evidenced. W1-W6 each name a specific test or component weakness. I3 (cross-field Zod validation gaps) is correctly classified Info because it documents a permissive contract, not an active bug.

- **BLOCK (2):** Missing auto-pin in `batch_update_tasks`; 3 backend test names that contradict assertions.
- **WARN (6):** False-confidence disabling-test; `isFixed` opacity-only assertion; auto-pin truthiness/presence inconsistency; All Day stale state preservation; keyboard activation of disabled buttons; brittle `.closest('div')` selector.

### 3. TASK-EDIT-UX-AUDIT.md
Method states "static code audit (no dev server)" — appropriate disclaimer. The disabled-control inventory is a useful table. Silent lockout scenarios are clearly enumerated. The dead/broken flow finding is a genuine product defect, not a cosmetic issue.

- **BLOCK (3):** Mode selector disabled with no visible explanation; `fixed` mode + `datePinned=false` silent lockout; `ManageCalTaskDialog` unreachable.
- **WARN (6):** Scheduling label dimmed without explanation; time blocks tag selector disabled without explanation; day requirement picker removed from DOM; travel inputs hidden; split toggle hidden; recurring mode selector missing All Day.

### 4. ZOE-TEST-AUDIT.md
Explicit verdicts per file (BLOCK / WARN) make prioritization easy. F1-F7 are correctly grouped as blockers because the mode-matrix test file is the primary test artifact for this feature. F8-F11 and F12-F17 are flagged for the baseline and backend suites respectively. The "Specific Missing Tests to Add" section is a concrete checklist.

- **BLOCK (7):** Parameterized fluff (160 shallow tests); silent lockout `fixed`+`datePinned=false` untested; missing visible explanation untested; invalid combinations never exercised; mode transition paths untested; recurring All Day gap untested; `rigid` in matrix but unasserted.
- **WARN (11):** Shallow active-button assertions; no negative interaction tests; rolling recurrence edge cases missing; no timezone change coverage; no negative backend tests for contradictory params; `datePinned` override with time untested; recurring inference absent; misleading test name; `scheduledAt` edge cases untested; auto-pin override logic thinly exercised.

### 5. TASK-CONFIGURATION-MATRIX.md
Well-structured reference doc. Catalogs 30 valid combinations, 10 invalid/locked combinations, 5 silent lockout scenarios, and inference rules for MCP, backend create, backend update, and MCP update paths. Cross-references other architecture docs. No actionable defects in the document itself. Its primary role is to provide the ground truth that the other four audits prove is unenforced or untested.

- **BLOCK (0), WARN (0).**

---

## Action Priority

1. **Fix `batch_update_tasks` (Theme 1)** — Add calendar-sync guard and auto-pin backstop. 2 BLOCK.
2. **Add visible lockout banners and test them (Theme 2)** — Replace CSS-only disabling with explanatory UI and hardened tests. 3 BLOCK, 5 WARN.
3. **Harden placement_mode validation and unify API/MCP guards (Theme 3)** — Cross-field rules in `validateTaskInput`, whitelist in `taskToRow`, and consistent `allowedKeys`. 2 BLOCK, 5 WARN.
4. **Rewrite misleading tests and add negative interaction coverage (Theme 4)** — Fix test names, replace shallow presence checks, add click-guard tests. 2 BLOCK, 4 WARN.
5. **Close recurring / All Day / `rigid` gaps (Theme 5)** — Add All Day to recurring UI or document exclusion; assert `rigid` in tests; add recurring inference tests. 2 BLOCK, 3 WARN.
6. **Wire up or remove `ManageCalTaskDialog` (Theme 6)** — 1 BLOCK.

---

Signed: Prairie Dawn — 2026-05-24

Overall: BLOCK
