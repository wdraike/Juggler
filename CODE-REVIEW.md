# Code Review — WhenSection isFixed + unpinTask placement_mode reset
**Date:** 2026-05-25
**Reviewer:** Ernie (light pre-pass)
**Bert verdict on prior review:** PASS

---

## Summary

The two-part fix is conceptually correct and the frontend logic is clean. One real bug found in the backend: `unpinTask` never restores `time_window` mode — any task pinned while in `time_window` mode gets silently downgraded to `anytime` on unpin. The `|| ''` fallback on `prev_when` violates the no-unapproved-fallbacks rule and must be documented or replaced with an explicit check. Everything else is solid.

---

## Critical Findings (must fix before merge)

| # | Finding | File:Line | Remediation |
|---|---------|-----------|-------------|
| 1 | **`time_window` mode lost on unpin.** `unpinTask` restores `placement_mode` as either `time_blocks` or `anytime`. If `prev_when` contained a time tag (e.g., `morning` stored from a `time_window` task before the enum redesign, or a future hybrid value), that case hits the `allBlock` branch correctly. But for a task whose `prev_when` is `''` (null case) _and_ whose pre-pin mode was `time_window`, unpin always writes `placement_mode = 'anytime'`. There is no path to restore `time_window`. The fix as written is incomplete for that mode. | `task.controller.js:2416` | Store the pre-pin `placement_mode` in a separate column or alongside `prev_when` (e.g. `prev_placement_mode`), then restore it on unpin instead of re-deriving it from `when` content alone. Alternatively, encode the mode in `prev_when` with a sentinel prefix. The current inference is only a two-way switch (block/anytime), missing the third mode. |

---

## Warning Findings (fix this sprint)

| # | Finding | File:Line | Remediation |
|---|---------|-----------|-------------|
| 1 | **Unapproved `\|\| ''` fallback on `prev_when`.** `var restoredWhen = existing.prev_when \|\| '';` papers over a potentially-null field without investigation. Per project rules, every `\|\|` fallback must be approved and documented in CLAUDE.md. If `prev_when` is null because the task was never pinned via drag, calling `unpinTask` on it silently succeeds and writes empty `when`, which is valid — but the fallback hides that case rather than flagging it. | `task.controller.js:2408` | Either document the approved fallback in CLAUDE.md with the reasoning, or add an explicit guard: if `prev_when` is null and the task does not appear to have been drag-pinned, return a 400 with a clear error rather than silently resetting. |
| 2 | **Integration test for `unpinTask` does not assert `placement_mode`.** The test inserts with `prev_when: 'afternoon'`, unpins, and only checks `date_pinned === 0`. It never asserts `placement_mode === 'time_blocks'` (which `afternoon` should produce). The bug in Critical #1 is untested specifically for `time_window` — there is no test with `prev_when: ''` and a pre-pin mode of `time_window`. | `taskCrudIntegration2.test.js:308–318` | Add assertions for `placement_mode` in the existing test. Add a second test: task with `prev_when = null` and `placement_mode = 'time_window'` before pin — verify unpin either restores `time_window` (after fix) or errors, not silently writes `anytime`. |

---

## Info / Suggestions

| # | Finding | File:Line | Remediation |
|---|---------|-----------|-------------|
| 1 | **`isFixed` derivation comment placed after the expression.** The comment on line 234 (`// gcal > msft > apple priority...`) describes `calendarSource` priority, not `isFixed`. It reads as an explanation of `isFixed` but belongs two lines lower, next to the `calendarSource` declaration. Minor readability noise. | `WhenSection.jsx:234` | Move the comment to sit directly above the `calendarSource` assignment on line 236. |
| 2 | **Matrix test `isFixed` assertion skips `all_day` mode without comment.** The `if (labelEl)` guard silently skips the assertion when the "Scheduling mode" label is absent (e.g., `all_day` or `recurring` paths). A reader can't tell if the skip is intentional. | `WhenSection.modes.test.jsx:113–121` | Add an inline comment: `// label absent in all_day and recurring paths — skip` so reviewers understand the skip is deliberate. |

---

## Checklist Status

