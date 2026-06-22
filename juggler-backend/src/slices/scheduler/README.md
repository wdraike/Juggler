---
type: explanation
status: active
version: leg/juggler-hex-h6-scheduler @ 2026-06-12
Last-updated: 2026-06-12
---

# Scheduler Slice

Hexagonal (ports-and-adapters) vertical slice for the task scheduler domain.
Phase H6 of the juggler hex migration — the largest and highest-risk slice,
landing the pure scheduling core (ConstraintSolver/ScoreEngine/ConflictResolver)
plus a full ports-and-adapters layer and `RunScheduleCommand` application
orchestrator.

External code must import only `slices/scheduler/facade` (or
`slices/scheduler`). Imports of slice internals (domain, adapters, application)
from outside the slice are forbidden by the boundary rule.

**Important:** The per-slice ESLint boundary rule for the scheduler slice is
**not yet wired** into `eslint.boundaries.config.js`. The other five slices
(calendar, weather, task, ai-enrichment, user-config) have active lint
enforcement; the scheduler's rule is H7 boundary-hardening work. Callers
should treat the facade as the contract regardless, and the boundary rule will
be added in H7.

---

## Structure

```
slices/scheduler/
├── domain/
│   ├── entities/
│   │   ├── Constraint.js         # Domain entity — single scheduling constraint
│   │   ├── Schedule.js           # Domain entity — a computed schedule (task placements)
│   │   ├── ScheduledTask.js      # Domain entity — a task with its placement
│   │   └── ScoredSchedule.js     # Domain entity — a schedule with quality score
│   ├── logic/
│   │   ├── ConstraintSolver.js   # Pure solver — most-constrained → least ordering (S1/S2/S3)
│   │   ├── ConflictResolver.js   # Pure solver — occupancy + calendar-busy collision detection
│   │   └── ScoreEngine.js        # Pure solver — schedule quality scoring
│   ├── ports/
│   │   ├── CalendarProviderPort.js      # Driven-port: externally-busy calendar intervals
│   │   ├── ClockPort.js                 # Driven-port: wall-clock + DB clock for placement cache
│   │   ├── ScheduleRepositoryPort.js    # Driven-port: delta-write persist seam (S5)
│   │   ├── TaskProviderPort.js          # Driven-port: task row + mapper source
│   │   ├── WeatherProviderPort.js       # Driven-port: forecast read for weather-constrained tasks
│   │   └── index.js
│   ├── value-objects/
│   │   ├── Deadline.js           # Immutable deadline VO
│   │   ├── Priority.js           # Closed-enum priority (P1–P4)
│   │   └── TimeWindow.js         # Immutable time-window VO
│   ├── constants.js              # Domain constants
│   └── index.js                  # Barrel: solvers + entities + value-objects
├── adapters/
│   ├── InMemoryScheduleRepository.js   # ScheduleRepositoryPort — in-memory (tests)
│   ├── KnexScheduleRepository.js        # ScheduleRepositoryPort — backed by lib/db (production)
│   ├── MysqlClockAdapter.js             # ClockPort — process clock + SELECT NOW(3) DB clock
│   ├── SchedulerCalendarProvider.js     # CalendarProviderPort — delegates to calendar facade
│   ├── SchedulerTaskProvider.js         # TaskProviderPort — tasks_v read + task slice mappers
│   ├── SchedulerWeatherProvider.js      # WeatherProviderPort — delegates to weather slice cache
│   └── index.js
├── application/
│   ├── RunScheduleCommand.js    # Application orchestrator: pull → solve → delta-write (S5)
│   └── index.js
├── facade.js                    # Public API — fronts legacy entry points + exposes slice layers
└── index.js                     # Re-exports facade + `{ scheduler: facade }` namespace
```

---

## Domain Core (Pure — Zero Infra)

The three logic classes compose into the scheduling pipeline. They are pure
functions with zero infrastructure imports (no knex, no DB, no Redis, no
controllers):

### ConstraintSolver

Implements the most-constrained → least-constrained ordering (S1): tasks with
deadlines come before those with only soft preferences; tasks with dependencies
before free tasks. Also handles severity ordering (S2) and recurrence/day-of-week
classification (S3 inputs). This order is the codebase's core scheduling invariant
and must never be reversed.

### ConflictResolver

Occupancy primitives and calendar-busy collision detection. Resolves placements
against a `calendarBusy` occupancy set (fixed calendar events arrive as FIXED
tasks in the working set through cal-sync).

### ScoreEngine

Schedule quality scoring. Houses the `scoreSchedule` logic.

---

## Ports

### TaskProviderPort

| Method | Description |
|--------|-------------|
| `rowToTask(row, timezone, srcMap)` | Map one `tasks_v` row to the scheduler's in-memory task object. Byte-identical to the task slice's mapper. |
| `taskToRow(task, userId, timezone, existing?)` | Map an in-memory task object back to a DB-shape row. |
| `buildSourceMap(rows)` | Build the recurring-template source map (instance field inheritance). |
| `loadSchedulableRows(db, userId)` | Load the scheduler's working set from `tasks_v` (status ''/wip/NULL or recurring_template). |

