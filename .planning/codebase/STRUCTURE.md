# Codebase Structure

**Analysis Date:** 2026-05-14

## Directory Layout

```
juggler/                         # Git submodule root
├── juggler-backend/             # Node.js/Express API server (port 5002)
│   ├── src/
│   │   ├── server.js            # Process entry point — startup, shutdown, cron init
│   │   ├── app.js               # Express app — middleware + route mounting
│   │   ├── db.js                # Knex singleton
│   │   ├── service-identity.js  # APP_ID / SERVICE_NAME constants
│   │   ├── proxy-config.js      # Service URL resolution (all environments)
│   │   ├── controllers/         # Business logic handlers
│   │   ├── routes/              # Express router files
│   │   ├── middleware/          # JWT, feature-gate, validate, rate-limit helpers
│   │   ├── scheduler/           # Scheduling engine
│   │   ├── lib/                 # Infrastructure (locks, queues, adapters, SSE)
│   │   ├── services/            # AI usage tracking services
│   │   ├── schemas/             # Zod validation schemas
│   │   ├── constants/           # Shared constants (AI use-cases)
│   │   ├── cron/                # Background cron jobs
│   │   ├── mcp/                 # MCP HTTP endpoint (stateless Streamable HTTP)
│   │   │   └── tools/           # MCP tool registrations
│   │   ├── db/
│   │   │   └── migrations/      # Knex migration files
│   │   ├── scripts/             # One-off admin scripts
│   │   ├── keys/                # Service JWT signing keys (gitignored content)
│   │   └── __tests__/           # Unit tests co-located with src
│   ├── tests/                   # Integration + scenario tests
│   │   ├── api/                 # Route-level API tests
│   │   ├── cal-sync/            # Calendar sync integration tests
│   │   ├── scheduler/           # Scheduler-specific tests
│   │   ├── unit/                # Pure unit tests for controllers/services
│   │   ├── lib/                 # Tests for lib/ modules
│   │   ├── db/                  # DB integration tests
│   │   ├── migrations/          # Migration up/down tests
│   │   ├── cron/                # Cron job tests
│   │   ├── security/            # Security tests
│   │   └── helpers/             # Shared test helpers (db setup, factories)
│   ├── vendor/                  # Vendored shared packages (auth-client, etc.)
│   ├── docs/                    # Architecture + design docs
│   ├── knexfile.js              # DB config for all environments
│   └── package.json
│
├── juggler-frontend/            # React SPA (port 3003, Create React App)
│   ├── src/
│   │   ├── index.js             # ReactDOM.createRoot entry
│   │   ├── App.js               # Root component — auth gate + route switch
│   │   ├── proxy-config.js      # Service URL resolution (shared with backend)
│   │   ├── setupProxy.js        # CRA dev proxy config
│   │   ├── components/
│   │   │   ├── layout/          # AppLayout, HeaderBar, NavigationBar, WeekStrip, etc.
│   │   │   ├── views/           # Calendar/list views (DailyView, WeekView, etc.)
│   │   │   ├── tasks/           # Task cards, edit form, quick-add
│   │   │   ├── schedule/        # Schedule-specific components (CalendarGrid, StatusToggle)
│   │   │   ├── settings/        # SettingsPanel
│   │   │   ├── features/        # Feature panels (CalSync, AI, Weather, Import/Export, dialogs)
│   │   │   ├── auth/            # AuthProvider, LoginPage
│   │   │   ├── billing/         # DisabledItemsPanel, UpgradePrompt
│   │   │   ├── admin/           # ImpersonationBanner, SchedulerDebug, SchedulerStepper
│   │   │   └── feedback/        # Feedback widgets
│   │   ├── hooks/               # Custom hooks (useTaskState, useConfig, useWeather, etc.)
│   │   ├── state/               # taskReducer.js + constants.js
│   │   ├── services/            # apiClient.js, impersonationService.js
│   │   ├── scheduler/           # Date/time helpers (re-exports from juggler-shared)
│   │   ├── utils/               # taskIcon.js, timezone.js, weatherMatch.js
│   │   └── theme/               # colors.js, typography.css
│   ├── public/                  # Static assets
│   ├── nginx.conf               # Production nginx config
│   └── package.json
│
├── juggler-mcp/                 # Standalone stdio MCP server
│   ├── index.js                 # Full MCP server — HTTP calls to juggler-backend
│   └── package.json
│
├── shared/                      # Shared scheduler logic (published as juggler-shared)
│   ├── scheduler/
│   │   ├── expandRecurring.js   # Recurring task instance expansion
│   │   ├── dateHelpers.js       # Date/time parsing + formatting
│   │   ├── timeBlockHelpers.js  # When-block window computation
│   │   ├── locationHelpers.js   # Location constraint helpers
│   │   ├── dependencyHelpers.js # Chain/dependency resolution
│   │   ├── missedHelpers.js     # Missed-instance detection
│   │   └── dateMatchesRecurrence.js
│   ├── verify-sync.js
│   └── package.json             # name: "juggler-shared"
│
├── auth-client/                 # Vendored copy of shared auth-client (gitignored per-service)
│   ├── auth-client.js
│   ├── mcp-auth.js
│   ├── proxy-config.js
│   └── service-auth.js
│
├── scripts/                     # Monorepo-level scripts
├── tests/                       # Playwright E2E tests (root-level)
├── playwright.config.js
├── package.json                 # Workspace root
└── restart.sh                   # Dev restart helper
```

