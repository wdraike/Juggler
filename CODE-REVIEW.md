# Code Review — ZOE-JUG-015 OAuth redirect_uri allowlist tests — 2026-05-31

## Summary

Five files changed: one runtime bug fix (`redis.js` — undefined logger), three migration idempotency bug fixes (invalid COLLATE-in-CHECK syntax + incomplete error-message matching), one pre-existing test file confirmed green. All changes are narrowly scoped and correct. No critical issues. Two warnings (migration `down()` idempotency gaps). Ship-ready.

---

## Critical Findings (must fix before merge)

None.

---

## Warning Findings (fix this sprint)

| # | Finding | File:Line | Remediation |
|---|---------|-----------|-------------|
| W1 | Migration 20260604 `down()` calls `ADD CONSTRAINT chk_cal_history_status` without guarding against pre-existing constraint — if rollback is called after a partial run, the re-add will throw "Duplicate check constraint name". The `up()` was fixed; `down()` was not. | `20260604000000_add_cal_history_missed_status.js:70–74` | Wrap the `ADD CONSTRAINT` in `down()` in a try/catch that silences "Duplicate check constraint name", mirroring the `up()` guard. |
| W2 | Migration 20260606 `down()` re-adds `chk_task_instances_status` with bare `await trx.raw(...)` — no duplicate-constraint guard. Same brittleness fixed in `up()` but not carried to `down()`. | `20260606000000_add_missed_status_to_task_instances.js:64–68` | Wrap the restore `ADD CONSTRAINT` in `down()` in a try/catch for "Duplicate check constraint name". |

---

## Info / Suggestions

| # | Finding | File:Line | Suggestion |
|---|---------|-----------|------------|
| I1 | `redis.js` JSDoc header still says "StriveRS" — document drift if this is the juggler service. | `redis.js:3` | Update header comment to "Juggler" to match service name. |
| I2 | The "missing redirect_uri" case (`app.js:164–165`) is not covered by a dedicated test — the three required cases per ZOE-JUG-015 are present and passing, but a 4th test for the no-`redirect_uri` path would complete coverage. | `app.test.js` | Optional: add `GET /oauth/authorize` with no params → 400 `redirect_uri required`. |

---

## Checklist Status

- [x] Complexity — PASS (all files small and single-purpose)
- [x] Error handling — PASS (migration idempotency errors now caught; redis logger fix correct)
- [x] Test coverage — PASS (18/18 tests green, all 4 OAuth allowlist cases covered)
- [x] Observability — PASS (redis.js now uses structured logger correctly)
- [x] Scalability — N/A (migrations + test file only)
- [x] API design — N/A (no new routes)
- [x] Dead code — PASS (no TODOs or commented-out blocks introduced)

---

## Status: PASS

_Signed: Ernie — 2026-05-31T00:00:00Z_
