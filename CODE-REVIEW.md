# Code Review — juggler-backend/task.controller.js + taskCrudIntegration.test.js

## Summary

**Critical: 1**
**Warning: 2**

---

## Critical

### C-1 — Fast path bypasses `guardFixedCalendarWhen`; ingested cal-synced tasks can be unpinned

**Location:** `juggler-backend/src/controllers/task.controller.js`, `updateTask` fast path (~line 906-1003)

`updateTask` has a fast direct-write path for edits that do not touch `recur`/`when`/`dragPin`/etc. The new `checkCalSyncEditGuard` is called there, but `guardFixedCalendarWhen` -- which prevents clearing `date_pinned` on calendar-linked tasks -- is **never invoked** in the fast path.

Because `checkCalSyncEditGuard` explicitly allows `datePinned` (legitimate pinning operations must work), a client that sends `datePinned: false` on an externally-ingested task gets past the field-list guard, and the fast path writes `date_pinned = 0` unchecked. This breaks the calendar-sync immovability invariant: the scheduler can now drift the task away from its provider event time.

The complex path also only calls `guardFixedCalendarWhen` when `row.when !== undefined` (line 1053), so a `datePinned`-only change is unguarded there too, but the fast path is *completely* missing the call, making the hole unconditional.

**Fix:** Call `guardFixedCalendarWhen(fastRow, fastExisting, { allowUnfix: !!req.body._allowUnfix })` in the fast path after `taskToRow`, or move the pin-clear protection into `checkCalSyncEditGuard` so the fast path does not need a second stop.

---

## Warnings

### W-1 -- `guard` variable in complex path relies on hoisting from fast path

**Location:** `juggler-backend/src/controllers/task.controller.js`, line 1020

The complex path assigns to `guard` without declaring it:

```js
guard = checkCalSyncEditGuard(existing, req.body);
```

It works today only because the fast path declares `var guard` (line 942), and `var` hoists to the function scope. If the fast path is ever removed, refactored to `let/const`, or split into a helper, this line becomes a strict-mode `ReferenceError`.

**Fix:** Declare `var guard = ...` (or use a fresh name) in the complex path.

### W-2 -- Test name mislabels the path being exercised

**Location:** `juggler-backend/tests/taskCrudIntegration.test.js`, line 350

```js
test('ingested cal-synced task allows status and notes (complex path)', async () => {
```

The test body sends `when: 'afternoon'` first (complex path, correctly blocked), then sends `notes: 'Added note'` second. The `notes` edit does **not** trigger `needsComplexPath`, so it exercises the **fast** path. The test name claims both assertions are "complex path," which is misleading for future maintainers.

**Fix:** Rename to something like `ingested cal-synced task blocks when and allows notes` or split into two focused tests.

---

## Observations / Smells

1. **Missing test coverage for `datePinned` on ingested tasks.** There is no test that sends `datePinned: false` (or `true`) on an ingested cal-synced task in either path. Given C-1, this is the exact gap that would have caught the bug.
2. **Stale error message in `checkCalSyncEditGuard`.** The returned error says, "Only status and notes can be changed here," but the `allowed` list also permits `datePinned`, `_dragPin`, and `_allowUnfix`. The message should match the actual policy.
3. **`batchUpdateTasks` does not call `checkCalSyncEditGuard`.** A client can bypass the per-field cal-sync restriction by using the batch endpoint. This is pre-existing, but the extraction of the shared helper makes the omission more visible.
4. **`seedCalSyncTask` helper declared before `controller` assignment.** It works because `controller` is a `var` and the helper is only invoked after line 95 runs, but it couples test ordering.
