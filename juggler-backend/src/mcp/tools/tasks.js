/**
 * MCP Task Tools — expose task CRUD as MCP tools
 *
 * Accepts both scheduledAt (UTC ISO) and date+time (local strings) —
 * UTC takes precedence. `deadline` and `earliestStart` are date-only
 * (YYYY-MM-DD). Always returns both scheduled_at formats in responses.
 *
 * ── jug-mcp-facade WI-2 (999.1182) ────────────────────────────────────────────
 * The 6 write tools (create_task, create_tasks, update_task, set_task_status,
 * delete_task, batch_update_tasks) now route through `slices/task/facade.js`'s
 * use-cases instead of an independent db()/tasksWrite reimplementation — the
 * SAME orchestration (row shaping, cal-sync guards, lock/queue, recurring
 * template/instance routing, and — highest-care — the rolling/next-occurrence
 * anchor projection) the HTTP path already uses. Read tools (list_tasks,
 * get_task, search_tasks) are unchanged read-only db() access — out of scope.
 *
 * Each write tool keeps a thin MCP-specific ADAPTER layer in front of the
 * facade call:
 *   - pre-write guards that produce a byte-identical error string to the
 *     pre-migration behavior for a condition the facade also independently
 *     enforces (validateTaskInput, create_task's AND-based fixed-mode check)
 *     are kept verbatim so that string never has to round-trip the facade;
 *   - an ALL_DAY placement-mode backstop is computed HERE, not left to the
 *     facade's own backstop, because the facade's version keys off an `allDay`
 *     boolean field the MCP zod schema has never exposed (MCP infers all_day
 *     from date-without-time, matching today's behavior — see
 *     behavior_contract "ALL_DAY backstop" in INTAKE-BRIEF.json);
 *   - `mapFacadeErrorText` translates the facade's structured
 *     `{status, body:{error, code?, blockedFields?}}` into the EXACT free-text
 *     string tasks.js has always returned for the SAME condition
 *     (behavior_contract: byte-identical error strings, not just
 *     equivalent-meaning);
 *   - the success payload is UNWRAPPED from the facade's `{status,body}`
 *     envelope to today's bare-object shape, and (for create_task/
 *     update_task/set_task_status) re-read via `rowToTask(row, tz)` using the
 *     user's ACTUAL resolved timezone — the facade's own use-cases format
 *     their `body.task` with `rowToTask(row, null)` (a hardcoded default tz,
 *     fine for HTTP where the client re-derives local fields, but wrong for
 *     MCP callers like ClimbRS who consume the server-formatted local fields
 *     directly). The formerly-known residual gap here — the create_task
 *     LOCKED/queued response, which has no DB row to re-read — is FIXED
 *     (999.1400): CreateTask's locked branch now formats its queued echo with
 *     the caller's resolved tz (the tz this adapter passes as timezoneHeader).
 *
 * ── RULED EXCEPTIONS (David, 2026-07-07) — intentional behavior changes ──────
 * 1. set_task_status / update_task: terminal-on-unscheduled status changes no
 *    longer REJECT (the old `terminalScheduleBlock` guard, 999.895) — calling
 *    facade.updateTaskStatus gives the D-B snap-then-write behavior (parity
 *    with HTTP) naturally. update_task routes any `status` field through
 *    facade.updateTaskStatus (not the plain row.status field UpdateTask's own
 *    shaping would otherwise write with zero terminal-schedule handling).
 * 2. delete_task: routes through facade.deleteTask, which already R55
 *    soft-cancels (status='cancelled', row kept) instead of the old hard
 *    `tasksWrite.deleteTaskById()` — no prerequisite fix needed (999.1215 was
 *    stale, closed by WI-1).
 * 3. batch_update_tasks: gains the rolling/next-occurrence anchor projection
 *    it never had (a silent MCP-only gap) as a side effect of routing through
 *    facade's lockedBatchUpdate/batchUpdateTxn, which already call
 *    applyRollingAnchor on a done/skip transition.
 */

const { z } = require('zod');
const safeStringify = require('../safeStringify');
const db = require('../../db');
const { rowToTask, buildSourceMap, validateTaskInput } = require('../../controllers/task.controller');
const { PLACEMENT_MODES } = require('../../lib/placementModes');
const facade = require('../../slices/task/facade');
const getUserTimezone = require('../getUserTimezone');
const { isAnchorDependentRecur } = require('../../../../shared/scheduler/expandRecurring');
const dateHelpers = require('../../../../shared/scheduler/dateHelpers');

