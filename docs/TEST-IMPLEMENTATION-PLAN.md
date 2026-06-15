# Juggler Test Suite — Implementation Plan

> Generated: 2026-06-15
> Source: Survey of 223 backend test files + 32 frontend test files + 466 structured test specs across 8 spec files
> Agents used: 3 parallel planners (Phase 0, Phases 1-6, Phases 7-14)

---

## 0. EXISTING INFRASTRUCTURE

### Test Framework
- **Jest** with `--forceExit`, `maxWorkers: 1` (sequential — integration tests share DB)
- **Config**: `jest.config.js` at `juggler-backend/jest.config.js`
- **Test environment**: Node.js (backend), React Testing Library (frontend), Playwright (E2E)

### Existing Test Count
| Layer | Files | Lines |
|-------|-------|-------|
| Backend tests | 223 files | ~55,000 |
| Frontend tests | 32 files | ~4,500 |
| E2E (Playwright) | ~5 files | ~1,000 |

### Key Test Infrastructure
| File | Purpose |
|------|---------|
| `tests/helpers/time-control.js` (153L) | Clock control helper |
| `tests/helpers/test-db.js` / `testDb.js` | DB connection management |
| `tests/helpers/requireDB.js` | DB requirement guard |
| `tests/helpers/seedFullUser.js` | Full user seeding |
| `tests/helpers/real-config-fixtures.js` | Realistic config fixtures |
| `tests/helpers/test-injector.js` | Dependency injection |
| `tests/factories/task.factory.js` (371L) | Task creation factory |
| `tests/factories/user.factory.js` (295L) | User creation factory |
| `tests/factories/recurring-rule.factory.js` (749L) | Recurrence rule factory |
| `tests/factories/comprehensive.factory.js` (441L) | Comprehensive fixture builder |
| `tests/test-doubles/InMemoryTaskRepository.js` (298L) | In-memory task repo |

### Key Existing Scheduler Test Files
| File | Lines | Coverage Area |
|------|-------|---------------|
| `schedulerRules.test.js` | 2,041 | Core rules, placement, fallback ladder |
| `schedulerScenarios.test.js` | 1,088 | Complex multi-task scenarios |
| `schedulerSupplyDemand.test.js` | 866 | Capacity, supply/demand |
| `schedulerTimeSimulation.test.js` | 515 | Time-based scenarios |
| `goldenMaster.h6.test.js` | 1,420 | 43 pinned golden-master scenarios |
| `goldenMaster.a002-location.test.js` | 798 | Location/tool golden master |
| `expandRecurring.test.js` | 731 | Recurring expansion |
| `unifiedSchedule.test.js` | 352 | Core scheduler unit tests |
| `depsGatingCharacterization.test.js` | 555 | Dependency gating |
| `scheduleQueue.test.js` | 149 | Debounce/rate limit |

---

## 1. PHASE DEPENDENCY GRAPH

```
Phase 0 (Infrastructure) ─────── BLOCKS EVERYTHING TIME-DEPENDENT
  │
  ├──► Phase 1 (Placement Modes) ──► Phase 7 (Phases/Triggers)
  ├──► Phase 2 (Recurrence) ────────┤
  ├──► Phase 3 (Splits) ─────────────┤
  ├──► Phase 4 (Deadlines/ES) ──────┤
  ├──► Phase 5 (Weather) ───────────┤
  ├──► Phase 6 (Dependencies) ───────┤
  │                                  ├──► Phase 9 (Templates)
  │                                  │
  ├──► Phase 8 (Calendar Sync) ──────┤
  │                                  │
  ├──► Phase 10 (Edge Cases) ────────┤
  │       ^-- Phase 10 is INDEPENDENT (pure validation)
  │                                  │
  └──► Phase 11 (Time-Travel) ───────┤
                                     ├──► Phase 12 (Adversarial Fixes)
                                     │
                                     └──► Phase 13 (Frontend) ──► Phase 14 (E2E)
                                          ^-- INDEPENDENT of backend
```

---

## 2. PHASE DETAILS

