/**
 * Data Controller — Import/Export for migration from window.storage format
 */

const db = require('../db');
const tasksWrite = require('../lib/tasks-write');
const { rowToTask, taskToRow } = require('./task.controller');
const { localToUtc, toDateISO } = require('../scheduler/dateHelpers');

/**
 * POST /api/data/import
 * Import from window.storage JSON format (v7 persistAll shape)
 */
async function importData(req, res) {
  try {
    var userId = req.user.id;
    var tz = req.headers['x-timezone'] || 'America/New_York';
    var data = req.body;

    if (!data || !data.extraTasks) {
      return res.status(400).json({ error: 'Invalid import data — expected v7 format with extraTasks' });
    }
    // Safety: require explicit confirmation since import wipes all existing data
    if (req.query.confirm !== 'delete_all') {
      return res.status(400).json({ error: 'Import will DELETE all existing tasks, config, and projects. Pass ?confirm=delete_all to proceed.' });
    }

    var tasks = data.extraTasks || [];
    var statuses = data.statuses || {};
    var locations = data.locations || [];
    var tools = data.tools || [];
    var toolMatrix = data.toolMatrix || {};
    var locSchedules = data.locSchedules || {};
    var locScheduleDefaults = data.locScheduleDefaults || {};
    var locScheduleOverrides = data.locScheduleOverrides || {};
    var hourLocationOverrides = data.hourLocationOverrides || {};
    var timeBlocks = data.timeBlocks || {};
    var explicitProjects = data.projects || [];
    var preferences = {
      gridZoom: data.gridZoom || 60,
      splitDefault: data.splitDefault || false,
      splitMinDefault: data.splitMinDefault || 15,
      schedFloor: data.schedFloor || 480,
      schedCeiling: data.schedCeiling || 1380
    };

    // Deduplicate tasks by ID — keep last occurrence (newer data wins)
    var deduped = new Map();
    for (var t of tasks) {
      deduped.set(t.id, t);
    }
    var uniqueTasks = Array.from(deduped.values());

    // Merge explicit projects with names extracted from tasks
    var explicitNames = new Set(explicitProjects.map(function(p) { return p.name; }));
    var extractedNames = new Set();
    uniqueTasks.forEach(function(t) {
      if (t.project && !explicitNames.has(t.project)) extractedNames.add(t.project);
    });
    var mergedProjects = explicitProjects.concat(
      Array.from(extractedNames).map(function(name) { return { name: name, color: null, icon: null }; })
    );

    // Use a transaction for atomicity
    await db.transaction(async function(trx) {
      // Clear existing data for user
      await trx('user_config').where('user_id', userId).del();
      await trx('tools').where('user_id', userId).del();
      await trx('locations').where('user_id', userId).del();
      await trx('projects').where('user_id', userId).del();
      // Wipe all tasks for this user
      await tasksWrite.deleteTasksWhere(trx, userId, function(q) { return q; });

      // Import tasks — compute scheduled_at from date+time
      if (uniqueTasks.length > 0) {
        var taskRows = uniqueTasks.map(function(t) {
          // Resolve location: try t.location first, fall back to t.where (old format)
          var loc = t.location || t.where;
          var locationArr = Array.isArray(loc) ? loc
            : (loc && loc !== 'anywhere' ? [loc] : []);

          // Compute scheduled_at (UTC) from local date+time
          var scheduledAt = null;
          if (t.date && t.date !== 'TBD') {
            var timeStr = t.time ? String(t.time).slice(0, 20) : null;
            scheduledAt = localToUtc(t.date, timeStr || '12:00 AM', tz);
          }

          // Compute due_at and start_after_at
          var dueAt = t.due ? toDateISO(t.due) || null : null;
          var startAfterAt = (t.startAfter || t.start_after) ? toDateISO(t.startAfter || t.start_after) || null : null;

          return {
            id: t.id,
            user_id: userId,
            text: t.text || '',
            scheduled_at: scheduledAt,
            dur: t.dur || 30,
            time_remaining: t.timeRemaining != null ? t.timeRemaining : null,
            pri: t.pri || 'P3',
            project: t.project || null,
            status: statuses[t.id] || t.status || '',
            section: t.section || null,
            notes: t.notes || null,
            due_at: dueAt,
            start_after_at: startAfterAt,
            location: JSON.stringify(locationArr),
            tools: JSON.stringify(t.tools || []),
            when: t.when || null,
            day_req: t.dayReq || 'any',
            recurring: t.recurring ? 1 : 0,
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

        // Insert via helper (routes each row to master/instance + legacy tasks)
        for (var i = 0; i < taskRows.length; i++) {
          await tasksWrite.insertTask(trx, taskRows[i]);
        }
      }

      // Import locations
      if (locations.length > 0) {
        await trx('locations').insert(locations.map(function(l, i) {
          return {
            user_id: userId,
            location_id: l.id,
            name: l.name,
            icon: l.icon || '',
            sort_order: i
          };
        }));
      }

      // Import tools
      if (tools.length > 0) {
        await trx('tools').insert(tools.map(function(t, i) {
          return {
            user_id: userId,
            tool_id: t.id,
            name: t.name,
            icon: t.icon || '',
            sort_order: i
          };
        }));
      }

      // Import projects
      if (mergedProjects.length > 0) {
        await trx('projects').insert(mergedProjects.map(function(p, i) {
          return {
            user_id: userId,
            name: p.name,
            color: p.color || null,
            icon: p.icon || null,
            sort_order: i
          };
        }));
      }

      // Import config values
      var configs = [
        { key: 'tool_matrix', value: toolMatrix },
        { key: 'time_blocks', value: timeBlocks },
        { key: 'loc_schedules', value: locSchedules },
        { key: 'loc_schedule_defaults', value: locScheduleDefaults },
        { key: 'loc_schedule_overrides', value: locScheduleOverrides },
        { key: 'hour_location_overrides', value: hourLocationOverrides },
        { key: 'preferences', value: preferences }
      ];

      await trx('user_config').insert(configs.map(function(c) {
        return {
          user_id: userId,
          config_key: c.key,
          config_value: JSON.stringify(c.value)
        };
      }));
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
    var userId = req.user.id;
    var tz = req.headers['x-timezone'] || 'America/New_York';

    var { fetchTasksWithEventIds } = require('./task.controller');
    var results = await Promise.all([
      fetchTasksWithEventIds(db, userId, function(q) { q.orderBy('created_at', 'asc'); }),
      db('locations').where('user_id', userId).orderBy('sort_order'),
      db('tools').where('user_id', userId).orderBy('sort_order'),
      db('projects').where('user_id', userId).orderBy('sort_order'),
      db('user_config').where('user_id', userId)
    ]);

    var taskRows = results[0];
    var locationRows = results[1];
    var toolRows = results[2];
    var projectRows = results[3];
    var configRows = results[4];

    var tasks = taskRows.map(function(r) { return rowToTask(r, tz); });
    var statuses = {};
    tasks.forEach(function(t) {
      if (t.status) statuses[t.id] = t.status;
    });

    var config = {};
    configRows.forEach(function(row) {
      config[row.config_key] = typeof row.config_value === 'string'
        ? JSON.parse(row.config_value) : row.config_value;
    });

    var prefs = config.preferences || {};

    res.json({
      v7: true,
      extraTasks: tasks,
      statuses: statuses,
      locations: locationRows.map(function(l) { return { id: l.location_id, name: l.name, icon: l.icon }; }),
      tools: toolRows.map(function(t) { return { id: t.tool_id, name: t.name, icon: t.icon }; }),
      projects: projectRows.map(function(p) { return { id: p.id, name: p.name, color: p.color, icon: p.icon }; }),
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
      schedCeiling: prefs.schedCeiling || 1380,
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
