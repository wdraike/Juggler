/**
 * Task Controller — CRUD operations for tasks
 *
 * The DB stores scheduled_at (DATETIME, UTC) as the single source of truth.
 *
 * API accepts BOTH formats:
 *   - UTC ISO: scheduledAt ("2026-03-08T22:45:00Z"), dueAt, startAfterAt
 *   - Local strings: date ("3/8") + time ("6:45 PM") — converted server-side
 *   UTC takes precedence if both are provided.
 *
 * API always returns both: scheduledAt (UTC ISO) + date/time/day (local derived).
 */

const db = require('../db');
const { v7: uuidv7 } = require('uuid');
const { localToUtc, utcToLocal, toDateISO, fromDateISO, getDayName } = require('../scheduler/dateHelpers');

/**
 * Normalize priority to P1-P4 format. Accepts "P1", "1", "p2", etc.
 */
function normalizePri(pri) {
  if (!pri) return 'P3';
  var s = String(pri).trim();
  if (/^P[1-4]$/i.test(s)) return s.toUpperCase();
  if (/^[1-4]$/.test(s)) return 'P' + s;
  return 'P3';
}

/**
 * Convert a DB scheduled_at value to an ISO UTC string.
 */
function scheduledAtToISO(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  var s = String(val);
  // MySQL dateStrings mode returns "YYYY-MM-DD HH:MM:SS"
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    return s.replace(' ', 'T') + 'Z';
  }
  // Already ISO
  if (s.endsWith('Z') || s.includes('+')) return s;
  return s + 'Z';
}

/**
 * Parse an ISO timestamp string into a Date for DB storage.
 * Accepts UTC ("2026-03-10T14:30:00Z") or with offset ("2026-03-10T10:30:00-04:00").
 */
function parseISOToDate(iso) {
  if (!iso) return null;
  var d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d;
}

// Fields that live on the source template and are inherited by habit instances.
// If an instance row has NULL for these, the value is read from the source.
var TEMPLATE_FIELDS = ['text', 'dur', 'pri', 'project', 'section', 'location', 'tools',
  'when', 'day_req', 'habit', 'rigid', 'time_flex', 'split', 'split_min',
  'recur', 'depends_on'];

/**
 * Build a { sourceId: row } lookup from an array of task rows.
 * Includes habit_template rows so instances can inherit their fields.
 */
function buildSourceMap(rows) {
  var map = {};
  rows.forEach(function(r) {
    if (r.task_type === 'habit_template') {
      map[r.id] = r;
    }
  });
  return map;
}

/**
 * Map task row from DB to API format.
 * Derives date/time/day from scheduled_at (UTC) using the user's timezone.
 * If sourceMap is provided, habit instances inherit template fields from their source.
 */
