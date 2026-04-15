/**
 * MCP Task Tools — expose task CRUD as MCP tools
 *
 * Accepts both scheduledAt (UTC ISO) and date+time (local strings) —
 * UTC takes precedence. `deadline` and `startAfter` are date-only
 * (YYYY-MM-DD). Always returns both scheduled_at formats in responses.
 */

const { z } = require('zod');
const db = require('../../db');
const { rowToTask, taskToRow, guardFixedCalendarWhen, ensureProject, applySplitDefault, buildSourceMap, TEMPLATE_FIELDS } = require('../../controllers/task.controller');
const { enqueueScheduleRun } = require('../../scheduler/scheduleQueue');
const { isLocked, enqueueWrite, splitFields } = require('../../lib/task-write-queue');
const tasksWrite = require('../../lib/tasks-write');

// Shared Zod fields for task input (used by create_task, create_tasks, update_task)
var taskInputFields = {
  text: z.string().optional(),
  project: z.string().optional().describe('Project name'),
  pri: z.string().optional().describe('Priority: "P1" (highest), "P2", "P3" (default), "P4" (lowest)'),
  dur: z.number().optional().describe('Duration in minutes'),
  when: z.string().optional().describe('Time preference: "morning", "afternoon", "evening", or null'),
  dayReq: z.string().optional().describe('Day requirement: "any", "weekday", "weekend", a single day letter (M,T,W,R,F,Sa,Su), or comma-separated for multiple days (e.g. "M,W,F")'),
  dependsOn: z.array(z.string()).optional().describe('Array of task IDs this task depends on'),
  // Local string fields (PREFERRED — server converts using user's timezone automatically)
  date: z.string().optional().describe('Scheduled date in M/D format (e.g. "3/8"). PREFERRED over scheduledAt — server handles timezone conversion.'),
  time: z.string().optional().describe('Scheduled time in h:mm AM/PM format (e.g. "9:30 PM"). PREFERRED over scheduledAt — server handles timezone conversion.'),
  deadline: z.string().optional().describe('Deadline (hard, non-negotiable). YYYY-MM-DD or M/D format. The scheduler places this task on or before this date.'),
  startAfter: z.string().optional().describe('Start-after date (YYYY-MM-DD or M/D). PREFERRED over startAfterAt.'),
  // UTC ISO fields (use ONLY if you already have a correct UTC timestamp — avoid manual timezone math)
  scheduledAt: z.string().optional().describe('UTC ISO timestamp. AVOID — use date+time instead to prevent timezone errors. Only use if you already have a verified UTC value.'),
  startAfterAt: z.string().optional().describe('Start-after as ISO string. AVOID — use startAfter instead.'),
  // Other fields
  location: z.array(z.string()).optional().describe('Location IDs'),
  tools: z.array(z.string()).optional().describe('Tool IDs'),
  notes: z.string().optional().describe('Additional notes'),
  recurring: z.boolean().optional().describe('Whether this is a recurring recurring'),
  rigid: z.boolean().optional().describe('Whether time is fixed/rigid'),
  split: z.boolean().optional().describe('Whether task can be split across time blocks'),
  splitMin: z.number().optional().describe('Minimum split chunk in minutes'),
  recur: z.object({
    type: z.string(),
    days: z.string().optional(),
    every: z.number().optional()
  }).optional().describe('Recurrence pattern'),
  datePinned: z.boolean().optional().describe('Whether date is pinned (won\'t be moved by scheduler)'),
  marker: z.boolean().optional().describe('Non-blocking reminder event — shows on calendar at its time but does not prevent tasks from being scheduled in the same slot. Use for events you want to see but not block time for (e.g. TV game windows, reminders). Can have status and dependencies like regular tasks.'),
  flexWhen: z.boolean().optional().describe('Allow the scheduler to relax this task\'s "when" time-of-day preference if it can\'t be placed within those windows. When false (default), the task stays unplaced if its when windows are full.'),
  travelBefore: z.number().optional().describe('Travel buffer before task in minutes — scheduler reserves this time and prevents overlapping placements'),
  travelAfter: z.number().optional().describe('Travel buffer after task in minutes — scheduler reserves this time and prevents overlapping placements'),
  desiredAt: z.string().optional().describe('User intended date/time as UTC ISO. Usually set automatically from date+time — only provide if you need to set desired_at differently from scheduled_at.'),
  desiredDate: z.string().optional().describe('User intended date only (YYYY-MM-DD). For tasks with a date preference but no specific time.'),
  preferredTimeMins: z.number().optional().describe('Preferred time as minutes from midnight in user local timezone (e.g. 720 = 12:00 PM, 420 = 7:00 AM). For recurring tasks in Time Window mode.')
};

