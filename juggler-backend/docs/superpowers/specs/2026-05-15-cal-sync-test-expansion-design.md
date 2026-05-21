---
type: design
service: juggler
status: active
last_updated: 2026-05-15
tags:
  - type/design
  - service/juggler
  - status/active
  - cal-sync
  - testing
---

# Cal-Sync Test Suite Expansion — Design Spec

**Date:** 2026-05-15  
**Status:** Approved  
**Scope:** juggler-backend calendar sync (GCal, MSFT, Apple CalDAV)

---

## Context

Existing suite: 168 tests / 17 files in `tests/cal-sync/` plus `tests/apple-cal-412.test.js`.  
Coverage: basic push/pull/deletion/conflict/promotion/ingest/allday/split/recurring/multi/lock/performance/e2e.  
Gap: zero tests for auth error paths, token refresh races, API error responses (410/429/403 subtypes), partial sync failures, data consistency under concurrent writes, and provider-specific CalDAV/Graph edge cases.

Four parallel research agents (GCal, MSFT, Apple CalDAV, sync resilience) analyzed the full codebase and surfaced 7 real bugs and ~60 missing test scenarios.

---

## Prerequisite Bug Fixes

These bugs cause test failures before any new tests can be written. All are surgical (2–8 lines each). Must be fixed and committed before the new test files are created.

| ID | File | Bug | Fix |
|----|------|-----|-----|
| BF-1 | `cal-sync.controller.js:~245` | Apple 401: `vaTokenCols` ternary only handles `gcal_event_id`/`msft_event_id`; Apple branch falls to MSFT case, clears wrong columns → Apple creds never cleared → infinite retry | Add `vaEventIdCol === 'apple_event_id'` branch: `{ apple_cal_password: null }` |
| BF-2 | `msft.adapter.js:~133` | MSFT delta link 410: `checkForChanges` returns `tokenInvalid: true` but caller never reads it → `msft_cal_delta_link` stays in DB → every subsequent sync hits 410 | When `result.tokenInvalid`, `UPDATE users SET msft_cal_delta_link=null` |
| BF-3 | `cal-sync.controller.js` write phase | GCal 410 on PATCH: 410 is swallowed by catch but ledger row stays `active` → same PATCH attempted every sync forever | On 410 in write-phase PATCH catch: mark ledger row `deleted_remote` |
| BF-4 | `gcal.adapter.js:listEvents` | Cancelled GCal recurring instances (`status:'cancelled'`) pass through normalizer with empty summary/startDateTime → phantom tasks created or spurious ledger updates | Filter `event.status === 'cancelled'` in `listEvents` before returning |
| BF-5 | `apple-cal-api.js:parseVEvents` | Floating-time DTSTART (TZID=America/New_York, no Z): `new Date('2026-05-15T10:00:00')` interpreted as local time; on UTC prod server = UTC 10:00 → wrong local time by UTC offset | Use `ical.js` timezone-aware conversion to produce UTC string with Z suffix when TZID present |
| BF-6 | `apple-cal-api.js:parseVEvents` | Multi-VEVENT ICS (master + detached override): `eventsById[url]` silently overwritten by second VEVENT; first event lost | Return all VEVENTs per ICS object; downstream `eventsById` must handle multiple events per URL |
| BF-7 | `cal-sync.controller.js` conflict check | Task deleted during sync: `freshById[tu.id] === undefined` → outer `if (origTask && freshById[tu.id])` is falsy → conflict silently skipped → write proceeds against deleted row | Handle `!freshById[tu.id]` explicitly: add to `conflictSkipIds` |
| BF-8 | `msft-cal-api.js:listEvents` | `$select` missing `type`, `seriesMasterId`, `isCancelled`, `sensitivity`, `responseStatus` → normalizer cannot distinguish occurrence/series/cancelled events | Add fields to `$select` string; update `normalizeEvent` to expose them |
| BF-9 | `apple-cal-api.js:checkForChanges` | CTag URL trailing-slash mismatch: `calendars.find(c => c.url === calendarUrl)` fails when stored URL and server URL differ by trailing slash → `cal` is `undefined` → returns `hasChanges:true` on every poll | Normalize both URLs (strip trailing slash) before comparison |

---

## Architecture

### Approach: Hybrid (mock for error paths, live for round-trips, pure unit for parsers)

- **Adapter tests 01/02/03**: Keep as live integration (unchanged). New adapter edge-case files (04/05/06) are mock-based — error paths cannot be reliably triggered live.
- **Sync integration tests 21/22/23**: Mock the API layer (jest.spyOn on gcalApi, msftCalApi, appleCalApi). Real juggler_test DB — same pattern as existing suite.
- **Parser unit tests**: No DB, no network. Pure functions only.

