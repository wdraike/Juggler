-- One-time repair: recurring+split task_instances left with a mixed
-- terminal/non-terminal status within one split-group. Root cause: prior to
-- leg jug-mcp-facade (999.1182, commit fd16ac66, 2026-07-07), the MCP
-- set_task_status tool wrote status directly instead of delegating to
-- facade.updateTaskStatus, so it skipped the split-chunk sibling-propagation
-- step (UpdateTaskStatus.js) — only the one instance row targeted by the
-- MCP call got the new status; its split siblings (same master_id +
-- occurrence_ordinal) stayed at their prior status and displayed overdue
-- forever once their date passed. Confirmed via `action_log`: zero
-- status_change rows exist for the affected master, proving these writes
-- never went through the audited facade path.
--
-- Scope confirmed narrow: only "Apply for Jobs" (019d5dfa-a97c-7152-a799-f21ba1026db2),
-- occurrence_ordinal 32156 (2026-07-01) and 32155 (2026-07-02).
--
-- Run Step 1 first; verify the two groups below are the only ones returned
-- before running Step 2.

-- Step 1: Audit — mixed terminal/non-terminal split-groups
SELECT master_id, occurrence_ordinal, date,
  SUM(status IN ('done','skip','cancel')) AS terminal_cnt,
  SUM(status NOT IN ('done','skip','cancel') OR status IS NULL) AS nonterm_cnt,
  COUNT(*) AS total
FROM task_instances
WHERE date BETWEEN '2026-06-25' AND '2026-07-08'
GROUP BY master_id, occurrence_ordinal, date
HAVING terminal_cnt > 0 AND nonterm_cnt > 0
ORDER BY date;

-- Step 2: Correct — propagate the already-recorded terminal status to the
-- stuck siblings in each affected split-group (mirrors what
-- UpdateTaskStatus.js's split-chunk propagation would have done at write time).
UPDATE task_instances
SET status = 'skip', updated_at = CURRENT_TIMESTAMP
WHERE master_id = '019d5dfa-a97c-7152-a799-f21ba1026db2'
  AND occurrence_ordinal = 32156
  AND status NOT IN ('done','skip','cancel');

UPDATE task_instances
SET status = 'done', updated_at = CURRENT_TIMESTAMP
WHERE master_id = '019d5dfa-a97c-7152-a799-f21ba1026db2'
  AND occurrence_ordinal = 32155
  AND status NOT IN ('done','skip','cancel');
