# Juggler Architecture Review — DDD & Hexagonal Migration Analysis

**Date:** 2026-01-14
**Purpose:** Assess current architecture and plan hexagonal migration

---

## Executive Summary

Juggler is a task/calendar management service with a monolithic MVC architecture. While smaller than Resume Optimizer, it has similar structural issues that would benefit from hexagonal refactoring.

| Metric | Value |
|--------|-------|
| Controllers | 13 files, 7,763 lines |
| Largest controller | `cal-sync.controller.js` (2,547 lines) |
| Second largest | `task.controller.js` (2,422 lines) |
| Scheduler files | 12 files, 5,097 lines |
| Largest scheduler | `runSchedule.js` (2,197 lines) |
| Services | 3 files (minimal) |
| Library files | 18 files, 2,915 lines |
| DB calls in controllers | 122 direct `db()` calls |

**Key finding:** The scheduler subsystem is the largest and most complex component (5,097 lines), not the controllers. This is unique to Juggler.

---

## Current Architecture

### Directory Structure

```
juggler-backend/src/
├── app.js                 (11,763 lines — large, wiring everything)
├── server.js              (6,103 lines)
├── controllers/
│   ├── cal-sync.controller.js   (2,547 lines) — CALENDAR SYNC
│   ├── task.controller.js       (2,422 lines) — TASK CRUD
│   ├── apple-cal.controller.js    (468 lines)
│   ├── config.controller.js       (405 lines)
│   ├── weather.controller.js      (277 lines)
│   ├── data.controller.js         (273 lines)
│   ├── cal-sync-helpers.js        (242 lines)
│   ├── billing-webhooks.controller.js (220 lines)
│   ├── msft-cal.controller.js       (210 lines)
│   ├── feature-catalog.controller.js (202 lines)
│   ├── gcal.controller.js           (175 lines)
│   ├── ai.controller.js             (168 lines)
│   └── impersonation.controller.js   (154 lines)
├── services/               (3 files — MINIMAL)
│   ├── ai-usage-flusher.service.js
│   ├── ai-usage-queue.service.js
│   └── gemini-tracked-call.js
├── scheduler/              (12 files, 5,097 lines — CORE DOMAIN)
│   ├── runSchedule.js           (2,197 lines)
│   ├── unifiedScheduleV2.js     (1,811 lines)
│   ├── scheduleQueue.js           (373 lines)
│   ├── schedulerSession.js        (279 lines)
│   ├── scoreSchedule.js          (181 lines)
│   ├── reconcileOccurrences.js   (126 lines)
│   └── constants.js, helpers...
├── lib/                    (18 files, 2,915 lines)
│   ├── apple-cal-api.js          (475 lines) — calendar adapter
│   ├── tasks-write.js            (498 lines)
│   ├── gcal-api.js               (231 lines) — calendar adapter
│   ├── msft-cal-api.js          (279 lines) — calendar adapter
│   ├── cal-adapters/             (directory)
│   ├── reconcile-splits.js       (279 lines)
│   ├── task-write-queue.js       (306 lines)
│   ├── sync-lock.js              (192 lines)
│   └── ...
├── routes/                 (19 files)
├── middleware/             (7 files)
├── mcp/                     (MCP server for external clients)
└── db/migrations/
```

### Architecture Issues

#### 1. Controller Bloat

| Controller | Lines | Primary Concern |
|------------|-------|------------------|
| `cal-sync.controller.js` | 2,547 | Calendar sync orchestration, sync state, conflict resolution |
| `task.controller.js` | 2,422 | Task CRUD, scheduling, calendar integration, MCP tools |
| `apple-cal.controller.js` | 468 | Apple Calendar API integration |
| `config.controller.js` | 405 | User preferences, system config |

**Issue:** Controllers contain business logic that should be in domain services.

#### 2. Scheduler — Core Domain Trapped in Procedural Code

The scheduler (`scheduler/`) is Juggler's core domain:

| File | Lines | Purpose |
|------|-------|---------|
| `runSchedule.js` | 2,197 | Schedule execution runner |
| `unifiedScheduleV2.js` | 1,811 | Main scheduler entry point |
| `scheduleQueue.js` | 373 | Event queue management |
| `schedulerSession.js` | 279 | Session state |
| `scoreSchedule.js` | 181 | Scoring algorithm |