// Shared Zod fields for task input (used by create_task, create_tasks, update_task)
var taskInputFields = {
  text: z.string().optional(),
  project: z.string().optional().describe('Project name'),
  pri: z.string().optional().describe('Priority: "P1" (highest), "P2", "P3" (default), "P4" (lowest)'),
  dur: z.number().optional().describe('Duration in minutes'),
  when: z.string().optional()
    .refine(function(w) {
      if (!w) return true;
      var reserved = ['fixed', 'allday'];
      return !w.split(',').some(function(t) { return reserved.indexOf(t.trim()) !== -1; });
    }, { message: 'Do not use when="fixed" or "allday" — these are reserved for calendar-synced events. Use date+time fields to schedule a task at a specific time.' })
    .describe('Time-of-day preference tags, comma-separated: "morning", "afternoon", "evening", "lunch", "biz", "night", or "" (none). Do NOT use "fixed" or "allday".'),
  dayReq: z.string().optional().describe('Day requirement: "any", "weekday", "weekend", a single day letter (M,T,W,R,F,Sa,Su), or comma-separated for multiple days (e.g. "M,W,F")'),
  dependsOn: z.array(z.string()).optional().describe('Array of task IDs this task depends on'),
  // Local string fields (PREFERRED — server converts using user's timezone automatically)
  date: z.string().optional().describe('Scheduled date in M/D format (e.g. "3/8"). PREFERRED over scheduledAt — server handles timezone conversion.'),
  time: z.string().optional().describe('Scheduled time in h:mm AM/PM format (e.g. "9:30 PM"). PREFERRED over scheduledAt — server handles timezone conversion.'),
  deadline: z.string().optional().describe('Deadline (hard, non-negotiable). YYYY-MM-DD or M/D format. The scheduler places this task on or before this date.'),
  earliestStart: z.string().optional().describe('Earliest start date (YYYY-MM-DD or M/D). The task can start ON this date, not after it.'),
  // UTC ISO fields (use ONLY if you already have a correct UTC timestamp — avoid manual timezone math)
  scheduledAt: z.string().optional().describe('UTC ISO timestamp. AVOID — use date+time instead to prevent timezone errors. Only use if you already have a verified UTC value.'),
  // Other fields
  location: z.array(z.string()).optional().describe('Location IDs'),
  tools: z.array(z.string()).optional().describe('Tool IDs'),
  notes: z.string().optional().describe('Additional notes'),
  url: z.string().optional().describe('External link (email thread, doc, issue, etc.) — surfaced on the task card as a clickable link.'),
  recurring: z.boolean().optional().describe('Whether this is a recurring recurring'),
  split: z.boolean().optional().describe('Whether task can be split across time blocks'),
  splitMin: z.number().optional().describe('Minimum split chunk in minutes'),
  recur: z.object({
    type: z.string(),
    days: z.string().optional(),
    every: z.number().optional(),
    timesPerCycle: z.number().optional().describe('Target count per cycle (e.g. 3 for "3x per week"). Only used when fewer than all selected days are required.'),
    fillPolicy: z.enum(['keep', 'backfill']).optional().describe('When a session in a times-per-cycle recurrence is skipped: "keep" (default) leaves it skipped; "backfill" tells the scheduler to pick a new date to hit the target count.')
  }).optional().describe('Recurrence pattern'),
  placementMode: z.enum(['anytime', 'time_window', 'time_blocks', 'fixed', 'all_day', 'reminder']).optional().describe('Scheduling mode. Inferred from date/time presence when omitted: time set → fixed; date only → all_day; neither → anytime.'),
  marker: z.boolean().optional().describe('Non-blocking reminder event — shows on calendar at its time but does not prevent tasks from being scheduled in the same slot. Use for events you want to see but not block time for (e.g. TV game windows, reminders). Can have status and dependencies like regular tasks.'),
  flexWhen: z.boolean().optional().describe('Allow the scheduler to relax this task\'s "when" time-of-day preference if it can\'t be placed within those windows. When false (default), the task stays unplaced if its when windows are full.'),
  travelBefore: z.number().optional().describe('Travel buffer before task in minutes — scheduler reserves this time and prevents overlapping placements'),
  travelAfter: z.number().optional().describe('Travel buffer after task in minutes — scheduler reserves this time and prevents overlapping placements'),
  desiredAt: z.string().optional().describe('User intended date/time as UTC ISO. Usually set automatically from date+time — only provide if you need to set desired_at differently from scheduled_at. For date-only intents (no specific time), send local-noon.'),
  preferredTimeMins: z.number().optional().describe('Preferred time as minutes from midnight in user local timezone (e.g. 720 = 12:00 PM, 420 = 7:00 AM). For recurring tasks in Time Window mode.')
};

