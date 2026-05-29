# Juggler Hexagonal Architecture Migration WBS

**Created:** 2026-01-15
**Status:** Planning
**Priority:** High
**Duration:** 14 weeks (2-developer team)

---

## Overview

This WBS defines the work to migrate Juggler from monolithic MVC to hexagonal (ports & adapters) architecture. The scheduler is the core domain and highest-risk component.

### Key Differentiators from Resume Optimizer

1. **Scheduler is Core** — 5,097 lines of scheduling algorithm, NOT controllers
2. **Calendar Adapters Exist** — Already separated, need port interfaces
3. **MCP Server** — External-facing adapter that needs facade
4. **Minimal Services** — Only 3 service files, more extraction needed

---

## Phase 0: Prerequisites (Day 1)

### 0.1 Documentation Review
- [ ] Read `juggler/docs/architecture/SCHEDULER.md` (756 lines) — core algorithm
- [ ] Read `juggler/docs/architecture/TASK-PROPERTIES.md` — task fields
- [ ] Read `juggler/docs/architecture/TASK-STATE-MATRIX.md` — state transitions
- [ ] Read `juggler/CLAUDE.md` — project conventions
- [ ] Read `JUGGLER-HEX-REVIEW.md` — architecture analysis

### 0.2 Codebase Analysis
- [ ] Map all `db()` calls in `scheduler/` files (expected ~100)
- [ ] Map all `db()` calls in `controllers/` (known: 122)
- [ ] Identify calendar adapter patterns (`lib/apple-cal-api.js`, etc.)
- [ ] Identify MCP server entry points

### 0.3 Infrastructure Check
- [ ] Verify `test-bed/` Docker environment works
- [ ] Verify `dev-bed/` Docker environment works
- [ ] Confirm test database isolation (port 3407)

---

## Phase 1: Infrastructure Layer (2 weeks)

### 1.1 lib-db Extraction [bert]
- [ ] Create `lib/db/index.js` with `createKnex(config)`, `withTransaction(fn)`
- [ ] Extract from `src/db.js` — singleton removal
- [ ] Create KnexTransactionContext class
- [ ] Write unit tests
- [ ] Update all consumers to use lib-db
- [ ] Delete singleton `src/db.js`
- [ ] Verify all tests pass

### 1.2 lib-logger Extraction [abby]
- [ ] Create `lib/logger/index.js` with `createLogger(name, config)`
- [ ] Extract logging patterns from scattered files
- [ ] Per-slice named loggers
- [ ] Write unit tests
- [ ] Migrate all `console.log`/`winston` calls
- [ ] Verify log output format unchanged

### 1.3 lib-config Extraction [abby]
- [ ] Create `lib/config/index.js` with `createConfig(schema)`
- [ ] Unified config access (env vars, secrets)
- [ ] Feature flag abstraction
- [ ] Write unit tests
- [ ] Migrate from `src/config/` and env vars
- [ ] Verify all config loads correctly

### 1.4 lib-cache Extraction [abby]
- [ ] Create `lib/cache/index.js` with CachePort interface
- [ ] RedisCacheAdapter implementation
- [ ] InMemoryCacheAdapter for tests
- [ ] Write unit tests
- [ ] Migrate from `src/lib/redis.js` usage patterns
- [ ] Verify cache invalidation works

### 1.5 lib-events Creation [bert]
- [ ] Create `lib/events/index.js` with EventBus
- [ ] `eventBus.publish(type, payload)`
- [ ] `eventBus.subscribe(type, handler)`
- [ ] InMemoryEventBus for tests
- [ ] Write unit tests
- [ ] Document event types (task.created, task.updated, etc.)

---

## Phase 2: Calendar Port (2 weeks)

### 2.1 CalendarPort Interface [abby]
- [ ] Create `slices/calendar/domain/ports/CalendarPort.js` (JSDoc typedef)
- [ ] Define methods: `getEvents()`, `createEvent()`, `updateEvent()`, `deleteEvent()`, `sync()`
- [ ] Define SyncState entity
- [ ] Write port contract tests

### 2.2 Google Calendar Adapter [abby]
- [ ] Refactor `lib/gcal-api.js` into `slices/calendar/adapters/GoogleCalendarAdapter.js`
- [ ] Implement CalendarPort interface
- [ ] Handle OAuth flow
- [ ] Write integration tests (mock API)

### 2.3 Microsoft Calendar Adapter [abby]
- [ ] Refactor `lib/msft-cal-api.js` into `slices/calendar/adapters/MicrosoftCalendarAdapter.js`
- [ ] Implement CalendarPort interface
- [ ] Handle OAuth flow
- [ ] Write integration tests (mock API)