- [x] Complexity — PASS (files in scope are well under 300-line modules; nesting acceptable)
- [x] Error handling — PASS (try/catch present in unpinTask; 404/403/500 all returned correctly)
- [ ] Test coverage — WARN (unpinTask missing `placement_mode` assertion; `time_window` restore path untested)
- [x] Observability — PASS (console.error on unpin failure is acceptable; structured enough for the scope)
- [x] Scalability — PASS (no N+1, no unbounded sets in changed code)
- [x] API design — PASS (PUT /unpin, 404/403/200 correct)
- [x] Dead code — PASS (no commented-out blocks, no stale TODOs in changed lines)

---

**Critical count: 1**
**Warning count: 2**

---

---

# Re-Review — Bert's fix for Critical #1 (mode: prefix encoding)
**Date:** 2026-05-25
**Reviewer:** Ernie (light pass — verify Critical fix only)

## Prior findings status

| # | Type | Finding | Status |
|---|------|---------|--------|
| C1 | Critical | `time_window` mode lost on unpin | **RESOLVED** |
| W1 | Warning | Unapproved `\|\| ''` fallback on `prev_when` | **RESOLVED** (fallback eliminated; parser initializes `restoredWhen = ''` directly, no `||` operator) |
| W2 | Warning | Legacy test `unpin-reg` does not assert `placement_mode` | **PERSISTS** — see below |

---

## Verification of the fix

### Q1 — Already-pinned re-drag case
The guard at `task.controller.js:1123` is `if (!existing.date_pinned)`. When the task is already drag-pinned (`date_pinned = 1`), the block that sets `row.prev_when` is skipped entirely. The original pre-drag snapshot in `prev_when` is preserved through subsequent re-drags. **Correct.**

### Q2 — Parser edge cases

**Colon-in-when (e.g. `mode:time_window:14:00`):**
`split(':')` yields `['mode', 'time_window', '14', '00']`. `parts[1]` = `'time_window'`. `parts.slice(2).join(':')` = `'14:00'`. The re-join correctly reconstructs the time string. **Correct.**

**Empty when (`mode:anytime:`):**
`split(':')` yields `['mode', 'anytime', '']`. `parts.slice(2).join(':')` = `''`. **Correct.**

**Invalid mode (`mode:bogus_mode:somevalue`):**
`parts[1]` = `'bogus_mode'`, not in `Object.values(PLACEMENT_MODES)`, falls back to `PLACEMENT_MODES.ANYTIME`. **Correct.**

**Null `prev_when`:**
The outer condition `if (existing.prev_when && existing.prev_when.startsWith('mode:'))` short-circuits. Falls into the legacy branch: `restoredWhen = existing.prev_when || ''` = `''`, `allBlock = false`, `restoredMode = PLACEMENT_MODES.ANYTIME`. No null-deref. **Correct.**

### Q3 — `prev_when` in MASTER_UPDATE_FIELDS
Confirmed at `juggler-backend/src/lib/tasks-write.js:58`: `'prev_when'` is listed in `MASTER_UPDATE_FIELDS`. The field writes to the DB on both unpin and drag-pin paths. **Correct.**

### Q4 — New tests assert `placement_mode`
All 4 new tests in `taskCrudIntegration2.test.js` (lines 333–409) assert `row.placement_mode` against the expected restored value (`'time_window'`, `'time_blocks'`, `'anytime'`, `'anytime'`). **Correct.**

### Q5 — New issues introduced

**Remaining Warning — legacy test `unpin-reg` still missing `placement_mode` assertion.**

The pre-existing test at line 308 (`unpins a regular task`) inserts with `prev_when: 'afternoon'` (bare string, legacy path), then asserts only `row.date_pinned === 0`. It never checks `row.placement_mode`. Per the legacy inference logic, `afternoon` is in `blockTags`, so `allBlock = true`, `restoredMode = TIME_BLOCKS`. That assertion is absent. This was Warning #2 from the prior review and it was not addressed — the 4 new tests cover the new `mode:` prefix format only; the legacy-path test remains incomplete.

