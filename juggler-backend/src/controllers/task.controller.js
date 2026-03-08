/**
 * Task Controller — CRUD operations for tasks
 */

const db = require('../db');
const { localToUtc, utcToLocal, toDateISO, fromDateISO } = require('../scheduler/dateHelpers');

/**
 * Map task row from DB to API format.
 * If timezone is provided and scheduled_at exists, derive date/time/day from UTC.
 */
function rowToTask(row, timezone) {
  let date = row.date;
  let time = row.time;
  let day = row.day;
  let due = row.due;
  let startAfter = row.start_after;

  // Derive date/time/day from scheduled_at (UTC source of truth)
  if (timezone && row.scheduled_at) {
    const local = utcToLocal(row.scheduled_at, timezone);
    if (local.date) date = local.date;
    if (local.time) time = local.time;
    if (local.day) day = local.day;
  }

  // Derive due/startAfter from DATE columns if available
  if (row.due_at) {
    due = fromDateISO(row.due_at instanceof Date
      ? row.due_at.toISOString().split('T')[0]
      : String(row.due_at).split('T')[0]);
  }
  if (row.start_after_at) {
    startAfter = fromDateISO(row.start_after_at instanceof Date
      ? row.start_after_at.toISOString().split('T')[0]
      : String(row.start_after_at).split('T')[0]);
  }

  return {
    id: row.id,
    text: row.text,
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
    dependsOn: typeof row.depends_on === 'string' ? JSON.parse(row.depends_on || '[]') : (row.depends_on || []),
    datePinned: !!row.date_pinned
  };
}

/**
 * Map API task to DB row.
 * If timezone is provided, compute scheduled_at (UTC) from date+time,
 * and due_at/start_after_at from due/startAfter.
 */
