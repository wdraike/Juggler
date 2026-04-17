# Scheduler — Planned Changes

## 1. Open time-window mode to all task types
**Current:** `getRecurFlexWindows()` returns null for non-recurring tasks. The UI hides the when-selector for recurring tasks.
**Change:** Remove the `!t.recurring` guard in `getRecurFlexWindows()`. Show the when-selector and flexWhen toggle for all task types (recurring and one-off). Any task should support "place around 2pm ± 30 min" or "morning only" constraints.
**Files:** `unifiedSchedule.js` (line 845), `TaskEditForm.jsx` (line 1308)

## 2. Date-agnostic recurring instance pool
**Current:** Recurring instances use `<masterId>-YYYYMMDD` IDs (legacy rows in DB). Instances are tied to their encoded date and can't be repurposed.
**Change:** Use ordinal IDs (`<masterId>-<ordinal>`). Scheduler assigns dates freely. Instances are a reusable pool. (Partially implemented — `expandRecurring` generates ordinal IDs, but legacy rows still exist in DB.)
**Files:** `expandRecurring.js`, `runSchedule.js`, migration for existing rows

## 3. `split_group` for chunk linking
**Current:** Column added but not yet used by scheduler or merge-back logic.
**Change:** Merge-back (Phase 5a) and status propagation should use `split_group` to find sibling chunks instead of matching by source + date + adjacency.
**Files:** `unifiedSchedule.js` (merge-back), `runSchedule.js` (persist)

## 4. `section` field — add UI or remove
**Current:** Stored in DB, passed through API, shown in ScheduleCard subtitle if populated. No UI to set or edit it.
**Decision needed:** Add a section picker to TaskEditForm, or drop the field.

## 5. `flexWhen` visibility for recurring tasks
**Current:** The Flex/Strict toggle is hidden for recurring tasks (`!recurring` guard in TaskEditForm).
**Change:** Show it for recurring tasks too. A recurring habit that can't find its preferred slot should be able to fall back to any available window.
**Files:** `TaskEditForm.jsx` (line 1308)

## 6. Unify `fixed` and `datePinned` into single `pinned` concept
**Current:** Two overlapping mechanisms: `when: 'fixed'` (from calendar sync, mixes time-constraint with pinning) and `datePinned` (user-pinned, evictable). Both route to `fixedByDate` in Phase 0 with nearly identical behavior.
**Change:** Single `pinned: true/false` field. The sync ledger (`calendar_sync` table) already tracks whether a task came from an external calendar — no need to encode source in `when`. Scheduler checks sync record to decide evictability:
- Pinned + has sync record → immovable (external calendar owns it)
- Pinned + no sync record → user-pinned, evictable during pile-ups
- Not pinned → scheduler places freely

`when` field goes back to being purely about time blocks. Remove `'fixed'` as a when-tag.
**Files:** `unifiedSchedule.js` (Phase 0 logic), `runSchedule.js` (persist guards), `task.controller.js` (fixed guards), `TaskEditForm.jsx` (fixed mode UI), `cal-sync.controller.js` (stop setting `when: 'fixed'`)

## 7. Filter terminal-status rows at the DB level
**Current:** `runSchedule.js` loads every row for the user (`tasks_v WHERE user_id = ?`) — all history including done/skip/cancel. Pool construction discards them in JS (line 163). For a user with 10 daily habits over 2 years, this is ~50K+ rows loaded and thrown away per scheduler run.
**Change:** Split the query:
- Main query: `WHERE status = '' OR status = 'wip' OR status IS NULL` — only schedulable rows
- Dedup query (for `expandRecurring`): `SELECT source_id, date FROM task_instances WHERE user_id = ? AND source_id IS NOT NULL AND status IN ('done','skip','cancel')` — lightweight, only the fields needed for duplicate detection
- Same pattern for `getSchedulePlacements` fast path (line 1036)
**Indexes:** `(user_id, status)` already exists and covers this. The view join may need attention — consider querying `task_instances` + `task_masters` directly instead of through `tasks_v` for the filtered path.
**Files:** `runSchedule.js` (lines 125, 1036, 1070), `expandRecurring.js` (dedup input)

## 8. Guard ingested (calendar-synced) tasks from user edits
**Current:** Only the `when: 'fixed'` tag is guarded on calendar-linked tasks (`guardFixedCalendarWhen`). Delete button is hidden in ingest-only mode. All other fields — text, dur, date, time, pri, notes, etc. — are freely editable. Changes don't sync back to the external calendar, creating silent drift.
**Change:**
- **Backend:** Add a guard in the task update path (PUT/PATCH) that rejects or warns on field changes to calendar-synced tasks. Allow status changes (done/skip) since those are Juggler-side actions. Allow notes (user annotation). Block text, dur, date, time, when, location changes on ingest-only tasks.
- **Frontend:** Disable or visually lock form fields for calendar-synced tasks in ingest-only mode. Show "managed by Google Calendar" / "managed by Outlook" indicator. Allow status toggle and notes.
- **MCP:** Same guard on `update_task` tool for synced tasks.
**Files:** `task.controller.js` (update path), `TaskEditForm.jsx` (field disabling), `mcp/tools/tasks.js` (update guard)