### Phase 0: Infrastructure Prerequisites
**Effort: 22h. CRITICAL PATH — blocks ~300 tests.**

| Task | Effort | Description |
|------|--------|-------------|
| 0.1 FakeClockAdapter | 2h | `src/slices/scheduler/adapters/FakeClockAdapter.js` — implements ClockPort (now, dbNow, advance, tick, skipDays, setTime, reset) |
| 0.2 FakeWeatherProvider | 1h | `src/slices/scheduler/adapters/FakeWeatherProvider.js` — implements WeatherProviderPort with setHour, setRange, setEmpty, setNoData |
| 0.3 Refactor legacy scheduler for ClockPort | 8h | **HARDEST TASK**: Replace all ~50+ `new Date()` calls in `unifiedScheduleV2.js` and `runSchedule.js` with injected clock. Must preserve byte-identical output. Run golden-master before/after. |
| 0.4 Refactor legacy scheduler for WeatherProvider | 4h | Inject weather provider into scheduler. Preserve fail-open behavior. |
| 0.5-0.6 Shared fixtures + timezone setup | 4h | Create `setupTest()` combining clock + weather + config + tasks. Add timezone default to all helpers. |
| 0.7-0.8 Documentation | 3h | Document scheduling-relevant field list. Update test-bed. |

---

### Phase 1: Placement Modes (TS-01 to TS-71)
**Effort: 28h. 71 tests. New file: `tests/scheduler/placementModes.test.js` + `tests/scheduler/modeTransitions.test.js`**

| Sub-phase | Tests | Key Focus |
|-----------|-------|-----------|
| Anytime (TS-01 to TS-22) | 22 | Earliest slot, deadline, startAfter, dayReq, when-tags, flexWhen, location/tools, travel, deps |
| Time Window (TS-23 to TS-34) | 12 | Window bounds, flex=0 degenerate, recurring, missed window |
| Time Blocks (TS-35 to TS-41) | 7 | Named block matching, flexWhen, custom tags, strict mode |
| Fixed (TS-42 to TS-51) | 10 | Exact time immovable, 400 validation, drag-to-fixed, mode exit |
| All Day (TS-52 to TS-57) | 6 | Banner, time ignored, recurring |
| Reminder (TS-58 to TS-61) | 4 | Zero occupancy, hidden controls |
| Mode Transitions (TS-62 to TS-71) | 10 | All pairwise mode changes, calendar-sync lock, takeOwnership |

---

### Phase 2: Recurrence (TS-72 to TS-110)
**Effort: 20h. 39 tests. 4 new files.**

| Sub-phase | Tests | File | Key Focus |
|-----------|-------|------|-----------|
| Recurrence Types (TS-72-84) | 13 | `recurrenceTypes.test.js` | Daily, weekly, biweekly, monthly, interval, rolling, recurEnd/Start, paused, horizon, grandfather |
| TPC (TS-85-93) | 9 | `tpc.test.js` | Keep/backfill, spacing guard, safety valve, target-interval steering |
| Rolling (TS-94-100) | 7 | `rollingRecurrence.test.js` | Anchor update on done/skip/cancel/missed, backfill, materialization |
| Instance Lifecycle (TS-101-110) | 10 | `instanceLifecycle.test.js` | All terminal statuses, missed detection (3 paths), delete |

---

### Phase 3: Splits (TS-111 to TS-126br)
**Effort: 24h. 60 tests. 3 new files.**

| Sub-phase | Tests | Key Focus |
|-----------|-------|-----------|
| Non-recurring splits (TS-111-119) | 9 | Inline chunks, split_min, runt merge, cross-day, travel, partial_split |
| Recurring splits (TS-120-126) | 7 | Pre-materialized, day-locked, time-boxed, overflow, drift fix |
| Split × Mode/Weather/Template/Travel/Location/Status/R×T | 44 | All interaction sub-domains |

---

### Phase 4: Deadlines & Earliest-Start (TS-127 to TS-141q)
**Effort: 23h. 46 tests. 2 new files.**

