# Juggler Deep Architecture Review — 2026-07-29

## Executive Summary

Juggler is mid-migration to hexagonal architecture via the `slices/` pattern. Five slices exist at varying completion levels. The migration is well-structured but incomplete — 3 of 5 slices are fully done, 2 are facade-only wrappers around legacy god objects. Significant security, scalability, dead-code, and efficiency issues remain.

**Overall compliance: ~40% hexagonal. ~60% legacy god-object code.**

---

## 1. Hexagonal Architecture Compliance

### 1.1 Fully Migrated Slices (DONE)

| Slice | Phase | Key Files |
|-------|-------|-----------|
| **task** | H3/W6 | `slices/task/facade.js` (thin controller 308 lines), 14 use-cases, ports, adapters |
| **weather** | W3 | `slices/weather/facade.js` (full slice), OpenMeteo, Nominatim, Knex cache |
| **user-config** | H4/W6 | `slices/user-config/facade.js` (20 use-cases), KnexConfigRepository, PaymentServiceEntitlementAdapter |
| **ai-enrichment** | H5 | `slices/ai-enrichment/facade.js` (Gemini adapter, usage repo) |

### 1.2 Partially Migrated Slices (FACADE ONLY)

| Slice | Phase | Problem |
|-------|-------|---------|
| **scheduler** | H6/W4 | Facade fronts legacy `runSchedule.js` (2,374 lines) and `unifiedScheduleV2.js` (2,560 lines). No domain extraction. |
| **calendar** | W4 | Facade re-exports legacy `cal-sync.controller.js` (2,554 lines). No domain extraction. |

### 1.3 Legacy God Objects (NOT COMPLIANT)

These files violate hexagonal isolation — they perform direct DB access, import other modules directly, and have no port/domain separation:

| File | Lines | Violations |
|------|-------|------------|
| `controllers/cal-sync.controller.js` | 2,554 | Direct `getDb()`, imports `task.controller`, `scheduleQueue`, `sync-lock` |
| `scheduler/runSchedule.js` | 2,374 | Direct `require('../db')`, imports `tasks-write`, `reconcile-splits` |
| `scheduler/unifiedScheduleV2.js` | 2,560 | Direct imports of `scoreSchedule`, `dateHelpers`, `timeBlockHelpers` |
| `scheduler/scheduleQueue.js` | 606 | Module-level singleton state (`dirty`, `running` maps), direct DB access |
| `controllers/apple-cal.controller.js` | 470 | Direct DB access, no facade delegation |
| `controllers/msft-cal.controller.js` | 243 | Direct DB access, no facade delegation |
| `controllers/gcal.controller.js` | 177 | Direct DB access, no facade delegation |
| `controllers/billing-webhooks.controller.js` | 187 | Direct DB access, no facade delegation |
| `controllers/feature-catalog.controller.js` | 219 | Direct DB access, no facade delegation |
| `controllers/impersonation.controller.js` | ~100 | Should delegate to user-config facade |
| `controllers/ai.controller.js` | 154 | Should delegate to ai-enrichment facade |
| `controllers/weather.controller.js` | 144 | Should be thin delegating to weather facade |
| `controllers/data.controller.js` | 113 | Should delegate to user-config facade |
| `controllers/config.controller.js` | 190 | Should be thin but has residual logic |

### 1.4 Infrastructure Modules (NO PORT ABSTRACTION)

These modules are used by both legacy and slice code but have no port/interface:

| Module | Purpose | Risk |
|--------|---------|------|
| `lib/tasks-write.js` | Canonical DB write path | Used by both legacy and slice code |
| `lib/sync-lock.js` | Per-user DB lock | Module-level singleton |
| `lib/task-write-queue.js` | Lock-contention queue | Module-level singleton state |
| `lib/sse-emitter.js` | Redis-backed SSE | Module-level singleton |
| `lib/redis.js` | Redis client | Module-level singleton |
| `lib/cal-adapters/` | Calendar provider adapters | Legacy pattern, calendar facade now owns registry |
| `lib/placementModes.js` | Shared constants | No port abstraction |
| `lib/task-status.js` | Shared constants | No port abstraction |
| `lib/rolling-anchor.js` | Rolling anchor logic | No port abstraction |
| `lib/reconcile-splits.js` | Split reconciliation | No port abstraction |
| `lib/credential-encrypt.js` | Crypto utility | No port abstraction |
| `lib/gcal-api.js` | Google Calendar API | No port abstraction |
| `lib/msft-cal-api.js` | Microsoft Calendar API | No port abstraction |
| `lib/apple-cal-api.js` | Apple CalDAV API | No port abstraction |
| `lib/csv-to-tasks.js` | CSV parsing | No port abstraction |
| `lib/tasks-csv.js` | CSV export | No port abstraction |
| `lib/push-service.js` | Push notifications | No port abstraction |
| `lib/push-subscriptions.js` | Push subscriptions | No port abstraction |
| `lib/notify-reminder.js` | Reminder notifications | No port abstraction |
| `lib/isAllDayTaskBackend.js` | Utility | No port abstraction |
| `lib/usage-reporter.js` | Usage reporting | No port abstraction |
| `lib/rate-limit-store.js` | Rate limit store | No port abstraction |
| `lib/jwt-secret.js` | JWT secret loading | No port abstraction |
| `lib/config/index.js` | Config loading | No port abstraction |
| `lib/logger/index.js` | Logger | No port abstraction |
| `lib/db/index.js` | DB singleton | No port abstraction |
| `lib/events/index.js` | Event bus | No port abstraction |
| `lib/events/taskEvents.js` | Task events | No port abstraction |
| `lib/events/taskEventLogger.js` | Task event logger | No port abstraction |
| `lib/cal-sync-helpers.js` | Cal sync helpers | No port abstraction |

### 1.5 Properly Ported Infrastructure

| Module | Status |
|--------|--------|
| `lib/cache/CachePort.js` | Properly ported — port + InMemory + Redis adapters |
| `lib/cache/index.js` | Properly ported — re-exports |

---

## 2. Security Review

### 2.1 HIGH: JWT in SSE URL Query Parameter

**File:** `app.js:274-280`
**Risk:** `GET /api/events?token=<jwt>` passes the JWT as a URL query parameter. Morgan suppresses logging for this route, but Cloud Run, CDN, and load balancer access logs will log the raw URL including the JWT.
**Current mitigation:** Morgan suppresses dev logs for this route only.
**Recommendation:** Upgrade SSE transport to use a short-lived opaque token (issue a one-time token via `/api/events/token`, exchange it for the JWT on first connection).

### 2.2 HIGH: Weather Controller Leaks Error Messages

**File:** `controllers/weather.controller.js` (lines 112, 184, 209, 239)
**Risk:** Open-Meteo and Nominatim error messages are echoed to the client (`res.status(500).json({ error: err.message })`). Inconsistent with production error-sanitization middleware.
**Recommendation:** Use the same sanitization middleware applied to other controllers.

### 2.3 MEDIUM: `/api/feature-catalog` and `/api/feature-events` Lack Dedicated Rate Limits

**File:** `app.js:325-326`
**Risk:** These service-key-protected endpoints only get the global `apiLimiter` (1,000/min per IP). Need per-endpoint limits to prevent brute-force on the service key.
**Recommendation:** Apply a low-volume limiter (e.g., 60/min) to these endpoints.

### 2.4 MEDIUM: Billing Webhook HMAC Signs `JSON.stringify(req.body)` Not Raw Bytes

**File:** `routes/billing-webhooks.routes.js:31`
**Risk:** The HMAC signs the JS re-serialized body, not the original wire bytes. Works only because payment-service uses the same `JSON.stringify` round-trip. Any key-ordering divergence breaks the signature silently.
**Recommendation:** Verify routes use `req.rawBody` throughout.

### 2.5 MEDIUM: No Zod Schema Validation on REST Write Routes

**File:** `controllers/task.controller.js`, `schemas/task.schema.js`
**Risk:** Manual validation in controllers is inconsistent. Top-10 write endpoints rely on ad-hoc checks rather than validated schemas.
**Recommendation:** Apply Zod schemas to REST write routes.

### 2.6 MEDIUM: Dev Mode OAuth Auto-Approval

**File:** `app.js:202-246`
**Risk:** Dev mode auto-approves OAuth with `dev-code-*` tokens. If dev mode is accidentally deployed to production, any client can obtain a valid token.
**Recommendation:** Add a startup guard that prevents `NODE_ENV=development` code paths from running in production.

### 2.7 LOW: Redis URL Plaintext

**File:** `server.js` startup warning
**Risk:** Production REDIS_URL may be plaintext without auth. Terraform Memorystore has `auth_enabled=true` + TLS.
**Recommendation:** Fix to `rediss://:<auth>@host` across all services.

### 2.8 LOW: Service Key in URL for Feature Endpoints

**File:** `routes/feature-catalog.routes.js`, `routes/feature-events.routes.js`
**Risk:** Service key passed as query parameter or header. Timing-safe compare added but no dedicated rate limit.
**Recommendation:** Add dedicated rate limiter.

