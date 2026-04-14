/**
 * MCP Config Tools — expose user config as MCP tools
 */

const { z } = require('zod');
const db = require('../../db');
const tasksWrite = require('../../lib/tasks-write');

function registerConfigTools(server, userId) {

  // ── get_config ──
  server.tool(
    'get_config',
    'Get user configuration including locations, tools, projects, time blocks, tool matrix, location schedules, and preferences.',
    {},
    async () => {
      const [locations, tools, projects, configRows] = await Promise.all([
        db('locations').where('user_id', userId).orderBy('sort_order'),
        db('tools').where('user_id', userId).orderBy('sort_order'),
        db('projects').where('user_id', userId).orderBy('sort_order'),
        db('user_config').where('user_id', userId)
      ]);

      const config = {};
      configRows.forEach(row => {
        const val = typeof row.config_value === 'string' ? (function() { try { return JSON.parse(row.config_value); } catch(e) { return row.config_value; } })() : row.config_value;
        config[row.config_key] = val;
      });

      const result = {
        locations: locations.map(l => ({ id: l.location_id, name: l.name, icon: l.icon })),
        tools: tools.map(t => ({ id: t.tool_id, name: t.name, icon: t.icon })),
        projects: projects.map(p => ({ id: p.id, name: p.name, color: p.color, icon: p.icon })),
        toolMatrix: config.tool_matrix || null,
        timeBlocks: config.time_blocks || null,
        locSchedules: config.loc_schedules || null,
        locScheduleDefaults: config.loc_schedule_defaults || null,
        locScheduleOverrides: config.loc_schedule_overrides || null,
        hourLocationOverrides: config.hour_location_overrides || null,
        preferences: config.preferences || null
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── list_projects ──
  server.tool(
    'list_projects',
    'List all projects, optionally filtered by name. Returns project name, color, icon, and task count.',
    {
      name: z.string().optional().describe('Filter by project name (exact match)')
    },
    async ({ name }) => {
      let query = db('projects').where('user_id', userId).orderBy('sort_order');
      if (name) query = query.where('name', name);
      const projects = await query;

      // Get task counts per project
      const projectNames = projects.map(p => p.name);
      const counts = await db('tasks_v')
        .where('user_id', userId)
        .whereIn('project', projectNames)
        .groupBy('project')
        .select('project', db.raw('COUNT(*) as total'), db.raw("SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done"));

      const countMap = {};
      counts.forEach(c => { countMap[c.project] = { total: c.total, done: c.done }; });

      const result = projects.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        icon: p.icon,
        taskCount: countMap[p.name]?.total || 0,
        doneCount: countMap[p.name]?.done || 0
      }));

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
  // ── create_project ──
  server.tool(
    'create_project',
    'Create a new project with optional color and icon.',
    {
      name: z.string().describe('Project name (must be unique)'),
      color: z.string().optional().describe('Project color (e.g. "#4A90D9")'),
      icon: z.string().optional().describe('Project icon identifier')
    },
    async ({ name, color, icon }) => {
      const maxOrder = await db('projects').where('user_id', userId).max('sort_order as max').first();
      const [id] = await db('projects').insert({
        user_id: userId,
        name,
        color: color || null,
        icon: icon || null,
        sort_order: (maxOrder?.max || 0) + 1
      });

      return { content: [{ type: 'text', text: JSON.stringify({ id, name, color, icon }) }] };
    }
  );

  // ── update_project ──
  server.tool(
    'update_project',
    'Update a project name, color, or icon. Renaming a project updates all associated tasks.',
    {
      id: z.number().describe('Project ID'),
      name: z.string().optional().describe('New project name'),
      color: z.string().optional().describe('New project color'),
      icon: z.string().optional().describe('New project icon')
    },
    async ({ id, name, color, icon }) => {
      const existing = await db('projects').where({ id, user_id: userId }).first();
      if (!existing) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Project not found' }) }] };

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (color !== undefined) updates.color = color;
      if (icon !== undefined) updates.icon = icon;
      updates.updated_at = db.fn.now();

      let renamed = null;
      await db.transaction(async (trx) => {
        await trx('projects').where({ id, user_id: userId }).update(updates);
        if (name && existing.name !== name) {
          // Project is a master-level field; helper routes accordingly
          await tasksWrite.updateTasksWhere(trx, userId, function(q) {
            return q.where('project', existing.name);
          }, { project: name, updated_at: db.fn.now() });
          renamed = { from: existing.name, to: name };
        }
      });

      return { content: [{ type: 'text', text: JSON.stringify({
        project: { id, name: name || existing.name, color: color !== undefined ? color : existing.color, icon: icon !== undefined ? icon : existing.icon },
        renamed
      }) }] };
    }
  );

  // ── delete_project ──
  server.tool(
    'delete_project',
    'Delete a project. Tasks in this project are kept but lose their project association.',
    {
      id: z.number().describe('Project ID to delete')
    },
    async ({ id }) => {
      const existing = await db('projects').where({ id, user_id: userId }).first();
      if (!existing) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Project not found' }) }] };

      await db('projects').where({ id, user_id: userId }).del();
      return { content: [{ type: 'text', text: JSON.stringify({ message: 'Project deleted', id, name: existing.name }) }] };
    }
  );

  // ── update_config ──
  server.tool(
    'update_config',
    'Update a user configuration value. Valid keys: time_blocks, preferences, loc_schedules, loc_schedule_defaults, loc_schedule_overrides, hour_location_overrides, tool_matrix.',
    {
      key: z.enum(['time_blocks', 'preferences', 'loc_schedules', 'loc_schedule_defaults', 'loc_schedule_overrides', 'hour_location_overrides', 'tool_matrix']).describe('Configuration key to update'),
      value: z.any().describe('New configuration value (object or array)')
    },
    async ({ key, value }) => {
      const existing = await db('user_config').where({ user_id: userId, config_key: key }).first();

      if (existing) {
        await db('user_config').where({ user_id: userId, config_key: key }).update({
          config_value: JSON.stringify(value),
          updated_at: db.fn.now()
        });
      } else {
        await db('user_config').insert({
          user_id: userId,
          config_key: key,
          config_value: JSON.stringify(value)
        });
      }

      // Trigger reschedule for schedule-affecting keys
      const { enqueueScheduleRun } = require('../../scheduler/scheduleQueue');
      enqueueScheduleRun(userId, 'mcp:config');

      return { content: [{ type: 'text', text: JSON.stringify({ key, value }) }] };
    }
  );
}

module.exports = { registerConfigTools };