// ── ALL_DAY placement-mode backstop (MCP-specific bridge) ────────────────────
// The facade's own ALL_DAY backstop (CreateTask/UpdateTask) keys off an
// `allDay` boolean field the MCP zod schema never exposes. MCP has always
// inferred all_day from "date present, no time/scheduledAt, no explicit
// placementMode" — replicate that inference on the body BEFORE handing off to
// the facade, so the facade's own row-shaping sees an explicit placementMode
// and its incompatible `allDay`-keyed backstop is a no-op either way.
function applyAllDayBackstop(fields) {
  var timeWasSet = fields.time !== undefined || fields.scheduledAt !== undefined;
  if (!timeWasSet && fields.date !== undefined && fields.placementMode === undefined) {
    fields.placementMode = PLACEMENT_MODES.ALL_DAY;
  }
}

// ── recurStart default for anchor-dependent recur (cookie BLOCK-1, jug-mcp-facade WI-2) ──
// CreateTask.js sets _requireRecurStartIfAnchor=true, so the facade hard-rejects a
// biweekly/interval/times-per-cycle recur (isAnchorDependentRecur) with no recurStart.
// The OLD MCP path never required it — recur_start persisted null and the scheduler's
// getAnchor (expandRecurring.js) fell back recur_start -> src.date -> startDate. The MCP
// zod schema exposes NO recurStart field, so a ClimbRS caller has no way to satisfy the
// facade's new requirement. Default it here to the SAME value getAnchor's src.date
// fallback would have produced: the task's derived local date (from date/scheduledAt in
// the user's timezone), else today's local date if neither is present. Boundary-correct
// home is the MCP adapter, NOT CreateTask.js (which deliberately reproduces the HTTP/UI
// reject for all callers — do not touch it).
function defaultRecurStartIfAnchorDependent(task, tz) {
  if (task.recurStart !== undefined && task.recurStart !== null && String(task.recurStart).trim() !== '') return;
  if (!isAnchorDependentRecur(task.recur)) return;
  var derivedDate = null;
  if (task.date !== undefined) {
    derivedDate = dateHelpers.toDateISO(task.date) || null;
  } else if (task.scheduledAt !== undefined) {
    // Pass a real Date object, not the raw ISO string: the MCP schema's scheduledAt
    // already carries a trailing 'Z' ('2026-08-04T14:00:00.000Z'), but utcToLocal's
    // string-handling branch assumes a MySQL-style space-separated string with NO
    // trailing 'Z' and appends one itself (`.replace(' ','T')+'Z'`) — double-Z on an
    // already-Z-terminated ISO string produces Invalid Date and silently falls
    // through to the today-fallback below (telly WARN jug-mcp-facade-recurstart-scheduledat-bug).
    derivedDate = dateHelpers.utcToLocal(new Date(task.scheduledAt), tz).date;
  }
  if (!derivedDate) {
    derivedDate = dateHelpers.utcToLocal(new Date(), tz).date;
  }
  task.recurStart = derivedDate;
}

// ── facade error -> MCP free-text translator ──────────────────────────────────
// behavior_contract: MCP's free-text isError strings must stay byte-identical
// for the SAME condition. The facade returns structured { error, code?,
// blockedFields? } bodies; known conditions are mapped to the EXACT legacy MCP
// string. Anything else (a facade-only guard tasks.js never had, e.g.
// TASK_DISABLED / PROVIDER_ORIGIN_DELETE_BLOCKED / the DB-backed reference
// existence check) falls back to a generic 'Error: <message>' / 'Validation
// error: <message>' — new-but-reasonable text for a condition MCP could not
// previously produce cleanly (see bert-REVIEW.json findings).
function mapFacadeErrorText(result) {
  var body = (result && result.body) || {};
  if (result.status === 404) return 'Error: Task not found';
  if (body.code === 'CAL_SYNCED_READONLY') {
    return 'Error: This task is synced from an external calendar. Only status and notes can be changed. Blocked fields: ' +
      (body.blockedFields || []).join(', ');
  }
  if (result.status === 400 && typeof body.error === 'string') {
    return 'Validation error: ' + body.error;
  }
  return 'Error: ' + (body.error || 'Request failed');
}