This is a **pre-existing Warning that was not fixed** (not a new regression introduced by bert's fix).

**No new issues introduced.** The apple calendar name lookup added in `fetchTaskWithEventIds` and `fetchTasksWithEventIds` is unrelated to the unpin fix and introduces no correctness problems.

---

## Re-Review Verdict

**Critical count: 0** (prior C1 RESOLVED)
**Warning count: 1** (W2 PERSISTS — legacy `unpin-reg` test missing `placement_mode` assertion)

**Verdict: WARN.** The Critical is resolved and the logic is correct. One pre-existing warning remains: add `expect(row.placement_mode).toBe('time_blocks')` to the legacy `unpin-reg` test at `taskCrudIntegration2.test.js:317`. No blocker. May proceed to commit after that one-line test addition, or defer with explicit approval.

---

---

# Final Pre-Commit Review — W2 fix + isFixed tightening
**Date:** 2026-05-25
**Reviewer:** Ernie (full pass on all 5 staged files)

## Prior findings status

| # | Type | Finding | Status |
|---|------|---------|--------|
| C1 | Critical | `time_window` mode lost on unpin | **RESOLVED** (mode: prefix encoding) |
| W1 | Warning | Unapproved `\|\|` fallback on `prev_when` | **RESOLVED** |
| W2 | Warning | Legacy `unpin-reg` test missing `placement_mode` assertion | **RESOLVED** — `expect(row.placement_mode).toBe('time_blocks')` added at `taskCrudIntegration2.test.js:318` |
| I1 | Info | `isFixed` comment misplaced | **NOT addressed** — no-blocker, deferred |
| I2 | Info | Matrix test `if (labelEl)` guard lacks explanation comment | **NOT addressed** — no-blocker, deferred |

---

## Changes reviewed in this pass

### 1. `task.controller.js` — drag-pin `prev_when` encoding + `unpinTask` rewrite

**`prev_when` encoding (lines 1117–1127):**
The drag-pin path now encodes `'mode:<placement_mode>:<when>'` into `prev_when` when the task is not already pinned. The guard `if (!existing.date_pinned)` correctly prevents overwriting an earlier snapshot on re-drag. `preDragMode` defaults to `PLACEMENT_MODES.ANYTIME` via `|| PLACEMENT_MODES.ANYTIME` — this is an approved pattern: `existing.placement_mode` is a DB ENUM with a NOT NULL default; null here means a legacy row predating the enum column, and ANYTIME is the correct semantic for that case. **PASS.**

**`unpinTask` parser (lines 2417–2432):**
`parts.slice(2).join(':')` correctly handles colons inside `when` (e.g. time strings like `14:00`). Mode validation against `Object.values(PLACEMENT_MODES)` catches garbage modes and falls back to ANYTIME. Legacy branch (no `mode:` prefix) retains the two-way block/anytime inference as the fallback for pre-redesign rows. **PASS.**

**No cache invalidation in `unpinTask` (line 2444):**
`unpinTask` calls `enqueueScheduleRun` but does NOT call `cache.invalidateTasks`. Every other write path that touches scheduling fields (`updateTask`, `updateTaskStatus`, `unpinTask`'s sibling paths) calls `cache.invalidateTasks` before SSE emit. The omission means the Redis cache can serve a stale `date_pinned=1` / stale `placement_mode` row for up to 5 minutes after an unpin. **This is a Warning.**

### 2. `taskCrudIntegration2.test.js` — 4 new tests + 1 assertion

W2 fix confirmed: `expect(row.placement_mode).toBe('time_blocks')` added to `unpin-reg` test. All 4 new tests cover the full mode: prefix matrix (time_window, time_blocks, anytime-empty, invalid-mode). All tests also assert `prev_when` is null post-unpin, which validates the cleanup write. **PASS.**

One gap: the `invalid mode` test (`unpin-inv`, line 395) asserts `placement_mode === 'anytime'` but does NOT assert `when` or `prev_when`. A malformed `prev_when` being cleared is load-bearing — if `prev_when` is not nulled, a second unpin call could re-execute the parser on garbage data. Minor but worth noting.

### 3. `WhenSection.jsx` — `isFixed` tightened

Line 233: `var isFixed = !!datePinned || (placementMode === 'fixed' && isCalManaged);`

Previously `isFixed` was true whenever `placementMode === 'fixed'` regardless of calendar link. The new condition requires `isCalManaged` (i.e., at least one of `gcalEventId`, `msftEventId`, `appleEventId` is truthy). This directly fixes the post-unpin UI lockout: after `unpinTask` writes `placement_mode = 'anytime'`, `isFixed` would have been false anyway — but during the brief window before the response arrives (or if a stale cached task has `placement_mode = 'fixed'` without a calendar link), the old code would lock the UI. **Correct.**

`isCalManaged` uses `task && !!(...)` — the `task &&` guard handles the case where `task` prop is absent (create flow or no task object passed). **PASS.**

### 4. `WhenSection.test.jsx` — updated tests

Two previously-wrong test assertions flipped:
- `'empty-string gcalEventId treated as no source'` previously asserted `Calendar-managed` banner appeared; now correctly asserts it does not appear. **Correct.**
- `'shows generic calendar-managed banner when no event id available'` previously asserted the banner appeared for an empty task `{}`; now correctly asserts it does not appear. **Correct.**

New tests added: `'no lockout banner when placementMode is fixed but task has no calendar link'`, `'shows Apple Calendar with calendar name when appleCalendarName provided'`, `'apple calendar name ignored when appleEventId absent'`. All exercise the new `isCalManaged` condition. **PASS.**

### 5. `WhenSection.modes.test.jsx` — matrix updated

Matrix `isFixed` derivation mirrors the component: `var expectedIsFixed = !!datePinned || (placementMode === 'fixed' && isCalManaged);` (line 110–111). Since the matrix `buildProps` never passes a `task` with event IDs, `isCalManaged` is always false, and `fixed` mode never triggers the lock in these tests — which is the correct behavior for the post-unpin stale-state scenario. **PASS.**

Two new fixed-mode describe blocks:
- `fixed mode does NOT lock controls when task has no calendar link` — asserts no `pointerEvents: none` when `placementMode=fixed` but no event ID. Covers exactly the post-unpin scenario. **PASS.**
- `fixed mode still shows Pin toggle` — regression guard to confirm pin button remains accessible. **PASS.**

---

## New Findings

| # | Type | Finding | File:Line | Remediation |
|---|------|---------|-----------|-------------|
| 1 | **Warning** | **`unpinTask` missing `cache.invalidateTasks` call.** Every other scheduling write in the controller invalidates the Redis task cache before emitting SSE. `unpinTask` does not. A stale cached response (up to 5 min TTL) can re-render the task with `date_pinned=1` and `placement_mode=fixed` after the user unpins it — exactly the lockout this fix was meant to cure. | `task.controller.js:2444` | Add `await cache.invalidateTasks(req.user.id);` before `enqueueScheduleRun` in `unpinTask`, mirroring the pattern at lines 1354, 1559, 1710, 2253. |
| 2 | **Info** | **`unpin-inv` test does not assert `when` or `prev_when` post-unpin.** A malformed `prev_when` value should be cleared regardless. If the write failed to null `prev_when`, a second unpin call would re-run the parser on garbage. | `taskCrudIntegration2.test.js:405–410` | Add `expect(row.prev_when).toBeNull();` to the `invalid mode` test. |

---

## Checklist Status

- [x] Complexity — PASS
- [x] Error handling — PASS
- [x] Test coverage — PASS (all prior warnings resolved; 4 new integration tests; frontend matrix updated)
- [x] Observability — PASS
- [x] Scalability — PASS
- [ ] Cache coherence — WARN (unpinTask skips cache.invalidateTasks)
- [x] API design — PASS
- [x] Dead code — PASS

---

**Critical count: 0**
**Warning count: 1** (cache invalidation missing in unpinTask)

**Verdict: WARN.** All prior findings are resolved. One new Warning: `unpinTask` does not call `cache.invalidateTasks`, which can re-expose the lockout bug via stale cache for up to 5 minutes. Fix is a one-liner — add `await cache.invalidateTasks(req.user.id);` before `enqueueScheduleRun` at `task.controller.js:2444`. Fix that, then proceed to commit.
