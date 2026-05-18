# Juggler — Context

<!-- One fact per line. Injected as CONTEXT: lines in session brief. -->
<!-- Keep facts to stable, non-obvious domain rules and architecture decisions. -->

Task & calendar management app — React (port 3003), Express (port 5002), MySQL, MCP server (juggler-mcp/)
Scheduler: schedule most-constrained → least-constrained; never reverse this; bugs cascade and corrupt all task data
Scheduler entry point: juggler-backend/src/scheduler/unifiedScheduleV2.js
Task type terms: one-off (standalone), chain member (linked dependency), recurring instance (one occurrence), split chunk (piece split across time)
Severity hierarchy: Deadlines > dependencies > preferences
Recurring instances must schedule on same day as their recurrence rule fires — never a different day
Event queue: triggered by user/MCP mutations only; never self-triggers; never write tasks that didn't change (delta writes not full rebuilds)
Calendar sync: GCal + MSFT + Apple (CalDAV) implemented; known DB contention on simultaneous syncs
Apple soak (2026-04-26): B1/B5/D pass; B2/B3/B4/C1/C2/C4 pending; do NOT use Family Calendar (repush loop bug)
Key docs: juggler-backend/docs/SCHEDULER.md, TASK-PROPERTIES.md, TASK-STATE-MATRIX.md