### Pattern: mock API, real DB

All `tests/cal-sync/2x-*.test.js` files follow this pattern:
```javascript
// Setup
beforeEach(async () => {
  await seedTestUser();           // creates user with real tokens from .env.test
  jest.spyOn(gcalApi, 'patchEvent').mockRejectedValue(new Error('Calendar API error 410: ...'));
});

// Assertion
expect(await db('cal_sync_ledger').where({ task_id: taskId }).first())
  .toMatchObject({ status: 'deleted_remote' });
```

---

## New Files

### `tests/cal-sync/04-adapter-gcal-edge.test.js` (~20 tests)

**Approach:** mock gcalApi; no live credentials needed.

Tests:
- `normalizeEvent` — cancelled event (`status:'cancelled'`) filtered before returning from `listEvents`
- `normalizeEvent` — cancelled event with no summary doesn't crash (returns `undefined`, not `'(No title)'` task)
- `buildErrorDetail` — 403 with `forbiddenForNonOrganizer` reason: `retryable: false`, does NOT clear refresh token
- `buildErrorDetail` — 403 with `rateLimitExceeded` reason: `retryable: true`
- `batchCreateEvents` — batch sub-response 429: classified as retryable, not permanent error
- `calendarFetch` — 503 with `Retry-After: 60` header: retried with capped delay (≤30s), throws after maxRetries
- `hasChanges` — 410 (expired sync token): returns `{ hasChanges: true, tokenInvalid: true }`, no 500
- `listEvents` pagination error on page 3: `gcal_sync_token` in DB unchanged (pre-error value preserved)
- `buildEventBody` — `colorId` absent from output (PATCH semantics preserve existing color; confirmed intentional)
- `buildEventBody` — `visibility` absent from output (confirmed intentional)
- `buildEventBody` — `attendees` absent from output (PATCH semantics preserve guests)
- Allday event pull-side: `isAllDay=true`, `start.date='2026-06-15'` → `date:'2026-06-15'` regardless of timezone
- Allday round-trip: push allday → read back via `normalizeEvent` → same date

**Live tests (require credentials):**
- Cancelled instance in real GCal list does not appear in `listEvents` result

### `tests/cal-sync/05-adapter-msft-edge.test.js` (~25 tests)

**Approach:** mock msftCalApi + DB.

Tests:
- `hasChanges` — 410 `syncStateNotFound`: `msft_cal_delta_link` set to null in DB; returns `{ hasChanges: true }`
- `hasChanges` — after delta link cleared, next call uses null link (no delta path) and succeeds
- `listEvents` — after delta clear, `msft_cal_delta_link` re-populated from new delta link
- `normalizeEvent` — `type:'occurrence'` (native Outlook recurring): detected; not ingested as standalone task
- `normalizeEvent` — `type:'exception'` (moved occurrence): ingested with exception's actual time
- `normalizeEvent` — `type:'seriesMaster'` with no `start.dateTime`: does not crash; excluded from ingest
- Ingest — `isCancelled:true` event: skipped, no task created
- Ingest — `responseStatus.response:'declined'` event: skipped or marked declined; not pushed back
- `buildMsftEventBody` — `categories` absent from output (PATCH semantics; sending `[]` would erase Outlook colors)
- `buildMsftEventBody` — `isReminderOn` absent from output (intentional; Outlook uses its own default)
- `showAs:'tentative'` ingest: `isTransparent: false`; documented
- `showAs:'tentative'` round-trip: design assertion — push does NOT send `showAs` field (Outlook preserves tentative)
- Allday pull-side: `isAllDay:true`, UTC midnight → correct date in user tz (America/Los_Angeles)
- Allday multi-day: start date extracted correctly when end = 3 days later
- Batch sub-response 429: classified retryable, not permanent failure
- `graphFetch` — 503 with `Retry-After: 60`: retried with capped delay; throws after maxRetries
- `getValidAccessToken` — expired token: refreshed, new token written to DB, API call proceeds
- Token clearing — `AADSTS70008 invalid_grant`: `msft_cal_refresh_token` nulled in DB
- `$select` — `type`, `seriesMasterId`, `isCancelled`, `sensitivity` present in list request (after BF-8)
- 404 on event push: ledger `deleted_remote`; task not immediately deleted
- 404 on delete attempt: 404 swallowed; ledger cleaned up normally

### `tests/cal-sync/06-adapter-apple-edge.test.js` (~18 tests)

**Approach:** mock tsdav client; some live with Apple credentials.