| Sub-phase | Tests | Key Focus |
|-----------|-------|-----------|
| Deadline base + × Template/Split/Dependency/Weather/Time | 33 | Hard bound, slack, P1 boost, ignoreDeadline, chain backprop, auto-brackets |
| Earliest-Start base + × Template/Split/Deadline/Time | 23 | Hard lower bound, slack effect, validation 400, impossible window |

---

### Phase 5: Weather (TS-142 to TS-154x)
**Effort: 15h. 37 tests. 1 new file: `tests/scheduler/weather.test.js`**

| Sub-phase | Tests | Key Focus |
|-----------|-------|-----------|
| Weather base (TS-142-154) | 13 | Precip/cloud/temp/humidity, fail-open, API down, cache refresh, parity |
| Weather × Template/Split/Dependency/Recurrence/Time | 24 | All interactions — location change, per-chunk, predecessor, instance |

---

### Phase 6: Dependencies (TS-155 to TS-162y)
**Effort: 12h. 33 tests. 1 new file.**

| Sub-phase | Tests | Key Focus |
|-----------|-------|-----------|
| Dependency base (TS-155-162) | 8 | A→B placement, chain, unmet, circular, recurring, deadline backprop |
| Dependency × Template (TS-162a-y) | 25 | Template change cascade, location, recurring, deadline, split, weather, mode |

---

### Phase 7: Scheduler Phases & Triggers (TS-163 to TS-194)
**Effort: 15h. 31 tests. 2 new files: `tests/scheduler/schedulerPhases.test.js`, `tests/scheduler/rescheduleTriggers.test.js`**

| Sub-phase | Tests | Key Focus |
|-----------|-------|-----------|
| Phase 0-7 (TS-163-170) | 8 | Immovables, queue, retry, missed preferred/window, past-anchored, rigid forced, deadline relaxed |
| Fallback ladder (TS-171-175) | 5 | All 4 passes + all-fail |
| Reschedule triggers (TS-176-194) | 18 | All 19 triggers + debounce + rate limit + non-triggers |

---

### Phase 8: Calendar Sync (TS-195 to TS-206)
**Effort: 13h. 12 tests. 2 new files.**

| Sub-phase | Key Focus |
|-----------|-----------|
| OAuth connect/disconnect | GCal, MSFT, Apple — token flow, user_calendars, initial sync |
| Push/pull | Fixed-only push, hash update, recurring push, ANYTIME skip, MISS_THRESHOLD, CDN grace |
| Sync-locked + takeOwnership | guardFixedCalendarWhen, allowUnfix, detach → anytime |
| Error/concurrent/split/multi | HTTP errors, lock contention, merge/unmerge, per-provider isolation |

---

### Phase 9: User Config & Template Interaction (TS-207 to TS-250)
**Effort: 19h. 44 tests. 2 new files.**

| Sub-phase | Tests | Key Focus |
|-----------|-------|-----------|
| User config (TS-207-214) | 8 | Time blocks, location schedule, tool matrix, preferences, config→rerun |
| Template × when-tag (TS-215-222) | 8 | Default, holiday, travel, custom, blocks added/removed, recurring |
| Template × location/tools (TS-223-235) | 13 | All location resolution chain steps, tool matrix AND logic |
| Combined + edge cases (TS-236-250) | 15 | Full chain, debounce, non-existent templateId, overlapping, zero-duration, clamping |

---

### Phase 10: Edge Cases & Validation (TS-251 to TS-272)
**Effort: 8h. 22 tests. INDEPENDENT — can start immediately.**

| Sub-phase | Key Focus |
|-----------|-----------|
| Input validation (TS-251-268) | All Zod schema boundaries: text(1-500), dur(5-480), timeFlex(0-480), enum values, null/undefined, passthrough |
| Resilience (TS-269-272) | Null mode, concurrent runs, crash recovery, migration rollback |

---

### Phase 11: Time-Travel & Clock Control (TS-273 to TS-288)
**Effort: 8h. 16 tests. BLOCKED by Phase 0.3.**

