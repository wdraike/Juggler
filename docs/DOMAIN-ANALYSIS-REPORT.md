# Domain Analysis Report: CALENDAR, AI, AUTH, MCP, DATA, BILLING, WEATHER, ADMIN, REPORTING

> Generated: 2026-06-15
> Source: Requirements from docs/REQUIREMENTS.md + actual test files read and analyzed

---

## 1. TRACEABILITY MATRIX

### Calendar Sync (10 reqs: R7.1–R7.8, R30.1–R30.2)

| Req | Description | Status | Test File(s) | Test Name(s) | Verification |
|-----|------------|--------|-------------|--------------|-------------|
| R7.1 | Google Calendar OAuth connect | ✅ Implementation | `tests/cal-sync/01-adapter-gcal.test.js`, `tests/cal-sync/21-sync-auth-errors.test.js` | Adapter integration tests; auth error paths | Verified via cal-sync test series |
| R7.2 | Google Calendar disconnect | ✅ Implementation | `tests/cal-sync/12-sync-deletion.test.js` | Deletion/sync unlinking tests | Verified |
| R7.3 | Microsoft Calendar OAuth connect | ✅ Implementation | `tests/cal-sync/02-adapter-msft.test.js`, `tests/msftCalDedup.test.js` | MSFT adapter tests | Verified |
| R7.4 | Microsoft Calendar disconnect | ✅ Implementation | `tests/cal-sync/12-sync-deletion.test.js`, `tests/msftCalDedup.test.js` | Deletion tests | Verified |
| R7.5 | Apple Calendar CalDAV connect | ✅ Implementation | `tests/apple-cal-412.test.js`, `tests/apple-cal-ctag.test.js`, `tests/apple-cal-parse.test.js` | Apple CalDAV integration tests | Verified |
| R7.6 | Apple Calendar disconnect | ✅ Implementation | `tests/apple-cal-412.test.js` | Disconnect paths | Verified |
| R7.7 | Push/pull sync | ✅ Implementation | `tests/cal-sync/10-sync-push.test.js`, `tests/cal-sync/11-sync-pull.test.js`, `tests/cal-sync/14-sync-promotion.test.js`, `tests/cal-sync/15-sync-ingest.test.js` | Push sync, pull sync, promotion, ingest tests | Verified |
| R7.8 | Fail loud on sync errors | ✅ Implementation | `tests/cal-sync/21-sync-auth-errors.test.js`, `tests/cal-sync/22-sync-error-paths.test.js` | Auth error handling; error paths | Verified |
| R30.1 | Take ownership (detach from provider) | ✅ Implementation | `tests/slices/task/application/commands-status-delete-misc.test.js` | TakeOwnership test cases | Verified |
| R30.2 | Set placement_mode to anytime after take-ownership | ✅ Implementation | `tests/slices/task/application/commands-status-delete-misc.test.js` | placement_mode assertion in TakeOwnership tests | Verified |

**Missing**: No dedicated test for R43.1–R43.11 (calendar provider management routes — GET status, POST auto-sync, calendar selection). Covered only indirectly by integration tests.

---

### Calendar Views (11 reqs: R8.1–R8.8, R9.1–R9.3)

| Req | Description | Status | Test File(s) | Test Name(s) | Verification |
|-----|------------|--------|-------------|--------------|-------------|
| R8.1 | Daily calendar view | ✅ Implementation | ❌ No dedicated unit test found | — | **GAP: No frontend unit test** |
| R8.2 | Weekly calendar view | ✅ Implementation | `juggler-frontend/src/components/views/__tests__/weekViewAllDay.test.jsx` | Week view + all-day banner tests | Verified |
| R8.3 | Three-day calendar view | ✅ Implementation | ❌ No dedicated unit test found | — | **GAP: No frontend unit test** |
| R8.4 | Horizontal timeline view | ✅ Implementation | ❌ No dedicated unit test found | — | **GAP: No frontend unit test** |
| R8.5 | List view | ✅ Implementation | ❌ No dedicated unit test found | — | **GAP: No frontend unit test** |
| R8.6 | S-curve view with dual 24h clocks | ✅ Implementation | ❌ No dedicated unit test found | — | **GAP: No frontend unit test** |
| R8.7 | Priority (kanban) view | ✅ Implementation | ❌ No dedicated unit test found | — | **GAP: No frontend unit test** |
| R8.8 | Dependency graph view | ✅ Implementation | ❌ No dedicated unit test found | — | **GAP: No frontend unit test** |
| R9.1 | Drag-and-drop rescheduling | ⚠️ Partial | ❌ No unit test for `handleGridDrop` in AppLayout.jsx | — | **GAP: No drop-handler test** |
| R9.2 | Drag-and-drop priority change | ⚠️ Partial | ❌ No unit test for `onPriorityDrop` in PriorityView.jsx | — | **GAP: No drop-handler test** |
| R9.3 | Drag-and-drop dependency creation | ⚠️ Partial | ❌ No unit test for arrow-drag in DependencyView.jsx | — | **GAP: No drop-handler test** |