Tests:
- Auth 401 → Apple creds cleared: `apple_cal_password` null in DB; stats has `tokenExpired:true` (after BF-1)
- Auth 401 → other providers (GCal, MSFT) continue syncing (Apple excluded from `validAdapters`)
- CTag URL trailing-slash mismatch: `checkForChanges` returns `hasChanges:true` when URL differs by trailing slash (regression — current behavior; then add fix + assert false)
- `listEvents` — null-data object in REPORT response: silently skipped (regression for `obj.data == null` guard)
- `listEvents` — malformed ICS in REPORT: skipped via try/catch, valid events returned
- `deleteEvent` 507: throws `CalDAV DELETE failed: HTTP 507`
- `deleteEvent` 404: does not throw (event already gone)
- `updateEvent` 412 → fetch returns object with no `.etag` field: retries with `undefined` etag, does not loop
- CDN grace: event missing after push within 120s → miss_count NOT incremented
- CDN grace: event missing after push after 130s → miss_count incremented
- `listEvents` — `expand:true` used in PROPFIND (verify tsdav call includes expand param)

**Live tests (require Apple credentials):**
- Push event → pull back → title/date/time match (round-trip regression)
- 401 on real CalDAV call produces correct error shape

### `tests/cal-sync/21-sync-auth-errors.test.js` (~15 tests)

**Approach:** mock API layers, real DB. All providers.

Tests:
- `invalid_grant` (GCal refresh token revoked): `gcal_refresh_token` null, `gcal_access_token` null, stats has `tokenExpired:true`
- `invalid_grant` (GCal): other providers (MSFT, Apple) continue syncing
- `invalid_grant` (MSFT): `msft_cal_refresh_token` null; other providers continue
- Apple 401: `apple_cal_password` null; `apple_cal_username` unchanged (username not cleared, only password)
- Mid-sync GCal 401 (access token expired after fetch): per-item error logged, lock released, DB access token not cleared (documents current behavior — real bug TC-1.1; test asserts what SHOULD happen after fix)
- Concurrent token refresh: `refreshAccessToken` called exactly once even when two parallel sync calls both see expired token
- Token refresh succeeds but new token immediately invalid (401 on first API call): tokens cleared, user prompted to reconnect
- MSFT `AADSTS50055` (account disabled): treated as permanent auth failure even when error string doesn't contain standard keywords → test drives regex improvement
- GCal scope reduced (403 `insufficientPermissions`): `retryable:false`, refresh token NOT cleared
- GCal auth error stats response: HTTP 200, body contains `{ gcal: { tokenExpired: true, action: 'Please reconnect...' } }`

### `tests/cal-sync/22-sync-error-paths.test.js` (~20 tests)

**Approach:** mock API layers, real DB.

Tests:
- 5/10 events pushed to GCal; API errors on items 5-9: ledger has 5 active rows + 5 error rows; no corruption
- Write-phase DB transaction rollback after successful API push: GCal events exist but ledger is empty; next sync orphan-cleanup detects and deletes them
- Pull succeeds; ledger INSERT IGNORE drops one row (duplicate conflict): task exists without ledger → next sync pushes it back (not silent data loss)
- GCal batch endpoint total failure → sequential fallback fires: partial success committed correctly
- `batchCreateEvents` sub-response 429: that item retried or returned as retryable; other items committed normally
- GCal 410 on PATCH: ledger `deleted_remote` after write (after BF-3)
- GCal 404 on PATCH: ledger `deleted_remote` (task gone externally)
- MSFT 503 on `listEvents`: sync aborts cleanly; existing ledger not corrupted; lock released
- `sync_history` write failure: full transaction rollback; HTTP 500; lock still released (via `finally`)
- Apple 507 on push: error ledger row; retryable flag; sync continues for other tasks
- GCal push: `forbiddenForNonOrganizer` 403 for one task → per-task error, other tasks committed normally (after BF-4 fix in error classification)
- MSFT batch: all sub-responses 503 → full retry; no partial state committed to ledger

### `tests/cal-sync/23-sync-consistency.test.js` (~12 tests)

**Approach:** mock API layers, real DB.

Tests:
- Task deleted during sync API phase: conflict check detects `freshById[id] === undefined` → skip write (after BF-7)
- Task deleted during sync: ledger insert for that task also skipped (no orphan ledger row)
- Two simultaneous syncs, same user: second gets 409 after all retries; first commits correctly; no ledger corruption
- Two simultaneous syncs: if both acquire lock at different times, second set of writes is idempotent (INSERT IGNORE prevents duplication)
- Task edited during push (watermark conflict): `gcal_event_id` NOT written; ledger insert preserved; self-heals on next sync
- Lock lost mid-write-phase (lock row deleted externally): `writePhaseLockLost` detected; write phase aborts
- Stale lock (TTL expired): next `acquireLock` clears expired row; sync proceeds
- Lock heartbeat stops (simulated): `lockLost` flag set; heartbeat timer cleared
- `sync_locks` sweep: expired rows removed by sweep timer

