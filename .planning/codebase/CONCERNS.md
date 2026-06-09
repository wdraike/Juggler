# Codebase Concerns

**Analysis Date:** 2026-05-14

---

## Tech Debt

**God-object controllers:**
- Issue: `task.controller.js` (2,306 lines) and `cal-sync.controller.js` (2,410 lines) handle far too many concerns — routing, business logic, DB access, and sync state. `runSchedule.js` (2,079 lines) and `unifiedScheduleV2.js` (1,580 lines) are similarly large. These are among the highest-risk files in the codebase.
- Files: `juggler-backend/src/controllers/task.controller.js`, `juggler-backend/src/controllers/cal-sync.controller.js`, `juggler-backend/src/scheduler/runSchedule.js`, `juggler-backend/src/scheduler/unifiedScheduleV2.js`
- Impact: Any change to these files has broad blast radius. Hard to unit test. Hard to reason about all code paths.
- Fix approach: Extract narrow sub-controllers or service objects. No single file should exceed ~500 lines.

**Large god components in frontend:**
- Issue: `TaskEditForm.jsx` (118 KB), `SettingsPanel.jsx` (88 KB), `AppLayout.jsx` (72 KB), `DailyView.jsx` (62 KB), `CalSyncPanel.jsx` (59 KB). These components carry enormous amounts of logic with no decomposition.
- Files: `juggler-frontend/src/components/tasks/TaskEditForm.jsx`, `juggler-frontend/src/components/settings/SettingsPanel.jsx`, `juggler-frontend/src/components/layout/AppLayout.jsx`, `juggler-frontend/src/components/views/DailyView.jsx`, `juggler-frontend/src/components/features/CalSyncPanel.jsx`
- Impact: Slow re-renders, merge conflicts, difficult testing.
- Fix approach: Extract sub-forms, sub-panels, and hooks. Each logical section of the task edit form should be its own component.

**`scheduleQueue` in-memory dirty set breaks under multi-instance:**
- Issue: `scheduleQueue.js` uses an in-process `dirty = {}` object to track which users have pending scheduler runs. Under two Cloud Run instances, enqueue on instance A does not mark the user dirty on instance B, so instance B's poll loop never fires for that user.
- Files: `juggler-backend/src/scheduler/scheduleQueue.js` (lines 48–49, 57–58, 214)
- Impact: Silent miss — scheduler does not run on the instance that received the queue row's dirty signal. Recovered on next startup scan, but latency is unbounded.
- Fix approach: Remove the in-memory dirty set. Convert the poll loop to a DB-only query (`SELECT DISTINCT user_id FROM schedule_queue WHERE created_at < NOW() - INTERVAL X SECOND`), or use Redis pub/sub to fan out dirty signals.

**Rate limiters use default in-memory store:**
- Issue: All `express-rate-limit` instances in `app.js` (lines 110–126) use the default `MemoryStore`. Under multiple Cloud Run instances, each instance tracks its own counters — a user can make `max * N` requests per window across N instances.
- Files: `juggler-backend/src/app.js` (lines 110–126)
- Impact: Rate limits provide no protection in a multi-instance deployment.
- Fix approach: Swap to `rate-limit-redis` store backed by the existing Redis client (`juggler-backend/src/lib/redis.js`).

**`timesPerCycle` work-budget awareness — held design:**
- Issue: `timesPerCycle` is occurrence-count-based, not work-budget-based. No slot suppression when `sum(time_remaining) < session_dur`. Held for UX review (JUG-HOLD-01 — `.planning/ROADMAP.md` `## Backlog` 999.013).
- Files: `juggler-backend/shared/scheduler/expandRecurring.js`, `juggler-backend/src/scheduler/runSchedule.js` (line 489)
- Impact: Recurring tasks with very low `time_remaining` still consume schedule slots unnecessarily.
- Fix approach: Design decision needed before implementation; see JUG-HOLD-01 (`.planning/ROADMAP.md` `## Backlog` 999.013).

