# Scheduler Refactor: Event Queue Architecture

## Problem

The current scheduler triggers via `scheduleAfterMutation` middleware on all task mutation routes (`PUT /tasks/batch`, `POST /tasks`, `DELETE /tasks/:id`). The scheduler's own DB writes go through the same routes, causing it to re-trigger itself. Multiple concurrent scheduler runs deadlock on the `original_scheduled_at` reset query (which locks hundreds of rows). This causes:

- 30-60 second save times for users
- Deadlocked MySQL transactions
- Data corruption (pinned tasks moved, dependencies wiped, `when` fields cleared)
- `original_scheduled_at` accumulating stale values across failed runs

## Architecture

### 1. Event Queue

Replace `scheduleAfterMutation` middleware with an in-memory event queue per user.

```
scheduleQueue = {
  userId: [{ timestamp, source }]
}
```

**Who enqueues:**
- User saves (task create/update/delete via API)
- MCP mutations (task tools)
- Calendar sync completion (GCal/MSFT)
- Timer (e.g., once at midnight for day rollover)

**Who does NOT enqueue:**
- The scheduler's own DB writes
- Version polling / placement reads
- Any read-only operation

**Implementation:** Instead of middleware that wraps `res.json`, have the mutation controllers explicitly call `enqueueScheduleRun(userId)` after their DB write succeeds. This is more explicit and prevents the scheduler's internal writes from triggering reruns.

### 2. Scheduler Run Lifecycle

```
function processScheduleQueue(userId):
  1. Record runTimestamp = now
  2. Purge all queue entries with timestamp <= runTimestamp
  3. Acquire sync lock (withLock) — prevents overlap with cal syncs
  4. Run the scheduler algorithm (unifiedSchedule)
  5. Persist ONLY changed tasks (see section 3)
  6. Release sync lock
  7. Check queue — if new entries arrived during steps 3-6, go to step 1
  8. Otherwise, done
```

**Single-flight guarantee:** Only one `processScheduleQueue` runs per user at a time. If a mutation arrives during a run, it's enqueued and picked up at step 7.

### 3. Minimal DB Writes

The scheduler currently writes to every task it places, even if the placement didn't change. It also writes `original_scheduled_at` on every move, accumulating stale values.

**New approach:**
- Compare each placement's `scheduled_at` with the task's current DB value
- Only write tasks where `scheduled_at` actually changed
- Do NOT write `original_scheduled_at` — this field is no longer needed (the `unscheduled` flag handles the "can't place" case, and `date_pinned` prevents unwanted moves)
- For unplaced tasks: set `unscheduled = 1, scheduled_at = NULL`
- For placed tasks: set `unscheduled = NULL, scheduled_at = <new_value>`
- Skip pinned, fixed, marker, and template tasks entirely

**Batch the writes:** Collect all changed tasks into a single `UPDATE` or use `INSERT ... ON DUPLICATE KEY UPDATE` for efficiency.

### 4. Remove `original_scheduled_at`

This field was used to "undo" scheduler moves by reverting to the pre-move time. But it caused cascading corruption:
- Stale values from failed runs persisted across restarts
- The reset query (`SET scheduled_at = original_scheduled_at`) locked hundreds of rows
- Pinned tasks had their times reverted to corrupted midnight values

**Replace with:** The scheduler always starts fresh — it reads current `scheduled_at` values and places tasks from scratch. No "undo" step needed. The `date_pinned` and `when: 'fixed'` flags protect tasks that shouldn't be moved.

**Migration:** Add a migration that sets `original_scheduled_at = NULL` on all rows, then drop the column in a subsequent release.

### 5. Protect Immutable Tasks

The scheduler must NEVER write to tasks that are:
- `date_pinned = 1` — user explicitly set the date/time
- `when = 'fixed'` — user locked the time
- `marker = 1` — non-blocking reminder
- `task_type = 'recurring_template'` — blueprint, not schedulable

These tasks should be treated as **fixtures** in the scheduling algorithm (they block time and satisfy dependencies) but never modified in the persist step.

### 6. Files to Change

| File | Change |
|------|--------|
| `src/routes/task.routes.js` | Remove `scheduleAfterMutation` middleware. Add `enqueueScheduleRun` calls to mutation routes. |
| `src/controllers/task.controller.js` | Call `enqueueScheduleRun(userId)` after successful creates/updates/deletes. |
| `src/mcp/tools/tasks.js` | Call `enqueueScheduleRun(userId)` after MCP mutations. |
| `src/scheduler/runSchedule.js` | Remove step 1 (`original_scheduled_at` reset). Implement minimal-diff persist. Add queue check after completion. |
| `src/scheduler/scheduleQueue.js` | New file: event queue + single-flight runner. |
| `src/controllers/cal-sync.controller.js` | Call `enqueueScheduleRun(userId)` after sync completion. |
| `src/db/migrations/` | Clear `original_scheduled_at` on all rows. |

### 7. Testing