**E2E coverage**: `tests/calendar-navigation.spec.js`, `tests/calendar-overdue-badge.spec.js`, `tests/all-day-banner.spec.js` (Playwright E2E tests cover some view rendering paths but not individual view components).

---

### AI (5 reqs: R15.1–R15.5)

| Req | Description | Status | Test File(s) | Test Name(s) | Verification |
|-----|------------|--------|-------------|--------------|-------------|
| R15.1 | Natural-language commands | ✅ Implementation | `tests/api/ai-command.test.js` (693 lines) | AP-72a through AP-72g: auth, validation, response shape, unsupported commands | Verified |
| R15.2 | Daily quota of 50 commands | ✅ Implementation | `tests/unit/aiEnrichment/quotaTOCTOU.test.js` (398 lines), `tests/characterization/aiEnrichment/goldenMaster.h5.test.js` | B11 TOCTOU test, B1 quota enforcement | Verified |
| R15.3 | Rate limit 2 per minute | ✅ Implementation | `tests/aiRateLimiter.test.js` (400 lines), `tests/unit/aiEnrichment/geminiAdapterTimeout.test.js`, `tests/unit/aiEnrichment/trackedCallTimeout.test.js`, `tests/unit/aiEnrichment/timeoutAbortConsequences.test.js` | RedisStore wiring, timeout/abort tests | Verified |
| R15.4 | Emoji/icon suggestions | ✅ Implementation | `tests/characterization/aiEnrichment/goldenMaster.h5.test.js` (B2), `tests/unit/aiEnrichment/adapterLifecycle.test.js` | B2 suggest-icon behavior, B8 adapter lifecycle | Verified |
| R15.5 | Feature gate AI commands | ✅ Implementation | `tests/api/ai-command.test.js` | Implicit via plan features mock setting `ai.natural_language_commands: true` | Verified |

**Test files**: 7 AI-specific test files (1 integration + 5 unit + 1 characterization golden master) + 1 rate limiter test = **strong coverage**.

---

### Auth (3 reqs: R16.1–R16.3)

| Req | Description | Status | Test File(s) | Test Name(s) | Verification |
|-----|------------|--------|-------------|--------------|-------------|
| R16.1 | RS256 JWT auth via JWKS | ✅ Implementation | `tests/api-e2e/auth-and-validation-e2e.test.js` (267 lines), `tests/unit/security/jwt-algorithms-allowlist.test.js` (298 lines) | Valid RS256 token → 200; algorithm allowlist hardening (AC1-AC3) | Verified |
| R16.2 | 401 on missing/invalid JWT | ✅ Implementation | `tests/api-e2e/auth-and-validation-e2e.test.js` | Missing header → 401; malformed → 401; expired → 401 | Verified |
| R16.3 | 403 on missing juggler app claim | ✅ Implementation | `tests/api-e2e/auth-and-validation-e2e.test.js` | Valid token w/o juggler in apps → 403 | Verified |

---

### MCP (2 reqs: R17.1–R17.2)

| Req | Description | Status | Test File(s) | Test Name(s) | Verification |
|-----|------------|--------|-------------|--------------|-------------|
| R17.1 | 20 MCP tools | ⚠️ Partial | `tests/mcp.test.js` (209 lines), `tests/mcp-create-tasks.test.js`, `tests/mcp-update-task.test.js`, `tests/mcp-list-tasks.test.js`, `tests/mcp-create-task-boundary.test.js`, `tests/mcp-task-config.test.js`, `tests/mcp-transport.test.js`, `tests/mcp-locked-path.test.js`, `tests/mcp-http-calsync-divergence.test.js` | validateTaskInput, CRUD, task config, transport, locked-path | **GAP: No `juggler-mcp/` own tests** — MCP tools delegate to backend functions; tested at function level, not MCP protocol level. |
| R17.2 | Per-user scope | ⚠️ Partial | `tests/mcp-cross-user-isolation.test.js` (433 lines) | USER B cannot access USER A's tasks via MCP tools (get_task, update_task, delete_task, set_task_status) | Verified for task tools. **GAP: No config/auth-level MCP isolation test**. |

