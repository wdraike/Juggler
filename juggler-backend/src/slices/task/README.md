---
type: explanation
status: active
version: leg/juggler-hex-h3 @ 2026-06-12
Last-updated: 2026-06-12
---

# Task Slice

Hexagonal (ports-and-adapters) vertical slice for all task lifecycle
functionality. Phase H3 of the juggler hex migration — the core task domain,
replacing the monolithic `controllers/task.controller.js` with a clean
ports-and-adapters structure.

External code must import only `slices/task/facade` (or `slices/task`).
Imports of slice internals (adapters, ports, entities, value-objects, or
application use-cases) from outside the slice are forbidden by the active
ESLint boundary rule (`npm run lint:boundaries`).

---

## Structure

```
slices/task/
├── domain/
│   ├── entities/
│   │   ├── RecurrenceRule.js     # Domain entity — recurring task rule shape
│   │   ├── Task.js               # Core domain entity
│   │   ├── TaskInstance.js       # Domain entity — one instance of a recurring task
│   │   └── TimeBlock.js          # Domain entity — a contiguous time block
│   ├── mappers/
│   │   └── taskMappers.js        # Pure row↔task mappers: rowToTask, taskToRow, buildSourceMap, TEMPLATE_FIELDS, safeParseJSON
│   ├── ports/
│   │   ├── TaskCachePort.js      # Driven-port: task list read-through cache
│   │   ├── TaskEventPort.js      # Driven-port: task lifecycle event publisher
│   │   └── TaskRepositoryPort.js # Driven-port: task persistence (read + write + transactions)
│   ├── validation/
│   │   └── taskValidation.js     # Pure validation: validateTaskInput, checkCalSyncEditGuard, guardFixedCalendarWhen
│   ├── value-objects/
│   │   ├── PlacementMode.js      # Closed-enum placement mode VO (reused by scheduler slice)
│   │   ├── TaskId.js             # Immutable task ID wrapper
│   │   └── TaskStatus.js         # Closed-enum task status VO
│   └── index.js                  # Domain barrel: mappers + validation + VOs
├── adapters/
│   ├── EventBusTaskEvents.js     # TaskEventPort backed by lib/events (ADR-0001)
│   ├── InMemoryTaskRepository.js # TaskRepositoryPort — in-memory (tests)
│   ├── KnexTaskRepository.js     # TaskRepositoryPort — backed by lib/db (production)
│   └── RedisTaskCache.js         # TaskCachePort backed by lib/cache (H2)
├── application/
│   ├── commands/
│   │   ├── BatchCreateTasks.js   # Batch insert up to 100 tasks
│   │   ├── BatchUpdateTasks.js   # Batch update up to 2000 tasks
│   │   ├── CompleteTask.js       # Force status = 'done'
│   │   ├── CreateTask.js         # Create one task
│   │   ├── DeleteTask.js         # Delete task (single or cascade-recurring)
│   │   ├── ReEnableTask.js       # Re-enable a disabled task
│   │   ├── SplitTask.js          # Split a task across time blocks
│   │   ├── TakeOwnership.js      # Take ownership of a calendar-origin task
│   │   ├── UpdateTask.js         # Update task fields
│   │   └── UpdateTaskStatus.js   # Update task status (done/wip/cancel/skip/pause/disabled/missed)
│   ├── queries/
│   │   ├── GetDisabledTasks.js   # Fetch disabled tasks for a user
│   │   ├── GetTask.js            # Fetch one task with event ids
│   │   ├── GetVersion.js         # Fetch the cache-busting version token
│   │   └── ListTasks.js          # Fetch all tasks for a user
│   └── index.js
├── facade.js                     # Public API — wires adapters → ports → use-cases; exposes one method per handler
└── index.js                      # Re-exports facade + `{ task: facade }` namespace
```

---

## Ports

### TaskRepositoryPort

The task persistence seam. Operates on **DB-shape rows** (snake_case column shape
`taskToRow()` produces and `rowToTask()` consumes).

Three binding invariants:

- **P1** (timestamps via `new Date()`, never `db.fn.now()`): Every `created_at`/`updated_at`
  write uses a JS Date. The legacy controller violated this on ~8 paths; the repository
  corrects all in-scope sites.
- **T-TX** (transaction boundaries): `runInTransaction(work)` runs inside one DB transaction;
  the `trxRepo` passed to `work` is bound to the transaction handle.
- **T-TENANCY** (user_id scoping): Every read and write is scoped by `userId`.

**Reads:**

