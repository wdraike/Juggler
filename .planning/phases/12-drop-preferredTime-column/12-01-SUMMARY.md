---
phase: "12"
plan: "01"
subsystem: "juggler"
tags: [cleanup, backend, frontend, preferred_time]
dependency_graph:
  requires: []
  provides: [preferred_time-reads-writes-removed]
  affects: [juggler-backend/task.controller.js, juggler-frontend/TaskEditForm.jsx]
tech_stack:
  added: []
  patterns: [surgical-removal]
key_files:
  modified:
    - juggler-backend/src/controllers/task.controller.js
    - juggler-frontend/src/components/tasks/TaskEditForm.jsx
decisions:
  - Kept hasPreferredTime state in TaskEditForm — it drives UI; only the API field is removed
  - Kept the comment at line 203 referencing the legacy flag — it explains why we no longer gate on it
metrics:
  duration: "~17 minutes"
  completed: "2026-05-18T17:54:59Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 12 Plan 01: Strip preferred_time Boolean — Summary

Remove all code-level reads and writes of the `preferred_time` boolean column from the backend mapper functions and frontend form, in advance of the DB migration (plan 02) that drops the column.

## What Was Done

**Task 1 — Backend (task.controller.js, commit 877d14a):**
- Removed `'preferred_time'` from `TEMPLATE_FIELDS` array (line 159); `'preferred_time_mins'` stays
- Removed `preferredTime: row.preferred_time != null ? !!row.preferred_time : null` from `rowToTask` return object
- Removed the `if (task.preferredTime !== undefined)` block (3 lines) from `taskToRow`

**Task 2 — Frontend (TaskEditForm.jsx, commit 877d14a):**
- Removed `if (task.preferredTime != null) return !!task.preferredTime;` from `hasPreferredTime` useState initializer
- Removed `preferredTime: t.preferredTime != null ? !!t.preferredTime : null` from `buildFields` snapshot object
- Removed `preferredTime: placementMode === 'time_window' ? true : (...)` from `buildFields` return object
- Removed `var snapPref` and `if (recurring && hasPreferredTime !== snapPref)` from `buildChangedFields`

## Verification

Backend grep for `preferred_time[^_]` (excluding `_mins` and comments): **0 hits**

Frontend grep for `preferredTime[^M]` (excluding `hasPreferredTime`, `setRecurringHasPreferredTime`, `preferredTimeMins`, comments): **0 hits** (1 hit in a `//` comment at line 203 — explaining legacy context, not a code action)

Frontend build: **clean** (no errors)

Backend tests: all pre-existing failures are DB-connection-related (not related to this change); no `preferred_time` references in any failure output.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — this is a pure removal of a boolean field with no new network surface.

## Self-Check: PASSED

- [x] `877d14a` exists in git log
- [x] `juggler-backend/src/controllers/task.controller.js` modified
- [x] `juggler-frontend/src/components/tasks/TaskEditForm.jsx` modified
- [x] `preferred_time_mins` untouched in all locations
- [x] `hasPreferredTime` state preserved in TaskEditForm
