<!-- refreshed: 2026-05-14 -->
# Architecture

**Analysis Date:** 2026-05-14

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                       juggler-frontend (React, port 3003)            │
│  App.js → AuthProvider → AppLayout → [Views] → [Components]          │
│  Axios apiClient  ·  SSE EventSource  ·  useTaskState (reducer)      │
└─────────────────────┬──────────────────────────────────────────────┬─┘
          REST /api/* │                              SSE /api/events │
                      ▼                                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  juggler-backend (Express, port 5002)                │
│  Routes → Controllers → lib (task-write-queue, sync-lock, redis)     │
│  Scheduler (unifiedScheduleV2) ← scheduleQueue (DB-backed event Q)  │
│  Cal-sync (GCal / MSFT / Apple adapters)  ·  AI (Gemini)            │
│  MCP HTTP endpoint (/mcp) → createMcpServerForUser                  │
└───────────────┬───────────────────────────────────────┬─────────────┘
                │ Knex (mysql2)                          │ ioredis
                ▼                                        ▼
┌─────────────────────────────┐        ┌────────────────────────────┐
│  MySQL — task_masters        │        │  Redis                     │
│           task_instances     │        │  SSE pub/sub (sse:{uid})   │
│           tasks_v (VIEW)     │        │  schedule cache            │
│           sync_locks         │        │  Falls back gracefully     │
│           schedule_queue     │        │  when unavailable          │
└─────────────────────────────┘        └────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                  juggler-mcp/ (stdio MCP server)                    │
│  ClimbRS / Claude Code → McpServer (stdio) → HTTP → juggler-backend │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                  shared/  (juggler-shared npm package)              │
│  scheduler helpers: expandRecurring, dateHelpers, timeBlockHelpers  │
│  locationHelpers, dependencyHelpers, missedHelpers                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | Key File |
|-----------|----------------|----------|
| AppLayout | Root orchestrator — mounts all views, owns modal state, wires hooks | `juggler-frontend/src/components/layout/AppLayout.jsx` |
| useTaskState | Task state manager — reducer + API sync + SSE listener | `juggler-frontend/src/hooks/useTaskState.js` |
| taskReducer | Immutable state reducer — field-level dirty tracking | `juggler-frontend/src/state/taskReducer.js` |
| apiClient | Axios instance — JWT bearer + timezone header + auto-refresh | `juggler-frontend/src/services/apiClient.js` |
| Views (9) | Read-only rendering of placements (DailyView, WeekView, etc.) | `juggler-frontend/src/components/views/` |
| task.controller | CRUD + rowToTask/taskToRow + enqueue orchestration | `juggler-backend/src/controllers/task.controller.js` |
| scheduleQueue | DB-backed event queue — debounced scheduler trigger | `juggler-backend/src/scheduler/scheduleQueue.js` |
| unifiedScheduleV2 | Main scheduler — constraint-first single-pass placement | `juggler-backend/src/scheduler/unifiedScheduleV2.js` |
| runSchedule | Load → schedule → persist loop (calls unifiedScheduleV2) | `juggler-backend/src/scheduler/runSchedule.js` |
| cal-sync.controller | Multi-provider calendar sync (GCal/MSFT/Apple) | `juggler-backend/src/controllers/cal-sync.controller.js` |
| cal-adapters/ | Provider adapter pattern for calendar sync | `juggler-backend/src/lib/cal-adapters/` |
| task-write-queue | Deferred write queue during lock contention | `juggler-backend/src/lib/task-write-queue.js` |
| sync-lock | DB-backed per-user mutual exclusion lock | `juggler-backend/src/lib/sync-lock.js` |
| tasks-write | Canonical write-path routing to task_masters + task_instances | `juggler-backend/src/lib/tasks-write.js` |
| sse-emitter | Server-Sent Events broadcaster — Redis pub/sub backed | `juggler-backend/src/lib/sse-emitter.js` |
| MCP transport (backend) | Stateless HTTP MCP endpoint for authenticated tool calls | `juggler-backend/src/mcp/transport.js` |
| juggler-mcp | Standalone stdio MCP server for Claude Code / ClimbRS | `juggler-mcp/index.js` |
| shared/ | Shared scheduler logic consumed by both backend and frontend | `shared/scheduler/` |

## Pattern Overview

**Overall:** Event-queue–driven, constraint-first task scheduling with adapter-pattern calendar sync and SSE real-time push.

**Key Characteristics:**
- Frontend is notification-only via SSE — the API is the single source of truth; SSE triggers refetches, not data merges
- Scheduler is triggered exclusively by user/MCP mutations via `scheduleQueue`, never self-triggers
- All task writes go through `tasks-write.js` which routes fields to `task_masters` or `task_instances` correctly
- Calendar sync and the scheduler share a per-user DB lock (`sync_locks`) to prevent concurrent writes

## Layers

**Frontend Presentation Layer:**
- Purpose: Render scheduler output; collect user input; relay mutations to backend
- Location: `juggler-frontend/src/`
- Contains: React components, custom hooks, reducer state, Axios apiClient
- Depends on: `juggler-backend` (REST API), `shared/` (via `juggler-shared` package alias)
- Used by: end users, admin routes

**Backend API Layer:**
- Purpose: Route HTTP requests, validate JWT, apply rate limits, delegate to controllers
- Location: `juggler-backend/src/app.js`, `juggler-backend/src/routes/`
- Contains: Express routes, middleware (JWT, feature-gate, entity-limits, validate)
- Depends on: controllers, middleware
- Used by: frontend, MCP transport, billing webhooks

**Controller Layer:**
- Purpose: Business logic — CRUD, field mapping, enqueue decisions
- Location: `juggler-backend/src/controllers/`
- Contains: `task.controller.js`, `cal-sync.controller.js`, `ai.controller.js`, `weather.controller.js`, etc.
- Depends on: lib/, scheduler/, db
- Used by: routes

**Scheduler Subsystem:**
- Purpose: Place tasks into time slots, persist moves, reconcile recurring instances
- Location: `juggler-backend/src/scheduler/`
- Contains: `unifiedScheduleV2.js`, `runSchedule.js`, `scheduleQueue.js`, `reconcileOccurrences.js`, helpers
- Depends on: db, lib/tasks-write, lib/sync-lock, shared/scheduler
- Used by: scheduleQueue poll loop, manually via `/api/schedule`

**Library Layer (`lib/`):**
- Purpose: Infrastructure — locking, write queue, SSE, Redis, cal-adapters, reconcile-splits
- Location: `juggler-backend/src/lib/`
- Contains: `sync-lock.js`, `task-write-queue.js`, `sse-emitter.js`, `redis.js`, `tasks-write.js`, `cal-adapters/`
- Depends on: db, external APIs (Redis, Google APIs, MSFT APIs, Apple CalDAV)
- Used by: controllers, scheduler, cron

**Database Layer:**
- Purpose: Persist task data, scheduling state, calendar ledgers, locks
- Location: `juggler-backend/src/db/`, `juggler-backend/knexfile.js`
- Contains: Knex instance, migrations
- Depends on: MySQL 8 (charset utf8mb4, timezone UTC)
- Used by: all backend layers

**Shared Library:**
- Purpose: Algorithm logic shared between backend scheduler and frontend rendering
- Location: `shared/scheduler/`
- Consumed as `juggler-shared` in frontend; required directly (`../../../shared/`) in backend

## Data Flow

### Primary Write Path (User Mutation)

1. Frontend sends `PATCH /api/tasks/:id` with changed fields only (`task.controller.js`)
2. `task.controller.js` acquires or queues via `task-write-queue.js` (if lock held) (`juggler-backend/src/lib/task-write-queue.js`)
3. `tasks-write.js` routes fields: scheduling-relevant → `task_masters`/`task_instances`, non-scheduling → direct write (`juggler-backend/src/lib/tasks-write.js`)
4. `task.controller.js` calls `enqueueScheduleRun(userId, source)` — inserts row to `schedule_queue`, marks user dirty in memory (`juggler-backend/src/scheduler/scheduleQueue.js`)
5. SSE `tasks:changed` event emitted immediately so frontend can optimistically update (`juggler-backend/src/lib/sse-emitter.js`)
6. Poll loop (1s interval) detects dirty user; waits for 2s quiet period, then fires `runScheduleAndPersist` (`juggler-backend/src/scheduler/runSchedule.js`)
7. Scheduler output: updated `scheduled_at` values written back to `task_instances`
8. Post-scheduler SSE `tasks:changed` emitted with affected task IDs

### Calendar Sync Path

1. Frontend or cron calls `POST /api/cal/sync`
2. `cal-sync.controller.js` acquires per-user `sync_locks` row
3. Flushes pending `task-write-queue` entries (so scheduler sees latest state)
4. For each connected adapter (`gcal`, `msft`, `apple`): pull remote events, diff against `cal_sync_ledger`, push changed tasks, mark misses
5. `MISS_THRESHOLD = 3` consecutive missing syncs before a task is deleted
6. Releases lock; emits `tasks:changed` SSE

### Scheduler Internal Flow

1. `scheduleQueue.processUser` calls `runScheduleAndPersist(userId)` under `sync-lock`
2. `runSchedule.js` loads all tasks from `tasks_v` view + user config
3. `reconcileOccurrences.js` expands recurring templates into instances for the look-ahead window
4. `unifiedScheduleV2.js` runs single-pass constraint-first placement: pinned → fixed → rigid recurring → slack-sorted queue
5. Delta detected: only tasks with changed `scheduled_at` are written back

### SSE Real-Time Notification

1. Frontend opens `GET /api/events?token=<jwt>` (EventSource, query-param token)
2. `sse-emitter.addClient(userId, res)` registers the response object
3. Backend publishes to `sse:{userId}` Redis channel; subscriber delivers to all connected instances
4. Falls back to local-only delivery if Redis is unavailable

**State Management (Frontend):**
- `useReducer` + `taskReducer` for task list and statuses
- Field-level dirty tracking: `_dirtyTaskIds` prevents remote refreshes from overwriting in-flight local changes
- `useTaskState` hook polls `GET /api/tasks/version` every 5s to detect external changes (MCP, another tab, cal-sync)

## Key Abstractions

**Task Model (master/instance split):**
- Purpose: Separates user intent (`task_masters`) from scheduler-placed occurrences (`task_instances`). One-off tasks have one instance; recurring tasks have N instances. Split tasks have N chunks as separate instance rows.
- Tables: `task_masters`, `task_instances`
- View: `tasks_v` — unified JOIN that all backend code reads from
- Write path: `juggler-backend/src/lib/tasks-write.js`

**Placement Mode:**
- Purpose: Classifies how the scheduler should place a task. Stored as ENUM in `task_masters.placement_mode`.
- Values: `marker`, `fixed`, `pinned_date`, `recurring_rigid`, `recurring_window`, `recurring_flexible`, `flexible`
- Defined: `juggler-backend/src/lib/placementModes.js`, mirrored in frontend at `juggler-frontend/src/state/constants.js`

**Calendar Adapter:**
- Purpose: Unified interface for GCal, MSFT, Apple CalDAV calendar providers
- Interface: `isConnected(user)`, `pullEvents()`, `pushTask()`, etc.
- Registry: `juggler-backend/src/lib/cal-adapters/index.js`
- Adapters: `gcal.adapter.js`, `msft.adapter.js`, `apple.adapter.js`

**Scheduler Queue:**
- Purpose: Decouples mutation endpoints from scheduler execution; debounces rapid edits
- DB table: `schedule_queue`
- In-memory: `dirty` map (per-user boolean), `running` map (single-flight guard)

## Entry Points

**Backend HTTP Server:**
- Location: `juggler-backend/src/server.js`
- Triggers: `node src/server.js` or nodemon
- Responsibilities: clear stale locks on startup, load JWT secrets, start HTTP server, enqueue startup scheduler runs, start AI usage flusher, start cal-history-cron

**Backend Express App:**
- Location: `juggler-backend/src/app.js`
- Responsibilities: all middleware registration, route mounting, MCP HTTP endpoint, SSE endpoint, global error handler

**Frontend Entry:**
- Location: `juggler-frontend/src/index.js`
- Mounts: `<App />` into `#root`
- Bootstraps: mobile-drag-drop polyfill

**Frontend App Root:**
- Location: `juggler-frontend/src/App.js`
- Wraps: `AuthProvider` → `AppContent` (route switch) → `AppLayout`
- Admin routes: `/admin/scheduler-debug`, `/admin/scheduler-stepper`, `/admin/impersonation`

**juggler-mcp Entry:**
- Location: `juggler-mcp/index.js`
- Transport: stdio (for Claude Code / ClimbRS)
- Calls juggler-backend REST API using stored JWT token

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop. The scheduler and cal-sync both use DB-backed locks (`sync_locks`) rather than in-process mutexes to ensure safety across multiple Cloud Run instances.
- **Global state:** `scheduleQueue.js` maintains in-memory `dirty` and `running` maps (module-level singletons). These are per-process only — multi-instance safety relies on DB lock + queue.
- **SSE scale-out:** `sse-emitter.js` uses Redis pub/sub so SSE events reach all Cloud Run instances. Falls back to local-only if Redis is down. Multi-instance deployment requires Redis.
- **Circular imports:** `scheduleQueue.js`, `task-write-queue.js`, and `sync-lock.js` use lazy `require()` getters to break circular dependency chains between the scheduler, write queue, and lock modules.
- **Auth:** All `/api/*` routes require JWT from the shared `auth-service`. JWT is RS256, verified via JWKS. Frontend stores access token in `localStorage` under key `juggler-access-token`.
- **Collation:** All MySQL tables must use `COLLATE utf8mb4_unicode_ci` explicitly. MySQL 8 defaults to `utf8mb4_0900_ai_ci` which silently breaks JOINs.
- **Scheduler trigger rule:** Scheduler runs only after user/MCP mutations. Never self-triggers. Never calls itself recursively.

## Anti-Patterns

### Merging SSE data into frontend state

**What happens:** Treating SSE event payloads as data to merge into task state directly.
**Why it's wrong:** SSE is notification-only. The event carries `ids` as a hint only. The SSE `tasks:changed` event must trigger a `GET /api/tasks` refetch, not an in-place state patch.
**Do this instead:** Call `loadTasks()` in `useTaskState` when `tasks:changed` SSE fires. See `juggler-frontend/src/hooks/useTaskState.js`.

### Writing directly to task_masters/task_instances without tasks-write.js

**What happens:** Code inserts/updates `task_masters` or `task_instances` rows directly via Knex outside of `tasks-write.js`.
**Why it's wrong:** `tasks-write.js` enforces field routing, placement_mode derivation, and `updated_at` tracking. Bypassing it produces inconsistent rows.
**Do this instead:** Call `tasksWrite.insertTask()`, `tasksWrite.updateTaskById()`, or `tasksWrite.bulkUpdate()` from `juggler-backend/src/lib/tasks-write.js`.

### Parallel scheduler enqueue for fan-out jobs

**What happens:** Enqueueing multiple `schedule_queue` inserts in parallel for bulk operations.
**Why it's wrong:** Simultaneous queue inserts trigger near-simultaneous scheduler runs, causing DB contention and redundant work.
**Do this instead:** Use sequential enqueue. One `enqueueScheduleRun` call covers all affected users because the scheduler processes each user's full task set.

## Error Handling

**Strategy:** Log and continue for non-fatal subsystem failures (AI flusher, cron, Redis); fatal errors (missing DB config, JWT load failure) crash the process with exit code 1.

**Patterns:**
- 500 responses in production omit internal message (sanitized by `res.json` wrapper in `app.js`)
- Unhandled rejections are logged but do not crash the process
- Uncaught exceptions crash the process in production (graceful shutdown), log only in development
- Cal-sync errors captured into structured `errorDetail` objects returned in the sync response body

## Cross-Cutting Concerns

**Logging:** `console.log/warn/error` throughout. Morgan `dev` format for HTTP requests (SSE endpoint excluded from logging to avoid token leakage).
**Validation:** Zod schemas in `juggler-backend/src/schemas/` (task, config, project). `validate.js` middleware applies them to routes.
**Authentication:** Shared `auth-client` npm package (vendored at `juggler-backend/vendor/auth-client.js`). JWT verified via JWKS from `auth-service`. MCP requests go through `authenticateMcpRequest` from `auth-client/mcp-auth`.
**Feature Gating:** `juggler-backend/src/middleware/feature-gate.js` — `requireFeature()`, `checkUsageLimit()`. Plan info from JWT `plans.juggler` claim.
**AI Usage Tracking:** All Gemini calls go through `trackedGeminiCall()` (`juggler-backend/src/services/gemini-tracked-call.js`) which writes to `ai_usage_outbox`. `ai-usage-flusher.service.js` batches and forwards to `payment-service`.

---

*Architecture analysis: 2026-05-14*
