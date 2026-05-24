# ZOE Adversarial Test Audit — cal_sync_ledger tests in taskCrudIntegration.test.js

_Date: 2026-05-24_
_Scope: Four new cal-sync CRUD tests added to `juggler-backend/tests/taskCrudIntegration.test.js`_
_Controller under test: `src/controllers/task.controller.js` (`updateTask` fast + complex paths)_

---

## Verdict: WARN

The four tests exercise the happy paths but contain shallow assertions that could mask false passes, miss critical boundary conditions, and omit negative/auth coverage. No regressions detected, but the suite is not airtight enough for a PASS.

---

## Tests Under Audit

| # | Test Name | Line |
|---|-----------|------|
| 1 | juggler-originated cal-synced task remains editable (fast path) | 324 |
| 2 | ingested cal-synced task blocks edits (fast path) | 337 |
| 3 | ingested cal-synced task silently keeps date_pinned on fast path (C-1) | 350 |
| 4 | ingested cal-synced task blocks when and allows notes | 370 |

---

## Findings

### WARN-1: Shallow optimistic-response assertions in Tests 1 and 4 (false-pass risk)

**Test 1** (`juggler-originated remains editable`) and **Test 4** (`notes` allowed path) both assert only on `res._json.task.{text,notes}`.

The fast path returns an **optimistic merge** (controller L998-1004):

```javascript
var optimistic = Object.assign({}, fastExisting, fastRow);
return res.json({ task: rowToTask(optimistic, null) });
```

`fastRow` is produced by `taskToRow(req.body)`; the response always reflects the submitted body regardless of whether `tasksWrite.updateTaskById` actually committed to the DB. If the write were skipped due to a future optimization, transaction rollback, or routing bug, the test would still pass.

**Required fix:** Add a post-update DB assertion:
- Test 1: `var row = await db('tasks_v').where('id', id).first(); expect(row.text).toBe('Updated');`
- Test 4 notes path: same pattern for `notes`.

---

### WARN-2: No DB write absence assertion in Test 2 (ingested blocked)

**Test 2** asserts `403` + `CAL_SYNCED_READONLY`, which is correct. However, it does not verify that the underlying task row was **not mutated**. If a future refactor moves the guard **after** the write (e.g., to support partial updates), the test would still pass while corrupting data.

**Required fix:** Add a DB assertion that `text` remains `'Ingested origin'` after the 403.

---

### WARN-3: Missing inactive-ledger boundary test

`fetchTaskWithEventIds` filters ledger rows with `.where({ task_id: id, status: 'active' })`. If a ledger row has `status = 'deleted'`, `'deleted_local'`, or any non-active value, the controller will not attach `cal_sync_origin` and the guard will not fire. An externally-ingested task whose sync link was broken could then be silently editable.

**Required fix:** Add a test: seed a task with a ledger row where `status = 'deleted'`, send a blocked field, assert `200` (or whatever the intended product behavior is — the test should at least document and lock the current behavior).

---

### WARN-4: Missing multi-provider origin-collision test

`fetchTaskWithEventIds` (L224-226) prefers non-juggler origin when multiple active ledger rows exist:

```javascript
if (!row.cal_sync_origin || row.cal_sync_origin === 'juggler') {
  row.cal_sync_origin = ledgerRows[i].origin || null;
}
```

A task with **both** a juggler-origin push ledger and an ingested gcal ledger would evaluate as `origin = 'gcal'` and become read-only. None of the four tests exercise multi-row collision.

**Required fix:** Seed two active ledger rows (`origin='juggler'` and `origin='gcal'`), attempt a text edit, assert `403`.

---

### WARN-5: Missing `_allowUnfix` opt-out edge case for ingested tasks

`_allowUnfix` is in the `allowed` array (L76), meaning an ingested task can submit it without triggering `CAL_SYNCED_READONLY`. `_allowUnfix` also forces the **complex path** (L898). In the complex path, `guardFixedCalendarWhen` receives `{ allowUnfix: true }` and returns early (L581), **not** stripping `date_pinned: 0`. Therefore, an ingested task can currently clear its pin by sending `{ datePinned: false, _allowUnfix: true }`.

Whether this is a bug or a feature is a product decision, but it is **untested** and un-documented.

**Required fix:** Add a test documenting the behavior: seed ingested task, send `{ datePinned: false, _allowUnfix: true }`, assert DB `date_pinned` is either `0` (if intended) or `1` (if the opt-out should not apply to ingested tasks).

---