## 9. Server-side field validation and cross-field rules
**Current:** `validateTaskInput()` only checks string lengths and enum values. No cross-field consistency checks. Invalid combinations are accepted by the API and only caught at scheduler runtime (e.g., `impossible_window`) or silently ignored.
**Change:** Add validation rules to `validateTaskInput()`:
- `deadline >= startAfter` (if both set)
- `dur > 0`
- `timeRemaining <= dur` (if timeRemaining set)
- `splitMin <= dur` and `splitMin > 0` (if split enabled)
- `timeFlex` within reasonable range (0-480)
- `dependsOn` IDs exist and don't create cycles (lightweight check — at least verify IDs exist)
- `recur` config validity: `type` is known, required sub-fields present (e.g., `days` for weekly, `every` for interval)
- `deadline` is a parseable date
- `startAfter` is a parseable date

Return 400 with specific error messages. Apply to both create and update paths, and to the MCP `add_task`/`update_task` tools.
**Files:** `task.controller.js` (`validateTaskInput`), `mcp/tools/tasks.js`

## 10. Issues tab overhaul
**Current:** Shows 1,827 items. Sources: overdue tasks, unplaced (from scheduler/cache), past-scheduled, blocked deps, backlog (no date). The count is overwhelming and includes stale cache data and potentially phantom tasks (IDs in the unplaced list whose task objects have no text because the cache references tasks that no longer exist or weren't hydrated properly).
**Problems:**
- Stale cache inflates unplaced count (fixed by `SCHEDULER_VERSION` but existing caches need clearing)
- No pagination or priority ordering — all issues shown in a flat list
- Nameless task entries — unplaced IDs from the scheduler that don't match a loaded task object (phantom references)
- `nullScheduled` catch-all (line 405-412 in AppLayout) adds every dateless active task to unplaced, even if deliberately in backlog
- No distinction between "needs action now" vs "informational" at the count level — the tab badge shows 1,827 when only a handful need attention
**Changes:**
- Tab badge should only count Action Required items (overdue + truly unplaced), not informational
- Paginate or cap each section (show top 20 with "show all" expand)
- Filter phantom unplaced entries — if the task object can't be found or has no text, skip it
- Separate "backlog" from "issues" — dateless tasks are intentional, not problems
- Consider a DB integrity check tool (admin endpoint) that finds orphaned instances, nameless tasks, broken references

## 11. DB integrity check tool
**Current:** No automated way to detect data inconsistencies.
**Change:** Admin-only API endpoint (`/admin/integrity-check`) that scans for:
- Instances with no matching master (`source_id` points to deleted master)
- Tasks with empty/null text
- Instances with `split_ordinal > split_total`
- Orphaned `calendar_sync` rows (task deleted but sync record remains)
- Duplicate instances (same `source_id + date` with status='')
- `dependsOn` referencing non-existent task IDs
- `startAfter > deadline` (impossible constraints)
Returns a report; optionally auto-fixes safe issues (delete orphans, clear broken deps).
**Files:** New `src/controllers/admin.controller.js` or `src/mcp/tools/admin.js`

## 12. Header responsive layout — prevent icon overlap
**Current:** Header icons/elements overlay each other on narrow screens. No graceful degradation.
**Change:** Use flex-wrap or horizontal scroll when the header can't fit all elements. Icons should never overlap — collapse into a hamburger menu or scroll horizontally below a breakpoint.
**Files:** `juggler-frontend` header component

## 13. Manual task drag/move should pin date+time
**Current:** When a user manually drags or moves a task on the calendar, it doesn't set `datePinned: true`. The scheduler can move it again on the next run, undoing the user's manual placement.
**Change:** Any manual move (drag-drop on calendar, time edit in form) should set `datePinned: true` on the task so the scheduler respects the user's intent. Only the user can unpin.
**Files:** Calendar drag handler, task update path in `AppLayout.jsx` / `task.controller.js`

## 14. Collapse adjacent split chunks visually on the calendar
**Current:** Split chunks of the same task placed back-to-back appear as separate cards on the calendar view. The scheduler's merge-back pass (Phase 5a) combines them in the DB, but either the merge isn't running or the frontend isn't reflecting merged chunks.
**Change:** Frontend should detect adjacent chunks with the same `sourceId` (or `splitGroup`) on the same day and render them as a single card with combined duration. Alternatively, ensure the backend merge-back is working and the frontend reads the merged result.
**Files:** `ScheduleCard.jsx` or `DayView.jsx` (frontend merge), `unifiedSchedule.js` Phase 5a (backend merge), `runSchedule.js` merge-back persist