**Issue:** Scheduler files are procedural, not object-oriented. No entity model for Task, TimeBlock, Constraint. Direct DB calls mixed with algorithm logic.

From `CLAUDE.md`:
> **⚠️ Caution:** Scheduler bugs cascade and corrupt all task data. Test exhaustively before deploying any scheduler change.

This is exactly the risk hexagonal architecture addresses — isolating the core algorithm from DB/external dependencies.

#### 3. Calendar Adapters — Ad-hoc, Not Ports

```
lib/
├── apple-cal-api.js      (475 lines)
├── gcal-api.js           (231 lines)
├── msft-cal-api.js       (279 lines)
├── cal-adapters/         (directory)
└── ...
```

These are already "adapters" in spirit — they wrap external calendar APIs. But:
- No shared `CalendarPort` interface
- No dependency injection
- Tightly coupled to controllers
- Hard to test in isolation

#### 4. Minimal Service Layer

Only 3 service files exist:
```
services/
├── ai-usage-flusher.service.js
├── ai-usage-queue.service.js
└── gemini-tracked-call.js
```

**Issue:** Business logic lives in controllers, not services. The MVC pattern has evolved into "Controller-Everything".

#### 5. Direct DB Access in Controllers

122 `db()` calls in controllers — same anti-pattern as Resume Optimizer.

---

## Domain Model Analysis

### Core Domains (DDD)

Based on the codebase, Juggler has these bounded contexts:

| Domain | Description | Files |
|--------|-------------|-------|
| **Scheduler** | Task scheduling algorithm | `scheduler/*` |
| **Task** | Task entities, CRUD, state machine | `task.controller.js` |
| **Calendar Sync** | External calendar sync (GCal, MSFT, Apple) | `cal-sync.controller.js`, `lib/apple-cal-api.js`, `lib/gcal-api.js`, `lib/msft-cal-api.js` |
| **User Preferences** | Config, settings | `config.controller.js` |
| **Weather** | Weather constraint checking | `weather.controller.js`, scheduler weather logic |
| **AI Enrichment** | AI-assisted task enhancement | `ai.controller.js`, `services/gemini-tracked-call.js` |

### Domain Priority for Migration

Based on complexity and business value:

| Priority | Domain | Lines | Rationale |
|----------|--------|-------|-----------|
| 1 | **Scheduler** | 5,097 | Core domain, highest complexity, most fragile |
| 2 | **Calendar Sync** | 2,547 + adapters | External integration, clear port boundary |
| 3 | **Task** | 2,422 | Root entity, needed for scheduler |
| 4 | **Weather** | ~300 | Isolated, easy win |
| 5 | **AI Enrichment** | ~200 | Already minimal service layer |

---

## Hexagonal Migration Strategy

### Phase 1: Infrastructure Libs (2 weeks)

Same as Resume Optimizer:

| Item | Description |
|------|-------------|
| lib-db | Extract `createKnex()`, `withTransaction()` from `src/db.js` |
| lib-logger | Extract `createLogger()` from logging patterns |
| lib-config | Extract config access patterns |
| lib-cache | Redis cache abstraction |
| lib-events | Event bus for scheduler events |

### Phase 2: Calendar Port (2 weeks)

**This is the cleanest win — calendar adapters are already isolated.**

```
slices/calendar/
├── domain/
│   ├── entities/
│   │   ├── CalendarEvent.js
│   │   └── SyncState.js
│   ├── ports/
│   │   ├── CalendarPort.js         ← interface
│   │   └── SyncStateRepositoryPort.js
│   └── value-objects/
│       ├── EventId.js
│       └── ProviderType.js
├── adapters/
│   ├── GoogleCalendarAdapter.js    ← implements CalendarPort
│   ├── MicrosoftCalendarAdapter.js ← implements CalendarPort
│   ├── AppleCalendarAdapter.js     ← implements CalendarPort
│   └── InMemoryCalendarAdapter.js  ← test double
├── application/
│   ├── commands/
│   │   ├── SyncCalendarCommand.js
│   │   └── CreateEventCommand.js
│   ├── queries/
│   │   └── GetSyncStatusQuery.js
│   └── handlers/
└── facade.js
```