| Method | Description |
|--------|-------------|
| `fetchTaskWithEventIds(id, userId)` | Single-row lookup with calendar event ids. Resolves null when no row exists. |
| `fetchTasksWithEventIds(userId, queryBuilder?)` | Bulk fetch with optional where/order/limit/offset. Folds event ids onto each row. |
| `getTasksVersion(userId)` | Cache-busting version token (`MAX(updated_at):COUNT(*)`). |
| `getRecurringTemplateRows(userId)` | User's recurring-template rows for `buildSourceMap`. |
| `expandToAllInstanceIds(userId, ids)` | Expand ids to include all sibling instances under any touched master. |
| `getUserSplitPreference(userId)` | User's `preferences` config row from `user_config`; drives `applySplitDefault`. |

**Writes (all timestamps via `new Date()` — P1):**

| Method | Description |
|--------|-------------|
| `insertTask(row)` | Insert one task row (master/instance routing via `lib/tasks-write`). |
| `insertTasksBatch(rows)` | Batch insert. |
| `updateTaskById(id, changes, userId)` | Update one task with field routing. |
| `deleteTaskById(id, userId)` | Delete one task (both tables). |
| `updateTasksWhere(userId, applyWhere, changes, opts?)` | Bulk update via where-builder. |
| `deleteTasksWhere(userId, applyWhere)` | Bulk delete via where-builder. |
| `updateInstancesWhere(userId, applyWhere, changes)` | Instance-only bulk update. |
| `deleteInstancesWhere(userId, applyWhere)` | Instance-only bulk delete. |

**Transactions:**

| Method | Description |
|--------|-------------|
| `runInTransaction(work)` | Run `work(trxRepo)` in a DB transaction. Commits on resolve, rolls back on reject. |

Contract method list: `['fetchTaskWithEventIds', 'fetchTasksWithEventIds', 'getTasksVersion', 'getRecurringTemplateRows', 'expandToAllInstanceIds', 'getUserSplitPreference', 'insertTask', 'insertTasksBatch', 'updateTaskById', 'deleteTaskById', 'updateTasksWhere', 'deleteTasksWhere', 'updateInstancesWhere', 'deleteInstancesWhere', 'runInTransaction']`

### TaskCachePort

| Method | Description |
|--------|-------------|
| `getTasks(userId)` | Read cached full task-list payload (`{ tasks, version }`); null on miss. |
| `setTasks(userId, payload, ttlSeconds)` | Cache the full task-list (legacy: 300s TTL). |
| `getVersion(userId)` | Read cached version payload; null on miss. |
| `setVersion(userId, payload, ttlSeconds)` | Cache the version payload (legacy: 30s TTL). |
| `invalidateTasks(userId)` | Bust the task-list + version cache after a mutation. MUST NOT throw into the write path. |

Contract method list: `['getTasks', 'setTasks', 'getVersion', 'setVersion', 'invalidateTasks']`

### TaskEventPort

Publishes task lifecycle events (ADR-0001 — lib-events is the task event bus).

| Method | Description |
|--------|-------------|
| `publishTaskCreated(task)` | Publish `TASK_CREATED`. No-op if task.id/userId is nullish. |
| `publishTaskUpdated(task)` | Publish `TASK_UPDATED`. Same nullish guard. |
| `publishTaskCompleted(task)` | Publish `TASK_COMPLETED` (status defaults to 'done'). Same nullish guard. |

**Binding invariants (ADR-0001 + S4/S6):**
- E-1 (publisher only): This port MUST NOT call `enqueueScheduleRun` or `scheduleQueue`.
- E-2 (fire-and-forget): A publish MUST NOT throw into or alter the task write response.
- E-3 (minimal payload): Payloads carry only `{ taskId, userId, status, timestamp }`.

Contract method list: `['publishTaskCreated', 'publishTaskUpdated', 'publishTaskCompleted']`

---

## Adapters

### KnexTaskRepository

Implements `TaskRepositoryPort`. Backed by `lib/db` (ADR-0002). Honors P1/T-TX/T-TENANCY.
The only live behavior change from the legacy controller is the P1 correction:
`created_at`/`updated_at`/`completed_at`/`scheduled_at` are written with `new Date()`,
never `db.fn.now()`.

### InMemoryTaskRepository

Implements `TaskRepositoryPort`. In-memory, for tests. Honors all binding invariants.

### RedisTaskCache

Implements `TaskCachePort`. Backed by `lib/cache`. Keys: `user:<userId>:tasks` (300s TTL)
and `user:<userId>:version` (30s TTL).

### EventBusTaskEvents

Implements `TaskEventPort`. Backed by `lib/events`. Wraps publish in try/catch;
returns null on failure (E-2 isolation).

---

## Domain Value Objects

### TaskId

Immutable wrapper around a task ID.

### TaskStatus

Closed-enum task status VO. Rejects unknown status terms.

### PlacementMode

Closed-enum placement mode VO. Also reused by the scheduler slice domain index
(one canonical VO for the whole codebase).

---

## Facade Operations

The facade exposes one method per legacy controller handler. Each returns
`{ status, body }`.