function registerTaskTools(server, userId) {

  // Helper: get user timezone
  async function getUserTimezone() {
    var user = await db('users').where('id', userId).select('timezone').first();
    return (user && user.timezone) || 'America/New_York';
  }

  // ── list_tasks ──
  server.tool(
    'list_tasks',
    'List tasks. Filter by status, project, date, or limit results. Returns both UTC (scheduledAt) and local (date/time/day) fields.',
    {
      status: z.string().optional().describe('Filter by status (e.g. "", "done", "dropped")'),
      project: z.string().optional().describe('Filter by project name'),
      date: z.string().optional().describe('Filter by date (M/D format, e.g. "3/8") — matched against derived local date'),
      limit: z.number().optional().describe('Max number of tasks to return')
    },
    async ({ status, project, date, limit }) => {
      var tz = await getUserTimezone();
      var query = db('tasks_v').where('user_id', userId);
      if (status !== undefined) query = query.where('status', status);
      if (project) query = query.where('project', project);
      query = query.orderBy('created_at', 'asc');
      if (limit && !date) query = query.limit(limit);

      var rows = await query;
      var srcMap = buildSourceMap(rows);
      var tasks = rows.map(function(r) { return rowToTask(r, tz, srcMap); });
      if (date) {
        tasks = tasks.filter(function(t) { return t.date === date; });
        if (limit) tasks = tasks.slice(0, limit);
      }
      return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
    }
  );

  // ── create_task ──
  server.tool(
    'create_task',
    'Create a single task. Use date+time for scheduling (server converts timezone automatically). Returns both UTC and local fields.',
    Object.assign({ id: z.string().optional().describe('Task ID (auto-generated UUID if omitted)'), text: z.string().describe('Task description/title') }, taskInputFields),
    async (params) => {
      var tz = await getUserTimezone();
      var task = Object.assign({}, params);
      if (!task.id) {
        var uuidv7 = require('uuid').v7;
        task.id = uuidv7();
      }
      var row = taskToRow(task, userId, tz);
      if (!row.task_type) row.task_type = 'task';
      row.created_at = db.fn.now();
      await applySplitDefault(row, userId);
      await ensureProject(userId, task.project);

      var locked = await isLocked(userId);
      if (locked) {
        row.user_id = userId;
        await enqueueWrite(userId, row.id, 'create', row, 'mcp:create_task');
        enqueueScheduleRun(userId, 'mcp:create_task', [row.id]);
        return { content: [{ type: 'text', text: JSON.stringify(Object.assign(rowToTask(row, tz), { queued: true }), null, 2) }] };
      }

      await tasksWrite.insertTask(db, row);
      enqueueScheduleRun(userId, 'mcp:create_task', [row.id]);
      var created = await db('tasks_with_sync_v').where('id', row.id).first();
      return { content: [{ type: 'text', text: JSON.stringify(rowToTask(created, tz), null, 2) }] };
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
      var tz = await getUserTimezone();
      var uuidv7 = require('uuid').v7;
      var prefs = await db('user_config').where({ user_id: userId, config_key: 'preferences' }).first();
      var splitDefault = prefs ? (typeof prefs.config_value === 'string' ? JSON.parse(prefs.config_value) : prefs.config_value).splitDefault : false;

      var projects = new Set();
      var rows = tasks.map(function(t) {
        if (!t.id) t.id = uuidv7();
        if (t.project) projects.add(t.project);
        var row = taskToRow(t, userId, tz);
        row.created_at = db.fn.now();
        if (row.split === undefined || row.split === null) {
          row.split = splitDefault ? 1 : 0;
        }
        return row;
      });

      for (var p of projects) {
        await ensureProject(userId, p);
      }

      var locked = await isLocked(userId);
      if (locked) {
        for (var qi = 0; qi < rows.length; qi++) {
          rows[qi].user_id = userId;
          await enqueueWrite(userId, rows[qi].id, 'create', rows[qi], 'mcp:create_tasks');
        }
        enqueueScheduleRun(userId, 'mcp:create_tasks', rows.map(function(r) { return r.id; }));
        return { content: [{ type: 'text', text: JSON.stringify({ created: rows.length, ids: rows.map(function(r) { return r.id; }), queued: true }) }] };
      }

      await db.transaction(async function(trx) {
        for (var i = 0; i < rows.length; i++) {
          await tasksWrite.insertTask(trx, rows[i]);
        }
      });

      enqueueScheduleRun(userId, 'mcp:create_tasks', rows.map(function(r) { return r.id; }));
      return { content: [{ type: 'text', text: JSON.stringify({ created: rows.length, ids: rows.map(function(r) { return r.id; }) }) }] };
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
      var tz = await getUserTimezone();
      var existing = await db('tasks_with_sync_v').where({ id: id, user_id: userId }).first();
      if (!existing) {
        return { content: [{ type: 'text', text: 'Error: Task not found' }], isError: true };
      }

      var row = taskToRow(fields, userId, tz);
      delete row.user_id;
      delete row.created_at;

      if (fields.project) await ensureProject(userId, fields.project);

      // Auto-pin logic
      var dateWasSet = fields.date !== undefined || fields.scheduledAt !== undefined;
      if (dateWasSet && row.date_pinned === undefined) {
        row.date_pinned = 1;
      }

      // Recurrings cannot have dependencies — strip if provided
      if (existing.task_type === 'recurring_template' || existing.task_type === 'recurring_instance') {
        delete row.depends_on;
      }

      // Route template fields to source for recurring instances (uses module-level TEMPLATE_FIELDS)
      var taskType = existing.task_type || 'task';
      var isRecurringInstance = taskType === 'recurring_instance' && existing.source_id;

      // Guard: don't let calendar-linked fixed tasks lose their 'fixed' tag.
      // Instance edits route `when` to the source template, so guard against it.
      if (row.when !== undefined) {
        var _mGuardOpts = { allowUnfix: !!fields._allowUnfix };
        if (isRecurringInstance) {
          var _srcT = await db('tasks_with_sync_v').where({ id: existing.source_id, user_id: userId }).first();
          guardFixedCalendarWhen(row, _srcT, _mGuardOpts);
        } else {
          guardFixedCalendarWhen(row, existing, _mGuardOpts);
        }
      }

      // Lock check: if scheduling lock is held, split and queue
      var locked = await isLocked(userId);
      if (locked) {
        var { schedulingFields, nonSchedulingFields } = splitFields(row);
        if (Object.keys(nonSchedulingFields).length > 0) {
          nonSchedulingFields.updated_at = db.fn.now();
          await tasksWrite.updateTaskById(db, id, nonSchedulingFields, userId);
        }
        if (Object.keys(schedulingFields).length > 0) {
          await enqueueWrite(userId, id, 'update', schedulingFields, 'mcp:update_task');
        }
        enqueueScheduleRun(userId, 'mcp:update_task', [id]);
        var allRows = await db('tasks_with_sync_v').where('user_id', userId).select();
        var srcMap = buildSourceMap(allRows);
        var updatedRow = allRows.find(function(r) { return r.id === id; });
        return { content: [{ type: 'text', text: JSON.stringify(Object.assign(rowToTask(updatedRow, tz, srcMap), { queued: true }), null, 2) }] };
      }

      if (isRecurringInstance) {
        var templateUpdate = {};
        var instanceUpdate = {};
        Object.keys(row).forEach(function(k) {
          if (k === 'updated_at') return;
          if (TEMPLATE_FIELDS.indexOf(k) >= 0) {
            templateUpdate[k] = row[k];
          } else {
            instanceUpdate[k] = row[k];
          }
        });
        if (Object.keys(templateUpdate).length > 0) {
          templateUpdate.updated_at = db.fn.now();
          await tasksWrite.updateTaskById(db, existing.source_id, templateUpdate, userId);
        }
        if (Object.keys(instanceUpdate).length > 0) {
          instanceUpdate.updated_at = db.fn.now();
          await tasksWrite.updateTaskById(db, id, instanceUpdate, userId);
        } else {
          await tasksWrite.updateTaskById(db, id, { updated_at: db.fn.now() }, userId);
        }
      } else {
        await tasksWrite.updateTaskById(db, id, row, userId);
      }

      enqueueScheduleRun(userId, 'mcp:update_task', [id]);
      var allRows = await db('tasks_with_sync_v').where('user_id', userId).select();
      var srcMap = buildSourceMap(allRows);
      var updatedRow = allRows.find(function(r) { return r.id === id; });
      return { content: [{ type: 'text', text: JSON.stringify(rowToTask(updatedRow, tz, srcMap), null, 2) }] };
    }
  );

  // ── set_task_status ──
  server.tool(
    'set_task_status',
    'Set task status (e.g. "", "done", "dropped").',
    {
      id: z.string().describe('Task ID'),
      status: z.string().describe('New status: "" (active), "done", "dropped"')
    },
    async ({ id, status }) => {
      var tz = await getUserTimezone();
      var existing = await db('tasks_v').where({ id: id, user_id: userId }).first();
      if (!existing) {
        return { content: [{ type: 'text', text: 'Error: Task not found' }], isError: true };
      }

      var update = { status: status || '', updated_at: db.fn.now() };

      await tasksWrite.updateTaskById(db, id, update, userId);
      enqueueScheduleRun(userId, 'mcp:set_task_status', [id]);
      var updated = await db('tasks_with_sync_v').where('id', id).first();
      return { content: [{ type: 'text', text: JSON.stringify(rowToTask(updated, tz), null, 2) }] };
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
      var task = await db('tasks_with_sync_v').where({ id: id, user_id: userId }).first();
      if (!task) {
        return { content: [{ type: 'text', text: 'Error: Task not found' }], isError: true };
      }

      // In ingest-only mode, prevent deletion of calendar-linked tasks
      if (task.gcal_event_id || task.msft_event_id) {
        var _csRow = await db('user_config')
          .where({ user_id: userId, config_key: 'cal_sync_settings' }).first();
        var _csSettings = _csRow
          ? (typeof _csRow.config_value === 'string' ? JSON.parse(_csRow.config_value) : _csRow.config_value)
          : {};
        var _isIngest = (task.gcal_event_id && _csSettings.gcal && _csSettings.gcal.mode === 'ingest')
                     || (task.msft_event_id && _csSettings.msft && _csSettings.msft.mode === 'ingest');
        if (_isIngest) {
          return { content: [{ type: 'text', text: 'Error: Calendar-linked tasks cannot be deleted in ingest-only mode. Delete the event from your calendar instead.' }], isError: true };
        }
      }

      await db.transaction(async function(trx) {
        var deletedDeps = typeof task.depends_on === 'string'
          ? JSON.parse(task.depends_on || '[]') : (task.depends_on || []);
        var affected = await trx('tasks_v')
          .where('user_id', userId)
          .whereRaw('JSON_CONTAINS(depends_on, ?)', [JSON.stringify(id)])
          .select('id', 'depends_on');
        for (var i = 0; i < affected.length; i++) {
          var other = affected[i];
          var deps = typeof other.depends_on === 'string'
            ? JSON.parse(other.depends_on || '[]') : (other.depends_on || []);
          var newDeps = deps.filter(function(d) { return d !== id; });
          deletedDeps.forEach(function(d) { if (newDeps.indexOf(d) === -1) newDeps.push(d); });
          await tasksWrite.updateTaskById(trx, other.id, {
            depends_on: JSON.stringify(newDeps), updated_at: db.fn.now()
          }, userId);
        }

        if (task.gcal_event_id || task.msft_event_id || task.apple_event_id) {
          // status='deleted_local' so the next sync doesn't recreate the task
          // from the still-existing calendar event
          await trx('cal_sync_ledger')
            .where({ user_id: userId, task_id: id })
            .where('status', 'active')
            .update({ status: 'deleted_local', task_id: null, provider_event_id: null, synced_at: db.fn.now() })
            .catch(function(err) { console.error("[silent-catch]", err.message); });
        }

        await tasksWrite.deleteTaskById(trx, id, userId);
      });

      enqueueScheduleRun(userId, 'mcp:delete_task', [id]);
      return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, id: id }) }] };
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
      var tz = await getUserTimezone();
      var rows = await db('tasks_v').where('user_id', userId);
      var srcMap = buildSourceMap(rows);
      var row = rows.find(function(r) { return r.id === id; });
      if (!row) {
        return { content: [{ type: 'text', text: 'Error: Task not found' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(rowToTask(row, tz, srcMap), null, 2) }] };
    }
  );

  // ── search_tasks ──
  server.tool(
    'search_tasks',
    'Search tasks by text across task names and notes. Supports optional status and project filters.',
    {
      query: z.string().describe('Search text (case-insensitive, matched against task text and notes)'),
      status: z.string().optional().describe('Filter by status (e.g. "", "done", "dropped")'),
      project: z.string().optional().describe('Filter by project name'),
      limit: z.number().optional().describe('Max results (default 20)')
    },
    async ({ query, status, project, limit }) => {
      var tz = await getUserTimezone();
      var dbQuery = db('tasks_v').where('user_id', userId);
      if (status !== undefined) dbQuery = dbQuery.where('status', status);
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
      return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
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

      var tz = await getUserTimezone();
      var updatedCount = 0;

      // Uses module-level TEMPLATE_FIELDS imported from task.controller

      // Lock check: if scheduling lock is held, split and queue
      var locked = await isLocked(userId);
      if (locked) {
        var idsToCheck = updates.map(function(u) { return u.id; });
        var existCheck = await db('tasks_v')
          .where('user_id', userId)
          .whereIn('id', idsToCheck)
          .select('id', 'task_type', 'source_id', 'scheduled_at');
        var existById = {};
        existCheck.forEach(function(r) { existById[r.id] = r; });
        var queuedCount = 0;

        for (var qi = 0; qi < updates.length; qi++) {
          var qUpdate = updates[qi];
          var qId = qUpdate.id;
          if (!qId || !existById[qId]) continue;
          var qFields = {};
          Object.keys(qUpdate).forEach(function(k) { if (k !== 'id') qFields[k] = qUpdate[k]; });
          var qRow = taskToRow(qFields, userId, tz);
          delete qRow.user_id;
          delete qRow.created_at;
          delete qRow._pendingTimeOnly;
          var split = splitFields(qRow);
          if (Object.keys(split.nonSchedulingFields).length > 0) {
            split.nonSchedulingFields.updated_at = db.fn.now();
            await tasksWrite.updateTaskById(db, qId, split.nonSchedulingFields, userId);
            updatedCount++;
          }
          if (Object.keys(split.schedulingFields).length > 0) {
            await enqueueWrite(userId, qId, 'update', split.schedulingFields, 'mcp:batch_update_tasks');
            queuedCount++;
          }
        }

        enqueueScheduleRun(userId, 'mcp:batch_update_tasks', idsToCheck);
        return { content: [{ type: 'text', text: JSON.stringify({ updated: updatedCount, queued: queuedCount }) }] };
      }

      await db.transaction(async function(trx) {
        var idsToUpdate = updates.map(function(u) { return u.id; });
        var existingRows = await trx('tasks_v')
          .where('user_id', userId)
          .whereIn('id', idsToUpdate)
          .select('id', 'task_type', 'source_id', 'scheduled_at');
        var existingById = {};
        existingRows.forEach(function(r) { existingById[r.id] = r; });

        for (var i = 0; i < updates.length; i++) {
          var update = updates[i];
          var id = update.id;
          if (!id || !existingById[id]) continue;

          var fields = {};
          Object.keys(update).forEach(function(k) { if (k !== 'id') fields[k] = update[k]; });
          var row = taskToRow(fields, userId, tz);
          delete row.user_id;
          delete row.created_at;
          delete row._pendingTimeOnly;

          var existing = existingById[id];
          var taskType = existing.task_type || 'task';

          if (taskType === 'recurring_instance' && existing.source_id) {
            var templateUpdate = {};
            var instanceUpdate = {};
            Object.keys(row).forEach(function(k) {
              if (k === 'updated_at') return;
              if (TEMPLATE_FIELDS.indexOf(k) >= 0) {
                templateUpdate[k] = row[k];
              } else {
                instanceUpdate[k] = row[k];
              }
            });
            if (Object.keys(templateUpdate).length > 0) {
              templateUpdate.updated_at = db.fn.now();
              await tasksWrite.updateTaskById(trx, existing.source_id, templateUpdate, userId);
            }
            if (Object.keys(instanceUpdate).length > 0) {
              instanceUpdate.updated_at = db.fn.now();
              await tasksWrite.updateTaskById(trx, id, instanceUpdate, userId);
            } else {
              await tasksWrite.updateTaskById(trx, id, { updated_at: db.fn.now() }, userId);
            }
          } else {
            await tasksWrite.updateTaskById(trx, id, row, userId);
          }
          updatedCount++;
        }
      });

      enqueueScheduleRun(userId, 'mcp:batch_update_tasks', updates.map(function(u) { return u.id; }).filter(Boolean));
      return { content: [{ type: 'text', text: JSON.stringify({ updated: updatedCount }) }] };
    }
  );
}

module.exports = { registerTaskTools };