**Recurring toggle bug (root cause identified, not fixed):**
- Issue: Three root causes remain unresolved for the recurring-toggle-off path: (1) ledger not cleaned when recurring=false is set, (2) done instances not archived before deletion, (3) fast-path skips cleanup entirely (`task.controller.js` line 892: "recurring=false must clean up instances — fast path skips that entirely"). Described in memory handoff `archive/handoffs/2026-05/handoff_recurring_toggle_fix.md`.
- Files: `juggler-backend/src/controllers/task.controller.js` (5 locations near lines 892, 1184–1187)
- Impact: Orphaned ledger rows, stale sync state, potential duplicate events on re-enabling.
- Fix approach: See handoff doc for the three specific RCs and their fix locations.

**102 deferred code-review audit findings:**
- Issue: A machine-generated code review produced 102 deferred findings. They are not yet individually addressed. Categories include 8 collation-drift tables (High), 7 missing FK constraints (High), 1 destructive cascade risk (High), 2 security findings (High), 18 missing indexes (Medium), 7 perf items (Medium), 9 dead-code rollups (Low), 4 dead-UI rollups (Low).
- Files: Captured as JUG-DBAUDIT-01 in `.planning/ROADMAP.md` `## Backlog` (999.293) — the surviving aggregate is the "Schema / DB Issues" § below. (The former `BACKLOG.md` deferred-findings table and the per-finding `.planning/todos/pending/juggler-{db,deadcode,perf,deadui,security}-*` files were removed when per-service BACKLOG.md was retired.)
- Impact: DB integrity gaps, silent join failures, performance degradation at scale, maintenance burden.
- Fix approach: Triage High items first (collation drift, missing FKs, cascade risk, security). Schedule medium/low in batches.

---

## Known Bugs

**Apple CalDAV `last_modified` not extracted on sync ingest:**
- Symptoms: Apple ingest path drops `LAST-MODIFIED` from the CalDAV WebDAV response layer (not from the iCal VEVENT body). Change-detection downstream uses a `null` `lastModified` for Apple events, causing spurious re-syncs.
- Files: `juggler-backend/src/lib/apple-cal-api.js` (line 60 — `fetchCalendarObjects` call does not request `getlastmodified` DAV prop), `juggler-backend/src/lib/cal-adapters/apple.adapter.js` (line 165 — falls through to `event.lastModified || null`)
- Trigger: Any Apple CalDAV sync ingest run.
- Workaround: None. Tracked as BACKLOG JUG-HIGH-01.

**Calendar views drop skipped/done tasks from past dates:**
- Symptoms: Calendar UI filter omits tasks with `status='skipped'` or `status='done'` when the task date is in the past, making it impossible to review historical completions in calendar view.
- Files: `juggler-frontend/src/components/views/CalendarView.jsx`, `juggler-frontend/src/components/views/DailyView.jsx`
- Trigger: Navigate to any past date in calendar view.
- Workaround: Use ListView with date range filter (shows past done tasks).
- Tracked as BACKLOG JUG-HIGH-03.

**Apple sync soak tests B2/B3/B4 and C1/C2/C4 incomplete:**
- Symptoms: Six Apple CalDAV soak test scenarios remain unverified in production conditions — B2 (time update CDN lag), B3 (multi-provider MISS_THRESHOLD interference deletes task from wrong provider), B4 (rename via CalDAV), C1/C2/C4 (various ingest scenarios). B3 is a confirmed logic issue.
- Files: `juggler-backend/src/controllers/cal-sync.controller.js` (MISS_THRESHOLD logic for multi-provider isolation), `juggler-backend/docs/SYNC-SOAK-TEST-APPLE.md`
- Trigger: Multi-provider sync (Apple + GCal or Apple + MSFT active simultaneously).
- Workaround: None. Bug #4 (MISS_THRESHOLD interference) is documented as "by design" but B3 shows it causes incorrect deletions.

