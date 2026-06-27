# Traceability — 999.895 — bugfix
| ID | Description | Design element | Code (file:sym) | Test(s) | Status |
|----|-------------|----------------|-----------------|---------|--------|
| BUG | MCP set_task_status/update_task mark terminal status with no terminal-schedule guard (HTTP-path parity gap) | terminalScheduleBlock helper mirrors UpdateTaskStatus.js:147-160 terminal-requires-schedule guard (rolling exempt); called in set_task_status + update_task | src/mcp/tools/tasks.js: terminalScheduleBlock, set_task_status, update_task | tests/mcp-terminal-schedule-guard.test.js — 14/14 GREEN after fix (RED before: R1a/b/c, R5a; R4b exemption-branch mutation-verified) | verified |