function taskToRow(task, userId, timezone) {
  const row = { user_id: userId };
  if (task.id !== undefined) row.id = task.id;
  if (task.text !== undefined) row.text = task.text;
  if (task.date !== undefined) row.date = task.date;
  if (task.day !== undefined) row.day = task.day;
  if (task.time !== undefined) row.time = task.time;
  if (task.dur !== undefined) row.dur = task.dur;
  if (task.timeRemaining !== undefined) row.time_remaining = task.timeRemaining;
  if (task.pri !== undefined) row.pri = task.pri;
  if (task.project !== undefined) row.project = task.project;
  if (task.status !== undefined) row.status = task.status;
  if (task.direction !== undefined) row.direction = task.direction;
  if (task.section !== undefined) row.section = task.section;
  if (task.notes !== undefined) row.notes = task.notes;
  if (task.due !== undefined) {
    row.due = task.due;
    row.due_at = task.due ? toDateISO(task.due) || null : null;
  }
  if (task.startAfter !== undefined) {
    row.start_after = task.startAfter;
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
  if (task.dependsOn !== undefined) row.depends_on = JSON.stringify(task.dependsOn || []);
  if (task.datePinned !== undefined) row.date_pinned = task.datePinned ? 1 : 0;

  // Compute scheduled_at from date+time if timezone is provided
  if (timezone && (task.date !== undefined || task.time !== undefined)) {
    const dateVal = task.date !== undefined ? task.date : null;
    const timeVal = task.time !== undefined ? task.time : null;
    if (dateVal) {
      row.scheduled_at = localToUtc(dateVal, timeVal, timezone) || null;
    } else if (dateVal === null || dateVal === '') {
      row.scheduled_at = null;
    }
  }

  row.updated_at = db.fn.now();
  return row;
}

/**
 * GET /api/tasks — all tasks for user
 */
async function getAllTasks(req, res) {
  try {
    const rows = await db('tasks').where('user_id', req.user.id).orderBy('created_at', 'asc');
    const tz = req.user.timezone || 'America/New_York';
    const tasks = rows.map(r => rowToTask(r, tz));
    res.json({ tasks });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
}

/**
 * POST /api/tasks — create single task
 */
async function ensureProject(userId, projectName) {
  if (!projectName) return;
  const exists = await db('projects').where({ user_id: userId, name: projectName }).first();
  if (!exists) {
    await db('projects').insert({ user_id: userId, name: projectName });
  }
}

async function applySplitDefault(row, userId) {
  if (row.split === undefined || row.split === null) {
    const prefs = await db('user_config').where({ user_id: userId, config_key: 'preferences' }).first();
    const splitDefault = prefs ? (typeof prefs.config_value === 'string' ? JSON.parse(prefs.config_value) : prefs.config_value).splitDefault : false;
    row.split = splitDefault ? 1 : 0;
  }
}

async function createTask(req, res) {
  try {
    const tz = req.user.timezone || 'America/New_York';
    const row = taskToRow(req.body, req.user.id, tz);
    row.created_at = db.fn.now();
    await applySplitDefault(row, req.user.id);
    await ensureProject(req.user.id, req.body.project);
    await db('tasks').insert(row);
    const created = await db('tasks').where('id', row.id).first();
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
    const { id } = req.params;
    const existing = await db('tasks').where({ id, user_id: req.user.id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const tz = req.user.timezone || 'America/New_York';
    const row = taskToRow(req.body, req.user.id, tz);
    delete row.id;
    delete row.user_id;
    delete row.created_at;

    if (req.body.project) await ensureProject(req.user.id, req.body.project);

    // When the user explicitly sets a date, pin it so the scheduler honors it.
    // If datePinned is explicitly sent as false, this is a reset — clear the pin.
    if (row.date !== undefined && row.date_pinned === undefined) {
      row.date_pinned = 1;
    }
    // Always clear scheduler-tracked originals on user edit so the
    // reset step won't revert back to a stale scheduler-assigned date.
    if (row.date !== undefined) {
      row.original_date = null;
      row.original_day = null;
      row.original_time = null;
    }

    await db.transaction(async (trx) => {
      await trx('tasks').where({ id, user_id: req.user.id }).update(row);

      // When a habit template (ht_*) is updated, propagate inheritable fields
      // to all its dh* instances so they stay in sync.
      if (id.indexOf('ht_') === 0 && existing.habit) {
        const PROPAGATE = ['location', 'when', 'where', 'tools', 'pri', 'rigid', 'split', 'day_req', 'time_flex'];
        const instanceUpdate = {};
        PROPAGATE.forEach(f => { if (row[f] !== undefined) instanceUpdate[f] = row[f]; });
        if (Object.keys(instanceUpdate).length > 0) {
          instanceUpdate.updated_at = db.fn.now();
          await trx('tasks')
            .where({ user_id: req.user.id, text: existing.text, habit: 1 })
            .andWhere('id', 'like', 'dh%')
            .update(instanceUpdate);
        }
      }
    });

    const updated = await db('tasks').where('id', id).first();
    res.json({ task: rowToTask(updated, tz) });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
}

/**
 * DELETE /api/tasks/:id — delete task
 * If task has a ledger record, null out task_id so sync will delete the GCal event.
 */
async function deleteTask(req, res) {
  try {
    const { id } = req.params;
    const task = await db('tasks').where({ id, user_id: req.user.id }).first();
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await db.transaction(async (trx) => {
      // Remap dependencies using JSON_CONTAINS to fetch only affected tasks
      const deletedDeps = typeof task.depends_on === 'string'
        ? JSON.parse(task.depends_on || '[]') : (task.depends_on || []);
      const affected = await trx('tasks')
        .where('user_id', req.user.id)
        .whereRaw('JSON_CONTAINS(depends_on, ?)', [JSON.stringify(id)])
        .select('id', 'depends_on');
      for (const other of affected) {
        const deps = typeof other.depends_on === 'string'
          ? JSON.parse(other.depends_on || '[]') : (other.depends_on || []);
        const newDeps = deps.filter(d => d !== id);
        deletedDeps.forEach(d => { if (newDeps.indexOf(d) === -1) newDeps.push(d); });
        await trx('tasks').where({ id: other.id, user_id: req.user.id })
          .update({ depends_on: JSON.stringify(newDeps), updated_at: db.fn.now() });
      }

      // Mark ledger record so sync will delete the GCal event
      if (task.gcal_event_id) {
        await trx('gcal_sync_ledger')
          .where({ user_id: req.user.id, task_id: id })
          .update({ task_id: null, synced_at: db.fn.now() });
      }

      await trx('tasks').where({ id, user_id: req.user.id }).del();
    });

    res.json({ message: 'Task deleted', id });
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
    const { id } = req.params;
    const { status, direction } = req.body;

    const existing = await db('tasks').where({ id, user_id: req.user.id }).first();
    if (!existing) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const update = { status: status || '', updated_at: db.fn.now() };
    if (direction !== undefined) update.direction = direction;

    await db('tasks').where({ id, user_id: req.user.id }).update(update);
    const updated = await db('tasks').where('id', id).first();
    const tz = req.user.timezone || 'America/New_York';
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
    const { tasks } = req.body;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'Tasks array required' });
    }
    if (tasks.length > 500) {
      return res.status(400).json({ error: 'Batch limited to 500 items' });
    }

    const tz = req.user.timezone || 'America/New_York';

    // Look up splitDefault once for the batch
    const prefs = await db('user_config').where({ user_id: req.user.id, config_key: 'preferences' }).first();
    const splitDefault = prefs ? (typeof prefs.config_value === 'string' ? JSON.parse(prefs.config_value) : prefs.config_value).splitDefault : false;

    const rows = tasks.map(t => {
      const row = taskToRow(t, req.user.id, tz);
      row.created_at = db.fn.now();
      if (row.split === undefined || row.split === null) {
        row.split = splitDefault ? 1 : 0;
      }
      return row;
    });

    // Ensure all referenced projects exist
    const projectNames = [...new Set(tasks.map(t => t.project).filter(Boolean))];
    for (const p of projectNames) {
      await ensureProject(req.user.id, p);
    }

    await db.transaction(async (trx) => {
      const chunkSize = 100;
      for (let i = 0; i < rows.length; i += chunkSize) {
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
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'Updates array required' });
    }
    if (updates.length > 500) {
      return res.status(400).json({ error: 'Batch limited to 500 items' });
    }

    const tz = req.user.timezone || 'America/New_York';
    let updatedCount = 0;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        updatedCount = 0;
        await db.transaction(async (trx) => {
          for (const update of updates) {
            const { id, ...fields } = update;
            if (!id) continue;

            const row = taskToRow(fields, req.user.id, tz);
            delete row.user_id;
            delete row.created_at;

            await trx('tasks').where({ id, user_id: req.user.id }).update(row);
            updatedCount++;
          }
        });
        break; // success
      } catch (err) {
        if (err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_RETRIES) {
          console.log('[BATCH] deadlock, retry ' + (attempt + 1) + '/' + MAX_RETRIES);
          await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
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
  createTask,
  updateTask,
  deleteTask,
  updateTaskStatus,
  batchCreateTasks,
  batchUpdateTasks,
  rowToTask,
  taskToRow
};