**Weather controller leaks error messages in 500 responses:**
- Symptoms: Open-Meteo and Nominatim error messages are echoed to the client (`res.status(500).json({ error: err.message })`). This is inconsistent with the production error-sanitization middleware applied to other controllers.
- Files: `juggler-backend/src/controllers/weather.controller.js` (lines 112, 184, 209, 239)
- Trigger: Any weather fetch failure (network error, API quota exceeded, geocoding failure).
- Workaround: None — production sanitization middleware in `app.js` only strips `body.message` not `body.error`.

---

## Security Considerations

**JWT exposed in server access logs for SSE endpoint:**
- Risk: `GET /api/events?token=<jwt>` is the SSE endpoint. Morgan is configured to suppress logging of this route (app.js line 89–92), but any reverse proxy, CDN, or load balancer access log that does not apply the same filter will log the JWT in plaintext in the URL. Cloud Run logs the raw request URL.
- Files: `juggler-backend/src/app.js` (lines 86–92, 154–160)
- Current mitigation: Morgan suppresses dev logs for this route only.
- Recommendation: Upgrade the SSE transport to use a short-lived opaque token (issue a one-time token via `/api/events/token`, exchange it for the JWT on first connection) so the JWT never appears in the URL.

**`/api/feature-catalog` and `/api/feature-events` lack dedicated rate limits:**
- Risk: These service-key-protected endpoints only get the global `apiLimiter` (1,000/min per IP, applied via app-level middleware). Per the security audit doc (JF-R1), they need per-endpoint limits to prevent brute-force on the service key.
- Files: `juggler-backend/src/app.js` (lines 205–206)
- Current mitigation: Global `apiLimiter` provides a floor; timing-safe compare added for service key (JF1).
- Recommendation: Apply a low-volume limiter (e.g., 60/min) to these endpoints as described in JF-R1.

**Billing webhook signing signs `JSON.stringify(req.body)` not raw bytes (known issue JF-I1):**
- Risk: The HMAC signs the JS re-serialized body, not the original wire bytes. Works only because payment-service uses the same `JSON.stringify` round-trip. Any key-ordering divergence breaks the signature silently.
- Files: `juggler-backend/src/routes/billing-webhooks.routes.js` (line 31), `juggler-backend/src/app.js` (lines 70–81 show `req.rawBody` IS captured but the verifier uses it correctly per latest code — verify this is resolved or still using JSON.stringify)
- Current mitigation: JF8 replay protection added; raw body captured in middleware. Verify the route uses `rawBody` not `JSON.stringify(body)`.
- Recommendation: Confirm routes use `req.rawBody` throughout; document as resolved if so.

**`/api/feature-catalog` and `/api/feature-events` no dedicated rate limit (JF-R1 not yet fixed):**
- Risk: Service-key endpoints have no targeted rate limit. Only global 1000/min IP floor applies.
- Files: `juggler-backend/src/app.js` (lines 205–206)
- Recommendation: Add `serviceLimiter = rateLimit({ max: 60 })` matching JF-R1 in the security audit.

**No Zod schema validation on REST write routes (JF-R3 not yet fixed):**
- Risk: Manual validation in controllers is inconsistent. The top-10 write endpoints (`POST /api/tasks`, batch CRUD, config updates) rely on ad-hoc checks rather than validated schemas.
- Files: `juggler-backend/src/controllers/task.controller.js`, `juggler-backend/src/schemas/task.schema.js` (Zod only used in MCP tools currently)
- Recommendation: Apply Zod schemas to REST write routes as described in JF-R3.

---

## Performance Bottlenecks

**`cal-sync.controller.js` runs as a single large sequential function:**
- Problem: The main sync path is a 2,410-line function that runs sequentially across all providers. Each Apple CalDAV push is a separate HTTP call with no batching.
- Files: `juggler-backend/src/controllers/cal-sync.controller.js`
- Cause: Apple CalDAV has no batch API. Google and MSFT use batch where possible, but the controller structure does not isolate per-provider paths.
- Improvement path: Profile per-provider time in production before optimizing. Apple sequential push is architecturally constrained.

