# Coding Conventions

**Analysis Date:** 2026-05-14

## Language Style

**Backend (`juggler-backend/src/`):**
- Plain CommonJS (`var`, `require`, `module.exports`) — not ES modules, not TypeScript
- `var` is the dominant variable declaration keyword throughout backend source
- No `class` syntax — all modules export plain objects or function closures
- `'use strict'` at the top of many files but not universally enforced

**Frontend (`juggler-frontend/src/`):**
- ES module syntax (`import`/`export`) with JSX (`.js`, `.jsx` extensions)
- Mix of `var` and `const`/`let` — `var` used heavily in functional components for compatibility with the same scheduler helpers shared with backend
- React functional components only — no class components

**Shared (`shared/`):**
- CommonJS, usable by both backend and frontend scheduler via bundling

## Naming Patterns

**Files:**
- Backend: `kebab-case.js` — e.g., `tasks-write.js`, `cal-sync-helpers.js`, `task-write-queue.js`
- Controllers: `<resource>.controller.js` — e.g., `task.controller.js`, `cal-sync.controller.js`
- Routes: `<resource>.routes.js` — e.g., `task.routes.js`, `gcal.routes.js`
- Services: `<name>.service.js` — e.g., `ai-usage-queue.service.js`
- Middleware: `<name>.middleware.js` — e.g., `plan-features.middleware.js`
- Frontend components: `PascalCase.jsx` — e.g., `TaskCard.jsx`, `ImpersonationBanner.jsx`
- Frontend hooks: `useCamelCase.js` — e.g., `useTaskState.js`, `useIsMobile.js`

**Functions:**
- camelCase for all function names in both backend and frontend
- Factory functions named `make<Type>` in tests (e.g., `makeTask`, `makeCfg`, `makeRow`)
- Helper/setup functions named `seed<Entity>` in test helpers (e.g., `seedUser`, `seedTask`)

**Variables:**
- camelCase throughout
- Underscore prefix (`_varName`) for private/internal module variables (e.g., `_acquireLock`, `_emitLocal`)
- `_dirtyTaskIds`, `_dirtyStatuses` in reducer for internal tracking state

**Constants:**
- `SCREAMING_SNAKE_CASE` for module-level constants — e.g., `MASTER_FIELDS`, `NON_SCHEDULING_FIELDS`, `PLACEMENT_TRIGGER_FIELDS`
- Priority values as string enum: `'P1'`, `'P2'`, `'P3'`, `'P4'`
- Status values as strings: `''`, `'wip'`, `'done'`, `'cancel'`, `'skip'`, `'pause'`, `'missed'`
- Task types as strings: `'task'`, `'recurring_template'`, `'recurring_instance'`

**DB Columns vs API Fields:**
- DB columns: `snake_case` — e.g., `scheduled_at`, `task_type`, `date_pinned`
- API/frontend fields: `camelCase` — e.g., `scheduledAt`, `taskType`, `datePinned`
- Zod schemas in `src/schemas/` use camelCase to match frontend
- `rowToTask()` and `taskToRow()` in `task.controller.js` handle the translation

## Code Style

**Formatting:**
- No Prettier config file detected — formatting is not enforced by tooling
- Indentation: 2 spaces throughout (consistent)
- Single quotes for strings in backend JS
- No trailing semicolons omitted — semicolons are used

**Linting:**
- Backend: ESLint flat config (`juggler-backend/eslint.config.js`) — ESLint 9.x
  - Only `eslint-plugin-unused-imports` enabled
  - `unused-imports/no-unused-imports`: error
  - `unused-imports/no-unused-vars`: warn (args/vars prefixed with `_` are excluded)
  - Style rules intentionally NOT enabled — detection scaffolding only
- Frontend: `react-app` + `react-app/jest` + `unused-imports` plugin (configured in `package.json` `eslintConfig`)
- Run: `npm run lint` (CLAUDE.md quality gate, though no separate lint script exists; ESLint called via `audit:unused`)

## Import Organization

**Backend pattern** (CommonJS `require`):
```js
// 1. Node built-ins (rare — crypto, path)
// 2. Third-party packages
const { z } = require('zod');
const { v7: uuidv7 } = require('uuid');
// 3. Internal DB
const db = require('../db');
// 4. Local modules — same directory or relative
const tasksWrite = require('../lib/tasks-write');
const { localToUtc } = require('../scheduler/dateHelpers');
```

**Lazy requires for circular dependency avoidance:**
- `task-write-queue.js` uses wrapper functions around `require()` to avoid circular imports:
  ```js
  var _acquireLock;
  function getAcquireLock() {
    if (!_acquireLock) _acquireLock = require('./sync-lock').acquireLock;
    return _acquireLock;
  }
  ```