### WARN-6: Missing `blockedFields` shape assertion in Test 2

`checkCalSyncEditGuard` returns `blockedFields: blocked`. Test 2 checks `code` but never inspects `blockedFields`. If the guard ever returned the wrong field list (e.g., omitted `text` or included an allowed field), the test would not catch it.

**Required fix:** Add `expect(res._json.blockedFields).toContain('text')`.

---

### WARN-7: Missing mixed-field test (blocked + allowed in one request)

No test covers a body that contains both allowed and blocked fields, e.g.:

```javascript
{ text: 'Blocked', notes: 'Allowed' }
```

The guard should reject the entire request. This is the realistic frontend scenario (users often touch multiple fields).

**Required fix:** Add a test asserting `403` when `text` and `notes` are sent together on an ingested task.

---

### WARN-8: No auth / wrong-user negative test

None of the four tests verify that user A cannot edit user B's cal-synced task. The mock helper hard-codes `USER_ID` and `req.user.id` to the same value.

**Required fix:** Add a test where `req.user.id` is a different user; assert `404` or `403`.

---

### WARN-9: Missing allowed-field coverage for `status` and `_dragPin`

The guard explicitly allows `status`, `notes`, `datePinned`, `_dragPin`, and `_allowUnfix`. Only `notes` is tested. Critical omissions:
- `status` on ingested task (should succeed).
- `_dragPin` on ingested task (should succeed, but may interact with `guardFixedCalendarWhen`).

**Required fix:** Add tests for both.

---

### WARN-10: C-1 (`date_pinned` retention) not tested on complex path

**Test 3** sends `{ datePinned: false }` with no other complex fields, so it stays on the **fast path**. If a future change to `needsComplexPath` logic forces this payload into the complex path, `guardFixedCalendarWhen` behavior could diverge because the complex path only calls the guard when `row.when !== undefined && !req.body._dragPin` (L1055). While `date_pinned` is not conditional on `when`, the code paths are different and the complex path is unexercised for C-1.

**Required fix:** Add a complex-path C-1 test: send `{ datePinned: false, when: 'afternoon' }` on an ingested task, assert the `when` change is blocked (403) **and** that `date_pinned` remains `1` after the blocked request.

---

### WARN-11: Misleading comment in Test 3

The test comment says "guard should silently strip it", implying `checkCalSyncEditGuard` performs the stripping. It does not — `datePinned` is in the `allowed` array. The actual stripping is performed by `guardFixedCalendarWhen` (L584-586). The comment should be corrected to avoid future maintenance errors.

---

### WARN-12: Missing origin-null boundary test

`checkCalSyncEditGuard` returns `null` (editable) when `origin` is falsy. A malformed ledger row with `origin = null` would make an ingested task editable even though it has active calendar event IDs. This is a data-integrity edge case with security implications.

**Required fix:** Seed a task with `origin: null` in the ledger, attempt a text edit, assert the expected behavior.

---

### WARN-13: No Apple provider coverage

Tests 1-3 use `gcal`; Test 4 uses `msft`. Apple (`provider: 'apple'`) is never exercised in the four tests, even though the controller explicitly handles it in `fetchTaskWithEventIds`.

**Required fix:** Parameterize or duplicate one blocking test with `provider: 'apple'`.

---

## Summary

| Status | Count | Details |
|--------|-------|---------|
| PASS | 0 | — |
| WARN | 13 | Shallow assertions, missing boundaries, missing negative/auth tests, uncovered edge cases |
| BLOCK | 0 | Core happy-path coverage is present; no regressions introduced |

## Action Items (in priority order)

1. **Harden shallow assertions** (WARN-1, WARN-2): Add DB assertions after every mutating test.
2. **Add inactive-ledger test** (WARN-3): Document behavior for broken sync links.
3. **Add mixed-field + blockedFields tests** (WARN-6, WARN-7): Lock guard rejection semantics.
4. **Add wrong-user auth test** (WARN-8): Close the authorization gap.
5. **Add `_allowUnfix` / C-1 complex-path / multi-provider tests** (WARN-4, WARN-5, WARN-10): Close the behavioral edge-case gaps.
6. **Add missing allowed-field tests** (WARN-9): Cover `status` and `_dragPin`.
7. **Fix Test 3 comment** (WARN-11): Replace "guard" with `guardFixedCalendarWhen`.
8. **Add origin-null and Apple provider tests** (WARN-12, WARN-13): Complete boundary coverage.

---

_Reviewer: Zoe_
_Mode: Adversarial / No trust in Telly's run_