- **Unit test:** Enqueue 3 events → scheduler runs once and processes all 3
- **Unit test:** Event arrives during scheduler run → picked up in the rerun check
- **Unit test:** Scheduler writes don't enqueue new events
- **Unit test:** Only changed tasks are written (mock DB, verify UPDATE count)
- **Unit test:** Pinned/fixed/marker tasks are never modified
- **Integration test:** Rapid user saves → no deadlocks, saves complete in <1s
- **Integration test:** Cal sync + scheduler don't overlap (withLock still works)
- All 203 existing scheduler scenario tests must pass

### 8. Separate Desired vs Scheduled Data

The current schema uses `scheduled_at` for both "what the user wants" and "where the scheduler placed it." This means every scheduler run overwrites user intent. If the scheduler can't place a task, the user's original date/time is lost.

**New fields:**

| Field | Purpose | Who writes | Nullable |
|-------|---------|-----------|----------|
| `desired_at` | User's intended date/time (from manual entry, GCal/MSFT sync, or MCP) | User, cal sync, MCP | Yes — null means "no preference, scheduler decides" |
| `desired_date` | User's intended date only (for tasks with a date but no specific time) | User, cal sync, MCP | Yes |
| `scheduled_at` | Where the scheduler actually placed it | Scheduler only | Yes — null means unscheduled |

**Rules:**
- User saves write to `desired_at` / `desired_date`, never to `scheduled_at`
- The scheduler reads `desired_at` as a hint/anchor but writes only to `scheduled_at`
- `date_pinned` means "scheduler must use `desired_at` exactly — don't optimize"
- `when = 'fixed'` means "scheduler must use `desired_at` time exactly — don't move"
- If the scheduler can't place a task, `scheduled_at = NULL` + `unscheduled = 1`, but `desired_at` is preserved
- The frontend displays `scheduled_at` on the calendar, falls back to `desired_at` if unscheduled

**This eliminates:**
- `original_scheduled_at` — no longer needed, `desired_at` is the permanent record
- The risk of losing user data during scheduler runs
- The "midnight write" problem entirely

### 9. Time Window Mode: Clear Time Block Fields

When a recurring task is in **Time Window mode** (anchored to a specific time ± flexibility):
- `when` should be set to `NULL` — time blocks are irrelevant since placement is driven by `desired_at` ± `time_flex`
- The scheduler should ignore time block constraints and use only the time anchor + flexibility window
- `preferred_time = 1` is the mode indicator

When in **Time Block mode** (`preferred_time = 0` or `NULL`):
- `when` contains the selected block tags (e.g., `'morning,afternoon'`)
- `desired_at` may be null (scheduler picks the best slot within the blocks)
- `time_flex` is irrelevant

**On mode switch:**
- Time Window → Time Blocks: clear `desired_at` time component (keep date if pinned), set `when` to default blocks
- Time Blocks → Time Window: set `when = NULL`, set `desired_at` to the selected time

### 10. Other Fields to Review

| Field | Current issue | Recommendation |
|-------|--------------|----------------|
| `date_pinned` | May be unnecessary if desired/scheduled are separate | Keep for now — means "scheduler must respect desired_date exactly." Without it, the scheduler could move a task to a better day. |
| `rigid` | Overlaps with `when = 'fixed'` for non-recurring tasks | Keep — `rigid` is for recurring tasks (exact time, no flex). `fixed` is for non-recurring. |
| `time_flex` | Set on tasks in Time Block mode where it's meaningless | Should be `NULL` when in Time Block mode |
| `flex_when` | Allows scheduler to relax `when` constraints | Only meaningful in Time Block mode — should be `NULL` in Time Window mode |
| `split` / `split_min` | Applied to Time Window tasks where splitting makes no sense | Should be `NULL` in Time Window mode (you don't split a fixed-time task) |

### 11. Implementation Order

Do these in sequence — each step should be working before starting the next.

1. **Event queue + single-flight runner** (`scheduleQueue.js`, update routes/controllers)
   - This stops the deadlocks and self-triggering immediately
   - All existing tests must pass before proceeding

2. **Minimal-diff persist** (update `runSchedule.js` step 7/8)
   - Only write changed `scheduled_at` values
   - Remove `original_scheduled_at` writes from the persist step
   - Remove step 1 reset query entirely
   - Add migration to clear all `original_scheduled_at` values

3. **Add `desired_at` / `desired_date`** (migration + controller + frontend)
   - Migration: add columns, copy current `scheduled_at` → `desired_at` for pinned/fixed tasks
   - Update `taskToRow` / `rowToTask` to handle both fields
   - Update frontend form to write `desired_at` instead of `scheduled_at`
   - Update scheduler to read `desired_at` as input, write `scheduled_at` as output

4. **Time Window / Time Block field cleanup**
   - When `preferred_time = 1`: set `when = NULL`, clear `split`/`split_min`/`flex_when`
   - When `preferred_time = 0`: clear `time_flex`
   - Update frontend form to enforce this on mode switch

5. **Drop `original_scheduled_at` column** (migration)
   - Only after step 2-3 are stable and deployed

### 12. Current Stopgap

Until this refactor lands, the single-flight pattern in `scheduleAfterMutation` (added 2026-04-05) prevents deadlocks by skipping scheduler runs if one is already in progress. This is a bandaid — it means some mutations don't trigger a reschedule at all. The event queue fixes this properly.
