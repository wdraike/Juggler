# SPEC — 999.895 — MCP terminal-schedule guard parity

## Intent
The HTTP status path enforces a "terminal-requires-schedule" guard: a task cannot be moved to a
terminal status (`done` / `skip` / `cancel`) unless it has a scheduled time (or the request supplies
one), EXCEPT rolling-recurring instances (anchor-based, exempt). The MCP tool path
(`src/mcp/tools/tasks.js`, tools `set_task_status` and `update_task`) lacks this guard, so MCP clients
(e.g. ClimbRS) can bypass it and mark unscheduled tasks terminal. Mirror the HTTP guard into the MCP
path.

## Canonical guard being mirrored
`src/slices/task/application/commands/UpdateTaskStatus.js:147-160`
- `TERMINAL_REQUIRES_SCHEDULE = ['done','skip','cancel']`
- Block when `status` is terminal AND `!existing.scheduled_at` AND no schedule supplied in the request
  AND the task is NOT a rolling-recurring instance (`isRollingMaster(master)` via `master_id||source_id`).
- HTTP error: 400 `{ error: "Cannot mark task <status> without a scheduled time. Schedule it first.",
  code: 'SCHEDULE_REQUIRED_FOR_TERMINAL_STATUS' }`.

## Functional requirements (acceptance criteria)
- **R1** `set_task_status` with a terminal status (`done`/`skip`/`cancel`) on an **unscheduled**,
  non-rolling task returns `isError:true` with the HTTP guard message, and does NOT write the status.
- **R2** `set_task_status` with a terminal status on a **scheduled** task succeeds (status written) —
  no false positive.
- **R3** `set_task_status` with a **non-terminal** status (e.g. `''`, `wip`) on an unscheduled task
  succeeds — guard does not over-fire.
- **R4** `set_task_status` terminal status on an unscheduled **rolling-recurring instance** is allowed
  (rolling exemption preserved, parity with HTTP).
- **R5** `update_task` setting `status` to a terminal value on an unscheduled, non-rolling task — with
  NO schedule supplied in the same call — returns `isError:true` with the guard message and does not
  write. If the same call supplies a schedule (`date`/`scheduledAt`), it is allowed.

## Non-goals
- No change to the HTTP path, the scheduler, batch_update behavior beyond the named guard, or any
  status semantics other than the terminal-schedule gate. No new statuses.