**Weather cache is location-grid-based (shared) but Nominatim reverse geocode is uncached:**
- Problem: Each "Locate me" click from any user triggers a live Nominatim reverse geocode request with no caching. Nominatim has usage policy rate limits and is a single point of external dependency.
- Files: `juggler-backend/src/controllers/weather.controller.js` (lines 213–224)
- Cause: Reverse geocode considered low-frequency; no caching added.
- Improvement path: Cache reverse geocode results in `weather_cache` or Redis keyed on rounded lat/lon (same grid as forecast).

**`scheduleQueue` poll loop fires every 1 second per instance:**
- Problem: The poll loop fires every 1000ms regardless of whether any work exists. Under multi-instance deployment this becomes N requests/second against the DB.
- Files: `juggler-backend/src/scheduler/scheduleQueue.js` (line 46 `POLL_MS = 1000`)
- Cause: Designed for single-instance; polling is the simplest debounce mechanism.
- Improvement path: Increase `POLL_MS` to 2–5s, or switch to Redis-based pub/sub notification instead of polling.

**`tasks_v` DB view used by cron for full-table scan:**
- Problem: `cal-history-cron.js` queries `tasks_v` (a view) with `WHERE user_id % SHARD_COUNT = shard` and no date filter on the missed-mark pass. This scans all pending recurring instances across all users for the shard.
- Files: `juggler-backend/src/cron/cal-history-cron.js` (lines 38–43)
- Cause: Shard-based partitioning is correct but the view query may not use indexes efficiently.
- Improvement path: Add a date-range predicate (e.g., `scheduled_at < NOW() - INTERVAL 1 HOUR`) to filter the scan. Verify EXPLAIN output on `tasks_v` for the `user_id % N` predicate.

---

## Fragile Areas

**Scheduler (`runSchedule.js`, `unifiedScheduleV2.js`):**
- Files: `juggler-backend/src/scheduler/runSchedule.js`, `juggler-backend/src/scheduler/unifiedScheduleV2.js`
- Why fragile: The scheduler is a 3,600-line combined system with complex state (prefix-sum capacity arrays, cross-cycle spacing guards, split-chunk merging, dependency topological sort). CLAUDE.md warns: "Scheduler bugs cascade and corrupt all task data. Test exhaustively before deploying any scheduler change."
- Safe modification: Run the full scheduler test suite (`runScheduleIntegration.test.js`, `schedulerRules.test.js`, `schedulerDeepCoverage.test.js`, `schedulerScenarios.test.js`) before and after any change. Never modify the constraint evaluation order (most→least constrained is invariant).
- Test coverage: 12+ scheduler-specific test files covering integration, rules, time simulation, and supply/demand scenarios.

**Calendar sync controller:**
- Files: `juggler-backend/src/controllers/cal-sync.controller.js`
- Why fragile: 2,410 lines of multi-provider sync logic with many edge cases (CDN grace windows, orphan detection, conflict resolution, MISS_THRESHOLD, recurring instance ID healing). Provider-specific code paths are interleaved, not isolated.
- Safe modification: Change one provider path at a time. Run `tests/cal-sync/` suite. Always check the sync audit endpoint (`/api/cal-sync/audit`) after changes to verify ledger consistency.
- Test coverage: 14 cal-sync test files covering push, pull, deletion, conflict, split tasks, recurring, ingest, multi-provider, and locking.

**Auth client vendored copy (sync risk):**
- Files: `juggler-backend/package.json` (`auth-client: file:../../auth-service/shared`), `juggler/auth-client/` (gitignored vendor copy, synced by deploy scripts)
- Why fragile: `auth-client.js` is gitignored in juggler. Changes to the shared `auth-service/shared/auth-client.js` must be manually synced via deploy script. If the sync is skipped, juggler runs stale auth logic with no error.
- Safe modification: After any auth-service shared change, run the deploy sync step and verify `auth-client/auth-client.js` matches the source.

