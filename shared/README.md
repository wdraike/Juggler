# Juggler Shared Task Status Library

This library provides a unified interface for task status management that can be used by both frontend and backend components of the Juggler application.

## Installation

The shared library is located in the `shared/` directory at the root of the Juggler project.

### Backend Usage (CommonJS)

```javascript
const taskStatus = require('../../shared/task-status');

// Use the functions
if (taskStatus.isTerminalStatus(task.status)) {
  console.log('Task is in terminal state');
}
```

### Frontend Usage (ES Modules)

```javascript
import {
  TaskStatus,
  isTerminalStatus,
  getTaskStatusDisplayName
} from '../../shared/task-status';

// Use the constants and functions
const displayName = getTaskStatusDisplayName(task.status);
```

## API Reference

### Constants

- `TaskStatus`: Object with all status constants (`EMPTY`, `WIP`, `DONE`, etc.)
- `TASK_STATUSES`: Array of all valid task statuses
- `TERMINAL_STATUSES`: Array of terminal statuses (tasks that are complete/cancelled)
- `ACTIVE_STATUSES`: Array of active statuses (tasks still in scheduling pool)
- `STATUS_OPTIONS`: Array of all status options for UI dropdowns
- `CalHistoryStatus`: Object with calendar history status constants
- `CAL_HISTORY_STATUSES`: Array of valid calendar history statuses
- `CAL_HISTORY_TERMINAL_STATUSES`: Array of terminal calendar history statuses

### Functions

#### `isValidTaskStatus(status: string): boolean`
Validates if a status value is valid for tasks.

#### `isTerminalStatus(status: string): boolean`
Checks if a status is terminal (task is complete/cancelled/skipped/paused/missed).

#### `isActiveStatus(status: string): boolean`
Checks if a status is active (task is still in the scheduling pool).

#### `getTaskStatusDisplayName(status: string): string`
Gets the user-friendly display name for a status value.

#### `getTaskStatusDescription(status: string): string`
Gets a short description for a status value.

#### `isValidCalHistoryStatus(status: string): boolean`
Validates if a calendar history status value is valid.

#### `isCalHistoryTerminalStatus(status: string): boolean`
Checks if a calendar history status is terminal.

#### `isValidBooleanValue(value: number): boolean`
Validates boolean values to ensure they are 0/1 only.

#### `validateStatusValue(status: string, context?: string): boolean`
Validates status values with context-specific error messages.

#### `canTransition(currentStatus: string, newStatus: string): boolean`
Checks if a transition from currentStatus to newStatus is valid based on the state transition matrix.

## Status Values

| Status | Value | Description |
|--------|-------|-------------|
| EMPTY | '' | Task created but not yet started |
| WIP | 'wip' | Work In Progress (actively being worked on) |
| DONE | 'done' | Task completed successfully |
| CANCEL | 'cancel' | Task cancelled by user |
| SKIP | 'skip' | Task temporarily bypassed |
| PAUSE | 'pause' | Recurring task paused |
| MISSED | 'missed' | Resolution window passed without action |
| ARCHIVED | 'archived' | Task moved to history/archive |
| RESTORED | 'restored' | Task restored from history/archive |

## State Transition Rules

Based on the state transition matrix in `docs/architecture/TASK-STATE-MATRIX.md`:

- **EMPTY** can transition to: `done`, `wip`, `skip`, `cancel`, `pause`
- **WIP** can transition to: `done`, `EMPTY` (reopen), `skip`, `cancel`
- **Terminal statuses** cannot transition to any other status

## Migration Guide

### From Backend `src/lib/task-status.js`

Replace:
```javascript
const { isTerminalStatus } = require('../lib/task-status');
```

With:
```javascript
const { isTerminalStatus } = require('../../shared/task-status');
```

### From Frontend `src/shared/task-status.js`

Replace:
```javascript
import { isTerminalStatus } from '../shared/task-status';
```

With:
```javascript
import { isTerminalStatus } from '../../shared/task-status';
```

## Testing

Run the test script:

```bash
cd shared
node test-task-status.js
```

## TypeScript Support

TypeScript definitions are available in `task-status.d.ts` for IDE autocomplete and type checking.