Contract method list: `['rowToTask', 'taskToRow', 'buildSourceMap', 'loadSchedulableRows']`

### CalendarProviderPort

| Method | Description |
|--------|-------------|
| `getBusyIntervals(userId, opts?)` | Externally-busy intervals for the user over the scheduling horizon. Default adapter returns `[]` — busy time arrives as FIXED tasks in the working set. |

Contract method list: `['getBusyIntervals']`

### ScheduleRepositoryPort

The delta-write persistence seam (S5). Operates on DB-shape rows (snake_case column
shape). Three binding invariants:

- **P1** (timestamps via `new Date()`, never `db.fn.now()`): Every timestamp write uses
  a JS `Date`. The legacy `runSchedule.js` violated P1 on 19 sites; this port corrects
  all of them in scope.
- **S5** (delta-write): `writeChanged` writes ONLY the rows in `delta` — no write-all
  path. The caller computes the changed set.
- **T-TX** (transaction boundary): The port participates in the caller's transaction;
  it does not open its own around `writeChanged`.

| Method | Description |
|--------|-------------|
| `writeChanged(delta, opts?)` | Write ONLY the delta rows (S5). Splits into batched scheduled_at/dur CASE update + per-row status/flag updates. Returns `{ written: number }`. |
| `deleteTasksWhere(userId, applyWhere)` | Bulk delete via where-builder (merged-out chunk cleanup). Returns rows removed. |
| `backfillRollingAnchorIfNull(masterId, userId, anchor)` | Set `task_masters.rolling_anchor` ONLY when currently NULL (rolling-anchor backfill). Returns rows updated (0 or 1). |
| `now()` | DB clock (`SELECT NOW(3)`) for placement-cache `generatedAt`. Returns a JS Date. |

Contract method list: `['writeChanged', 'deleteTasksWhere', 'backfillRollingAnchorIfNull', 'now']`

### WeatherProviderPort

| Method | Description |
|--------|-------------|
| `loadWeatherForHorizon(locations, db?)` | Build `weatherByDateHour` map for weather-constrained task placement. Returns `{}` on any failure (fail-open — binding invariant C-WX). |

Contract method list: `['loadWeatherForHorizon']`

**Binding invariant C-WX (fail-open):** The adapter MUST reproduce the legacy
fail-open behavior at every level: no coords, no cache row, unparseable JSON, or
missing hourly all return `{}`. The pure core treats a missing entry as "weather OK."
Never throw into the scheduler from this port.

### ClockPort

| Method | Description |
|--------|-------------|
| `now()` | Process wall-clock as a JS Date (`new Date()`). |
| `dbNow(db?)` | DB clock as a JS Date (`SELECT NOW(3)`). Used for placement-cache `generatedAt` so it matches MySQL `updated_at`. |

Contract method list: `['now', 'dbNow']`

---

## Adapters

### KnexScheduleRepository

Implements `ScheduleRepositoryPort`. Backed by `lib/db`. Honors all three binding
invariants (P1/S5/T-TX). The batched CASE update is chunked at 200 rows.

### InMemoryScheduleRepository

Implements `ScheduleRepositoryPort`. In-memory, for tests. Honors P1/S5/T-TX
semantics.

### SchedulerTaskProvider

Implements `TaskProviderPort`. Reads `tasks_v` via `lib/db`. Sources `rowToTask`,
`taskToRow`, and `buildSourceMap` from the task slice facade (byte-identical
functions) — does NOT re-implement them.

### SchedulerCalendarProvider

Implements `CalendarProviderPort`. Thin pass-through over the calendar slice
facade. Currently returns `[]` for `getBusyIntervals` (H6 behavior-preserved;
busy time arrives as FIXED tasks).

### SchedulerWeatherProvider

Implements `WeatherProviderPort`. Delegates to the weather slice cache via
`lib/db`. Preserves fail-open behavior.

### MysqlClockAdapter

Implements `ClockPort`. `now()` returns `new Date()`; `dbNow(db)` runs
`SELECT NOW(3)` and parses the result to a JS Date.

---

## Application Layer

### RunScheduleCommand

The sole delta-write orchestrator (S5). Pulls the working set via
`TaskProviderPort`, runs the pure scheduling core (`ConstraintSolver` →
`ConflictResolver` → `ScoreEngine`), computes the changed-row delta, and
flushes it via `ScheduleRepositoryPort.writeChanged`.

`RunScheduleCommand` does NOT import `scheduleQueue`. The mutation→schedule
trigger (enqueue) stays outside the slice (invariant S4/S6). The schedule
routes import `enqueueScheduleRun` directly from `scheduler/scheduleQueue` for
the `/nudge` endpoint — that trigger seam is deliberately NOT routed through
this facade.

---

## Facade

`slices/scheduler/facade.js` is the single public API. The facade is **thin**:
it re-exports the existing legacy entry-point functions verbatim (same
functions, same signatures). It does not rewrite the scheduler.