- This pattern appears in `task-write-queue.js` and `sse-emitter.js` — use it when a module has circular deps.

**Frontend pattern** (ES modules):
```js
// 1. React + hooks
import React from 'react';
import { useReducer, useCallback } from 'react';
// 2. Third-party
import axios from 'axios';
// 3. Local state/services
import taskReducer from '../state/taskReducer';
import apiClient from '../services/apiClient';
// 4. Local utilities
import { getBrowserTimezone } from '../utils/timezone';
```

## Error Handling

**Backend controllers:**
- All async route handlers wrapped in try/catch
- Standard error response shape: `{ error: 'message string' }` with appropriate HTTP status
- `400` for validation failures (with `{ error: 'Validation failed', details: [...] }` from Zod middleware)
- `401` for auth failures
- `409` for conflicts (e.g., lock held)
- `500` for unexpected server errors (usually just `res.status(500).json({ error: e.message })`)

**Validation layer:**
- Input validated via Zod schemas in `src/schemas/` before reaching controllers
- `validate(schema)` middleware in `src/middleware/validate.js` parses with `schema.safeParse(req.body)`
- Attach schema to route: `router.post('/', validate(taskCreateSchema), controller.create)`

**Frontend:**
- API calls via axios — rejections caught in `.catch()` blocks or try/catch in async functions
- No global error boundary pattern observed — error handling is per-component

## Logging

**Backend:**
- `console.warn(...)` for non-fatal warnings (Redis unavailable, sync edge cases)
- `console.error(...)` for unexpected errors
- No structured logging library — plain `console.*`
- Module prefix convention: `[module-name]` in log messages — e.g., `'[sse-emitter] Redis subscriber error...'`
- `morgan` HTTP request logger configured in `src/app.js`

**Frontend:**
- No logging beyond `console.error` for unexpected failures

## Comments

**When to comment:**
- JSDoc-style block comment at top of every module explaining its purpose and contract
- Complex logic sections marked with ASCII section dividers: `// ── Section Name ──────`
- Block comments use `/** ... */` for public-facing function docs; `//` for inline explanation
- Known limitations and open gaps documented inline (particularly in `unifiedScheduleV2.js`)

**Example module header pattern:**
```js
/**
 * task-write-queue.js — Durable queue for scheduling-relevant task writes.
 *
 * When the per-user lock is held (scheduler or cal-sync running), mutation
 * endpoints queue scheduling-relevant field changes here instead of writing
 * directly to the tasks table. Non-scheduling fields (text, notes, project)
 * always write directly.
 */
```

**Section divider pattern (prominent in scheduler and tests):**
```js
// ═══════════════════════════════════════════════════════════════
// TEMPLATE_FIELDS
// ═══════════════════════════════════════════════════════════════
```

## Function Design

**Size:** Functions are kept focused but not artificially small — complex scheduler functions run long with inline comments
**Parameters:** Prefer plain objects over long parameter lists; factory functions like `makeTask(overrides)` use `Object.assign({defaults}, overrides)` pattern
**Return Values:** Controllers use `res.json(...)` — no return value. Pure functions return computed values directly.

## Module Design

**Backend exports:**
- Single responsibility per module
- Named exports for utilities: `module.exports = { functionA, functionB };`
- Named exports avoid default export confusion across CommonJS/ESM boundary

**Frontend exports:**
- Default export for components (`export default function TaskCard(...)`)
- Named exports for utilities and constants (`export function getTaskIcon`, `export const STATUS_OPTIONS`)

**DB access pattern:**
- `require('../db')` returns a Knex instance — all queries use it directly
- All task writes go through `juggler-backend/src/lib/tasks-write.js` — never write to `task_masters`/`task_instances` directly from controllers
- Read via `tasks_v` view (single-table facade over the two-table model)

## Validation Schemas

Location: `juggler-backend/src/schemas/`
- `task.schema.js` — `taskCreateSchema`, `taskUpdateSchema`
- `project.schema.js` — `projectSchema`, `projectUpdateSchema`
- `config.schema.js` — `preferencesSchema`

Schema uses `.passthrough()` on base objects so unknown fields reach the controller intact.

## Constants

Location: `juggler-backend/src/constants/`
- `ai-use-cases.js` — named AI use case identifiers

Location: `juggler-backend/src/scheduler/constants.js`
- `DEFAULT_TIME_BLOCKS`, `DEFAULT_TOOL_MATRIX`, `GRID_START`, `GRID_END`, `PRI_RANK`

Frontend constants: `juggler-frontend/src/state/constants.js`
- `STATUS_OPTIONS`, `STATUS_MAP`, `PRI_COLORS`, `isTerminalStatus`, `PAST_OPACITY`

---

*Convention analysis: 2026-05-14*