### 2.4 Apple Calendar Adapter [abby]
- [ ] Refactor `lib/apple-cal-api.js` into `slices/calendar/adapters/AppleCalendarAdapter.js`
- [ ] Implement CalendarPort interface
- [ ] Handle CalDAV protocol
- [ ] Write integration tests (mock API)

### 2.5 In-Memory Calendar Adapter [abby]
- [ ] Create `slices/calendar/adapters/InMemoryCalendarAdapter.js` for tests
- [ ] Full CalendarPort implementation
- [ ] Write unit tests

### 2.6 Calendar Facade [abby]
- [ ] Create `slices/calendar/facade.js` as single public API
- [ ] Export only: CalendarService, CalendarPort, adapters
- [ ] Update `cal-sync.controller.js` to use facade
- [ ] Verify calendar sync still works

---

## Phase 3: Task Domain (2 weeks)

### 3.1 Task Entity [telly]
- [ ] Create `slices/task/domain/entities/Task.js`
- [ ] Pure JS class with no external dependencies
- [ ] Methods: `getDuration()`, `isRecurring()`, `isOverdue()`, `hasDeadline()`
- [ ] Value objects: TaskId, TaskStatus, PlacementMode
- [ ] Write unit tests

### 3.2 TaskRepositoryPort [telly]
- [ ] Create `slices/task/domain/ports/TaskRepositoryPort.js` (JSDoc typedef)
- [ ] Methods: `findById()`, `findByIds()`, `findByUser()`, `save()`, `delete()`
- [ ] Write port contract tests

### 3.3 KnexTaskRepository [bert]
- [ ] Create `slices/task/adapters/KnexTaskRepository.js`
- [ ] Implement TaskRepositoryPort
- [ ] Extract DB logic from `task.controller.js`
- [ ] Write integration tests (testcontainers)

### 3.4 InMemoryTaskRepository [telly]
- [ ] Create `slices/task/adapters/InMemoryTaskRepository.js` for tests
- [ ] Full repository implementation
- [ ] Write unit tests

### 3.5 Task Commands [bert]
- [ ] Create `slices/task/application/commands/CreateTaskCommand.js`
- [ ] Create `slices/task/application/commands/UpdateTaskCommand.js`
- [ ] Create `slices/task/application/commands/CompleteTaskCommand.js`
- [ ] Create `slices/task/application/commands/SplitTaskCommand.js`
- [ ] Write handler tests

### 3.6 Task Queries [telly]
- [ ] Create `slices/task/application/queries/GetTaskQuery.js`
- [ ] Create `slices/task/application/queries/ListTasksQuery.js`
- [ ] Write handler tests

### 3.7 Task Facade [bert]
- [ ] Create `slices/task/facade.js`
- [ ] Export: TaskService, TaskRepository, commands, queries
- [ ] Update `task.controller.js` to use facade
- [ ] Verify task CRUD still works

---

## Phase 4: Scheduler Domain (4 weeks) — Most Critical

### 4.1 Scheduler Analysis [bert]
- [ ] Map dependencies in `unifiedScheduleV2.js` (1,811 lines)
- [ ] Map dependencies in `runSchedule.js` (2,197 lines)
- [ ] Identify pure functions vs DB-coupled code
- [ ] Document data flow: input → algorithm → output