### `tests/apple-cal-parse.test.js` (~15 tests)

**Approach:** pure unit, no DB/network.

Tests:
- `parseVEvents` — multi-VEVENT ICS: both VEVENTs returned (not just last)
- `parseVEvents` — multi-VEVENT: both share same `_url` and `_etag`
- `parseVEvents` — VALARM: preserved in `_raw`, not extracted to named field
- `buildVEvent` — no VALARM in output (documents intentional strip; regression guard)
- `parseVEvents` — RRULE: not extracted to named field; preserved in `_raw`; single VEVENT returned (expand=true delegates to server)
- `parseVEvents` — EXDATE: not extracted; preserved in `_raw`
- `parseVEvents` — X-APPLE-STRUCTURED-LOCATION: does not crash; not extracted
- `parseVEvents` — X-APPLE-TRAVEL-START VEVENT: check if filtered or ingested
- `listEvents` — `obj.data === null`: skipped (regression for null-data guard)
- `parseVEvents` — malformed ICS: caught, skipped, no throw
- `buildVEvent` — emoji in title: valid ICS; round-trips through `ICAL.parse` correctly
- `parseVEvents` — accented chars in SUMMARY: `title` matches original
- `parseVEvents` — floating time with TZID (no Z): `startDateTime` has Z suffix on output (after BF-5)
- `parseVEvents` — UTC time (with Z): `startDateTime` unchanged (no double-conversion)
- `parseVEvents` — date-only DTSTART (all-day): `isAllDay:true`, no time field

### `tests/cal-sync-helpers-tz.test.js` (~8 tests)

**Approach:** pure unit.

Tests:
- `isoToJugglerDate` — UTC string (`2026-05-15T14:00:00Z`), user tz `America/New_York`: `time:'10:00 AM'`, `date:'2026-05-15'`
- `isoToJugglerDate` — floating time after BF-5 fix (now has Z): same result regardless of server timezone
- `isoToJugglerDate` — allday `date`-only string: `isAllDay:true`, correct date, no time shift
- `localToUtc` — DST spring-forward (2:00 AM on changeover day): deterministic result, no NaN, no throw
- `jugglerDateToISO` — UTC+12 allday event: date string unchanged (no off-by-one)
- `jugglerDateToISO` — UTC-12 allday event: date string unchanged
- `computeDurationMinutes` — event spanning DST boundary: correct duration (not off by 60)
- `isoToJugglerDate` — time at midnight UTC in timezone behind UTC: date is correct (no off-by-one)

### `tests/apple-cal-cdn-grace.test.js` (~5 tests)

**Approach:** pure unit.

Tests:
- `withinCdnGrace` — `last_pushed_at: null` → `false`
- `withinCdnGrace` — pushed 60s ago, provider `'apple'` → `true` (within 120s)
- `withinCdnGrace` — pushed 130s ago, provider `'apple'` → `false` (past grace)
- `withinCdnGrace` — pushed 60s ago, provider `'gcal'` → `false` (no grace for GCal)
- `withinCdnGrace` — pushed 60s ago, provider `'msft'` → `false` (no grace for MSFT)

---

## Execution Order

1. **Apply BF-1 through BF-7** (bug fixes) — commit each individually
2. **Create unit test files** (no DB dependency): `apple-cal-parse.test.js`, `cal-sync-helpers-tz.test.js`, `apple-cal-cdn-grace.test.js`
3. **Create adapter edge-case files**: `04-adapter-gcal-edge.test.js`, `05-adapter-msft-edge.test.js`, `06-adapter-apple-edge.test.js`
4. **Create integration test files**: `21-sync-auth-errors.test.js`, `22-sync-error-paths.test.js`, `23-sync-consistency.test.js`
5. **Run full suite** — verify 306 pass, 0 skip

---

## Success Criteria

- All 7 bugs fixed (tests confirm the fix)
- All ~138 new tests pass
- No existing tests broken
- `npm run lint && npm test` clean
- Test names read as spec — someone reading the test output understands what the system guarantees

---

## Out of Scope

- MSFT Teams meeting data preservation (P3, design decision not yet made)
- MSFT shared/delegated calendars (requires additional test credentials)
- GCal push notification webhooks (feature not yet implemented)
- MSFT delta link re-seeding after full sync (architectural gap requiring larger refactor; tracked separately)
- Apple shard migration redirect (tsdav handles correctly; P3 performance only)