function rowToTask(row, timezone, sourceMap) {
  // Merge template fields from source for thin habit instances
  var src = sourceMap && row.source_id ? sourceMap[row.source_id] : null;
  if (src) {
    // Create a merged row so downstream logic sees complete data
    var merged = {};
    Object.keys(row).forEach(function(k) { merged[k] = row[k]; });
    TEMPLATE_FIELDS.forEach(function(f) {
      var v = merged[f];
      // Treat null, empty string, and empty arrays/objects as "inherit from source"
      var isEmpty = v == null || v === '' || v === '[]' || v === '{}';
      if (!isEmpty && Array.isArray(v) && v.length === 0) isEmpty = true;
      if (isEmpty) merged[f] = src[f];
    });
    row = merged;
  }
  var date = null;
  var time = null;
  var day = null;
  var due = null;
  var startAfter = null;

  // Derive date/time/day from scheduled_at (UTC source of truth)
  if (timezone && row.scheduled_at) {
    var local = utcToLocal(row.scheduled_at, timezone);
    if (local.date) date = local.date;
    if (local.time) time = local.time;
    if (local.day) day = local.day;
  }

  // Derive due from due_at DATE column
  if (row.due_at) {
    due = fromDateISO(row.due_at instanceof Date
      ? row.due_at.toISOString().split('T')[0]
      : String(row.due_at).split('T')[0]);
  }
  // Derive startAfter from start_after_at DATE column
  if (row.start_after_at) {
    startAfter = fromDateISO(row.start_after_at instanceof Date
      ? row.start_after_at.toISOString().split('T')[0]
      : String(row.start_after_at).split('T')[0]);
  }

  // Build dueAt / startAfterAt ISO strings
  var dueAtISO = null;
  if (row.due_at) {
    var dueStr = row.due_at instanceof Date
      ? row.due_at.toISOString().split('T')[0]
      : String(row.due_at).split('T')[0];
    dueAtISO = dueStr;
  }
  var startAfterAtISO = null;
  if (row.start_after_at) {
    var saStr = row.start_after_at instanceof Date
      ? row.start_after_at.toISOString().split('T')[0]
      : String(row.start_after_at).split('T')[0];
    startAfterAtISO = saStr;
  }

  return {
    id: row.id,
    taskType: row.task_type || 'task',
    text: row.text,
    // UTC source of truth
    scheduledAt: scheduledAtToISO(row.scheduled_at),
    dueAt: dueAtISO,
    startAfterAt: startAfterAtISO,
    // Derived local convenience fields
    date: date,
    day: day,
    time: time,
    dur: row.dur,
    timeRemaining: row.time_remaining,
    pri: row.pri,
    project: row.project,
    status: row.status || '',
    direction: row.direction,
    section: row.section,
    notes: row.notes,
    due: due,
    startAfter: startAfter,
    location: typeof row.location === 'string' ? JSON.parse(row.location || '[]') : (row.location || []),
    tools: typeof row.tools === 'string' ? JSON.parse(row.tools || '[]') : (row.tools || []),
    when: row.when,
    dayReq: row.day_req,
    habit: !!row.habit,
    rigid: !!row.rigid,
    timeFlex: row.time_flex != null ? row.time_flex : undefined,
    split: row.split === null ? undefined : !!row.split,
    splitMin: row.split_min,
    recur: typeof row.recur === 'string' ? JSON.parse(row.recur || 'null') : row.recur,
    sourceId: row.source_id,
    generated: !!row.generated,
    gcalEventId: row.gcal_event_id,
    msftEventId: row.msft_event_id,
    dependsOn: typeof row.depends_on === 'string' ? JSON.parse(row.depends_on || '[]') : (row.depends_on || []),
    datePinned: !!row.date_pinned
  };
}

/**
 * Map API task to DB row.
 * Converts date+time → scheduled_at (UTC) and due/startAfter → due_at/start_after_at.
 */