| Method | Handler | Description |
|--------|---------|-------------|
| `getAllTasks(input)` | `GET /tasks` | Returns `{ tasks, version }`. Cache read-through. |
| `getTask(input)` | `GET /tasks/:id` | Returns task with event ids. 404 on missing. |
| `getVersion(input)` | `GET /tasks/version` | Returns `{ version }`. |
| `getDisabledTasks(input)` | `GET /tasks/disabled` | Returns disabled tasks. |
| `createTask(input)` | `POST /tasks` | Create one task. Triggers scheduler. |
| `updateTask(input)` | `PUT /tasks/:id` | Update task fields. Handles recurring-template/instance routing. |
| `deleteTask(input)` | `DELETE /tasks/:id` | Delete task (single or cascade-recurring). |
| `updateTaskStatus(input)` | `PATCH /tasks/:id/status` | Update status. Handles rolling anchor, split siblings, cal-sync. |
| `batchCreateTasks(input)` | `POST /tasks/batch` | Batch create up to 100 tasks. Zod-validated. |
| `batchUpdateTasks(input)` | `PUT /tasks/batch` | Batch update up to 2000 tasks. Zod-validated. |
| `reEnableTask(input)` | `POST /tasks/:id/re-enable` | Re-enable a disabled task (checks entity limits). |
| `takeOwnership(input)` | `POST /tasks/:id/take-ownership` | Take ownership of a calendar-origin task. |
| `completeTask(input)` | (WBS-named) | Force status to 'done'. |
| `splitTask(input)` | (WBS-named) | Split a task across time blocks. |

**Pure helper re-exports** (consumed by scheduler, MCP tools, schedule routes,
and the golden master):

| Export | Source |
|--------|--------|
| `rowToTask` | `domain/mappers/taskMappers` |
| `taskToRow` | `domain/mappers/taskMappers` |
| `buildSourceMap` | `domain/mappers/taskMappers` |
| `safeParseJSON` | `domain/mappers/taskMappers` |
| `TEMPLATE_FIELDS` | `domain/mappers/taskMappers` |
| `validateTaskInput` | `domain/validation/taskValidation` |
| `checkCalSyncEditGuard` | `domain/validation/taskValidation` |
| `guardFixedCalendarWhen` | `domain/validation/taskValidation` |
| `ensureProject(userId, name)` | Ensures a project row exists for the user |
| `applySplitDefault(row, userId)` | Applies the user's split preference default to a task row |
| `expandToAllInstanceIds(userId, ids)` | Delegates to the slice repo |
| `fetchTasksWithEventIds(userId, queryBuilder)` | Delegates to the slice repo |

---

## Usage

### Importing the facade

```javascript
// Namespaced (matches index.js `{ task: facade }` export)
const { task } = require('./slices/task');

// Direct
const taskFacade = require('./slices/task/facade');
```

### Creating and updating tasks

```javascript
const { task } = require('./slices/task');

const result = await task.createTask({ userId, fields, timezone });
// { status: 201, body: { task: { id, text, ... } } }

const updated = await task.updateTask({ userId, id, fields, timezone });
// { status: 200, body: { task: { ... } } }
```

---

## Architecture Boundary

The ESLint boundary rule (`eslint.boundaries.config.js`, run via
`npm run lint:boundaries`, ref `JUG-HEX-H3 (W6)`) enforces that external code imports
only the facade, never slice internals. Direct imports of adapters, ports, entities,
value-objects, or application use-cases from outside the slice are a lint error.

The task slice boundary also covers `domain/value-objects/` (unlike the calendar
slice's known gap) and `application/` use-cases.

---

## Testing

Run via test-bed:

```bash
cd test-bed && make test-juggler
```

The task suite covers:

- Golden-master characterization: 12 HTTP handlers pinned bit-for-bit across all
  task types, status transitions, and recurrence paths
- `KnexTaskRepository` + `InMemoryTaskRepository` contract conformance (P1 + T-TX)
- `RedisTaskCache` keying and TTL invariants
- `EventBusTaskEvents` E-1/E-2/E-3 publishing invariants
- All 14 application use-cases via facade delegation tests

---

## Dependencies

The slice adapters delegate to:

- `lib/db` — Knex DB access (`KnexTaskRepository`)
- `lib/cache` — Redis cache (`RedisTaskCache`)
- `lib/events` — EventBus publisher (`EventBusTaskEvents`)
- `lib/tasks-write` — master/instance write helpers (`KnexTaskRepository`)
- `scheduler/dateHelpers` — date conversion utilities (facade wiring)
- `scheduler/scheduleQueue` — `enqueueScheduleRun` scheduler trigger (S4/S6 — sole trigger)
- `lib/task-write-queue` — `isLocked`, `enqueueWrite`, `splitFields`
- `lib/sse-emitter` — SSE broadcast on task change