**Why start here:**
- Clear external dependency (calendar APIs)
- Already partially separated in `lib/` directory
- Well-defined interface (create, update, delete, sync)
- Easy to write test doubles

### Phase 3: Task Domain (2 weeks)

```
slices/task/
├── domain/
│   ├── entities/
│   │   ├── Task.js
│   │   ├── TaskInstance.js
│   │   ├── RecurrenceRule.js
│   │   └── TimeBlock.js
│   ├── ports/
│   │   ├── TaskRepositoryPort.js
│   │   ├── TaskCachePort.js
│   │   └── TaskEventPort.js
│   └── value-objects/
│       ├── TaskId.js
│       ├── TaskStatus.js
│       └── PlacementMode.js
├── application/
│   ├── commands/
│   │   ├── CreateTaskCommand.js
│   │   ├── UpdateTaskCommand.js
│   │   ├── CompleteTaskCommand.js
│   │   └── SplitTaskCommand.js
│   └── queries/
│       ├── GetTaskQuery.js
│       └── ListTasksQuery.js
├── adapters/
│   ├── KnexTaskRepository.js
│   ├── RedisTaskCache.js
│   └── InMemoryTaskRepository.js
└── facade.js
```

### Phase 4: Scheduler Domain (4 weeks) — Most Critical

The scheduler is the core algorithm. It should be **pure domain logic** with **no DB access**.

```
slices/scheduler/
├── domain/
│   ├── entities/
│   │   ├── Schedule.js            ← the aggregate root
│   │   ├── ScheduledTask.js
│   │   ├── Constraint.js
│   │   └── ScoredSchedule.js
│   ├── services/
│   │   ├── ConstraintSolver.js    ← pure algorithm
│   │   ├── ScoreEngine.js         ← pure algorithm
│   │   └── ConflictResolver.js    ← pure algorithm
│   ├── ports/
│   │   ├── TaskProviderPort.js   ← inject task data
│   │   ├── CalendarProviderPort.js ← inject calendar data
│   │   └── ScheduleRepositoryPort.js
│   └── value-objects/
│       ├── TimeWindow.js
│       ├── Priority.js
│       └── Deadline.js
├── application/
│   ├── commands/
│   │   └── RunScheduleCommand.js
│   ├── handlers/
│   │   └── ScheduleHandler.js
│   └── queries/
│       └── GetScheduleQuery.js
├── adapters/
│   ├── SchedulerTaskProvider.js   ← implements TaskProviderPort
│   ├── SchedulerCalendarProvider.js
│   └── KnexScheduleRepository.js
└── facade.js
```

**Key principle:** The scheduler algorithm (constraint solving, scoring) should have **zero dependencies on Knex, Express, or external APIs**. All data comes through ports.

#### Current Scheduler Issues

From `unifiedScheduleV2.js` (1,811 lines):
- Direct `db()` calls throughout
- Mixed concerns: scheduling algorithm + DB queries + scoring
- Hard to test without full DB
- Fragile (per CLAUDE.md warning)

#### After Migration

```javascript
// Pure domain service - testable without DB
class ConstraintSolver {
  solve(tasks, constraints, timeWindows) {
    // Pure algorithm - no db, no external calls
    // All data passed in via parameters
  }
}

// Application layer - orchestrates
class RunScheduleCommand {
  constructor({ taskProvider, calendarProvider, scoreEngine }) {
    // Dependencies injected
  }
  
  async execute(userId, date) {
    const tasks = await this.taskProvider.getTasksForUser(userId);
    const calendar = await this.calendarProvider.getEvents(userId, date);
    const schedule = this.constraintSolver.solve(tasks, calendar);
    return schedule;
  }
}
```

### Phase 5: Weather Domain (1 week)

Small, isolated domain:

```
slices/weather/
├── domain/
│   ├── services/
│   │   └── WeatherConstraintService.js
│   └── ports/
│       └── WeatherProviderPort.js
├── adapters/
│   ├── OpenWeatherMapAdapter.js
│   └── MockWeatherProvider.js
└── facade.js
```

---

## WBS Summary

| Phase | Work | Duration | Risk |
|-------|------|----------|------|
| 1 | Infrastructure libs (db, logger, config, cache, events) | 2 weeks | Low |
| 2 | Calendar port + adapters | 2 weeks | Low |
| 3 | Task domain extraction | 2 weeks | Medium |
| 4 | Scheduler domain extraction | 4 weeks | **High** (core logic) |
| 5 | Weather domain | 1 week | Low |
| 6 | Migrate remaining controllers | 2 weeks | Medium |
| 7 | Clean up, deprecation | 1 week | Low |

**Total:** 14 weeks for a 2-developer team

---

## Key Differences from Resume Optimizer

### 1. Scheduler is the Core

Resume Optimizer's core is the keyword/bridge matching algorithm. Juggler's core is the scheduler. Both need to be pure domain logic with injected dependencies.

### 2. Calendar Adapters Already Exist

The `lib/apple-cal-api.js`, `lib/gcal-api.js`, `lib/msft-cal-api.js` are already adapters — they just need:
- Shared `CalendarPort` interface
- Dependency injection
- Test doubles

### 3. MCP Server Integration

Juggler has `juggler-mcp/` which exposes tasks to external MCP clients (ClimbRS). This is an **external-facing port** in hexagonal terms:

```
slices/task/
├── adapters/
│   ├── http/
│   │   └── TaskController.js      ← REST API
│   └── mcp/
│       └── TaskMcpServer.js       ← MCP protocol
```

Both adapters use the same `TaskFacade`.

### 4. Smaller Service Layer

Resume Optimizer has more services (embedding, qualifiers, etc.). Juggler has minimal services — most business logic is in controllers or scheduler files. This means more extraction work.

---

## Recommendations

### Immediate Wins

1. **Create `lib-db`** — extract from `src/db.js` (same as RO)
2. **Create `lib-events`** — scheduler needs event-driven architecture
3. **Define `CalendarPort`** — unify calendar adapters under one interface

### Priority Order

1. **Scheduler first** — highest risk, most fragile, needs isolation
2. **Calendar adapters second** — cleanest extraction path
3. **Task third** — needed by scheduler
4. **Weather fourth** — easy win

### Anti-patterns to Avoid

1. **Don't create a "TaskResolverService"** — put methods on TaskService or entity
2. **Don't create a "SchedulerService" that does everything** — separate concerns:
   - `ConstraintSolver` (pure)
   - `ScheduleScorer` (pure)
   - `RunScheduleCommand` (orchestrator)
3. **Don't extract all of `cal-sync.controller.js` at once** — it's 2,547 lines. Extract piece by piece:
   - Sync state management → `SyncStateService`
   - Conflict resolution → `ConflictResolver`
   - Event transformation → `EventTransformer`

---

## Metrics Comparison

| Metric | Resume Optimizer | Juggler |
|--------|------------------|---------|
| Controllers | 15+ (8,807 lines largest) | 13 (2,547 lines largest) |
| db() calls in controllers | 861 | 122 |
| Services | Few, scattered | 3 (minimal) |
| Core domain | Qualifier matching | Task scheduling |
| External integrations | Gemini, MCP | GCal, MSFT, Apple, MCP |
| Test isolation | Poor (DB required) | Poor (DB required) |

Juggler is **smaller** but has the **same architectural issues**. The scheduler is the key risk area.

---

## Next Steps

1. Create `docs/architecture/JUGGLER-HEX-WBS.md` similar to Resume Optimizer
2. Create Kanban tasks for Phase 1 infrastructure libs
3. Start with `lib-events` — scheduler needs it most
4. Define `CalendarPort` interface and migrate one adapter as pilot

---

## References

- `CLAUDE.md` — Juggler conventions and scheduler warnings
- `juggler-backend/docs/SCHEDULER.md` — Scheduler design doc
- `RO-BACKEND-TO-BE-ARCHITECTURE.md` — Resume Optimizer hexagonal pattern