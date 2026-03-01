/**
 * Data Controller — Import/Export for migration from window.storage format
 */

const db = require('../db');
const { rowToTask } = require('./task.controller');

/**
 * POST /api/data/import
 * Import from window.storage JSON format (v7 persistAll shape)
 */
async function importData(req, res) {
  try {
    const userId = req.user.id;
    const data = req.body;

    if (!data || !data.extraTasks) {
      return res.status(400).json({ error: 'Invalid import data — expected v7 format with extraTasks' });
    }

    const tasks = data.extraTasks || [];
    const statuses = data.statuses || {};
    const directions = data.directions || {};
    const locations = data.locations || [];
    const tools = data.tools || [];
    const toolMatrix = data.toolMatrix || {};
    const locSchedules = data.locSchedules || {};
    const locScheduleDefaults = data.locScheduleDefaults || {};
    const locScheduleOverrides = data.locScheduleOverrides || {};
    const hourLocationOverrides = data.hourLocationOverrides || {};
    const timeBlocks = data.timeBlocks || {};
    const explicitProjects = data.projects || [];
    const preferences = {
      gridZoom: data.gridZoom || 60,
      splitDefault: data.splitDefault || false,
      splitMinDefault: data.splitMinDefault || 15,
      schedFloor: data.schedFloor || 480
    };

    // Deduplicate tasks by ID — keep last occurrence (newer data wins)
    const deduped = new Map();
    for (const t of tasks) {
      deduped.set(t.id, t);
    }
    const uniqueTasks = Array.from(deduped.values());

    // Merge explicit projects with names extracted from tasks (before transaction so it's in scope for response)
    const explicitNames = new Set(explicitProjects.map(p => p.name));
    const extractedNames = new Set();
    uniqueTasks.forEach(t => {
      if (t.project && !explicitNames.has(t.project)) extractedNames.add(t.project);
    });
    const mergedProjects = [
      ...explicitProjects,
      ...Array.from(extractedNames).map(name => ({ name, color: null, icon: null }))
    ];

    // Use a transaction for atomicity
    await db.transaction(async (trx) => {
      // Clear existing data for user
      await trx('user_config').where('user_id', userId).del();
      await trx('tools').where('user_id', userId).del();
      await trx('locations').where('user_id', userId).del();
      await trx('projects').where('user_id', userId).del();
      await trx('tasks').where('user_id', userId).del();

      // Import tasks — merge status/direction into each task
      if (uniqueTasks.length > 0) {
        const taskRows = uniqueTasks.map(t => {
          // Resolve location: try t.location first, fall back to t.where (old format)
          const loc = t.location || t.where;
          const locationArr = Array.isArray(loc) ? loc
            : (loc && loc !== 'anywhere' ? [loc] : []);

          return {
            id: t.id,
            user_id: userId,
            text: t.text || '',
            date: t.date || null,
            day: t.day || null,
            time: t.time ? String(t.time).slice(0, 20) : null,
            dur: t.dur || 30,
            time_remaining: t.timeRemaining != null ? t.timeRemaining : null,
            pri: t.pri || 'P3',
            project: t.project || null,
            status: statuses[t.id] || t.status || '',
            direction: directions[t.id] || t.direction || null,
            section: t.section || null,
            notes: t.notes || null,
            due: t.due || null,
            start_after: t.startAfter || null,
            location: JSON.stringify(locationArr),
            tools: JSON.stringify(t.tools || []),
            when: t.when || null,
            day_req: t.dayReq || 'any',
            habit: t.habit ? 1 : 0,
            rigid: t.rigid ? 1 : 0,
            split: t.split === undefined || t.split === null ? null : (t.split ? 1 : 0),
            split_min: t.splitMin || null,
            recur: t.recur ? JSON.stringify(t.recur) : null,
            source_id: t.sourceId || null,
            generated: t.generated ? 1 : 0,
            gcal_event_id: t.gcalEventId || null,
            depends_on: JSON.stringify(t.dependsOn || []),
            created_at: trx.fn.now(),
            updated_at: trx.fn.now()
          };
        });

        // Insert in chunks
        const chunkSize = 100;
        for (let i = 0; i < taskRows.length; i += chunkSize) {
          await trx('tasks').insert(taskRows.slice(i, i + chunkSize));
        }
      }

      // Import locations
      if (locations.length > 0) {
        await trx('locations').insert(locations.map((l, i) => ({
          user_id: userId,
          location_id: l.id,
          name: l.name,
          icon: l.icon || '',
          sort_order: i
        })));
      }

      // Import tools
      if (tools.length > 0) {
        await trx('tools').insert(tools.map((t, i) => ({
          user_id: userId,
          tool_id: t.id,
          name: t.name,
          icon: t.icon || '',
          sort_order: i
        })));
      }

      // Import projects
      if (mergedProjects.length > 0) {
        await trx('projects').insert(mergedProjects.map((p, i) => ({
          user_id: userId,
          name: p.name,
          color: p.color || null,
          icon: p.icon || null,
          sort_order: i
        })));
      }

      // Import config values
      const configs = [
        { key: 'tool_matrix', value: toolMatrix },
        { key: 'time_blocks', value: timeBlocks },
        { key: 'loc_schedules', value: locSchedules },
        { key: 'loc_schedule_defaults', value: locScheduleDefaults },
        { key: 'loc_schedule_overrides', value: locScheduleOverrides },
        { key: 'hour_location_overrides', value: hourLocationOverrides },
        { key: 'preferences', value: preferences }
      ];

      await trx('user_config').insert(configs.map(c => ({
        user_id: userId,
        config_key: c.key,
        config_value: JSON.stringify(c.value)
      })));
    });

    res.json({
      message: 'Import successful',
      counts: {
        tasks: uniqueTasks.length,
        duplicatesRemoved: tasks.length - uniqueTasks.length,
        locations: locations.length,
        tools: tools.length,
        projects: mergedProjects.length
      }
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: 'Import failed', message: error.message });
  }
}