| Export | Description |
|--------|-------------|
| `runScheduleAndPersist(userId, ids, opts)` | Run the scheduler + persist the changed-row delta (S5). Returns `{ dayPlacements, unplaced, … }`. Used by POST /run and MCP `run_schedule`. |
| `deriveSchedulePlacements(userId, opts)` | Read-only placement view DERIVED from the task read model (GET /api/tasks); does NOT mutate tasks. Used by MCP `get_schedule`. Replaced `getSchedulePlacements` + the `schedule_cache` read path (W3/W4). |
| `unifiedScheduleV2(...)` | Pure scheduling entry point. Used by the admin debug route for phase snapshots. |
| `computeWindowCloseUtc` | Window-close UTC helper (parity with legacy entry module). |
| `RunScheduleCommand` | Application orchestrator (the sole delta-write seam, S5). |
| `ConstraintSolver`, `ConflictResolver`, `ScoreEngine` | Pure domain core. |
| `Schedule`, `ScheduledTask`, `ScoredSchedule`, `Constraint` | Domain entities. |
| `Priority`, `TimeWindow`, `Deadline` | Domain value objects. |
| `PlacementMode` | Reused from the task slice (one canonical VO — S7). |
| `CalendarProviderPort`, `ClockPort`, `ScheduleRepositoryPort`, `TaskProviderPort`, `WeatherProviderPort` | Port contracts (for test wiring). |
| `SchedulerTaskProvider`, `SchedulerCalendarProvider`, `SchedulerWeatherProvider`, `KnexScheduleRepository`, `InMemoryScheduleRepository`, `MysqlClockAdapter` | Named adapter exports. |

---

## Legacy Files (H7 pending)

The legacy entry files `src/scheduler/runSchedule.js` and
`src/scheduler/unifiedScheduleV2.js` **remain outside the slice** and continue
to exist. The facade fronts them by re-exporting their functions verbatim.
Thinning/deleting those files, adding the per-slice ESLint boundary rule, and
closing the remaining inline writes in `runSchedule.js` are H7
boundary-hardening work. Callers should use the facade now even though the
boundary rule is not yet enforced by lint.

---

## Architecture Boundary

The ESLint boundary rule for the scheduler slice is **not yet wired** in
`eslint.boundaries.config.js`. All other five migrated slices (calendar, weather,
task, ai-enrichment, user-config) have active enforcement via
`npm run lint:boundaries`. The scheduler's rule is deferred to H7.

External code should import only `slices/scheduler/facade` regardless, and the
rule will be enforced once H7 lands.

---

## Scheduler Invariants (S1–S8)

These invariants govern all scheduler behavior. See also `juggler-backend/docs/architecture/SCHEDULER.md`.

| Invariant | Description |
|-----------|-------------|
| S1 | Schedule most-constrained → least-constrained. Never reverse this order. |
| S2 | Severity hierarchy: Deadlines > dependencies > preferences. |
| S3 | Recurring instances must be scheduled on the same day their recurrence rule fires. |
| S4 | The scheduler is triggered only by user/MCP mutations — never self-triggers. |
| S5 | Delta-write: write only tasks that actually changed. No full rebuild writes. |
| S6 | No cascading scheduler calls from within the scheduler. |
| S7 | Task-type terminology: `one-off`, `chain member`, `recurring instance`, `split chunk`. |
| S8 | `computeWindowCloseUtc` provides the authoritative scheduling-horizon close. |

---

## Usage

### Importing the facade

```javascript
// Namespaced (matches index.js `{ scheduler: facade }` export)
const { scheduler } = require('./slices/scheduler');

// Direct
const scheduler = require('./slices/scheduler/facade');
```

### Running the scheduler

```javascript
const { scheduler } = require('./slices/scheduler');

// Run + persist (POST /run, MCP run_schedule)
const result = await scheduler.runScheduleAndPersist(userId, ids, opts);
// { dayPlacements, unplaced, ... }

// Read-only placement view (MCP get_schedule) — DERIVED from GET /api/tasks
const placements = await scheduler.deriveSchedulePlacements(userId, opts);
```

---

## Testing

Run via test-bed:

```bash
cd test-bed && make test-juggler
```

The scheduler suite covers:

- Golden-master characterization: `unifiedScheduleV2` output pinned bit-for-bit
  across all task types and constraint combinations
- `RunScheduleCommand` orchestration: pull → solve → delta assertion
- `KnexScheduleRepository` + `InMemoryScheduleRepository` contract conformance
- Port contract tests: every adapter satisfies its port's method list
- S4/S6 static require-closure assertion: `RunScheduleCommand` is not in the
  `scheduleQueue` closure

---

## Dependencies

The slice adapters delegate to:

- `lib/db` — Knex DB access (`KnexScheduleRepository`, `SchedulerTaskProvider`, `SchedulerWeatherProvider`)
- `slices/task/facade` — task row mappers (`SchedulerTaskProvider`)
- `slices/calendar/facade` — calendar adapter registry (`SchedulerCalendarProvider`)
- `slices/weather/facade` — weather cache (`SchedulerWeatherProvider`)
- `lib/tasks-write` — batch write helpers (`KnexScheduleRepository`)
- `scheduler/dateHelpers` — date conversion utilities (legacy entry points)