| Sub-phase | Key Focus |
|-----------|-----------|
| Clock advance effects | Overdue, missed, recurring generation, rolling anchor, nudge, start_after crossing, weather change |
| Horizon/weekend/advance | 14-day horizon, grandfather clause, split time-box, debounce, weekday→weekend |

---

### Phase 12: Adversarial Gap Fixes (TS-301 to TS-348)
**Effort: 28h. 51 tests. 18 new files.**

| Gap | Tests | File |
|-----|-------|------|
| CONTRA-1: fixed+recurring | TS-301-304 (4) | `fixedRecurringGap.test.js` |
| G-001: TPC fill policy | TS-305-308 (4) | `tpcFillPolicy.test.js` |
| G-005: split status propagation | TS-309-312 (4) | `splitStatusPropagation.test.js` |
| G-006: past time_blocks | TS-293 (1) | `pastRecurringTimeBlocks.test.js` |
| G-002: clock wiring | TS-314-317 (4) | `clockWiringGap.test.js` |
| G-003: weather fail-open | TS-318-319 (2) | `weatherFailOpen.test.js` |
| G-004: status transition matrix | TS-320-329 (10) | `statusTransitionMatrix.test.js` |
| G-010 to G-020 (MED) | TS-335-345 (11) | 11 separate files |
| G-030 to G-033 (cross-domain) | TS-299/300/313/346-348 (6) | `crossDomain.test.js` |
| G-021 to G-029 (LOW) | TBD (~9) | `lowPriorityGaps.test.js` |

---

### Phase 13: Frontend Tests
**Effort: 17h. 10 new files. INDEPENDENT.**

| Sub-phase | Key Focus |
|-----------|-----------|
| View components | DailyView, ThreeDayView, TimelineView, ListView, SCurveView, PriorityView, DependencyView |
| Drag-and-drop handlers | handleGridDrop, onPriorityDrop, arrow-drag (pure function tests) |
| WhenSection extended | Mode toggle interactions, fixed/reminder rendering |
| Weather badge UI | Icon rendering per condition, F/C display, missing-data fallback |

---

### Phase 14: E2E / Integration
**Effort: 13h. 3 new files.**

| Sub-phase | Key Focus |
|-----------|-----------|
| Full-stack scheduler | Playwright: create → schedule → verify → modify → re-schedule |
| Calendar sync | OAuth connect → push → pull → verify (requires .env.test tokens) |
| MCP protocol | In-process JSON-RPC: tasks.create/update/list/delete, error handling |

---

## 3. FILES TO CREATE

### Backend (27 files)
| # | File | Phase |
|---|------|-------|
| 1 | `tests/scheduler/placementModes.test.js` | 1 |
| 2 | `tests/scheduler/modeTransitions.test.js` | 1 |
| 3 | `tests/scheduler/recurrenceTypes.test.js` | 2 |
| 4 | `tests/scheduler/tpc.test.js` | 2 |
| 5 | `tests/scheduler/rollingRecurrence.test.js` | 2 |
| 6 | `tests/scheduler/instanceLifecycle.test.js` | 2 |
| 7 | `tests/scheduler/splitNonRecurring.test.js` | 3 |
| 8 | `tests/scheduler/splitRecurring.test.js` | 3 |
| 9 | `tests/scheduler/splitInteractions.test.js` | 3 |
| 10 | `tests/scheduler/deadlines.test.js` | 4 |
| 11 | `tests/scheduler/earliestStart.test.js` | 4 |
| 12 | `tests/scheduler/weather.test.js` | 5 |
| 13 | `tests/scheduler/dependencies.test.js` | 6 |
| 14 | `tests/scheduler/schedulerPhases.test.js` | 7 |
| 15 | `tests/scheduler/rescheduleTriggers.test.js` | 7 |
| 16 | `tests/calendar/oauthConnect.test.js` | 8 |
| 17 | `tests/calendar/syncFlow.test.js` | 8 |
| 18 | `tests/scheduler/userConfig.test.js` | 9 |
| 19 | `tests/scheduler/templateTaskInteraction.test.js` | 9 |
| 20 | `tests/validation/zodValidation.test.js` | 10 |
| 21 | `tests/resilience/nullMode.test.js` | 10 |
| 22 | `tests/scheduler/timeTravel.test.js` | 11 |
| 23-28 | `tests/adversarial/*.test.js` (6 files) | 12 |
| 29-38 | `tests/adversarial/*.test.js` (10 files) | 12 |

