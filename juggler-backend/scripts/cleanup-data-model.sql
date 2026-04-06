-- Data Model Cleanup Script
-- Run after stopping the juggler backend to avoid table locks
--
-- 1. Convert recurring tasks to habit_template
-- These have recur set but task_type='task' — they need to be templates
-- so expandRecurring generates proper instances with field inheritance
UPDATE tasks SET task_type = 'habit_template'
WHERE id IN ('ts009', 'ts013')
AND task_type = 'task';

-- 2. Fix orphaned habit flags
-- These have habit=1 but no recurrence and no source_id — they're regular tasks
-- that got the habit flag set incorrectly. Clear the flag so they're treated as tasks.
UPDATE tasks SET habit = 0
WHERE habit = 1
AND task_type = 'task'
AND (recur IS NULL OR recur = 'null')
AND source_id IS NULL;

-- 3. Verify cleanup
SELECT task_type, habit, COUNT(*) as cnt
FROM tasks
WHERE habit = 1 OR task_type IN ('habit_template', 'habit_instance')
GROUP BY task_type, habit;

-- Expected results:
-- habit_template | 1 | 15  (13 original + 2 converted)
-- habit_instance | 1 | 873 (generated instances)
-- No rows with task_type='task' and habit=1