## Directory Purposes

**`juggler-backend/src/controllers/`:**
- Purpose: Business logic for each API domain
- One controller per domain: `task.controller.js`, `cal-sync.controller.js`, `ai.controller.js`, `weather.controller.js`, `gcal.controller.js`, `msft-cal.controller.js`, `apple-cal.controller.js`, `config.controller.js`, `data.controller.js`, `billing-webhooks.controller.js`, `feature-catalog.controller.js`, `impersonation.controller.js`
- Key files: `juggler-backend/src/controllers/task.controller.js` (largest; owns `rowToTask`, `taskToRow`, `buildSourceMap`)

**`juggler-backend/src/routes/`:**
- Purpose: Express Router files — wire HTTP verbs to controller methods, apply middleware
- One `.routes.js` file per domain matching the controller

**`juggler-backend/src/scheduler/`:**
- Purpose: Scheduling engine — placement, queue, recurring expansion, persistence
- Key files: `unifiedScheduleV2.js` (placement algorithm), `scheduleQueue.js` (event queue), `runSchedule.js` (load/run/persist), `reconcileOccurrences.js`, `dateHelpers.js`, `dependencyHelpers.js`, `timeBlockHelpers.js`, `locationHelpers.js`, `constants.js`, `scoreSchedule.js`

**`juggler-backend/src/lib/`:**
- Purpose: Infrastructure primitives shared across controllers/scheduler
- Key files: `tasks-write.js` (canonical DB write path), `task-write-queue.js` (lock-contention queue), `sync-lock.js` (per-user DB lock), `sse-emitter.js` (Redis-backed SSE), `redis.js` (cache client), `cal-adapters/` (GCal/MSFT/Apple adapters), `reconcile-splits.js`, `placementModes.js`, `task-status.js`

**`juggler-backend/src/db/migrations/`:**
- Purpose: Knex migration files — append-only, timestamped
- Naming: `YYYYMMDDHHMMSS_description.js`
- Key: `20260415010000_create_task_masters_and_instances.js` (master/instance model), `20260501000300_placement_mode_stored.js` (current tasks_v view definition)

**`juggler-backend/src/mcp/`:**
- Purpose: MCP HTTP transport + tool registrations for authenticated in-app MCP access
- `transport.js` handles `POST /mcp`; `server.js` creates per-user McpServer; `tools/` registers task/schedule/config/data tools

**`juggler-backend/tests/`:**
- Purpose: Test suite (Jest)
- Subdirs: `api/`, `cal-sync/`, `scheduler/`, `unit/`, `lib/`, `db/`, `migrations/`, `cron/`, `security/`, `helpers/`

**`juggler-frontend/src/components/layout/`:**
- Purpose: App shell components — `AppLayout.jsx` is the root orchestrator; `HeaderBar.jsx`, `NavigationBar.jsx`, `WeekStrip.jsx`, `ToastNotification.jsx`, `UserDropdown.jsx`

