/**
 * MCP Task Tools — expose task CRUD as MCP tools
 */

const { z } = require('zod');
const db = require('../../db');
const { rowToTask, taskToRow } = require('../../controllers/task.controller');

async function ensureProject(userId, projectName) {
  if (!projectName) return;
  const exists = await db('projects').where({ user_id: userId, name: projectName }).first();
  if (!exists) {
    await db('projects').insert({ user_id: userId, name: projectName });
  }
}

function registerTaskTools(server, userId) {

  // ── list_tasks ──
  server.tool(
    'list_tasks',
    'List tasks. Filter by status, project, date, or limit results.',
    {
      status: z.string().optional().describe('Filter by status (e.g. "", "done", "dropped")'),
      project: z.string().optional().describe('Filter by project name'),
      date: z.string().optional().describe('Filter by date (M/D format, e.g. "3/8")'),
      limit: z.number().optional().describe('Max number of tasks to return')
    },
    async ({ status, project, date, limit }) => {
      let query = db('tasks').where('user_id', userId);
      if (status !== undefined) query = query.where('status', status);
      if (project) query = query.where('project', project);
      if (date) query = query.where('date', date);
      query = query.orderBy('created_at', 'asc');
      if (limit) query = query.limit(limit);

      const rows = await query;
      const tasks = rows.map(rowToTask);
      return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
    }
  );

  // ── create_task ──
  server.tool(
    'create_task',
    'Create a single task. Returns the created task.',
    {
      id: z.string().optional().describe('Task ID (auto-generated UUID if omitted)'),
      text: z.string().describe('Task description/title'),
      project: z.string().optional().describe('Project name'),
      pri: z.number().optional().describe('Priority (1=highest, 5=lowest)'),
      dur: z.number().optional().describe('Duration in minutes'),
      when: z.string().optional().describe('Time preference: "morning", "afternoon", "evening", or null'),
      dayReq: z.string().optional().describe('Day requirement: "any", "weekday", "weekend", or specific day letter'),
      dependsOn: z.array(z.string()).optional().describe('Array of task IDs this task depends on'),
      due: z.string().optional().describe('Due date in M/D format'),
      date: z.string().optional().describe('Scheduled date in M/D format'),
      day: z.string().optional().describe('Day of week (Mon, Tue, etc.)'),
      time: z.string().optional().describe('Scheduled time (e.g. "9:00 AM")'),
      startAfter: z.string().optional().describe('Don\'t schedule before this date (M/D format)'),
      location: z.array(z.string()).optional().describe('Location IDs'),
      tools: z.array(z.string()).optional().describe('Tool IDs'),
      notes: z.string().optional().describe('Additional notes'),
      habit: z.boolean().optional().describe('Whether this is a recurring habit'),
      rigid: z.boolean().optional().describe('Whether time is fixed/rigid'),
      split: z.boolean().optional().describe('Whether task can be split across time blocks'),
      splitMin: z.number().optional().describe('Minimum split chunk in minutes'),
      recur: z.object({
        type: z.string(),
        days: z.string().optional(),
        every: z.number().optional()
      }).optional().describe('Recurrence pattern'),
      datePinned: z.boolean().optional().describe('Whether date is pinned (won\'t be moved by scheduler)')
    },
    async (params) => {
      const task = { ...params };
      if (!task.id) {
        const { v4: uuidv4 } = require('uuid');
        task.id = uuidv4();
      }
      const row = taskToRow(task, userId);
      row.created_at = db.fn.now();
      if (row.split === undefined || row.split === null) {
        const prefs = await db('user_config').where({ user_id: userId, config_key: 'preferences' }).first();
        const splitDefault = prefs ? (typeof prefs.config_value === 'string' ? JSON.parse(prefs.config_value) : prefs.config_value).splitDefault : false;
        row.split = splitDefault ? 1 : 0;
      }
      await ensureProject(userId, task.project);
      await db('tasks').insert(row);
      const created = await db('tasks').where('id', row.id).first();
      return { content: [{ type: 'text', text: JSON.stringify(rowToTask(created), null, 2) }] };
    }
  );

  // ── create_tasks (batch) ──
  server.tool(
    'create_tasks',
    'Create multiple tasks at once. Each task object has the same fields as create_task. Returns count of created tasks.',
    {
      tasks: z.array(z.object({
        id: z.string().optional(),
        text: z.string(),
        project: z.string().optional(),
        pri: z.number().optional(),
        dur: z.number().optional(),
        when: z.string().optional(),
        dayReq: z.string().optional(),
        dependsOn: z.array(z.string()).optional(),
        due: z.string().optional(),
        date: z.string().optional(),
        day: z.string().optional(),
        time: z.string().optional(),
        startAfter: z.string().optional(),
        location: z.array(z.string()).optional(),
        tools: z.array(z.string()).optional(),
        notes: z.string().optional(),
        habit: z.boolean().optional(),
        rigid: z.boolean().optional(),
        split: z.boolean().optional(),
        splitMin: z.number().optional(),
        recur: z.object({
          type: z.string(),
          days: z.string().optional(),
          every: z.number().optional()
        }).optional(),
        datePinned: z.boolean().optional()
      })).describe('Array of task objects to create')
    },
    async ({ tasks }) => {
      const { v4: uuidv4 } = require('uuid');
      const prefs = await db('user_config').where({ user_id: userId, config_key: 'preferences' }).first();
      const splitDefault = prefs ? (typeof prefs.config_value === 'string' ? JSON.parse(prefs.config_value) : prefs.config_value).splitDefault : false;

      const projects = new Set();
      const rows = tasks.map(t => {
        if (!t.id) t.id = uuidv4();
        if (t.project) projects.add(t.project);
        const row = taskToRow(t, userId);
        row.created_at = db.fn.now();
        if (row.split === undefined || row.split === null) {
          row.split = splitDefault ? 1 : 0;
        }
        return row;
      });

      for (const p of projects) {
        await ensureProject(userId, p);
      }

      await db.transaction(async (trx) => {
        const chunkSize = 100;
        for (let i = 0; i < rows.length; i += chunkSize) {
          await trx('tasks').insert(rows.slice(i, i + chunkSize));
        }
      });

      return { content: [{ type: 'text', text: JSON.stringify({ created: rows.length, ids: rows.map(r => r.id) }) }] };
    }
  );

  // ── update_task ──
  server.tool(
    'update_task',
    'Update fields on an existing task. Only provided fields are changed.',
    {
      id: z.string().describe('Task ID to update'),
      text: z.string().optional(),
      project: z.string().optional(),
      pri: z.number().optional(),
      dur: z.number().optional(),
      when: z.string().optional(),
      dayReq: z.string().optional(),
      dependsOn: z.array(z.string()).optional(),
      due: z.string().optional(),
      date: z.string().optional(),
      day: z.string().optional(),
      time: z.string().optional(),
      startAfter: z.string().optional(),
      location: z.array(z.string()).optional(),
      tools: z.array(z.string()).optional(),
      notes: z.string().optional(),
      habit: z.boolean().optional(),
      rigid: z.boolean().optional(),
      split: z.boolean().optional(),
      splitMin: z.number().optional(),
      datePinned: z.boolean().optional(),
      status: z.string().optional(),
      direction: z.string().optional()
    },
    async ({ id, ...fields }) => {
      const existing = await db('tasks').where({ id, user_id: userId }).first();
      if (!existing) {
        return { content: [{ type: 'text', text: 'Error: Task not found' }], isError: true };
      }

      const row = taskToRow(fields, userId);
      delete row.user_id;
      delete row.created_at;

      if (fields.project) await ensureProject(userId, fields.project);

      // Auto-pin logic (same as REST controller)
      if (row.date !== undefined && row.date_pinned === undefined) {
        row.date_pinned = 1;
      }
      if (row.date !== undefined) {
        row.original_date = null;
        row.original_day = null;
        row.original_time = null;
      }

      await db('tasks').where({ id, user_id: userId }).update(row);
      const updated = await db('tasks').where('id', id).first();
      return { content: [{ type: 'text', text: JSON.stringify(rowToTask(updated), null, 2) }] };
    }
  );

  // ── set_task_status ──
  server.tool(
    'set_task_status',
    'Set task status (e.g. "", "done", "dropped") and optional direction ("fwd", "back").',
    {
      id: z.string().describe('Task ID'),
      status: z.string().describe('New status: "" (active), "done", "dropped"'),
      direction: z.string().optional().describe('Direction: "fwd" or "back"')
    },
    async ({ id, status, direction }) => {
      const existing = await db('tasks').where({ id, user_id: userId }).first();
      if (!existing) {
        return { content: [{ type: 'text', text: 'Error: Task not found' }], isError: true };
      }

      const update = { status: status || '', updated_at: db.fn.now() };
      if (direction !== undefined) update.direction = direction;

      await db('tasks').where({ id, user_id: userId }).update(update);
      const updated = await db('tasks').where('id', id).first();
      return { content: [{ type: 'text', text: JSON.stringify(rowToTask(updated), null, 2) }] };
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
      const task = await db('tasks').where({ id, user_id: userId }).first();
      if (!task) {
        return { content: [{ type: 'text', text: 'Error: Task not found' }], isError: true };
      }

      await db.transaction(async (trx) => {
        // Remap dependencies
        const deletedDeps = typeof task.depends_on === 'string'
          ? JSON.parse(task.depends_on || '[]') : (task.depends_on || []);
        const affected = await trx('tasks')
          .where('user_id', userId)
          .whereRaw('JSON_CONTAINS(depends_on, ?)', [JSON.stringify(id)])
          .select('id', 'depends_on');
        for (const other of affected) {
          const deps = typeof other.depends_on === 'string'
            ? JSON.parse(other.depends_on || '[]') : (other.depends_on || []);
          const newDeps = deps.filter(d => d !== id);
          deletedDeps.forEach(d => { if (newDeps.indexOf(d) === -1) newDeps.push(d); });
          await trx('tasks').where({ id: other.id, user_id: userId })
            .update({ depends_on: JSON.stringify(newDeps), updated_at: db.fn.now() });
        }

        // Mark ledger record for GCal deletion
        if (task.gcal_event_id) {
          await trx('gcal_sync_ledger')
            .where({ user_id: userId, task_id: id })
            .update({ task_id: null, synced_at: db.fn.now() });
        }

        await trx('tasks').where({ id, user_id: userId }).del();
      });

      return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, id }) }] };
    }
  );
}

module.exports = { registerTaskTools };