---

## 3. Scalability Review

### 3.1 HIGH: `scheduleQueue` In-Memory Dirty Set Not Multi-Instance Safe

**File:** `scheduler/scheduleQueue.js:48-49, 57-58, 214`
**Risk:** `dirty = {}` is per-process. Under two Cloud Run instances, enqueue on instance A does not mark user dirty on instance B. Instance B's poll loop never fires for that user.
**Recommendation:** Remove the in-memory dirty set. Convert poll loop to DB-only query or use Redis pub/sub.

### 3.2 HIGH: Rate Limiters Use Default In-Memory Store

**File:** `app.js:110-126`
**Risk:** All `express-rate-limit` instances use default `MemoryStore`. Under multiple Cloud Run instances, each instance tracks its own counters — a user can make `max * N` requests per window across N instances.
**Note:** Some limiters (apiLimiter, aiLimiter, clientErrorLimiter) already use `maybeRedisStore`. Others (mcpLimiter, oauthCallbackLimiter, billingWebhookLimiter, healthLimiter) still use MemoryStore.
**Recommendation:** Swap remaining limiters to `rate-limit-redis` store.

### 3.3 MEDIUM: SSE Fan-Out Requires Redis

**File:** `lib/sse-emitter.js`
**Risk:** If `REDIS_URL` is not set in production Cloud Run env vars, SSE emitter silently degrades to local-only emit. Under two instances, SSE events delivered to only the instance that handled the mutation.
**Recommendation:** Ensure `REDIS_URL` is set in all Cloud Run service configurations. Add startup health check.

### 3.4 MEDIUM: `scheduleQueue` Poll Loop Fires Every 1 Second

**File:** `scheduler/scheduleQueue.js:46` (`POLL_MS = 1000`)
**Risk:** Poll loop fires every 1000ms regardless of whether any work exists. Under multi-instance deployment this becomes N requests/second against the DB.
**Recommendation:** Increase `POLL_MS` to 2-5s, or switch to Redis-based pub/sub notification.

### 3.5 MEDIUM: `tasks_v` DB View Used by Cron for Full-Table Scan

**File:** `cron/cal-history-cron.js:38-43`
**Risk:** Queries `tasks_v` with `WHERE user_id % SHARD_COUNT = shard` and no date filter. Scans all pending recurring instances across all users for the shard.
**Recommendation:** Add a date-range predicate (e.g., `scheduled_at < NOW() - INTERVAL 1 HOUR`).

### 3.6 LOW: Nominatim Reverse Geocode Uncached

**File:** `controllers/weather.controller.js:213-224`
**Risk:** Each "Locate me" click triggers a live Nominatim reverse geocode request with no caching. Nominatim has usage policy rate limits.
**Recommendation:** Cache reverse geocode results in `weather_cache` or Redis keyed on rounded lat/lon.

---

## 4. Dead Code / Redundant Code

### 4.1 HIGH: `unifiedSchedule.js` — Dead Scheduler

**File:** `scheduler/unifiedSchedule.js`
**Risk:** This is the v1 scheduler. v2 (`unifiedScheduleV2.js`) is the only active scheduler. v1 is dead code.
**Recommendation:** Delete `unifiedSchedule.js` after confirming no imports.

### 4.2 MEDIUM: `scheduler/dateHelpers.js` — Duplicate of `shared/scheduler/dateHelpers.js`

**File:** `scheduler/dateHelpers.js` vs `shared/scheduler/dateHelpers.js`
**Risk:** Backend has its own copy of date helpers. Shared package also has them. Potential drift.
**Recommendation:** Backend should import from shared, not maintain its own copy.

### 4.3 MEDIUM: `scheduler/dependencyHelpers.js` — Duplicate of `shared/scheduler/dependencyHelpers.js`

**File:** `scheduler/dependencyHelpers.js` vs `shared/scheduler/dependencyHelpers.js`
**Risk:** Same as dateHelpers — duplicate code.
**Recommendation:** Backend should import from shared.

### 4.4 MEDIUM: `scheduler/timeBlockHelpers.js` — Duplicate of `shared/scheduler/timeBlockHelpers.js`

**File:** `scheduler/timeBlockHelpers.js` vs `shared/scheduler/timeBlockHelpers.js`
**Risk:** Same as dateHelpers — duplicate code.
**Recommendation:** Backend should import from shared.

### 4.5 MEDIUM: `scheduler/locationHelpers.js` — Duplicate of `shared/scheduler/locationHelpers.js`

**File:** `scheduler/locationHelpers.js` vs `shared/scheduler/locationHelpers.js`
**Risk:** Same as dateHelpers — duplicate code.
**Recommendation:** Backend should import from shared.