### Frontend (10 files)
| # | File |
|---|------|
| 1-7 | `src/components/views/__tests__/{Daily,ThreeDay,Timeline,List,SCurve,Priority,Dependency}View.test.jsx` |
| 8 | `src/components/views/__tests__/dragDropHandlers.test.jsx` |
| 9 | `src/components/weather/__tests__/WeatherBadge.test.jsx` |
| 10 | Extend `src/components/tasks/sections/__tests__/WhenSection.modes.test.jsx` |

### E2E (3 files)
| # | File |
|---|------|
| 1 | `tests/e2e/fullStackScheduler.spec.js` (Playwright) |
| 2 | `tests/e2e/calendarSyncE2E.spec.js` (Playwright) |
| 3 | `tests/mcp/integration.test.js` (Jest) |

### Infrastructure (3 new source files)
| # | File | Phase |
|---|------|-------|
| 1 | `src/slices/scheduler/adapters/FakeClockAdapter.js` | 0.1 |
| 2 | `src/slices/scheduler/adapters/FakeWeatherProvider.js` | 0.2 |
| 3 | `tests/helpers/test-fixture-builder.js` | 0.5 |

---

## 4. EFFORT SUMMARY

| Phase | Effort | Parallel? | Blocker | Tests |
|-------|--------|-----------|---------|-------|
| **Phase 0** (Infrastructure) | 22h | No | None | ~6 (unit tests for fakes) |
| **Phase 1** (Placement Modes) | 28h | Yes (sub-tasks) | Phase 0.3 | 71 |
| **Phase 2** (Recurrence) | 20h | Yes (sub-tasks) | Phase 0.3 | 39 |
| **Phase 3** (Splits) | 24h | Yes (sub-tasks) | Phase 0.3 | 60 |
| **Phase 4** (Deadlines/ES) | 23h | Yes (sub-tasks) | Phase 0.3 | 46 |
| **Phase 5** (Weather) | 15h | Yes (sub-tasks) | Phase 0.2, 0.4 | 37 |
| **Phase 6** (Dependencies) | 12h | Yes (sub-tasks) | Phase 0.3 | 33 |
| **Phase 7** (Phases/Triggers) | 15h | Partial | Phases 1-6 | 31 |
| **Phase 8** (Calendar Sync) | 13h | Partial | Phase 0.3 | 12 |
| **Phase 9** (Templates) | 19h | Partial | Phases 1-6 | 44 |
| **Phase 10** (Edge Cases) | 8h | **Independent** | None | 22 |
| **Phase 11** (Time-Travel) | 8h | No | Phase 0.3 | 16 |
| **Phase 12** (Adversarial) | 28h | Partial | Phases 1-6 | 51 |
| **Phase 13** (Frontend) | 17h | **Independent** | None | ~40 |
| **Phase 14** (E2E) | 13h | No | Everything | ~10 |
| **Total** | **265h** | | | **~466** |

---

## 5. PARALLEL EXECUTION PLAN (3 Developers)

```
Week 1-2:
  Dev A → Phase 0 (Infrastructure) — MUST go first
  Dev B → Phase 10 (Edge Cases) — independent, starts immediately
  Dev C → Phase 13 (Frontend) — independent, starts immediately

Week 3-4:
  Dev A → Phase 1 (Placement Modes) + Phase 2 (Recurrence)
  Dev B → Phase 3 (Splits) + Phase 6 (Dependencies)
  Dev C → Phase 4 (Deadlines/ES) + Phase 5 (Weather)

Week 5-6:
  Dev A → Phase 7 (Phases/Triggers) + Phase 9 (Templates)
  Dev B → Phase 8 (Calendar Sync) + Phase 11 (Time-Travel)
  Dev C → Phase 12 (Adversarial — HIGH gaps)

Week 7-8:
  Dev A → Phase 12 (Adversarial — MED + cross-domain)
  Dev B → Phase 12 (Adversarial — LOW)
  Dev C → Phase 14 (E2E)

Total calendar time: ~8 weeks with 3 developers (265 person-hours)
```

