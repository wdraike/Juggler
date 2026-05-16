# R1: Route Coverage Gap Report

_Audit date: 2026-05-16. Source: `src/routes/` (19 route files) vs `docs/TEST-USE-CASES.md` §3 and `tests/` tree._

---

## Key Finding: Several "GAP" Routes Now Have Test Files

Four of the eight AP-70–77 GAP routes listed in TEST-USE-CASES.md now have test coverage
that was written AFTER the doc was last updated. The doc has not been updated to reflect
these files. The remaining four are still genuine gaps.

---

## Confirmed Existing GAP Routes (handler exists, no test)

These routes exist in the codebase, are listed as GAP in TEST-USE-CASES.md, and still have
no test file covering them.

| Route | Handler File | Test Status |
|-------|-------------|-------------|
| GET /api/my-plan/ | `src/routes/my-plan.routes.js` (inline handler) | NO_TEST |
| POST /api/impersonation/start | `src/routes/impersonation.routes.js` → `src/controllers/impersonation.controller.js` | NO_TEST |
| POST /api/impersonation/stop | `src/routes/impersonation.routes.js` → `src/controllers/impersonation.controller.js` | NO_TEST |
| GET /api/impersonation/targets | `src/routes/impersonation.routes.js` → `src/controllers/impersonation.controller.js` | NO_TEST |
| GET /api/impersonation/log | `src/routes/impersonation.routes.js` → `src/controllers/impersonation.controller.js` | NO_TEST |

Notes:
- `impersonation/targets` and `impersonation/log` are not in TEST-USE-CASES.md at all (undocumented routes). All four impersonation routes have no test file anywhere.
- `my-plan/` has no test file — neither under `tests/api/` nor elsewhere.

---

## GAP Routes Now Resolved (test file exists — doc out of date)

These routes are marked GAP in TEST-USE-CASES.md (AP-70–74) but a test file has since been
written covering them. The doc needs updating.

| Doc ID | Route | Test File | Coverage Notes |
|--------|-------|-----------|----------------|
| AP-70 | POST /api/data/import | `tests/api/data-and-weather.test.js` | Happy path, missing confirm param, unauthenticated, feature-gated export blocked |
| AP-71 | GET /api/data/export | `tests/api/data-and-weather.test.js` | Happy path, unauthenticated, feature gate check |
| AP-73 | GET /api/weather/geocode | `tests/api/data-and-weather.test.js` | Hit/miss, empty query, auth check |
| AP-74 | GET /api/weather/ (forecast) | `tests/api/data-and-weather.test.js` | Cache miss → fetch, cache hit path |

Additionally, two weather routes NOT in TEST-USE-CASES.md are also covered by this file:
- GET /api/weather/reverse-geocode — COVERED by `tests/api/data-and-weather.test.js`
- POST /api/weather/ingest — COVERED by `tests/api/data-and-weather.test.js`

For AP-72 (POST /api/ai/command): `tests/aiRateLimiter.test.js` references `/api/ai/command`
but only tests the rate-limiter store type (Redis vs Memory), not the route handler behavior
(handleCommand, feature gating, usage limit). This is PARTIAL coverage, not full route coverage.

---

## Routes NOT in TEST-USE-CASES.md (new since doc was written)

Routes that exist in `src/routes/` but have no AP-XX entry in TEST-USE-CASES.md §3.

| Route | Handler File | Test Status | Recommended Test File |
|-------|-------------|-------------|----------------------|
| GET /health | `src/routes/health.routes.js` | COVERED (partial) — `api.integration.test.js`, `security/rate-limits.test.js`, `security/probes.test.js` | Add AP entry |
| GET /api/health | `src/routes/health.routes.js` | COVERED (partial) — same as above, dual-mounted | Add AP entry |
| GET /health/immediate | `src/routes/health.routes.js` | NO_TEST — no test hits `/health/immediate` | `tests/api/health.test.js` |
| GET /health/detailed | `src/routes/health.routes.js` | NO_TEST — no test hits `/health/detailed` or `/api/health/detailed` | `tests/api/health.test.js` |
| GET /api/tools/ | `src/routes/tool.routes.js` | NO_TEST — no HTTP test calls this path | `tests/api/tools.test.js` |
| PUT /api/tools/ | `src/routes/tool.routes.js` | NO_TEST | `tests/api/tools.test.js` |
| GET /api/feature-catalog/ | `src/routes/feature-catalog.routes.js` | NO_TEST | `tests/api/feature-catalog.test.js` |
| GET /api/feature-events/ | `src/routes/feature-events.routes.js` | NO_TEST | `tests/api/feature-events.test.js` |
| POST /api/billing-webhooks/ | `src/routes/billing-webhooks.routes.js` | PARTIAL — `tests/security/webhook.test.js` tests HMAC rejection; `disabledStatus.test.js` tests `enforceDowngradeLimits` internally. No test of the full dispatch path. | Already in E2-11 as PARTIAL |
| GET /api/gcal/callback | `src/routes/gcal.routes.js` | PARTIAL — `security/probes.test.js` tests bad-state rejection; no happy-path or token-exchange test | `tests/api/oauth-providers.test.js` |
| GET /api/msft-cal/callback | `src/routes/msft-cal.routes.js` | PARTIAL — same as gcal/callback | `tests/api/oauth-providers.test.js` |
| GET /api/tasks/version | `src/routes/task.routes.js` | PARTIAL — `taskCrudIntegration2.test.js` calls controller directly (not via HTTP) | `tests/api/tasks.test.js` |
| GET /api/apple-cal/refresh-calendars | `src/routes/apple-cal.routes.js` | NO_TEST | `tests/api/oauth-providers.test.js` |
| POST /api/apple-cal/select-calendar | `src/routes/apple-cal.routes.js` | NO_TEST (singular form; `select-calendars` plural is AP-64 PLANNED) | `tests/api/oauth-providers.test.js` |
| GET /api/weather/reverse-geocode | `src/routes/weather.routes.js` | COVERED — `tests/api/data-and-weather.test.js` | Add AP entry |
| POST /api/weather/ingest | `src/routes/weather.routes.js` | COVERED — `tests/api/data-and-weather.test.js` | Add AP entry |
| GET /api/impersonation/targets | `src/routes/impersonation.routes.js` | NO_TEST | `tests/api/impersonation.test.js` |
| GET /api/impersonation/log | `src/routes/impersonation.routes.js` | NO_TEST | `tests/api/impersonation.test.js` |