### 4.2 ConstraintSolver Service [bert]
- [ ] Extract constraint logic from `runSchedule.js`
- [ ] Create `slices/scheduler/domain/services/ConstraintSolver.js`
- [ **PURE FUNCTION** — no DB, no external calls
- [ ] Methods: `solve(tasks, constraints, timeWindows)`
- [ ] Write unit tests with zero dependencies

### 4.3 ScoreEngine Service [telly]
- [ ] Extract scoring logic from `scoreSchedule.js` (181 lines)
- [ ] Create `slices/scheduler/domain/services/ScoreEngine.js`
- [ **PURE FUNCTION** — no DB, no external calls
- [ ] Methods: `score(schedule)`, `compare(schedules)`
- [ ] Write unit tests with zero dependencies

### 4.4 TaskProviderPort [bert]
- [ ] Create `slices/scheduler/domain/ports/TaskProviderPort.js`
- [ ] Methods: `getTasksForUser()`, `getRecurringTemplates()`, `getTaskInstances()`
- [ ] Separates scheduler from task DB access

### 4.5 CalendarProviderPort [abby]
- [ ] Create `slices/scheduler/domain/ports/CalendarProviderPort.js`
- [ ] Methods: `getEventsForDay()`, `getBusySlots()`
- [ ] Separates scheduler from calendar API access

### 4.6 SchedulerTaskProvider [bert]
- [ ] Create `slices/scheduler/adapters/SchedulerTaskProvider.js`
- [ ] Implements TaskProviderPort
- [ ] Queries task tables
- [ ] No scheduling logic, just data retrieval

### 4.7 SchedulerCalendarProvider [abby]
- [ ] Create `slices/scheduler/adapters/SchedulerCalendarProvider.js`
- [ ] Implements CalendarProviderPort
- [ ] Uses Calendar facade
- [ ] No scheduling logic, just data retrieval

### 4.8 RunScheduleCommand [bert]
- [ ] Create `slices/scheduler/application/commands/RunScheduleCommand.js`
- [ ] Injects TaskProvider, CalendarProvider, ConstraintSolver, ScoreEngine
- [ ] Orchestrates scheduling algorithm
- [ ] Writes results via TaskRepository

### 4.9 ScheduleSession Entity [telly]
- [ ] Create `slices/scheduler/domain/entities/ScheduleSession.js`
- [ ] Tracks scheduling state (current phase, conflicts, placements)
- [ ] Methods for rollback and conflict resolution

### 4.10 Scheduler Facade [bert]
- [ ] Create `slices/scheduler/facade.js`
- [ ] Export: SchedulerService, ConstraintSolver, ScoreEngine
- [ ] Update `unifiedScheduleV2.js` to use facade
- [ ] Run full scheduler test suite

### 4.11 Scheduler Integration Tests [telly]
- [ ] Create `slices/scheduler/tests/integration/` structure
- [ ] Testcontainers for MySQL
- [ ] Test scheduler with real DB
- [ ] Verify algorithm correctness

---

## Phase 5: Weather Domain (1 week)

### 5.1 WeatherConstraintService [abby]
- [ ] Create `slices/weather/domain/services/WeatherConstraintService.js`
- [ ] Pure function: `isWeatherOK(task, forecast)`
- [ ] No external dependencies

### 5.2 WeatherProviderPort [abby]
- [ ] Create `slices/weather/domain/ports/WeatherProviderPort.js`
- [ ] Methods: `getForecast(location, date)`, `getCurrentConditions(location)`

### 5.3 OpenWeatherMapAdapter [abby]
- [ ] Refactor from `weather.controller.js`
- [ ] Implement WeatherProviderPort
- [ ] Handle API rate limits

### 5.4 MockWeatherProvider [telly]
- [ ] Create `slices/weather/adapters/MockWeatherProvider.js` for tests
- [ ] Return predictable data

### 5.5 Weather Facade [abby]
- [ ] Create `slices/weather/facade.js`
- [ ] Update `weather.controller.js` to use facade

---

## Phase 6: Remaining Slices (2 weeks)

### 6.1 User Slice [bert]
- [ ] Extract user preferences from `config.controller.js`
- [ ] Create UserPreference entity
- [ ] Create UserRepositoryPort
- [ ] Create KnexUserRepository
- [ ] Create facade

### 6.2 AI Enrichment Slice [abby]
- [ ] Already has services layer (minimal extraction)
- [ ] Create AIPort interface
- [ ] Create GeminiAdapter (extract from `services/gemini-tracked-call.js`)
- [ ] Create MockAIClient for tests

### 6.3 MCP Adapter [bert]
- [ ] Create `slices/task/adapters/McpServerAdapter.js`
- [ ] Implements MCP protocol for external clients
- [ ] Uses Task facade internally
- [ ] Separate from HTTP controller

---

## Phase 7: Clean Up (1 week)

### 7.1 Deprecation Warnings [bert]
- [ ] Add deprecation warnings to old import paths
- [ ] Document migration guide
- [ ] Update all consumers

### 7.2 ESLint Boundary Rules [telly]
- [ ] Create `eslint.boundaries.config.js`
- [ ] Enforce: no cross-slice imports except through facades
- [ ] Enforce: no DB imports in domain layer

### 7.3 Documentation [bird]
- [ ] Update `juggler/CLAUDE.md` with hex conventions
- [ ] Document each slice in `slices/*/README.md`
- [ ] Create architecture decision records (ADRs)

### 7.4 Test Coverage Audit [telly]
- [ ] Run coverage report
- [ ] Target: 80%+ unit test coverage (no DB)
- [ ] Target: 90%+ integration test coverage

### 7.5 Performance Benchmarks [bert]
- [ ] Benchmark scheduler before/after
- [ ] Ensure no regression in scheduling time
- [ ] Document performance characteristics

---

## Phase 8: Test Infrastructure (Ongoing, Parallel)

### 8.1 Testcontainers Setup [telly]
- [ ] Create `tests/integration/testcontainers-setup.js`
- [ ] MySQL container with test schema
- [ ] Redis container for cache tests

### 8.2 Test Data Factories [telly]
- [ ] Create `tests/factories/TaskFactory.js`
- [ ] Create `tests/factories/UserFactory.js`
- [ ] Create `tests/factories/CalendarEventFactory.js`

### 8.3 Integration Test Suite [bert]
- [ ] Create `tests/integration/scheduler.test.js`
- [ ] Create `tests/integration/task-crud.test.js`
- [ ] Create `tests/integration/calendar-sync.test.js`

### 8.4 E2E Test Suite [bird]
- [ ] Create `tests/e2e/scheduling-flow.test.js`
- [ ] Create `tests/e2e/calendar-integration.test.js`

---

## Dependencies Between Phases

```
Phase 0 ─┬─> Phase 1 (infrastructure)
         │
         └─> Phase 8 (test infra, parallel)

Phase 1 ──> Phase 2 (calendar port)
            Phase 3 (task domain)
            Phase 5 (weather domain)

Phase 2 ──> Phase 4.6-4.7 (scheduler providers)

Phase 3 ──> Phase 4.4 (task provider)

Phase 4 ──> Phase 6.3 (MCP adapter)

Phase 6 ──> Phase 7 (clean up)
```

---

## Risk Assessment

| Risk | Phase | Mitigation |
|------|-------|------------|
| Scheduler algorithm regression | 4 | Extensive unit tests, benchmark before/after |
| Calendar API changes | 2 | Port abstraction isolates changes |
| Test infrastructure gaps | 8 | Start early, run parallel |
| Controller bloat extraction | 6 | Incremental, one domain at a time |
| Dependency cycles | All | ESLint boundary rules enforce clean architecture |

---

## Verification Gates

### Gate 1: Infrastructure Complete
- [ ] lib-db, lib-logger, lib-config, lib-cache, lib-events extracted
- [ ] All tests pass
- [ ] No singleton imports

### Gate 2: Calendar Port Complete
- [ ] CalendarPort interface defined
- [ ] All 3 adapters implement interface
- [ ] InMemoryCalendarAdapter works
- [ ] Calendar sync still functional

### Gate 3: Task Domain Complete
- [ ] Task entity created
- [ ] Repository pattern implemented
- [ ] CRUD operations work through facade

### Gate 4: Scheduler Domain Complete
- [ ] ConstraintSolver is pure (no DB)
- [ ] ScoreEngine is pure (no DB)
- [ ] Scheduler runs with injected providers
- [ ] Performance no worse than baseline

### Gate 5: All Slices Extracted
- [ ] User, Weather, AI, MCP slices created
- [ ] All controllers use facades
- [ ] ESLint boundary rules enforced

### Gate 6: Documentation Complete
- [ ] All slices have README
- [ ] ADRs written
- [ ] CLAUDE.md updated

---

## Summary Statistics

| Metric | Before | After |
|--------|--------|-------|
| Controllers with 2000+ lines | 2 | 0 |
| Pure domain services | 0 | 10+ |
| Port interfaces | 0 | 15+ |
| In-memory test doubles | 0 | 10+ |
| DB calls in domain layer | 122 | 0 |
| Scheduler purity | Procedural | Pure algorithms |

---

## Agent Assignments

| Agent | Specialization | Phases |
|-------|----------------|--------|
| **bert** | Implementation, DB extraction | 1.1, 1.5, 3.3, 3.5, 3.7, 4.1-4.4, 4.6, 4.8, 4.10, 6.1, 6.3, 7.1, 7.5, 8.3 |
| **abby** | Infrastructure, ports | 1.2, 1.3, 1.4, 2.1-2.6, 4.5, 4.7, 5.1-5.5, 6.2 |
| **telly** | Tests, value objects | 3.1, 3.2, 3.4, 3.6, 4.3, 4.9, 4.11, 7.2, 7.4, 8.1, 8.2 |
| **bird** | Documentation, review | 0.1, 7.3, 8.4 |

---

## Change Log

| Date | Change |
|------|--------|
| 2026-01-15 | Initial creation — 8 phases, 140+ tasks |