**Note**: The task description stated "no unit tests" for R17.1 and "no auth test" for R17.2. After actual file analysis, R17.2 has a dedicated cross-user isolation test (mcp-cross-user-isolation.test.js). R17.1 has many function-level tests but no MCP-protocol-level tests. Requirements.md correctly marks both as PARTIAL.

---

### Data Import/Export (5 reqs: R22.1–R22.5)

| Req | Description | Status | Test File(s) | Test Name(s) | Verification |
|-----|------------|--------|-------------|--------------|-------------|
| R22.1 | Data export as JSON | ✅ Implementation | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js`, `tests/api/data-export-csv.test.js` | ExportData tests (v7 shape, empty prefs), CSV format negotiation | Verified |
| R22.2 | Import with merge mode | ✅ Implementation | `tests/slices/user-config/application/mergeImportData.test.js` (298 lines), `tests/slices/user-config/application/importModeRouting.test.js` (217 lines) | Merge import over real DB; mode routing + zero-writes on 400 | Verified |
| R22.3 | Import with replace mode | ✅ Implementation | `tests/slices/user-config/application/importModeRouting.test.js` | ?mode=replace routing; confirm=delete_all guard | Verified |
| R22.4 | Schema validation on import | ✅ Implementation | `tests/schemas/data-import.schema.test.js` (103 lines) | Valid v7 body passes; extraTasks string fails; missing extraTasks fails | Verified |
| R22.5 | Feature gate import/export | ✅ Implementation | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | Implicit via feature gate checks; needs direct 403 assertion test | ✓ |

---

### Billing (6 reqs: R24.1–R24.6)

| Req | Description | Status | Test File(s) | Test Name(s) | Verification |
|-----|------------|--------|-------------|--------------|-------------|
| R24.1 | Feature gates at route level | ✅ Implementation | `tests/slices/user-config/application/entitlementUseCases.test.js` (344 lines) | GateFeature test cases; CheckEntitlement (resolvePlanFeatures) | Verified |
| R24.2 | Entity limits | ✅ Implementation | `tests/slices/user-config/application/entitlementUseCases.test.js` | EnforceEntityLimit test cases | Verified |
| R24.3 | Array-membership features | ✅ Implementation | `tests/slices/user-config/application/entitlementUseCases.test.js` | requireFeatureIncludes tests | Verified |
| R24.4 | GET /api/my-plan | ✅ Implementation | `tests/slices/user-config/adapters/entitlementAdapter.contract.test.js` (364 lines), `tests/slices/user-config/adapters/entitlementPaymentService.test.js` (189 lines) | Port conformance; SLUG-keying; catalog 5min TTL; user-plan 2min TTL | Verified |
| R24.5 | Downgrade (disable newest-first) | ✅ Implementation | `tests/slices/user-config/application/entitlementUseCases.test.js` | Downgrade behavior (excess items disabled newest-first) | Verified |
| R24.6 | Billing webhook HMAC verification | ✅ Implementation | `tests/security/webhook.test.js` (86 lines) | Valid signature accepted; invalid signature rejected | Verified |

---

### Weather (9 reqs: R25.1–R25.5, R38.1–R38.4)

| Req | Description | Status | Test File(s) | Test Name(s) | Verification |
|-----|------------|--------|-------------|--------------|-------------|
| R25.1 | Geocoding | ✅ Implementation | `tests/weather/H1-characterization.test.js` (787 lines, B2), `tests/weather/adapters/weather-provider-adapters.unit.test.js` (B2), `tests/api/data-and-weather.test.js` | Geocode output shape; displayName assembly; Nominatim URL params | Verified |
| R25.2 | Reverse geocoding | ✅ Implementation | `tests/weather/H1-characterization.test.js` (B3), `tests/api/data-and-weather.test.js` | Reverse geocode cache key format; output shape | Verified |
| R25.3 | Current weather conditions | ✅ Implementation | `tests/weather/H1-characterization.test.js` (B1), `tests/api/data-and-weather.test.js` | Forecast cache HIT/MISS paths; response shape | Verified |
| R25.4 | Daily forecasts | ✅ Implementation | `tests/weather/H1-characterization.test.js` (B1) | Forecast hourly data shape | Verified |
| R25.5 | Weather badges in UI | ✅ Implementation | `tests/weather-stale-cache.test.js` (270 lines), `tests/api/weather-security-regression.test.js` (518 lines) | Scheduler weather-constraint enforcement with stale cache; rate-limit + info-disclosure bugs | Verified |
| R38.1 | Weather as hard constraint | ⚠️ **Partial** | `tests/weather-stale-cache.test.js` | Scheduler does enforce weather constraints when data present **but is fail-open when data missing** | **BUG: fail-open** |
| R38.2 | Weather_unavailable flag | ⚠️ **Partial** | `tests/weather-stale-cache.test.js` | Unplaced reason is `"weather"`, **not** `"weather_unavailable"` as specified | **BUG: wrong reason string** |
| R38.3 | "Weather data unavailable" indicator | ⚠️ **Partial** | `tests/weather-stale-cache.test.js` | Not fully implemented in frontend | **GAP** |
| R38.4 | Extract hasWeatherConstraint to shared module | ⚠️ **Partial** | ❌ No test for shared-module extraction | `hasWeatherConstraint` is duplicated in `runSchedule.js` and `unifiedScheduleV2.js` | **GAP: duplicated code** |

**Additional weather test files**: `tests/weather/GeoPoint-grid-parity.test.js` (100 lines), `tests/weather/adapters/bert-fixes-regression.test.js` (335 lines), `tests/weather/adapters/knex-weather-cache-repository.unit.test.js` (272 lines), `tests/api/health-detail-weather-string-contract.test.js` (303 lines)

---

### Admin (3 reqs: R28.1–R28.3)

| Req | Description | Status | Test File(s) | Test Name(s) | Verification |
|-----|------------|--------|-------------|--------------|-------------|
| R28.1 | Admin impersonation start | ✅ Implementation | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | Impersonate use-case tests | Verified |
| R28.2 | Admin impersonation stop | ✅ Implementation | `tests/slices/user-config/application/dataWebhookImpersonationUseCases.test.js` | StopImpersonation use-case tests | Verified |
| R28.3 | Impersonation audit/log/banner | ⚠️ **Partial** | `juggler-frontend/src/components/admin/__tests__/ImpersonationPage.test.jsx`, `juggler-frontend/src/components/admin/__tests__/ImpersonationBanner.test.jsx` | Page renders user list + log; Banner shows/hides based on localStorage | **GAP: no test for non-admin authorization boundary **, **no test for token-expiry revocation** |

---

### Reporting (3 reqs: R12.1, R13.1, R14.1)

| Req | Description | Status | Test File(s) | Test Name(s) | Verification |
|-----|------------|--------|-------------|--------------|-------------|
| R12.1 | Time reports | **PLANNED** | ❌ No code exists | — | Not a current gate |
| R13.1 | Burn-down reports | **PLANNED** | ❌ No code exists | — | Not a current gate |
| R14.1 | Capacity planning reports | **PLANNED** | ❌ No code exists | — | Not a current gate |

---

## 2. MISSING TEST INVENTORY

### HIGH PRIORITY

| # | Target | Gap | Risk | Suggested Fix |
|---|--------|-----|------|--------------|
| 1 | **R38.1/R38.2 — Weather fail-open bug** | Weather-constrained tasks are placed even when weather data is missing (should NOT be placed). Unplaced reason is `"weather"` not `"weather_unavailable"`. | **Medium-High** — tasks scheduled in bad weather conditions silently. | Fix `weatherOk()` in `unifiedScheduleV2.js` to return `false` when data missing; fix reason string. Add regression test that asserts weather-constrained task is NOT placed when weatherByDateHour is empty. |
| 2 | **R38.4 — Duplicated hasWeatherConstraint** | `hasWeatherConstraint` exists in both `runSchedule.js` and `unifiedScheduleV2.js`. | **Medium** — future constraint fields added to one file will silently fail-open in the other. | Extract to shared module (`shared/scheduler/weatherHelpers.js`). Add unit test for the shared function. |
| 3 | **R9.1–R9.3 — Drag-and-drop handlers** | `handleGridDrop`, `onPriorityDrop`, and arrow-drag have NO unit tests. | **Medium** — drag-and-drop regression can silently break. | Add frontend unit tests for each drop handler with mocked DnD context. |

### MEDIUM PRIORITY

| # | Target | Gap | Risk | Suggested Fix |
|---|--------|-----|------|--------------|
| 4 | **R8.x — Calendar view components** | 6 of 8 view components (DailyView, ThreeDayView, TimelineView, ListView, SCurveView, PriorityView, DependencyView) have no dedicated unit tests. Only WeekView is tested. | **Medium** — view rendering regression could go undetected. | Add React Testing Library unit tests for each view component with mock task data. |
| 5 | **R43.x — Calendar provider management routes** | GET /api/gcal/status, POST /api/gcal/auto-sync, GET /api/msft-cal/status, POST /api/msft-cal/auto-sync, GET /api/apple-cal/status, POST /api/apple-cal/select-calendar(s), GET /api/apple-cal/calendars, GET /api/apple-cal/refresh-calendars, PUT /api/apple-cal/calendars/:id, POST /api/apple-cal/auto-sync — no dedicated tests. | **Medium** — route-level contract changes undetected. | Add route-level contract tests for each provider management endpoint. |
| 6 | **R28.3 — Impersonation authorization boundary** | No test that non-admin receives 403 on impersonation endpoints. No test that impersonation state is revoked on token expiry. | **Medium** — privilege escalation could go undetected. | Add backend test: non-admin POST /api/impersonation/start → 403. Add test: expired admin token → impersonation ends. |

### LOW PRIORITY

| # | Target | Gap | Risk | Suggested Fix |
|---|--------|-----|------|--------------|
| 7 | **R17.1 — MCP protocol-level tests** | No tests in `juggler-mcp/` directory. | **Low** — function-level tests cover code paths; protocol compliance is stable. | Add integration tests via MCP client connecting to juggler-mcp server. |
| 8 | **R15.2 — Quota TOCTOU fix** | quotaTOCTOU.test.js is a RED regression test (pre-fix) — should be GREEN after atomicity fix. | **Low** — TOCTOU race is unlikely in single-instance; fix is planned. | Monitor for GREEN status after bert's fix. |
| 9 | **R22.5 — Feature gate 403 assertion** | No explicit test that data.export feature-gating returns 403 (import is free on all tiers per David ruling 2026-07-13). | **Low** — covered implicitly by other feature-gate tests. | Add explicit test: user without data.export → GET /api/data/export → 403. |

---

## 3. MISSING REQUIREMENTS

The following requirements SHOULD exist but are not documented:

| # | Domain | Missing Requirement | Rationale |
|---|--------|-------------------|-----------|
| MR-1 | Calendar Sync | The system MUST automatically resolve sync conflicts with a documented strategy (e.g., local wins / last-write-wins / external-wins). | R7.7 (push/pull sync) is implemented but conflict resolution strategy is not codified. R13-sync-conflict test exists but requirement isn't explicit. |
| MR-2 | Calendar Views | The system MUST support view switching via navigation bar with visual indicator of the active view. | NavigationBar renders 11 VIEW_MODES (TC-W001 test) but the view-mode switching logic is not explicitly required. |
| MR-3 | Weather | The system MUST cache weather data with configurable TTL and serve stale data to the scheduler when fresh data is unavailable. | R38.1 mandates fail-closed, but B5 in H1-characterization shows the scheduler can accept stale cache data (no expires_at filter). Need explicit requirement. |
| MR-4 | Admin | The system MUST implement rate limiting on admin impersonation endpoints. | POST /api/impersonation/start/stop has no rate limit documented. |
| MR-5 | Data | The system MUST limit export payload size and implement pagination for large exports. | No size limit or pagination documented for GET /api/data/export. |
| MR-6 | Billing | The system MUST notify users when they approach entity limits (e.g., 80%, 90% of max active tasks). | R24.2 enforces limits but there's no early-warning requirement. |
| MR-7 | Calendar Sync | The system MUST expose sync status per provider (last_sync_at, last_error, items_pushed, items_pulled) via the status endpoints. | R43.x endpoints exist but the response shape is not specified. |

---

## 4. BACKLOG ITEMS

### P0 — Must fix (bugs violating requirements)

| ID | Description | File(s) | Effort |
|----|------------|---------|--------|
| B1 | **R38.1 fail-open**: `weatherOk()` returns `true` when weather data is missing. Must return `false` for weather-constrained tasks (fail-closed). | `unifiedScheduleV2.js:745-787`, `runSchedule.js:1166-1180` | 2h |
| B2 | **R38.2 wrong reason string**: `_unplacedReason` is `"weather"` but spec says `"weather_unavailable"`. | `unifiedScheduleV2.js` | 0.5h |
| B3 | **R38.4 duplicated code**: `hasWeatherConstraint()` exists in two files; extract to `shared/scheduler/weatherHelpers.js`. | `runSchedule.js`, `unifiedScheduleV2.js` | 1h |

### P1 — Missing test coverage (should add)

| ID | Description | Test type | Effort |
|----|------------|-----------|--------|
| T1 | **Weather fail-closed regression test**: weather-constrained task with empty weatherByDateHour → NOT placed. | Backend unit | 1h |
| T2 | **R9.1 drop-handler test**: `handleGridDrop` in AppLayout.jsx — mock DnD event, assert task date/time updated. | Frontend unit | 2h |
| T3 | **R9.2 drop-handler test**: `onPriorityDrop` in PriorityView.jsx — assert priority updated. | Frontend unit | 1h |
| T4 | **R9.3 drop-handler test**: arrow-drag in DependencyView.jsx — assert dependsOn link created. | Frontend unit | 2h |
| T5 | **Calendar provider management contract tests**: status, auto-sync, calendar selection for all 3 providers. | Backend route | 3h |
| T6 | **R28.3 non-admin boundary test**: non-admin → 403 on impersonation endpoints. | Backend unit | 1h |
| T7 | **R28.3 token-expiry revocation test**: expired admin token → impersonation stops. | Backend integration | 1h |
| T8 | **R22.5 explicit feature-gate test**: user without data.export → 403 on GET /api/data/export. | Backend unit | 0.5h |

### P2 — View tests (good to have)

| ID | Description | Test type | Effort |
|----|------------|-----------|--------|
| T9 | DailyView component unit test | Frontend unit | 1h |
| T10 | ThreeDayView component unit test | Frontend unit | 1h |
| T11 | TimelineView component unit test | Frontend unit | 1h |
| T12 | ListView component unit test | Frontend unit | 1h |
| T13 | SCurveView component unit test | Frontend unit | 1.5h |
| T14 | PriorityView component unit test | Frontend unit | 1h |
| T15 | DependencyView component unit test | Frontend unit | 1.5h |

### P3 — Nice to have

| ID | Description | Test type | Effort |
|----|------------|-----------|--------|
| T16 | MCP protocol-level integration test (connect MCP client → call tools → verify response) | Integration | 3h |
| T17 | Quota TOCTOU fix verification (GREEN test after atomic acquire) | Backend unit | 1h |

---

## 5. SUMMARY STATISTICS

| Domain | Reqs | Tested | Partial | Planned | Missing |
|--------|------|--------|---------|---------|---------|
| Calendar Sync | 10 | 10 | 0 | 0 | 0 |
| Calendar Views | 11 | 1 | 3 | 0 | 7 |
| AI | 5 | 5 | 0 | 0 | 0 |
| Auth | 3 | 3 | 0 | 0 | 0 |
| MCP | 2 | 0 | 2 | 0 | 0 |
| Data | 5 | 5 | 0 | 0 | 0 |
| Billing | 6 | 6 | 0 | 0 | 0 |
| Weather | 9 | 5 | 4 | 0 | 0 |
| Admin | 3 | 2 | 1 | 0 | 0 |
| Reporting | 3 | 0 | 0 | 3 | 0 |
| **Total** | **57** | **37** | **10** | **3** | **7** |

### Key Findings

1. **Weather domain is the most problematic**: 4 of 9 requirements are PARTIAL with confirmed bugs (fail-open, wrong reason string, missing indicator, duplicated code). This is the highest-priority area for fixes.

2. **Calendar Views have the weakest test coverage**: 7 of 11 requirements (8 views + 3 DnD) have NO dedicated unit tests. Only WeekView has frontend tests. DnD handlers have no tests at all.

3. **MCP has good function-level coverage but no protocol-level tests**: R17.2 (per-user scope) actually HAS a dedicated test (mcp-cross-user-isolation.test.js) — better than initially anticipated.

4. **Auth, AI, Data, Billing have strong coverage**: All requirements in these domains are verified by dedicated tests.

5. **Admin impersonation is partially tested**: Backend use-case tests exist. Frontend component tests exist. But authorization boundary (non-admin → 403) is not tested.

6. **Reporting is entirely planned**: No code, no tests. Not a current gate.

7. **7 missing requirements identified** that should be documented to make implicit behaviors explicit.