/**
 * GET /api/data/export
 * Export all data as JSON (compatible with window.storage format for round-trip)
 */
async function exportData(req, res) {
  try {
    const userId = req.user.id;

    const [taskRows, locationRows, toolRows, projectRows, configRows] = await Promise.all([
      db('tasks').where('user_id', userId).orderBy('created_at', 'asc'),
      db('locations').where('user_id', userId).orderBy('sort_order'),
      db('tools').where('user_id', userId).orderBy('sort_order'),
      db('projects').where('user_id', userId).orderBy('sort_order'),
      db('user_config').where('user_id', userId)
    ]);

    const tasks = taskRows.map(rowToTask);
    const statuses = {};
    const directions = {};
    tasks.forEach(t => {
      if (t.status) statuses[t.id] = t.status;
      if (t.direction) directions[t.id] = t.direction;
    });

    const config = {};
    configRows.forEach(row => {
      config[row.config_key] = typeof row.config_value === 'string'
        ? JSON.parse(row.config_value) : row.config_value;
    });

    const prefs = config.preferences || {};

    res.json({
      v7: true,
      extraTasks: tasks,
      statuses,
      directions,
      locations: locationRows.map(l => ({ id: l.location_id, name: l.name, icon: l.icon })),
      tools: toolRows.map(t => ({ id: t.tool_id, name: t.name, icon: t.icon })),
      projects: projectRows.map(p => ({ id: p.id, name: p.name, color: p.color, icon: p.icon })),
      toolMatrix: config.tool_matrix || {},
      timeBlocks: config.time_blocks || {},
      locSchedules: config.loc_schedules || {},
      locScheduleDefaults: config.loc_schedule_defaults || {},
      locScheduleOverrides: config.loc_schedule_overrides || {},
      hourLocationOverrides: config.hour_location_overrides || {},
      gridZoom: prefs.gridZoom || 60,
      splitDefault: prefs.splitDefault || false,
      splitMinDefault: prefs.splitMinDefault || 15,
      schedFloor: prefs.schedFloor || 480,
      updated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Export failed' });
  }
}

module.exports = {
  importData,
  exportData
};