### 4.6 LOW: `lib/task-status.js` — Duplicate of `shared/task-status.js`

**File:** `lib/task-status.js` vs `shared/task-status.js`
**Risk:** Duplicate task status logic.
**Recommendation:** Backend should import from shared.

### 4.7 LOW: `lib/cal-adapters/` — Legacy Shims

**File:** `lib/cal-adapters/index.js`
**Risk:** Calendar facade now owns the adapter registry. The old `lib/cal-adapters/` files are thin shims that re-export from the facade. These should be removed once all importers are updated.
**Recommendation:** Remove legacy shims after confirming no direct imports.

### 4.8 LOW: `lib/placementModes.js` — Duplicate of `slices/task/domain/value-objects/PlacementMode.js`

**File:** `lib/placementModes.js` vs `slices/task/domain/value-objects/PlacementMode.js`
**Risk:** Duplicate placement mode constants.
**Recommendation:** Slice code should use its own value objects; legacy code should be migrated.

### 4.9 LOW: `lib/cal-sync-helpers.js` — Duplicate of `controllers/cal-sync-helpers.js`

**File:** `lib/cal-sync-helpers.js` vs `controllers/cal-sync-helpers.js`
**Risk:** Two copies of cal sync helper functions.
**Recommendation:** Consolidate into one.

### 4.10 LOW: `auth-client/` — Vendored Copy

**File:** `auth-client/` directory
**Risk:** Vendored copy of auth-client. Changes to `auth-service/shared/` must be manually synced. If sync is skipped, juggler runs stale auth logic.
**Recommendation:** Automate the sync or use npm package.

### 4.11 LOW: `scripts/db-backup/` — Stale SQL Dumps

**File:** `scripts/db-backup/` (15 SQL dump files from March-May 2026)
**Risk:** Old database backups consuming disk space. Not referenced by any active process.
**Recommendation:** Archive or delete old backups.

### 4.12 LOW: `.muppets/logs/` — Stale Agent Logs

**File:** `.muppets/logs/` (30+ KERMIT-LOG files from June-July 2026)
**Risk:** Agent logs consuming disk space. Not referenced by active code.
**Recommendation:** Archive or rotate old logs.

### 4.13 LOW: `.claude/worktrees/` — Stale Worktree

**File:** `.claude/worktrees/fix-anytime-overdue/`
**Risk:** Stale git worktree from a previous fix branch. Contains its own node_modules.
**Recommendation:** Clean up stale worktree.

---

## 5. Inefficient Code

### 5.1 MEDIUM: `cal-sync.controller.js` Runs as Single Large Sequential Function

**File:** `controllers/cal-sync.controller.js` (2,554 lines)
**Risk:** Main sync path runs sequentially across all providers. Each Apple CalDAV push is a separate HTTP call with no batching.
**Recommendation:** Profile per-provider time in production before optimizing. Apple sequential push is architecturally constrained.

### 5.2 MEDIUM: God Object Controllers

**File:** `controllers/cal-sync.controller.js` (2,554 lines), `scheduler/runSchedule.js` (2,374 lines), `scheduler/unifiedScheduleV2.js` (2,560 lines)
**Risk:** Any change to these files has broad blast radius. Hard to unit test. Hard to reason about all code paths.
**Recommendation:** Extract narrow sub-controllers or service objects. No single file should exceed ~500 lines.

### 5.3 MEDIUM: God Components in Frontend

**File:** `juggler-frontend/src/components/tasks/TaskEditForm.jsx` (118 KB), `SettingsPanel.jsx` (88 KB), `AppLayout.jsx` (72 KB), `DailyView.jsx` (62 KB), `CalSyncPanel.jsx` (59 KB)
**Risk:** Slow re-renders, merge conflicts, difficult testing.
**Recommendation:** Extract sub-forms, sub-panels, and hooks.

### 5.4 LOW: `timesPerCycle` Work-Budget Awareness — Held Design

**File:** `shared/scheduler/expandRecurring.js`, `scheduler/runSchedule.js:489`
**Risk:** `timesPerCycle` is occurrence-count-based, not work-budget-based. No slot suppression when `sum(time_remaining) < session_dur`.
**Recommendation:** Design decision needed before implementation.

### 5.5 LOW: Recurring Toggle Bug (Root Causes Identified, Not Fixed)

**File:** `controllers/task.controller.js` (5 locations near lines 892, 1184-1187)
**Risk:** Three root causes remain unresolved for the recurring-toggle-off path: (1) ledger not cleaned when recurring=false, (2) done instances not archived before deletion, (3) fast-path skips cleanup entirely.
**Recommendation:** See handoff doc for the three specific RCs and their fix locations.