function registerTaskTools(server, userId) {

  // ── list_tasks ──
  server.tool(
    'list_tasks',
    'List tasks. Excludes completed ("done") tasks by default so the agent sees the active working set. Pass `status="done"` or `includeDone: true` to see completed history.',
    {
      status: z.string().optional().describe('Filter by exact status: "" (pending), "done", "skip", "cancel", "disabled", "pause". When provided, this overrides the default done-exclusion.'),
      includeDone: z.boolean().optional().describe('Include tasks with status="done" in the default list. Default: false — done tasks are filtered out to keep the active working set focused.'),
      project: z.string().optional().describe('Filter by project name'),
      date: z.string().optional().describe('Filter by date (M/D format, e.g. "3/8") — matched against derived local date'),
      limit: z.number().optional().describe('Max number of tasks to return')
    },
    async ({ status, includeDone, project, date, limit }) => {
      var tz = await getUserTimezone(userId);
      var query = db('tasks_v').where('user_id', userId);
      if (status !== undefined) {
        // Explicit status filter takes precedence over includeDone.
        query = query.where('status', status);
      } else if (!includeDone) {
        // Default: hide completed tasks. Keep skip/cancel/disabled/pause/wip
        // and active pending — those are all still informative to the agent.
        // Use three-valued-logic aware predicate because MySQL `status != 'done'`
        // is FALSE for NULL values.
        query = query.where(function() {
          this.whereNot('status', 'done').orWhereNull('status');
        });
      }
      if (project) query = query.where('project', project);
      query = query.orderBy('created_at', 'asc');
      if (limit && !date) query = query.limit(limit);

      var rows = await query;
      var srcMap = buildSourceMap(rows);
      var tasks = rows.map(function(r) { return rowToTask(r, tz, srcMap); });
      if (date) {
        // Normalize date to canonical ISO format (YYYY-MM-DD) to match t.date format
        var dateHelpers = require('../../../../shared/scheduler/dateHelpers');
        var normalizedDate = dateHelpers.isoToDateKey(date);
        if (normalizedDate) {
          tasks = tasks.filter(function(t) { return t.date === normalizedDate; });
        } else {
          tasks = []; // Invalid date format
        }
        if (limit) tasks = tasks.slice(0, limit);
      }
      return { content: [{ type: 'text', text: safeStringify(tasks) }] };
    }
  );

  // ── create_task ──
  server.tool(
    'create_task',
    'Create a single task. Use date+time for scheduling (server converts timezone automatically). Returns both UTC and local fields.',
    Object.assign({ id: z.string().optional().describe('Task ID (auto-generated UUID if omitted)'), text: z.string().describe('Task description/title') }, taskInputFields),
    async (params) => {
      // Validate input (same shared domain function the facade also calls —
      // kept here so the SAME error text returns without a facade round-trip).
      var valErrors = validateTaskInput(Object.assign({ _requireText: true }, params));
      if (valErrors.length > 0) {
        return { content: [{ type: 'text', text: 'Validation error: ' + valErrors.join('; ') }], isError: true };
      }
      var tz = await getUserTimezone(userId);
      var task = Object.assign({}, params);
      applyAllDayBackstop(task);
      defaultRecurStartIfAnchorDependent(task, tz);

      // create_task's OWN AND-based fixed-mode guard (date+time BOTH required,
      // unlike validateTaskInput's OR-based check above) — reachable whenever
      // exactly one of date/time is supplied without scheduledAt. Preserved
      // verbatim (dead only for the both-missing case, which validateTaskInput
      // already rejects above — see mcp-tasks-write-tools-db-side-effects
      // characterization test + telly's dead-code finding).
      if (task.placementMode === PLACEMENT_MODES.FIXED) {
        var _hasDate = task.date !== undefined || task.scheduledAt !== undefined;
        var _hasTime = task.time !== undefined || task.scheduledAt !== undefined;
        if (!_hasDate || !_hasTime) {
          return { content: [{ type: 'text', text: 'Validation error: placementMode "fixed" requires a date and time.' }], isError: true };
        }
      }

      var result = await facade.createTask({ userId: userId, body: task, timezoneHeader: tz });
      if (result.status >= 400) {
        return { content: [{ type: 'text', text: mapFacadeErrorText(result) }], isError: true };
      }
      var body = result.body || {};
      var payload;
      if (body.queued) {
        // LOCKED/queued path: no DB row exists yet to re-read — use the
        // facade's own optimistic task shape. 999.1400: CreateTask formats
        // this echo with the tz passed as timezoneHeader (the user's actual
        // resolved tz), so its local date/time fields are correct.
        payload = Object.assign({}, body.task, { queued: true });
      } else {
        var created = await db('tasks_with_sync_v').where('id', body.task.id).first();
        payload = rowToTask(created, tz);
      }
      return { content: [{ type: 'text', text: safeStringify(payload) }] };
    }
  );

  // ── create_tasks (batch) ──
  server.tool(
    'create_tasks',
    'Create multiple tasks at once. Use date+time for scheduling (server converts timezone automatically). Returns count.',
    {
      tasks: z.array(z.object(
        Object.assign({ id: z.string().optional(), text: z.string() }, taskInputFields)
      )).describe('Array of task objects to create')
    },
    async ({ tasks }) => {
      for (var vi = 0; vi < tasks.length; vi++) {
        var vErrs = validateTaskInput(Object.assign({ _requireText: true }, tasks[vi]));
        if (vErrs.length > 0) {
          return { content: [{ type: 'text', text: 'Validation error on task ' + vi + ': ' + vErrs.join('; ') }], isError: true };
        }
      }
      var tz = await getUserTimezone(userId);
      var uuidv7 = require('uuid').v7;
      // The facade's BatchCreateTasks use-case does not return generated ids —
      // pre-assign them here (same as tasks.js has always done) so the
      // response's {created, ids} shape can be reconstructed without them.
      var preparedTasks = tasks.map(function(t) {
        var task = Object.assign({}, t);
        if (!task.id) task.id = uuidv7();
        applyAllDayBackstop(task);
        defaultRecurStartIfAnchorDependent(task, tz);
        return task;
      });

      var result = await facade.batchCreateTasks({ userId: userId, body: { tasks: preparedTasks }, timezoneHeader: tz });
      if (result.status >= 400) {
        return { content: [{ type: 'text', text: mapFacadeErrorText(result) }], isError: true };
      }
      var ids = preparedTasks.map(function(t) { return t.id; });
      var payload = { created: result.body.created, ids: ids };
      if (result.body.queued) payload.queued = true;
      return { content: [{ type: 'text', text: safeStringify(payload) }] };
    }
  );

  // ── update_task ──
  server.tool(
    'update_task',
    'Update fields on an existing task. Use date+time for scheduling (server converts timezone automatically). Only provided fields are changed.',
    Object.assign({
      id: z.string().describe('Task ID to update'),
      status: z.string().optional()
    }, taskInputFields),
    async ({ id, ...fields }) => {
      var tz = await getUserTimezone(userId);

      var updateFields = Object.assign({}, fields);
      applyAllDayBackstop(updateFields);

      // update_task's OWN legacy fixed-mode guard (ernie BLOCK-1, jug-mcp-facade
      // WI-2), reproduced byte-identically BEFORE the facade call: facade.updateTask's
      // own guard (UpdateTask.js:256-260) is AND-based (requires date AND time) and
      // returns a DIFFERENT string ('Fixed mode requires a date and time.') for a
      // BROADER reject set than the pre-migration OR-based guard this adapter always
      // had (date OR time OR scheduledAt OR the EXISTING row's scheduled_at satisfies
      // it). Kept verbatim, mirroring create_task's own pre-guard pattern, so the
      // byte-identical ClimbRS error contract holds without a facade round-trip.
      //
      // MOVED BEFORE validateTaskInput (bert iter2, telly WARN
      // jug-mcp-facade-fixedguard-validatetaskinput-ordering-gap): the shared
      // validateTaskInput's own fixed-mode cross-field check (taskValidation.js:
      // 317-324) is existing-blind and, when called first, unconditionally
      // re-rejects the exact "fixed + no inline date/time, but the row already
      // HAS a scheduled_at" case this guard exempts below — making that legacy
      // exemption unreachable. Running this DB-aware guard first restores it.
      var _uFixedExemptByExisting = false;
      if (updateFields.placementMode === PLACEMENT_MODES.FIXED) {
        var _uHasDate = updateFields.date !== undefined && updateFields.date !== null && updateFields.date !== '';
        var _uHasTime = updateFields.time !== undefined && updateFields.time !== null && updateFields.time !== '';
        var _uHasScheduledAt = updateFields.scheduledAt !== undefined && updateFields.scheduledAt !== null && updateFields.scheduledAt !== '';
        if (!_uHasDate && !_uHasTime && !_uHasScheduledAt) {
          var _uExisting = await db('tasks_with_sync_v').where({ id: id, user_id: userId }).first();
          if (!_uExisting || !_uExisting.scheduled_at) {
            return { content: [{ type: 'text', text: 'Validation error: placementMode "fixed" requires a date, time, or scheduledAt' }], isError: true };
          }
          _uFixedExemptByExisting = true;
        }
      }

      // Validate input (same shared domain function the facade also calls). When
      // the guard above exempted this call via the row's EXISTING scheduled_at,
      // validate a CLONE carrying that existing value as scheduledAt so
      // validateTaskInput's own (existing-blind) OR-based fixed-mode check also
      // sees the requirement satisfied — `fields`/`updateFields` (what's actually
      // sent to the facade below) are untouched, so no extra write is introduced;
      // the row's real scheduled_at is left exactly as-is.
      //
      // 999.1396 RESOLVED: the facade-internal duplicate of this shadowing bug
      // (UpdateTask.js's own existing-blind validateTaskInput call, which used
      // to independently re-reject the real body downstream of this adapter
      // padding) is fixed — validateTaskInput is now existing-aware and both
      // UpdateTask and BatchUpdateTasks pass the row through for the
      // fixed-without-inline-schedule case, so the exemption below holds
      // end-to-end for single AND batch.
      var valInputFields = _uFixedExemptByExisting
        ? Object.assign({}, fields, { scheduledAt: _uExisting.scheduled_at })
        : fields;
      var valErrors = validateTaskInput(valInputFields);
      if (valErrors.length > 0) {
        return { content: [{ type: 'text', text: 'Validation error: ' + valErrors.join('; ') }], isError: true };
      }

      // RULED (999.1216): status transitions route through
      // facade.updateTaskStatus so the D-B snap-then-write terminal-schedule
      // handling + rolling-anchor projection apply — UpdateTask's own row
      // shaping would otherwise write `status` directly with NO terminal
      // guard at all. Non-status fields (if any) are applied first via
      // facade.updateTask, then the status transition — this lets
      // update_task(id,{status:'done',date:'12/1'}) schedule-and-complete in
      // one call (the date lands before updateTaskStatus checks scheduled_at),
      // matching pre-migration semantics for that combination.
      var hasStatus = 'status' in updateFields;
      var statusValue = updateFields.status;
      var nonStatusFields = Object.assign({}, updateFields);
      delete nonStatusFields.status;

      var lastResult = null;
      if (!hasStatus || Object.keys(nonStatusFields).length > 0) {
        lastResult = await facade.updateTask({
          id: id, userId: userId,
          body: hasStatus ? nonStatusFields : updateFields,
          timezoneHeader: tz
        });
        if (lastResult.status >= 400) {
          return { content: [{ type: 'text', text: mapFacadeErrorText(lastResult) }], isError: true };
        }
      }
      if (hasStatus) {
        lastResult = await facade.updateTaskStatus({
          id: id, userId: userId,
          body: { status: statusValue },
          timezoneHeader: tz
        });
        if (lastResult.status >= 400) {
          return { content: [{ type: 'text', text: mapFacadeErrorText(lastResult) }], isError: true };
        }
      }

      var allRows = await db('tasks_with_sync_v').where('user_id', userId).select();
      var srcMap = buildSourceMap(allRows);
      var updatedRow = allRows.find(function(r) { return r.id === id; });
      var payload = rowToTask(updatedRow, tz, srcMap);
      if (lastResult && lastResult.body && lastResult.body.queued) payload.queued = true;
      return { content: [{ type: 'text', text: safeStringify(payload) }] };
    }
  );

  // ── set_task_status ──
  server.tool(
    'set_task_status',
    'Set task status (e.g. "", "done", "cancel").',
    {
      id: z.string().describe('Task ID'),
      status: z.string().describe('New status. Valid values: "" (active), "wip", "done", "cancel", "skip", "pause", "disabled"')
    },
    async ({ id, status }) => {
      var tz = await getUserTimezone(userId);

      // Routes through facade.updateTaskStatus — eliminates tasks.js's own
      // byte-copy of the rolling/next-occurrence anchor recompute (999.1098)
      // in favor of the facade's applyRollingAnchor (which has the
      // trx-threading fix this copy lacked), and gives the D-B snap-then-write
      // terminal-schedule behavior (999.1216 RULED) in place of the old
      // reject-based terminalScheduleBlock guard.
      var result = await facade.updateTaskStatus({
        id: id, userId: userId,
        body: { status: status },
        timezoneHeader: tz
      });
      if (result.status >= 400) {
        return { content: [{ type: 'text', text: mapFacadeErrorText(result) }], isError: true };
      }

      var updated = await db('tasks_with_sync_v').where({ id: id, user_id: userId }).first();
      return { content: [{ type: 'text', text: safeStringify(rowToTask(updated, tz)) }] };
    }
  );

  // ── delete_task ──
  server.tool(
    'delete_task',
    'Delete a task. Dependencies are remapped to the deleted task\'s dependencies.',
    {
      id: z.string().describe('Task ID to delete')
    },
    async ({ id }) => {
      // RULED (delete_task hard-delete -> R55 soft-cancel): facade.deleteTask
      // already routes every scope through soft-cancel (standardDelete ->
      // twrite.softCancelById) — no prerequisite fix needed (999.1215 was
      // stale, closed by WI-1). The response envelope is reconstructed to the
      // pinned {deleted:true,id} shape regardless of which internal branch
      // the facade took (it returns a scope-specific `message` field instead).
      var result = await facade.deleteTask({ id: id, userId: userId });
      if (result.status >= 400) {
        return { content: [{ type: 'text', text: mapFacadeErrorText(result) }], isError: true };
      }
      return { content: [{ type: 'text', text: safeStringify({ deleted: true, id: id }) }] };
    }
  );

  // ── get_task ──
  server.tool(
    'get_task',
    'Get a single task by ID. Returns full task details including both UTC and local fields.',
    {
      id: z.string().describe('Task ID')
    },
    async ({ id }) => {
      var tz = await getUserTimezone(userId);
      var rows = await db('tasks_v').where('user_id', userId);
      var srcMap = buildSourceMap(rows);
      var row = rows.find(function(r) { return r.id === id; });
      if (!row) {
        return { content: [{ type: 'text', text: 'Error: Task not found' }], isError: true };
      }
      return { content: [{ type: 'text', text: safeStringify(rowToTask(row, tz, srcMap)) }] };
    }
  );

  // ── search_tasks ──
  server.tool(
    'search_tasks',
    'Search tasks by text across task names and notes. Excludes "done" tasks by default — pass status="done" or includeDone=true to see completed history.',
    {
      query: z.string().describe('Search text (case-insensitive, matched against task text and notes)'),
      status: z.string().optional().describe('Filter by exact status: "" (pending), "done", "skip", "cancel", "disabled", "pause". Overrides the default done-exclusion.'),
      includeDone: z.boolean().optional().describe('Include tasks with status="done" in the default results. Default: false.'),
      project: z.string().optional().describe('Filter by project name'),
      limit: z.number().optional().describe('Max results (default 20)')
    },
    async ({ query, status, includeDone, project, limit }) => {
      var tz = await getUserTimezone(userId);
      var dbQuery = db('tasks_v').where('user_id', userId);
      if (status !== undefined) {
        dbQuery = dbQuery.where('status', status);
      } else if (!includeDone) {
        dbQuery = dbQuery.where(function() {
          this.whereNot('status', 'done').orWhereNull('status');
        });
      }
      if (project) dbQuery = dbQuery.where('project', project);
      var escaped = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
      dbQuery = dbQuery.where(function() {
        this.where('text', 'like', '%' + escaped + '%')
            .orWhere('notes', 'like', '%' + escaped + '%');
      });
      dbQuery = dbQuery.orderBy('created_at', 'asc').limit(limit || 20);

      var rows = await dbQuery;
      // Also load all rows for sourceMap (recurring inheritance)
      var allRows = await db('tasks_v').where('user_id', userId);
      var srcMap = buildSourceMap(allRows);
      var tasks = rows.map(function(r) { return rowToTask(r, tz, srcMap); });
      return { content: [{ type: 'text', text: safeStringify(tasks) }] };
    }
  );

  // ── batch_update_tasks ──
  server.tool(
    'batch_update_tasks',
    'Update multiple tasks at once. Each entry needs an id and the fields to change. Max 200 tasks per call.',
    {
      updates: z.array(z.object(
        Object.assign({
          id: z.string().describe('Task ID to update'),
          status: z.string().optional()
        }, taskInputFields)
      )).describe('Array of task updates, each with an id and fields to change')
    },
    async ({ updates }) => {
      if (updates.length > 200) {
        return { content: [{ type: 'text', text: 'Error: Batch limited to 200 items' }], isError: true };
      }
      var tz = await getUserTimezone(userId);

      // Legacy per-item fixed-mode-requires-schedule guard (ernie BLOCK-2,
      // jug-mcp-facade WI-2), reproduced BEFORE calling the facade: neither
      // facade batch path (lockedBatchUpdate / batchUpdateTxn) replicates this
      // guard (they only run checkCalSyncEditGuard / guardFixedCalendarWhen — a
      // different check), so a fixed item with no schedulable time would
      // otherwise be persisted with an unplaceable placement_mode=FIXED and no
      // error returned. Pre-check the WHOLE batch and abort BEFORE any facade
      // write — matching the old per-item-collect-then-transaction-rollback
      // outcome (txErrors -> throw -> nothing committed).
      var idsToCheck = updates.map(function(u) { return u.id; }).filter(Boolean);
      var existingRows = idsToCheck.length > 0
        ? await db('tasks_with_sync_v').where('user_id', userId).whereIn('id', idsToCheck).select('id', 'scheduled_at')
        : [];
      var existingById = {};
      existingRows.forEach(function(r) { existingById[r.id] = r; });
      var txErrors = [];
      updates.forEach(function(u) {
        if (u.placementMode === PLACEMENT_MODES.FIXED) {
          var _bHasDate = u.date !== undefined && u.date !== null && u.date !== '';
          var _bHasTime = u.time !== undefined && u.time !== null && u.time !== '';
          var _bHasScheduledAt = u.scheduledAt !== undefined && u.scheduledAt !== null && u.scheduledAt !== '';
          var _bExisting = existingById[u.id];
          if (!_bHasDate && !_bHasTime && !_bHasScheduledAt && !(_bExisting && _bExisting.scheduled_at)) {
            txErrors.push({ id: u.id, error: 'Validation error: placementMode "fixed" requires a date, time, or scheduledAt' });
          }
        }
      });
      if (txErrors.length > 0) {
        return { content: [{ type: 'text', text: txErrors.map(function(e) { return e.id + ': ' + e.error; }).join('; ') }], isError: true };
      }

      var preparedUpdates = updates.map(function(u) {
        var upd = Object.assign({}, u);
        applyAllDayBackstop(upd);
        return upd;
      });

      // RULED (batch_update_tasks anchor gap): routing through
      // facade.batchUpdateTasks (lockedBatchUpdate / batchUpdateTxn) means the
      // rolling/next-occurrence anchor projection now fires on a done/skip
      // transition inside a batch — a silent MCP-only gap tasks.js's own
      // batch_update_tasks never had (999.1100/BUG1 pattern).
      var result = await facade.batchUpdateTasks({
        userId: userId,
        body: { updates: preparedUpdates },
        timezoneHeader: tz
      });
      if (result.status >= 400) {
        return { content: [{ type: 'text', text: mapFacadeErrorText(result) }], isError: true };
      }
      var payload = { updated: result.body.updated };
      if (result.body.queued !== undefined) payload.queued = result.body.queued;
      return { content: [{ type: 'text', text: safeStringify(payload) }] };
    }
  );
}

module.exports = { registerTaskTools };