---

## GAP Routes Where Handler Does NOT Exist

All eight AP-70–77 routes listed as GAP in TEST-USE-CASES.md have implemented handlers.
None are stubs or missing.

| Route | Status |
|-------|--------|
| POST /api/data/import | IMPLEMENTED — `src/controllers/data.controller.js` via `data.routes.js` |
| GET /api/data/export | IMPLEMENTED — `src/controllers/data.controller.js` via `data.routes.js` |
| POST /api/ai/command | IMPLEMENTED — `src/controllers/ai.controller.js` via `ai.routes.js` |
| GET /api/weather/geocode | IMPLEMENTED — `src/controllers/weather.controller.js` via `weather.routes.js` |
| GET /api/weather/ | IMPLEMENTED — `src/controllers/weather.controller.js` via `weather.routes.js` |
| GET /api/my-plan/ | IMPLEMENTED — inline handler in `src/routes/my-plan.routes.js` |
| POST /api/impersonation/start | IMPLEMENTED — `src/controllers/impersonation.controller.js` via `impersonation.routes.js` |
| POST /api/impersonation/stop | IMPLEMENTED — `src/controllers/impersonation.controller.js` via `impersonation.routes.js` |

---

## Complete Route Inventory

All routes found in `src/routes/` with their mount prefix from `src/app.js`:

| Route | Handler | Test Status |
|-------|---------|-------------|
| GET /health | health.routes.js | PARTIAL |
| GET /health/immediate | health.routes.js | NO_TEST |
| GET /health/detailed | health.routes.js | NO_TEST |
| GET /api/health | health.routes.js (dual mount) | PARTIAL |
| GET /api/health/immediate | health.routes.js | NO_TEST |
| GET /api/health/detailed | health.routes.js | NO_TEST |
| GET /api/tasks | task.routes.js | COVERED |
| GET /api/tasks/version | task.routes.js | PARTIAL (direct controller only) |
| GET /api/tasks/disabled | task.routes.js | COVERED |
| GET /api/tasks/suggest-icon | task.routes.js | PLANNED (AP-10) |
| GET /api/tasks/:id | task.routes.js | COVERED |
| POST /api/tasks | task.routes.js | COVERED |
| POST /api/tasks/batch | task.routes.js | PLANNED (AP-07) |
| PUT /api/tasks/batch | task.routes.js | PLANNED (AP-09) |
| PUT /api/tasks/:id/status | task.routes.js | COVERED |
| PUT /api/tasks/:id/re-enable | task.routes.js | COVERED |
| PUT /api/tasks/:id/unpin | task.routes.js | COVERED |
| PUT /api/tasks/:id | task.routes.js | COVERED |
| DELETE /api/tasks/:id | task.routes.js | COVERED |
| GET /api/config/ | config.routes.js | COVERED |
| PUT /api/config/:key | config.routes.js | COVERED |
| GET /api/projects/ | project.routes.js | COVERED |
| POST /api/projects/ | project.routes.js | COVERED |
| PUT /api/projects/reorder | project.routes.js | COVERED |
| PUT /api/projects/:id | project.routes.js | COVERED |
| DELETE /api/projects/:id | project.routes.js | COVERED |
| GET /api/locations/ | location.routes.js | COVERED |
| PUT /api/locations/ | location.routes.js | COVERED |
| GET /api/tools/ | tool.routes.js | NO_TEST |
| PUT /api/tools/ | tool.routes.js | NO_TEST |
| POST /api/data/import | data.routes.js | COVERED (new test file) |
| GET /api/data/export | data.routes.js | COVERED (new test file) |
| POST /api/schedule/run | schedule.routes.js | COVERED |
| GET /api/schedule/placements | schedule.routes.js | COVERED |
| POST /api/schedule/nudge | schedule.routes.js | COVERED |
| POST /api/schedule/debug | schedule.routes.js | COVERED |
| POST /api/schedule/step/start | schedule.routes.js | COVERED |
| GET /api/schedule/step/:id/summary | schedule.routes.js | COVERED |
| GET /api/schedule/step/:id/:step | schedule.routes.js | COVERED |
| POST /api/schedule/step/:id/stop | schedule.routes.js | COVERED |
| GET /api/gcal/status | gcal.routes.js | COVERED |
| GET /api/gcal/connect | gcal.routes.js | COVERED |
| GET /api/gcal/callback | gcal.routes.js | PARTIAL |
| POST /api/gcal/disconnect | gcal.routes.js | COVERED |
| POST /api/gcal/auto-sync | gcal.routes.js | COVERED |
| GET /api/msft-cal/status | msft-cal.routes.js | COVERED |
| GET /api/msft-cal/connect | msft-cal.routes.js | COVERED |
| GET /api/msft-cal/callback | msft-cal.routes.js | PARTIAL |
| POST /api/msft-cal/disconnect | msft-cal.routes.js | COVERED |
| POST /api/msft-cal/auto-sync | msft-cal.routes.js | COVERED |
| GET /api/apple-cal/status | apple-cal.routes.js | COVERED |
| POST /api/apple-cal/connect | apple-cal.routes.js | PLANNED (AP-63) |
| POST /api/apple-cal/select-calendar | apple-cal.routes.js | NO_TEST (singular — different from AP-64) |
| POST /api/apple-cal/select-calendars | apple-cal.routes.js | PLANNED (AP-64) |
| GET /api/apple-cal/calendars | apple-cal.routes.js | COVERED |
| GET /api/apple-cal/refresh-calendars | apple-cal.routes.js | NO_TEST |
| PUT /api/apple-cal/calendars/:id | apple-cal.routes.js | PLANNED (AP-66) |
| POST /api/apple-cal/disconnect | apple-cal.routes.js | COVERED |
| POST /api/apple-cal/auto-sync | apple-cal.routes.js | COVERED |
| GET /api/cal/has-changes | cal-sync.routes.js | COVERED |
| POST /api/cal/sync | cal-sync.routes.js | COVERED |
| GET /api/cal/sync-history | cal-sync.routes.js | COVERED |
| GET /api/cal/audit | cal-sync.routes.js | COVERED |
| GET /api/weather/geocode | weather.routes.js | COVERED (new test file) |
| GET /api/weather/reverse-geocode | weather.routes.js | COVERED (new test file) |
| GET /api/weather/ | weather.routes.js | COVERED (new test file) |
| POST /api/weather/ingest | weather.routes.js | COVERED (new test file) |
| GET /api/my-plan/ | my-plan.routes.js | NO_TEST |
| POST /api/ai/command | ai.routes.js | PARTIAL (rate-limiter only; handler not tested) |
| GET /api/feature-catalog/ | feature-catalog.routes.js | NO_TEST |
| GET /api/feature-events/ | feature-events.routes.js | NO_TEST |
| POST /api/billing-webhooks/ | billing-webhooks.routes.js | PARTIAL |
| POST /api/impersonation/start | impersonation.routes.js | NO_TEST |
| POST /api/impersonation/stop | impersonation.routes.js | NO_TEST |
| GET /api/impersonation/targets | impersonation.routes.js | NO_TEST |
| GET /api/impersonation/log | impersonation.routes.js | NO_TEST |

---

## Summary

- **Total routes in codebase:** 71
- **Routes with full test coverage (COVERED):** 41
- **Routes with planned tests (PLANNED):** 7
- **Routes with partial coverage only (PARTIAL):** 5 — gcal/callback, msft-cal/callback, billing-webhooks, ai/command, tasks/version
- **Routes with no tests at all (NO_TEST):** 18
  - health/immediate, health/detailed (×2 mounts = 4 entries but 2 distinct routes)
  - tools GET + PUT
  - apple-cal/select-calendar (singular), apple-cal/refresh-calendars
  - my-plan/
  - feature-catalog/, feature-events/
  - impersonation/start, /stop, /targets, /log
- **Routes listed as GAP in TEST-USE-CASES.md but now have test file:** 4 (AP-70, AP-71, AP-73, AP-74 — all in `tests/api/data-and-weather.test.js`)
- **Routes listed as GAP in TEST-USE-CASES.md where handler does NOT exist:** 0 — all 8 are implemented
- **Routes NOT in TEST-USE-CASES.md at all:** 18 routes (feature-catalog, feature-events, billing-webhooks, tools, health sub-routes, gcal/msft callbacks, apple-cal singular + refresh, weather/reverse-geocode, weather/ingest, impersonation targets + log)