**`juggler-frontend/src/components/views/`:**
- Purpose: Calendar and task list view renderers
- Views: `DailyView.jsx`, `DayView.jsx`, `ThreeDayView.jsx`, `WeekView.jsx`, `CalendarView.jsx`, `ListView.jsx`, `PriorityView.jsx`, `ConflictsView.jsx`, `DependencyView.jsx`, `TimelineView.jsx`, `SCurveView.jsx`
- Admin views: `SchedulerDebug.js`, `SchedulerStepper.jsx`, `ImpersonationPage.jsx`

**`juggler-frontend/src/hooks/`:**
- Purpose: Custom React hooks — `useTaskState.js` (core state), `useConfig.js`, `useWeather.js`, `useDragDrop.js`, `useTimezone.js`, `useUndo.js`, `useKeyboardShortcuts.js`, `useIsMobile.js`, `useIsCompact.js`, `usePlanInfo.js`

**`juggler-frontend/src/state/`:**
- Purpose: Reducer logic and global constants
- `taskReducer.js` — immutable state transitions with field-level dirty tracking
- `constants.js` — GRID_START/END, PRI_COLORS, STATUS_MAP, placement mode constants

**`juggler-frontend/src/scheduler/`:**
- Purpose: Re-exports from `juggler-shared` plus frontend-specific date display helpers
- All files delegate to `shared/scheduler/` via `juggler-shared` package alias

**`shared/scheduler/`:**
- Purpose: Algorithm code shared between backend scheduler and frontend rendering
- Consumed in backend: `require('../../../shared/scheduler/expandRecurring')`
- Consumed in frontend: `import { ... } from '../scheduler/dateHelpers'` (re-exports via `juggler-shared`)

## Key File Locations

**Entry Points:**
- `juggler-backend/src/server.js`: Backend process start
- `juggler-backend/src/app.js`: Express app configuration
- `juggler-frontend/src/index.js`: React app bootstrap
- `juggler-frontend/src/App.js`: React root component
- `juggler-mcp/index.js`: Standalone MCP stdio server

**Configuration:**
- `juggler-backend/knexfile.js`: Database config (dev/test/production)
- `juggler-frontend/src/proxy-config.js`: Service URLs for all environments
- `juggler-backend/src/service-identity.js`: APP_ID, SERVICE_NAME constants

**Core Logic:**
- `juggler-backend/src/lib/tasks-write.js`: All task DB writes
- `juggler-backend/src/scheduler/unifiedScheduleV2.js`: Scheduling algorithm
- `juggler-backend/src/scheduler/scheduleQueue.js`: Event queue + poll loop
- `juggler-backend/src/lib/sync-lock.js`: Per-user mutual exclusion
- `juggler-backend/src/lib/sse-emitter.js`: Real-time push
- `juggler-frontend/src/hooks/useTaskState.js`: Frontend state management

**Database:**
- `juggler-backend/src/db/migrations/`: All migrations
- `juggler-backend/src/db.js`: Knex instance export

**Docs:**
- `juggler-backend/docs/SCHEDULER.md`: Scheduler design
- `juggler-backend/docs/TASK-PROPERTIES.md`: All task fields
- `juggler-backend/docs/TASK-STATE-MATRIX.md`: Valid state transitions
- `juggler-backend/docs/SCHEMA.md`: DB schema reference

## Naming Conventions

**Backend Files:**
- Controllers: `{domain}.controller.js` — e.g., `task.controller.js`
- Routes: `{domain}.routes.js` — e.g., `task.routes.js`
- Middleware: descriptive noun — e.g., `jwt-auth.js`, `feature-gate.js`, `validate.js`
- Library modules: kebab-case noun — e.g., `sync-lock.js`, `task-write-queue.js`, `sse-emitter.js`
- Scheduler helpers: camelCase noun — e.g., `dateHelpers.js`, `timeBlockHelpers.js`
- Migrations: `YYYYMMDDHHMMSS_snake_case_description.js`

**Frontend Files:**
- Components: PascalCase `.jsx` — e.g., `TaskEditForm.jsx`, `DailyView.jsx`
- Hooks: camelCase `use*.js` — e.g., `useTaskState.js`, `useWeather.js`
- Utilities: camelCase `.js` — e.g., `taskIcon.js`, `timezone.js`
- Services: camelCase `.js` — e.g., `apiClient.js`
- State: camelCase `.js` — e.g., `taskReducer.js`, `constants.js`

