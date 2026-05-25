-- Run this BEFORE the column-drop migration. Verify SELECT returns 0 before running UPDATE.
-- Note: date_pinned lives on task_instances, not task_masters — join required.

-- Step 1: Audit (run first, verify count is 0 before proceeding to Step 2)
SELECT COUNT(*) FROM task_instances i
JOIN task_masters m ON m.id = i.master_id
WHERE i.date_pinned = 1
  AND m.placement_mode NOT IN ('fixed', 'reminder');

-- Step 2: Correct (only run after auditing and confirming the count above)
UPDATE task_masters m
JOIN task_instances i ON i.master_id = m.id
SET m.placement_mode = 'fixed'
WHERE i.date_pinned = 1
  AND m.placement_mode NOT IN ('fixed', 'reminder')
  AND (i.time IS NOT NULL OR i.scheduled_at IS NOT NULL);