---

## 6. RISKS & BLOCKERS

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Phase 0.3** — refactoring legacy scheduler for ClockPort (~50+ `new Date()` calls) | Blocks ALL time-dependent tests (~300 of 466) | Start Phase 0.3 first. Run golden-master before/after to verify byte-identical output. Can fall back to hardcoded `TODAY`/`NOW_MINS` for interim testing. |
| **Phase 0.4** — weather provider injection | Blocks 37 weather tests | FakeWeatherProvider is trivial (Phase 0.2). Wiring into legacy scheduler is the hard part. |
| **schedulerRules.test.js** is 2,041 lines | Maintainability cliff | Create focused new files per sub-domain instead of extending this further. |
| **Sequential Jest** (maxWorkers: 1) | Slow CI (~30 min for current 223 files) | Acceptable for now. New files add ~12,000 lines → expect ~60 min full suite. |
| **test-bed Docker dependency** | Integration/E2E tests need MySQL | Pure-unit tests (majority) don't need DB. Mark DB-dependent tests clearly. |
| **OAuth tokens for calendar sync** | E2E tests can't run in CI | Mock sync provider for CI. Full E2E with real tokens runs manually. |
| **Golden-master tests** may shift during refactoring | Regression risk | Pin before/after. Deviations must be reviewed and golden-master updated intentionally. |

---

## 7. TEST ORGANIZATION STRATEGY

### Backend Test Layout
```
tests/
├── scheduler/           # Core scheduler: ~13 new files, ~450 tests
│   ├── placementModes.test.js
│   ├── modeTransitions.test.js
│   ├── recurrenceTypes.test.js
│   ├── tpc.test.js
│   ├── rollingRecurrence.test.js
│   ├── instanceLifecycle.test.js
│   ├── splitNonRecurring.test.js
│   ├── splitRecurring.test.js
│   ├── splitInteractions.test.js
│   ├── deadlines.test.js
│   ├── earliestStart.test.js
│   ├── weather.test.js
│   ├── dependencies.test.js
│   ├── schedulerPhases.test.js
│   ├── rescheduleTriggers.test.js
│   ├── userConfig.test.js
│   ├── templateTaskInteraction.test.js
│   └── timeTravel.test.js
├── calendar/             # Calendar sync: 2 new files
│   ├── oauthConnect.test.js
│   └── syncFlow.test.js
├── validation/           # Input validation: 1 new file
│   └── zodValidation.test.js
├── resilience/           # Error handling: 1 new file
│   └── nullMode.test.js
├── adversarial/          # Gap fixes: ~18 new files
│   ├── fixedRecurringGap.test.js
│   ├── tpcFillPolicy.test.js
│   ├── splitStatusPropagation.test.js
│   ├── pastRecurringTimeBlocks.test.js
│   ├── clockWiringGap.test.js
│   ├── weatherFailOpen.test.js
│   ├── statusTransitionMatrix.test.js
│   ├── crossDomain.test.js
│   ├── lowPriorityGaps.test.js
│   └── (10 more one-off files)
└── [existing files remain]
```

### Test Pattern
Each test file follows:
```
const { makeTask, makeCfg, runSchedule } = require('./test-helpers');

describe('Domain Name', () => {
  beforeEach(() => {
    // Reset clock, weather, config to defaults
  });

  test('TS-NNN: Title', () => {
    // Data Setup
    const task = makeTask({ ... });
    const cfg = makeCfg({ ... });
    const clock = new FakeClockAdapter('2026-06-15T08:00:00Z');

    // Action
    const result = runSchedule(tasks, statuses, clock.now(), cfg);

    // Expected Outcome
    expect(result.dayPlacements['2026-06-15']).toContainEqual(
      expect.objectContaining({ id: task.id, ... })
    );
  });
});
```