**Database:**
- Tables: snake_case plural — `task_masters`, `task_instances`, `sync_locks`, `schedule_queue`
- Views: snake_case with `_v` suffix — `tasks_v`, `tasks_with_sync_v`
- Migrations: prefixed with timestamp, described in snake_case

## Where to Add New Code

**New API Endpoint (new domain):**
- Controller: `juggler-backend/src/controllers/{domain}.controller.js`
- Routes: `juggler-backend/src/routes/{domain}.routes.js`
- Mount in: `juggler-backend/src/app.js` under `/api/{domain}`
- Tests: `juggler-backend/tests/api/` or `juggler-backend/tests/unit/`

**New API Endpoint (existing domain):**
- Add handler function to existing controller file
- Add route to existing `.routes.js` file

**New Calendar View:**
- Implementation: `juggler-frontend/src/components/views/{Name}View.jsx`
- Import + mount in: `juggler-frontend/src/components/layout/AppLayout.jsx`

**New Task Field:**
1. Migration: `juggler-backend/src/db/migrations/YYYYMMDDHHMMSS_add_{field}.js` — add to `task_masters` or `task_instances`, update `tasks_v` view
2. Field routing: add to `MASTER_FIELDS` or `INSTANCE_FIELDS` in `juggler-backend/src/lib/tasks-write.js`
3. API mapping: add to `rowToTask`/`taskToRow` in `juggler-backend/src/controllers/task.controller.js`
4. Frontend save: add to `SAVE_FIELDS` in `juggler-frontend/src/hooks/useTaskState.js`
5. Scheduler: add to `NON_SCHEDULING_FIELDS` in `juggler-backend/src/lib/task-write-queue.js` if non-scheduling, otherwise it will be treated as scheduling-relevant by default

**New Shared Scheduler Helper:**
- Implementation: `shared/scheduler/{helperName}.js`
- Frontend re-export: add to `juggler-frontend/src/scheduler/dateHelpers.js` or appropriate file
- Backend require: `require('../../../shared/scheduler/{helperName}')`

**New Feature Gate:**
- Add feature to `CATALOG` in `juggler-backend/src/controllers/feature-catalog.controller.js`
- Use `requireFeature()` or `checkUsageLimit()` middleware from `juggler-backend/src/middleware/feature-gate.js`

**New Middleware:**
- File: `juggler-backend/src/middleware/{name}.js`
- Apply in route file or in `app.js`

**New DB Migration:**
- File: `juggler-backend/src/db/migrations/YYYYMMDDHHMMSS_description.js`
- Must include both `exports.up` and `exports.down`
- Always add `COLLATE utf8mb4_unicode_ci` to any new column or table using text types

## Special Directories

**`juggler-backend/vendor/`:**
- Purpose: Vendored copies of shared packages (`auth-client.js`, `mcp-auth.js`, `proxy-config.js`, `service-auth.js`)
- Generated: No — manually synced from `auth-service/shared/` by deploy scripts
- Committed: Yes (to allow offline builds)
- Sync: Changes to `auth-service/shared/` must be manually propagated here

**`juggler-backend/src/keys/`:**
- Purpose: Service JWT signing keys (`service-private.pem`, `service-public.pem`, `service-kid.txt`)
- Generated: Yes (once, at service setup)
- Committed: Keys are in `.gitignore`; only `service-kid.txt` (key ID) is safe to commit

**`juggler-backend/juggler/`:**
- Purpose: Stale git submodule artifact — nested `juggler-backend/juggler/juggler-backend/tests/` directory
- Generated: No — submodule checkout artifact, not active code
- Committed: Submodule reference only; contains no live code

**`.worktrees/`:**
- Purpose: Active git worktrees for parallel feature development
- Generated: Yes (by `git worktree add`)
- Committed: No — worktree metadata only

**`.planning/`:**
- Purpose: Planning documents (codebase maps, quick fixes, debug notes, session handoffs)
- Generated: By hand / by planning sessions. (Formerly by GSD tooling — GSD was fully uninstalled
  2026-07-02; do not invoke `gsd-*` skills. The directory remains as plain planning docs.)
- Committed: Yes

---

*Structure analysis: 2026-05-14*