function taskToRow(task, userId, timezone) {
  var row = { user_id: userId };
  if (task.id !== undefined) row.id = task.id;
  if (task.taskType !== undefined) row.task_type = task.taskType;
  if (task.text !== undefined) row.text = task.text;
  if (task.dur !== undefined) row.dur = task.dur || 30;
  if (task.timeRemaining !== undefined) row.time_remaining = task.timeRemaining;
  if (task.pri !== undefined) row.pri = normalizePri(task.pri);
  if (task.project !== undefined) row.project = task.project;
  if (task.status !== undefined) row.status = task.status;
  if (task.direction !== undefined) row.direction = task.direction;
  if (task.section !== undefined) row.section = task.section;
  if (task.notes !== undefined) row.notes = task.notes;
  // UTC ISO fields take precedence over local string fields
  if (task.dueAt !== undefined) {
    row.due_at = task.dueAt || null;
  } else if (task.due !== undefined) {
    row.due_at = task.due ? toDateISO(task.due) || null : null;
  }
  if (task.startAfterAt !== undefined) {
    row.start_after_at = task.startAfterAt || null;
  } else if (task.startAfter !== undefined) {
    row.start_after_at = task.startAfter ? toDateISO(task.startAfter) || null : null;
  }
  if (task.location !== undefined) row.location = JSON.stringify(task.location);
  if (task.tools !== undefined) row.tools = JSON.stringify(task.tools);
  if (task.when !== undefined) row.when = task.when;
  if (task.dayReq !== undefined) row.day_req = task.dayReq;
  if (task.habit !== undefined) row.habit = task.habit ? 1 : 0;
  if (task.rigid !== undefined) row.rigid = task.rigid ? 1 : 0;
  if (task.timeFlex !== undefined) row.time_flex = task.timeFlex;
  if (task.split !== undefined) row.split = task.split === null ? null : (task.split ? 1 : 0);
  if (task.splitMin !== undefined) row.split_min = task.splitMin;
  if (task.recur !== undefined) row.recur = task.recur ? JSON.stringify(task.recur) : null;
  if (task.sourceId !== undefined) row.source_id = task.sourceId;
  if (task.generated !== undefined) row.generated = task.generated ? 1 : 0;
  if (task.gcalEventId !== undefined) row.gcal_event_id = task.gcalEventId;
  if (task.msftEventId !== undefined) row.msft_event_id = task.msftEventId;
  if (task.dependsOn !== undefined) row.depends_on = JSON.stringify(task.dependsOn || []);
  if (task.datePinned !== undefined) row.date_pinned = task.datePinned ? 1 : 0;

  // scheduledAt (UTC ISO) takes precedence over date+time (local strings)
  if (task.scheduledAt !== undefined) {
    row.scheduled_at = task.scheduledAt ? parseISOToDate(task.scheduledAt) : null;
  } else if (timezone && (task.date !== undefined || task.time !== undefined)) {
    var dateVal = task.date !== undefined ? task.date : null;
    var timeVal = task.time !== undefined ? task.time : null;
    if (dateVal) {
      row.scheduled_at = localToUtc(dateVal, timeVal, timezone) || null;
    } else if (task.date !== undefined && !dateVal) {
      // date was explicitly sent as null/empty → clear scheduled_at
      row.scheduled_at = null;
    }
    // If only time was sent (no date field), scheduled_at is handled in the
    // caller which can read the existing row's date and combine with the new time.
    if (task.date === undefined && task.time !== undefined) {
      row._pendingTimeOnly = timeVal;
    }
  }

  row.updated_at = db.fn.now();
  return row;
}

/**
 * Compute a version string from the most recent updated_at across all tasks.
 * Used for change-detection polling so the frontend knows when to reload.
 */
async function getTasksVersion(userId) {
  var row = await db('tasks')
    .where('user_id', userId)
    .max('updated_at as max_updated')
    .count('* as cnt')
    .first();
  // Combine max timestamp + count so additions/deletions also change the version
  var ts = row && row.max_updated ? String(row.max_updated) : '0';
  var cnt = row ? String(row.cnt) : '0';
  return ts + ':' + cnt;
}

/**
 * GET /api/tasks — all tasks for user
 */