**sync_history and cal_sync_ledger collation drift:**
- Files: `juggler-backend/src/db/migrations/20260509000500_widen_sync_history_action.js` (line 16–17), `juggler-backend/src/db/migrations/20260509001000_widen_last_modified_at_precision.js` (line 17–18)
- Why fragile: Both `sync_history.user_id` and `cal_sync_ledger.user_id` remain on `utf8mb4_0900_ai_ci` while `users.id` uses `utf8mb4_unicode_ci`. This collation mismatch silently breaks JOIN queries in MySQL 8 strict mode. Noted as known in migration comments but not yet fixed.
- Safe modification: Any query joining these tables to `users` must explicitly use `COLLATE utf8mb4_unicode_ci` or avoid the join. The fix is `ALTER TABLE ... CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` (same pattern as `20260508000100_fix_core_tables_collation.js`).

---

## Scaling Limits

**SSE fan-out now Redis-backed but requires Redis in production:**
- Current capacity: The SSE emitter (`juggler-backend/src/lib/sse-emitter.js`) uses Redis pub/sub for multi-instance fan-out with a local fallback for Redis-unavailable cases.
- Limit: If `REDIS_URL` is not set in production Cloud Run env vars, the SSE emitter silently degrades to local-only emit. Under two instances, SSE events are delivered to only the instance that handled the mutation.
- Scaling path: Ensure `REDIS_URL` is set in all Cloud Run service configurations. Add a startup health check that confirms Redis connectivity.

**`scheduleQueue.js` in-memory dirty set — not multi-instance safe:**
- Current capacity: Works correctly for a single Cloud Run instance.
- Limit: Under two instances, the dirty set is not shared. A queue row inserted on instance A is not acted upon by instance B until B's startup scan or its next DB-based discovery. There is no time guarantee.
- Scaling path: See Tech Debt section above (remove dirty set, use DB-only poll or Redis notification).

---

## Dependencies at Risk

**`express-rate-limit` uses in-memory MemoryStore:**
- Risk: Default store is process-local. Under multi-instance deployment, rate limits are per-instance.
- Impact: Rate limiting ineffective at scale.
- Migration plan: Add `rate-limit-redis` and configure all limiters to use the existing Redis client.

**`tsdav` for Apple CalDAV:**
- Risk: `tsdav` is the only dependency for Apple CalDAV. It is a community library with limited maintainership. The Apple-specific error surface (CDN lag, rate limiting, authentication edge cases) is handled in the app layer, not the library.
- Impact: Breaking changes in `tsdav` would require significant adapter rewrite.
- Migration plan: Pin the version; vendor if necessary. The Apple adapter (`juggler-backend/src/lib/cal-adapters/apple.adapter.js`) already isolates the tsdav surface.

---

## Missing Critical Features

**Multi-server readiness — audit not yet executed:**
- Problem: BACKLOG JUG-HIGH-04 tracks a comprehensive multi-server audit. The audit phase plan exists at `.planning/phases/multi-server-readiness-audit-validate-all-code-for-safe-hori/PLAN.md` but has `status: planned` and has not been executed.
- Blocks: Safe horizontal scale-out of the backend. Known risks: scheduleQueue dirty set (noted above), rate limiter store, and any remaining in-process singletons not yet discovered.

**Pollen count in weather integration:**
- Problem: Open-Meteo Air Quality API supports grass/tree/weed pollen indexes but they are not fetched. No pollen condition filter on tasks.
- Blocks: Users with pollen-sensitive outdoor tasks cannot schedule around pollen conditions.

**Browser-side weather fetch relay:**
- Problem: Every user with a unique location triggers a separate server-side Open-Meteo API call. High user volume at different locations could exhaust the Open-Meteo free tier or cause throttling on the shared server IP.
- Blocks: Scale; noted in Issues.txt as future work.

---

