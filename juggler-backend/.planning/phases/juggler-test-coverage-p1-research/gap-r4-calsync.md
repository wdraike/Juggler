# R4: Cal-sync Coverage Gap Report

Audit date: 2026-05-16. Based on `git log --oneline -30`, `docs/TEST-USE-CASES.md` §4, and
direct inspection of all cal-sync source and test files.

---

## Recent commits with no corresponding test

The following source-only commits changed cal-sync logic but have no paired test commit and no
existing test covering the specific behavior they introduced or fixed.

| Commit | Summary | Test added? |
|--------|---------|------------|
| `4d5c805` | ETag-based change detection for Apple CalDAV — adds `provider_etag` column; uses ETag fallback when `lastModified` is NULL; clears ETag after Juggler push | No test for ETag path |
| `76e526a` (Bug 3) | Provider-origin events in full-sync mode now pull external edits (adds `else-if` branch on `origin === pid` + full-sync + lastModified change) | No test for provider-origin pull path |
| `59215cc` (RC-2) | Multi-provider `has-changes` local-task check now uses `max(gcal/msft/apple last_synced_at)` instead of only `gcal_last_synced_at` | No test verifying MSFT-only or Apple-only users get local-change detection |
| `da5e191` | Guard floating timezone from UTC conversion in `parseVEvents` (BF-5 fix) | Covered by `45e090a` (`parseVEvents` edge cases) — floating timezone test present |
| `0e79b1b` | Prevent multi-VEVENT ICS second entry overwriting first | Covered by `45e090a` — multi-VEVENT test present |
| `9b364b7` | Trailing slash normalization in `checkForChanges` | Covered by `6d0ea05` — trailing slash tests in `06-adapter-apple-edge.test.js` |
| `9d232cc` | Add missing fields to MSFT `calendarView $select` | Covered by `f2a08dd` — `BF-8` test in `05-adapter-msft-edge.test.js` |
| `838c0c3` | Detect task-deleted-during-sync as conflict | Covered by `0a65681` + `ddd14d3` — BF-7 test in `23-sync-consistency.test.js` |
| `2912c30` | Filter cancelled recurring instances from GCal `listEvents` | Covered by `2b76767` — `BF-4` test in `04-adapter-gcal-edge.test.js` |
| `1008fe1` | Transition ledger to `deleted_remote` on 410 PATCH | No direct unit test; behaviour is within sync integration flow only |
| `27ab39d` | Clear correct provider credentials on 401 auth failure | Covered by `969ea4c` — auth error integration tests |

**Net untested commits: 3 with real unit-testable gaps** (`4d5c805`, `76e526a` Bug 3, `59215cc` RC-2).
The `1008fe1` ledger-transition is exercised only within the full integration flow (no isolated test).

---

## CS- GAP items — can they be tested without credentials?

| ID | Description | Testable without creds? | Approach |
|----|-------------|------------------------|---------|
| CS-11 | MSFT: seed calendar row, verify sync runs | Partially — the seed scenario `msftCalendar` exists; full sync requires a live MSFT token | Seed + mock MSFT API to verify the sync controller routes into the MSFT adapter path (similar to `99-sync-e2e.test.js` GCal pattern). Can be validated without real tokens if adapter is mocked. |
| CS-12 | Apple CalDAV: seed calendar row, verify sync runs | Partially — same as CS-11. Apple credentials required for real CalDAV calls, but controller routing can be mocked. | Same approach: seed `appleCalendar` scenario + mock `apple-cal-api` and `apple.adapter` calls. |
| CS-13 | Apple: `miss_count` guard (repush loop fix) | Yes — pure logic test; only requires DB and mocked CalDAV client | Unit test on `cal-sync.controller.js`: verify that when a ledger row has `miss_count >= 1`, the controller skips the C2-fix re-push path. No real Apple credentials needed. |
| CS-14 | Multi-provider: no `MISS_THRESHOLD` interference | Yes — can be constructed with mocked adapters for two providers | Integration test with two providers active: verify that provider A's `miss_count` accumulation does not affect provider B's threshold evaluation. Controller logic only, no real tokens. |
| CS-15 | Concurrent sync: no duplicate active rows | Yes — already partially covered | `23-sync-consistency.test.js` already covers concurrent lock (409 on second sync). The specific "no duplicate active rows" assertion on the `cal_sync_ledger` table after two concurrent syncs is NOT explicitly asserted in the existing test. Needs a ledger-state assertion added. |

---

## Adapter functions with no unit test

Functions that exist in the exported API but have no test (mock-based or credential-gated) targeting them:

| Function | File | Test file | Coverage |
|----------|------|-----------|---------|
| `apple.adapter.getEnabledCalendars` | `src/lib/cal-adapters/apple.adapter.js` | None | Not tested in isolation. Called internally by `listEvents` and `getWriteCalendar`; behavior on `user_calendars` table fallback to legacy single-URL is untested with a mock DB. |
| `apple.adapter.getWriteCalendar` | `src/lib/cal-adapters/apple.adapter.js` | None | Not tested in isolation. Relies on `getEnabledCalendars`; the "prefer full-sync calendars for writing" filter logic is unverified. |
| `gcal.adapter.batchCreateEvents` | `src/lib/cal-adapters/gcal.adapter.js` | `23-sync-consistency.test.js` (spy only) | Only mocked-out in BF-7 test, never exercised directly. All live tests are credential-gated in `01-adapter-gcal.test.js`. No mock-based unit test for chunk-of-50 logic, error handling on partial batch failure, or `id` index mapping. |
| `gcal.adapter.batchDeleteEvents` | `src/lib/cal-adapters/gcal.adapter.js` | None | No mock-based unit test. 404/410 tolerance in batch is untested. |
| `gcal.adapter.batchUpdateEvents` | `src/lib/cal-adapters/gcal.adapter.js` | `10-sync-push.test.js` (spy only) | Only spied on, never directly invoked with mock responses. |
| `msft.adapter.ianaToWindows` | `src/lib/cal-adapters/msft.adapter.js` | None | Internal helper, not exported. The Windows timezone mapping is exercised only in the credential-gated MSFT integration path. No unit test for IANA-not-in-map passthrough behavior. |
| `msft.adapter.truncateDateTime` | `src/lib/cal-adapters/msft.adapter.js` | `05-adapter-msft-edge.test.js` (indirectly) | `normalizeEvent` calls it; the 7-digit precision truncation is incidentally tested via `normalizeEvent` in `05-adapter-msft-edge.test.js`. No explicit `truncateDateTime` unit test. |
| `apple-cal-api.createEvent` (412 retry path) | `src/lib/apple-cal-api.js` | None | The 412 Precondition Failed path (stale ledger — fetch current ETag and overwrite) is not tested. Only the happy path is exercised. |
| `apple-cal-api.updateEvent` (412 retry path) | `src/lib/apple-cal-api.js` | None | Same: 412 stale-ETag retry inside `updateEvent` is not tested. |
| `apple-cal-api.toUtcICALTime` | `src/lib/apple-cal-api.js` | `tests/apple-cal-412.test.js` (indirectly) | Called internally by `buildVEvent`; tested via `DTSTAMP` presence in Apple 412 tests, but the MySQL `YYYY-MM-DD HH:MM:SS` string-path (appending Z) is not directly asserted. |
| `gcal.adapter.hasChanges` (token update branch) | `src/lib/cal-adapters/gcal.adapter.js` | `04-adapter-gcal-edge.test.js` (partial) | The test only covers the `tokenInvalid` return. The "no changes + new sync token → save to DB" branch is not tested. |
| Controller: ETag-based detection path | `src/controllers/cal-sync.controller.js` | None | The `provider_etag` fallback logic (when `lastModified` is NULL, compare ETag instead) added in `4d5c805` has no unit or integration test. |
| Controller: provider-origin full-sync pull | `src/controllers/cal-sync.controller.js` | None | The `else-if` branch for `origin === pid && full-sync && lastModified changed` added in `76e526a` Bug 3 has no test. |
| Controller: multi-provider `hasChangesLocal` | `src/controllers/cal-sync.controller.js` | None | The `max(gcal/msft/apple last_synced_at)` fix from `59215cc` RC-2 has no test verifying MSFT-only or Apple-only users get local-change detection. |

---

## Credential-gated tests (expected skips — NOT gaps)

These files require real OAuth tokens or CalDAV credentials. They are skipped in CI and on machines
without credentials in `.env.test`. This is the intended behavior per the design spec and
`TEST-USE-CASES.md` §4.2.

- `tests/cal-sync/01-adapter-gcal.test.js` — requires `TEST_GCAL_TOKEN` or OAuth refresh flow
- `tests/cal-sync/02-adapter-msft.test.js` — requires `TEST_MSFT_TOKEN`
- `tests/cal-sync/03-adapter-apple.test.js` — requires `TEST_APPLE_USERNAME`, `TEST_APPLE_PASSWORD`, `TEST_APPLE_CALENDAR_URL`
- `tests/cal-sync/10-sync-push.test.js` through `tests/cal-sync/20-sync-lock.test.js` — integration tests requiring real DB (port 3308) and provider tokens where applicable
- `tests/cal-sync/21-sync-auth-errors.test.js` — requires real DB; skips individual cases if no token
- `tests/cal-sync/22-sync-error-paths.test.js` — requires real DB
- `tests/cal-sync/23-sync-consistency.test.js` — requires real DB
- `tests/cal-sync/30-sync-performance.test.js` — requires real DB and provider token
- `tests/cal-sync/99-sync-e2e.test.js` — requires real DB + provider token; seed scenario `gcalCalendar` skips if no GCal token present

All the above use `isDbAvailable()` and/or credential guards with `console.warn` + early return.
Skipping is correct behavior in credential-absent environments.

---

## Summary

- **Real testable gaps found: 5**
  1. ETag-based change detection in `cal-sync.controller.js` (commit `4d5c805`) — no test
  2. Provider-origin full-sync pull path in `cal-sync.controller.js` (commit `76e526a` Bug 3) — no test
  3. Multi-provider `hasChangesLocal` max-of-three-providers logic (commit `59215cc` RC-2) — no test
  4. `apple.adapter.getEnabledCalendars` fallback from `user_calendars` to legacy URL — no mock-DB test
  5. `apple-cal-api.createEvent` and `updateEvent` 412-retry paths — no test

- **Credential-gated expected skips: 10 test files** (01, 02, 03, 10–23, 30, 99)

- **Commits since last TEST-USE-CASES.md update with no paired test: 3**
  (`4d5c805`, `76e526a`, `59215cc` — all controller-level logic changes)

- **CS- items testable without credentials: CS-13, CS-14, CS-15** (partial — lock assertion gap)

- **CS- items requiring credentials or mock-heavy scaffolding: CS-11, CS-12** — can be partially
  tested by mocking the provider adapter layer; full end-to-end requires live tokens.