async function getAllTasks(req, res) {
  try {
    var rows = await db('tasks').where('user_id', req.user.id).orderBy('created_at', 'asc');
    var tz = req.user.timezone || 'America/New_York';
    var srcMap = buildSourceMap(rows);
    var tasks = rows.map(function(r) { return rowToTask(r, tz, srcMap); });
    var version = await getTasksVersion(req.user.id);
    res.json({ tasks: tasks, version: version });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
}

/**
 * GET /api/tasks/version — lightweight change-detection endpoint
 */
async function getVersion(req, res) {
  try {
    var version = await getTasksVersion(req.user.id);
    res.json({ version: version });
  } catch (error) {
    console.error('Get version error:', error);
    res.status(500).json({ error: 'Failed to get version' });
  }
}

/**
 * POST /api/tasks — create single task
 */
async function ensureProject(userId, projectName) {
  if (!projectName) return;
  var exists = await db('projects').where({ user_id: userId, name: projectName }).first();
  if (!exists) {
    await db('projects').insert({ user_id: userId, name: projectName });
  }
}

async function applySplitDefault(row, userId) {
  if (row.split === undefined || row.split === null) {
    var prefs = await db('user_config').where({ user_id: userId, config_key: 'preferences' }).first();
    var splitDefault = prefs ? (typeof prefs.config_value === 'string' ? JSON.parse(prefs.config_value) : prefs.config_value).splitDefault : false;
    row.split = splitDefault ? 1 : 0;
  }
}

async function createTask(req, res) {
  try {
    var tz = req.user.timezone || 'America/New_York';
    var row = taskToRow(req.body, req.user.id, tz);
    if (!row.id) row.id = uuidv7();
    if (!row.task_type) row.task_type = 'task';
    row.created_at = db.fn.now();
    await applySplitDefault(row, req.user.id);
    await ensureProject(req.user.id, req.body.project);
    await db('tasks').insert(row);
    var created = await db('tasks').where('id', row.id).first();
    res.status(201).json({ task: rowToTask(created, tz) });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
}

/**
 * PUT /api/tasks/:id — update task fields
 */
async function updateTask(req, res) {
  try {
    var id = req.params.id;
    var existing = await db('tasks').where({ id: id, user_id: req.user.id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }

    var tz = req.user.timezone || 'America/New_York';
    var row = taskToRow(req.body, req.user.id, tz);
    delete row.id;
    delete row.user_id;
    delete row.created_at;

    // Time-only update: combine new time with existing date
    if (row._pendingTimeOnly && existing.scheduled_at) {
      var existingLocal = utcToLocal(existing.scheduled_at, tz);
      if (existingLocal && existingLocal.date) {
        row.scheduled_at = localToUtc(existingLocal.date, row._pendingTimeOnly, tz) || null;
      }
    }
    delete row._pendingTimeOnly;

    if (req.body.project) await ensureProject(req.user.id, req.body.project);

    // When the user explicitly sets a date/scheduledAt, pin it so the scheduler honors it.
    var dateWasSet = req.body.date !== undefined || req.body.scheduledAt !== undefined;
    var timeWasSet = req.body.time !== undefined || req.body.scheduledAt !== undefined;
    if (dateWasSet && row.date_pinned === undefined) {
      row.date_pinned = 1;
    }
    // Clear scheduler-tracked original on user edit so the reset step
    // won't revert back to a stale scheduler-assigned value.
    if (dateWasSet || timeWasSet) {
      row.original_scheduled_at = null;
    }

    // Fields that belong on the source template (shared across all instances).
    var TEMPLATE_ROW_FIELDS = ['text', 'dur', 'pri', 'project', 'section', 'location', 'tools',
      'when', 'day_req', 'habit', 'rigid', 'time_flex', 'split', 'split_min',
      'recur', 'depends_on'];

    var taskType = existing.task_type || 'task';

    await db.transaction(async function(trx) {
      if (taskType === 'habit_instance' && existing.source_id) {
        // Route template fields to the source, keep instance fields on this row
        var templateUpdate = {};
        var instanceUpdate = {};

        Object.keys(row).forEach(function(k) {
          if (k === 'updated_at') return; // added to both
          if (TEMPLATE_ROW_FIELDS.indexOf(k) >= 0) {
            templateUpdate[k] = row[k];
          } else {
            instanceUpdate[k] = row[k];
          }
        });

        // Update the source template with template fields
        if (Object.keys(templateUpdate).length > 0) {
          templateUpdate.updated_at = db.fn.now();
          await trx('tasks')
            .where({ id: existing.source_id, user_id: req.user.id })
            .update(templateUpdate);
        }

        // Update instance-specific fields on this row
        if (Object.keys(instanceUpdate).length > 0) {
          instanceUpdate.updated_at = db.fn.now();
          await trx('tasks').where({ id: id, user_id: req.user.id }).update(instanceUpdate);
        } else {
          // Still touch updated_at so version changes
          await trx('tasks').where({ id: id, user_id: req.user.id }).update({ updated_at: db.fn.now() });
        }
      } else if (taskType === 'habit_template') {
        // Editing the template directly — just update the template row
        await trx('tasks').where({ id: id, user_id: req.user.id }).update(row);
      } else {
        // Normal (non-habit) task — update directly
        await trx('tasks').where({ id: id, user_id: req.user.id }).update(row);
      }
    });

    // Re-read with sourceMap so the response includes merged fields
    var allRows = await db('tasks').where('user_id', req.user.id).select();
    var srcMap = buildSourceMap(allRows);
    var updatedRow = allRows.find(function(r) { return r.id === id; });
    res.json({ task: rowToTask(updatedRow, tz, srcMap) });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
}

/**
 * DELETE /api/tasks/:id — delete task
 */
async function deleteTask(req, res) {
  try {
    var id = req.params.id;
    var task = await db('tasks').where({ id: id, user_id: req.user.id }).first();
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await db.transaction(async function(trx) {
      var deletedDeps = typeof task.depends_on === 'string'
        ? JSON.parse(task.depends_on || '[]') : (task.depends_on || []);
      var affected = await trx('tasks')
        .where('user_id', req.user.id)
        .whereRaw('JSON_CONTAINS(depends_on, ?)', [JSON.stringify(id)])
        .select('id', 'depends_on');
      for (var i = 0; i < affected.length; i++) {
        var other = affected[i];
        var deps = typeof other.depends_on === 'string'
          ? JSON.parse(other.depends_on || '[]') : (other.depends_on || []);
        var newDeps = deps.filter(function(d) { return d !== id; });
        deletedDeps.forEach(function(d) { if (newDeps.indexOf(d) === -1) newDeps.push(d); });
        await trx('tasks').where({ id: other.id, user_id: req.user.id })
          .update({ depends_on: JSON.stringify(newDeps), updated_at: db.fn.now() });
      }

      if (task.gcal_event_id) {
        await trx('gcal_sync_ledger')
          .where({ user_id: req.user.id, task_id: id })
          .update({ task_id: null, synced_at: db.fn.now() });
      }
      if (task.msft_event_id) {
        await trx('msft_cal_sync_ledger')
          .where({ user_id: req.user.id, task_id: id })
          .update({ task_id: null, synced_at: db.fn.now() });
      }

      await trx('tasks').where({ id: id, user_id: req.user.id }).del();
    });

    res.json({ message: 'Task deleted', id: id });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
}

/**
 * PUT /api/tasks/:id/status — update status + direction
 */
async function updateTaskStatus(req, res) {
  try {
    var id = req.params.id;
    var status = req.body.status;
    var direction = req.body.direction;

    var existing = await db('tasks').where({ id: id, user_id: req.user.id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }

    var update = { status: status || '', updated_at: db.fn.now() };
    if (direction !== undefined) update.direction = direction;

    await db('tasks').where({ id: id, user_id: req.user.id }).update(update);
    var updated = await db('tasks').where('id', id).first();
    var tz = req.user.timezone || 'America/New_York';
    res.json({ task: rowToTask(updated, tz) });
  } catch (error) {
    console.error('Update task status error:', error);
    res.status(500).json({ error: 'Failed to update task status' });
  }
}

/**
 * POST /api/tasks/batch — batch create tasks
 */
async function batchCreateTasks(req, res) {
  try {
    var tasks = req.body.tasks;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'Tasks array required' });
    }
    if (tasks.length > 500) {
      return res.status(400).json({ error: 'Batch limited to 500 items' });
    }

    var tz = req.user.timezone || 'America/New_York';

    var prefs = await db('user_config').where({ user_id: req.user.id, config_key: 'preferences' }).first();
    var splitDefault = prefs ? (typeof prefs.config_value === 'string' ? JSON.parse(prefs.config_value) : prefs.config_value).splitDefault : false;

    var rows = tasks.map(function(t) {
      var row = taskToRow(t, req.user.id, tz);
      row.created_at = db.fn.now();
      if (row.split === undefined || row.split === null) {
        row.split = splitDefault ? 1 : 0;
      }
      return row;
    });

    var projectNames = [];
    var seen = {};
    tasks.forEach(function(t) {
      if (t.project && !seen[t.project]) { projectNames.push(t.project); seen[t.project] = true; }
    });
    for (var i = 0; i < projectNames.length; i++) {
      await ensureProject(req.user.id, projectNames[i]);
    }

    await db.transaction(async function(trx) {
      var chunkSize = 100;
      for (var i = 0; i < rows.length; i += chunkSize) {
        await trx('tasks').insert(rows.slice(i, i + chunkSize));
      }
    });

    res.status(201).json({ created: rows.length });
  } catch (error) {
    console.error('Batch create error:', error);
    res.status(500).json({ error: 'Failed to batch create tasks' });
  }
}

/**
 * PUT /api/tasks/batch — batch update tasks
 */
async function batchUpdateTasks(req, res) {
  try {
    var updates = req.body.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'Updates array required' });
    }
    if (updates.length > 2000) {
      return res.status(400).json({ error: 'Batch limited to 2000 items' });
    }

    var tz = req.user.timezone || 'America/New_York';
    var updatedCount = 0;
    var MAX_RETRIES = 3;

    // Template fields that should be routed to the source for habit instances
    var TEMPLATE_ROW_FIELDS = ['text', 'dur', 'pri', 'project', 'section', 'location', 'tools',
      'when', 'day_req', 'habit', 'rigid', 'time_flex', 'split', 'split_min',
      'recur', 'depends_on'];

    for (var attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        updatedCount = 0;
        await db.transaction(async function(trx) {
          // Pre-load task_type and source_id for all IDs being updated
          var idsToUpdate = updates.map(function(u) { return u.id; }).filter(Boolean);
          var existingRows = await trx('tasks')
            .where('user_id', req.user.id)
            .whereIn('id', idsToUpdate)
            .select('id', 'task_type', 'source_id', 'scheduled_at');
          var existingById = {};
          existingRows.forEach(function(r) { existingById[r.id] = r; });

          for (var i = 0; i < updates.length; i++) {
            var update = updates[i];
            var id = update.id;
            if (!id) continue;

            var fields = {};
            Object.keys(update).forEach(function(k) { if (k !== 'id') fields[k] = update[k]; });
            var row = taskToRow(fields, req.user.id, tz);
            delete row.user_id;
            delete row.created_at;

            var existing = existingById[id];

            // Time-only update: combine new time with existing date
            if (row._pendingTimeOnly && existing && existing.scheduled_at) {
              var existingDt = new Date(existing.scheduled_at);
              var existingLocal = utcToLocal(existingDt, tz);
              if (existingLocal) {
                var existingDate = existingLocal.date; // e.g. "3/12"
                row.scheduled_at = localToUtc(existingDate, row._pendingTimeOnly, tz) || null;
              }
            }
            delete row._pendingTimeOnly;
            var taskType = existing ? (existing.task_type || 'task') : 'task';

            if (taskType === 'habit_instance' && existing && existing.source_id) {
              // Route template fields to source, instance fields to this row
              var templateUpdate = {};
              var instanceUpdate = {};
              Object.keys(row).forEach(function(k) {
                if (k === 'updated_at') return;
                if (TEMPLATE_ROW_FIELDS.indexOf(k) >= 0) {
                  templateUpdate[k] = row[k];
                } else {
                  instanceUpdate[k] = row[k];
                }
              });
              if (Object.keys(templateUpdate).length > 0) {
                templateUpdate.updated_at = db.fn.now();
                await trx('tasks')
                  .where({ id: existing.source_id, user_id: req.user.id })
                  .update(templateUpdate);
              }
              if (Object.keys(instanceUpdate).length > 0) {
                instanceUpdate.updated_at = db.fn.now();
                await trx('tasks').where({ id: id, user_id: req.user.id }).update(instanceUpdate);
              } else {
                await trx('tasks').where({ id: id, user_id: req.user.id }).update({ updated_at: db.fn.now() });
              }
            } else {
              await trx('tasks').where({ id: id, user_id: req.user.id }).update(row);
            }
            updatedCount++;
          }
        });
        break;
      } catch (err) {
        if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_RETRIES) {
          console.log('[BATCH] deadlock, retry ' + (attempt + 1) + '/' + MAX_RETRIES);
          await new Promise(function(r) { setTimeout(r, 200 * (attempt + 1)); });
          continue;
        }
        throw err;
      }
    }

    res.json({ updated: updatedCount });
  } catch (error) {
    console.error('Batch update error:', error);
    res.status(500).json({ error: 'Failed to batch update tasks' });
  }
}

module.exports = {
  getAllTasks,
  getVersion,
  createTask,
  updateTask,
  deleteTask,
  updateTaskStatus,
  batchCreateTasks,
  batchUpdateTasks,
  rowToTask,
  taskToRow,
  buildSourceMap,
  ensureProject,
  applySplitDefault
};