## Test Coverage Gaps

**No frontend unit tests for business-logic hooks:**
- What's not tested: `juggler-frontend/src/hooks/useTaskState.js` (22 KB), `juggler-frontend/src/hooks/useConfig.js` (14 KB), `juggler-frontend/src/hooks/useDragDrop.js`. Only 4 frontend test files exist total (`weatherMatch.test.js`, `taskIcon.test.js`, `impersonationService.test.js`, `constants.test.js`).
- Files: `juggler-frontend/src/hooks/useTaskState.js`, `juggler-frontend/src/hooks/useConfig.js`
- Risk: Bug regressions in core task state management go undetected without Playwright tests.
- Priority: High.

**No controller-level tests for `cal-sync.controller.js`:**
- What's not tested: The cal-sync controller itself is only covered by `tests/cal-sync/` integration tests which mock external API calls. The internal branch logic (orphan matching, ordinal healing, CDN grace window evaluation) has no unit test coverage.
- Files: `juggler-backend/src/controllers/cal-sync.controller.js`
- Risk: Silent regression in sync logic without full integration test harness running.
- Priority: High.

**No tests for weather controller:**
- What's not tested: `juggler-backend/src/controllers/weather.controller.js` — cache hit/miss logic, ingest endpoint, geocode/reverse-geocode paths.
- Files: `juggler-backend/src/controllers/weather.controller.js`
- Risk: Weather cache invalidation or API error handling regressions go undetected.
- Priority: Medium.

**Apple soak test scenarios B2/B3/B4 and C1/C2/C4 never fully verified:**
- What's not tested: Six Apple CalDAV soak scenarios that require multi-provider isolation and CDN-lag timing. The automated tests in `tests/cal-sync/03-adapter-apple.test.js` mock the CalDAV network layer and cannot reproduce real Apple CDN propagation delays.
- Files: `juggler-backend/docs/SYNC-SOAK-TEST-APPLE.md`
- Risk: Multi-provider MISS_THRESHOLD interference (Bug #4) can silently delete tasks via the wrong provider.
- Priority: High — requires live Apple CalDAV account for verification.

---

## Schema / DB Issues (Aggregate)

The 102-item audit produced the following unresolved DB issues by category (canonical record is now JUG-DBAUDIT-01 in `.planning/ROADMAP.md` `## Backlog` 999.293; the per-finding `.planning/todos/pending/` files were removed with per-service BACKLOG.md):

| Category | Count | Priority | Notes |
|----------|-------|----------|-------|
| Dead-by-date drift columns | 20 | Medium | Columns where `dead_by` date has passed — likely removable |
| Missing indexes | 18 | Medium | FK columns without covering indexes; affects JOIN performance |
| Collation drift | 8 | High | Tables on `utf8mb4_0900_ai_ci` breaking joins with `utf8mb4_unicode_ci` tables |
| Missing FK constraints | 7 | High | Orphan rows accumulate silently without FK enforcement |
| Duplicate indexes | 7 | Medium | Redundant index overhead |
| Unused indexes | 6 | Low | Write overhead with no read benefit |
| Timezone inconsistency | 5 | Medium | Mixed tz handling across tables |
| JSON schema gaps | 4 | Low | Unvalidated JSON blob columns |
| Type mismatches | 3 | Medium | Column type disagreements between related tables |
| Destructive cascade risk | 1 | High | A cascade that could delete more data than intended |

Known specific issues confirmed by code review:
- `cal_sync_ledger.calendar_id` is unpopulated everywhere — either populate or drop (`juggler-backend/docs/SCHEMA.md` line 383).
- `task_masters.section` is dead in the edit UI — populated only by import/export text parser (`juggler-frontend/src/components/features/ImportExportPanel.jsx`).
- `sync_history.user_id` and `cal_sync_ledger.user_id` remain on `utf8mb4_0900_ai_ci` — known, documented in migration comments but unfixed.

---

*Concerns audit: 2026-05-14*