---

## 6. Backlog Items to Add

The following items should be added to the monorepo backlog (product: juggler):

### P0 — Architecture Refactor (Hexagonal Migration)

1. **999.941** — H7: Extract scheduler slice domain from `runSchedule.js` and `unifiedScheduleV2.js` (4,934 combined lines) into ports/adapters/use-cases
2. **999.942** — H7: Extract calendar slice domain from `cal-sync.controller.js` (2,554 lines) into ports/adapters/use-cases
3. **999.943** — H7: Thin remaining legacy controllers (apple-cal, msft-cal, gcal, billing-webhooks, feature-catalog, impersonation, ai, weather, data, config) to delegate to slice facades
4. **999.944** — H7: Port infrastructure modules (tasks-write, sync-lock, task-write-queue, sse-emitter, redis) behind port abstractions
5. **999.945** — H7: Delete dead `unifiedSchedule.js` (v1 scheduler) after confirming no imports

### P1 — Security

6. **999.946** — SECURITY: Replace JWT-in-URL SSE transport with short-lived opaque token for `/api/events`
7. **999.947** — SECURITY: Apply production error-sanitization middleware to weather controller (4 leak sites)
8. **999.948** — SECURITY: Add dedicated rate limiters for `/api/feature-catalog` and `/api/feature-events` endpoints
9. **999.949** — SECURITY: Verify billing webhook HMAC uses `req.rawBody` not `JSON.stringify(body)`
10. **999.950** — SECURITY: Apply Zod schema validation to REST write routes (top-10 endpoints)
11. **999.951** — SECURITY: Add startup guard preventing NODE_ENV=development OAuth auto-approval in production

### P2 — Scalability

12. **999.952** — SCALABILITY: Remove in-memory dirty set from `scheduleQueue.js` — use DB-only poll or Redis pub/sub
13. **999.953** — SCALABILITY: Swap remaining per-instance rate limiters (mcpLimiter, oauthCallbackLimiter, billingWebhookLimiter, healthLimiter) to Redis-backed store
14. **999.954** — SCALABILITY: Add startup health check confirming Redis connectivity for SSE fan-out
15. **999.955** — SCALABILITY: Increase `POLL_MS` from 1000 to 2000-5000 or switch to Redis notification
16. **999.956** — SCALABILITY: Add date-range predicate to `cal-history-cron.js` `tasks_v` query to avoid full-table scan

### P2 — Dead Code Cleanup

17. **999.957** — DEADCODE: Consolidate duplicate scheduler helpers (dateHelpers, dependencyHelpers, timeBlockHelpers, locationHelpers) — backend should import from shared/
18. **999.958** — DEADCODE: Consolidate duplicate `lib/task-status.js` with `shared/task-status.js`
19. **999.959** — DEADCODE: Remove legacy `lib/cal-adapters/` shim files after confirming no direct imports
20. **999.960** — DEADCODE: Consolidate duplicate `lib/cal-sync-helpers.js` with `controllers/cal-sync-helpers.js`
21. **999.961** — DEADCODE: Clean up stale `.claude/worktrees/fix-anytime-overdue/` worktree
22. **999.962** — DEADCODE: Archive or delete old `scripts/db-backup/` SQL dumps (March-May 2026)
23. **999.963** — DEADCODE: Archive or rotate `.muppets/logs/` agent logs (30+ files)

### P2 — Inefficient Code

24. **999.964** — PERF: Extract sub-controllers from `cal-sync.controller.js` (2,554 lines) — no single file should exceed ~500 lines
25. **999.965** — PERF: Extract sub-components from frontend god components (TaskEditForm 118KB, SettingsPanel 88KB, AppLayout 72KB, DailyView 62KB, CalSyncPanel 59KB)
26. **999.966** — PERF: Cache Nominatim reverse geocode results in weather_cache or Redis
27. **999.967** — BUG: Fix recurring toggle-off path (3 root causes: ledger cleanup, done instance archiving, fast-path skip)

---

## Summary

| Category | Count | Priority |
|----------|-------|----------|
| Hexagonal non-compliance (god objects) | 5 | P0 |
| Hexagonal non-compliance (infra modules) | 28 | P2 |
| Security findings | 6 | P1 |
| Scalability findings | 5 | P2 |
| Dead code findings | 7 | P2 |
| Inefficient code findings | 4 | P2 |
| **Total backlog items to add** | **27** | |

*Review conducted: 2026-07-29*
