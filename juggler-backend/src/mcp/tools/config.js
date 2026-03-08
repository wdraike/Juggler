/**
 * MCP Config Tools — expose user config as MCP tools
 */

const { z } = require('zod');
const db = require('../../db');

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
        const val = typeof row.config_value === 'string' ? JSON.parse(row.config_value) : row.config_value;
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
      const counts = await db('tasks')
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
}

module.exports = { registerConfigTools };
