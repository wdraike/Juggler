/**
 * Config Controller — locations, tools, matrix, time blocks, schedules, preferences, projects
 */

const db = require('../db');
const tasksWrite = require('../lib/tasks-write');
const { enqueueScheduleRun } = require('../scheduler/scheduleQueue');
const cache = require('../lib/redis');

/**
 * GET /api/config — all config for user
 */
async function getAllConfig(req, res) {
  try {
    const userId = req.user.id;
    const cacheKey = `user:${userId}:config`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

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
      preferences: config.preferences || null,
      scheduleTemplates: config.schedule_templates || null,
      templateDefaults: config.template_defaults || null,
      templateOverrides: config.template_overrides || null
    };
    await cache.set(cacheKey, result, 3600); // 1 hour TTL
    res.json(result);
  } catch (error) {
    console.error('Get config error:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
}

/**
 * PUT /api/config/:key — update specific config key
 */
async function updateConfig(req, res) {
  try {
    const userId = req.user.id;
    const { key } = req.params;
    const { value } = req.body;

    const validKeys = [
      'tool_matrix', 'time_blocks', 'loc_schedules',
      'loc_schedule_defaults', 'loc_schedule_overrides',
      'hour_location_overrides', 'preferences',
      'schedule_templates', 'template_defaults', 'template_overrides',
      'cal_sync_settings'
    ];

    if (!validKeys.includes(key)) {
      return res.status(400).json({ error: `Invalid config key: ${key}` });
    }

    // Prevent DoS via oversized config values
    const serialized = JSON.stringify(value);
    if (serialized.length > 102400) { // 100KB max
      return res.status(400).json({ error: 'Config value too large (max 100KB)' });
    }

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

    await cache.invalidateConfig(userId);

    // Check for orphaned when-tags when templates are saved
    var warnings = [];
    if (key === 'schedule_templates' && value && typeof value === 'object') {
      var newTags = {};
      Object.values(value).forEach(function(tmpl) {
        (tmpl.blocks || []).forEach(function(b) {
          if (b.tag) newTags[b.tag] = true;
        });
      });

      var activeTasks = await db('tasks_v')
        .where('user_id', userId)
        .whereNotIn('status', ['done', 'cancel', 'skip', 'pause'])
        .whereNotNull('when')
        .where('when', '!=', '')
        .where('when', '!=', 'anytime')
        .select('id', 'text', 'when');

      var orphanedTasks = [];
      activeTasks.forEach(function(t) {
        var parts = (t.when || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        // Skip special values
        var nonSpecial = parts.filter(function(p) { return p !== 'fixed' && p !== 'allday' && p !== 'anytime'; });
        if (nonSpecial.length === 0) return;
        var hasValid = nonSpecial.some(function(p) { return newTags[p]; });
        if (!hasValid) {
          orphanedTasks.push({ id: t.id, text: t.text, when: t.when });
        }
      });

      if (orphanedTasks.length > 0) {
        warnings.push({
          type: 'orphanedWhenTags',
          tasks: orphanedTasks,
          message: orphanedTasks.length + ' task(s) use time block tags that no longer exist in any template'
        });
      }
    }

    res.json({ key, value, warnings: warnings });

    // Schedule-affecting keys: reschedule in the background after responding
    var schedKeys = [
      'hour_location_overrides', 'time_blocks', 'loc_schedules',
      'loc_schedule_defaults', 'loc_schedule_overrides', 'tool_matrix', 'preferences',
      'schedule_templates'
    ];
    if (schedKeys.includes(key)) {
      enqueueScheduleRun(userId, 'config:' + key);
    }
  } catch (error) {
    console.error('Update config error:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
}

// ── Projects ──

async function getProjects(req, res) {
  try {
    const rows = await db('projects').where('user_id', req.user.id).orderBy('sort_order');
    res.json({ projects: rows.map(p => ({ id: p.id, name: p.name, color: p.color, icon: p.icon })) });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
}

async function createProject(req, res) {
  try {
    const { name, color, icon } = req.body;
    if (!name) return res.status(400).json({ error: 'Project name required' });

    const maxOrder = await db('projects').where('user_id', req.user.id).max('sort_order as max').first();
    const [id] = await db('projects').insert({
      user_id: req.user.id,
      name,
      color: color || null,
      icon: icon || null,
      sort_order: (maxOrder?.max || 0) + 1
    });

    await cache.invalidateConfig(req.user.id);
    res.status(201).json({ project: { id, name, color, icon } });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
}

async function updateProject(req, res) {
  try {
    const { id } = req.params;
    const { name, color, icon, oldName } = req.body;

    await db.transaction(async (trx) => {
      await trx('projects').where({ id, user_id: req.user.id }).update({
        name, color, icon, updated_at: db.fn.now()
      });
      // If the name changed, rename the project on all tasks that reference it
      if (oldName && name && oldName !== name) {
        await tasksWrite.updateTasksWhere(trx, req.user.id, function(q) {
          return q.where('project', oldName);
        }, { project: name, updated_at: db.fn.now() });
      }
    });

    await cache.invalidateConfig(req.user.id);
    if (oldName && name && oldName !== name) await cache.invalidateTasks(req.user.id); // project rename cascades to tasks
    res.json({ project: { id: parseInt(id), name, color, icon }, renamed: oldName && name && oldName !== name ? { from: oldName, to: name } : null });
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
}

async function deleteProject(req, res) {
  try {
    const { id } = req.params;
    await db('projects').where({ id, user_id: req.user.id }).del();
    await cache.invalidateConfig(req.user.id);
    res.json({ message: 'Project deleted', id });
  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
}

// ── Locations ──

async function getLocations(req, res) {
  try {
    const rows = await db('locations').where('user_id', req.user.id).orderBy('sort_order');
    res.json({ locations: rows.map(l => ({ id: l.location_id, name: l.name, icon: l.icon })) });
  } catch (error) {
    console.error('Get locations error:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
}

async function replaceLocations(req, res) {
  try {
    const { locations } = req.body;
    if (!Array.isArray(locations)) return res.status(400).json({ error: 'Locations array required' });

    await db.transaction(async (trx) => {
      await trx('locations').where('user_id', req.user.id).del();
      if (locations.length > 0) {
        await trx('locations').insert(locations.map((l, i) => ({
          user_id: req.user.id,
          location_id: l.id,
          name: l.name,
          icon: l.icon || '',
          sort_order: i
        })));
      }
    });

    await cache.invalidateConfig(req.user.id);
    res.json({ locations });
  } catch (error) {
    console.error('Replace locations error:', error);
    res.status(500).json({ error: 'Failed to update locations' });
  }
}

// ── Tools ──

async function getTools(req, res) {
  try {
    const rows = await db('tools').where('user_id', req.user.id).orderBy('sort_order');
    res.json({ tools: rows.map(t => ({ id: t.tool_id, name: t.name, icon: t.icon })) });
  } catch (error) {
    console.error('Get tools error:', error);
    res.status(500).json({ error: 'Failed to fetch tools' });
  }
}

async function replaceTools(req, res) {
  try {
    const { tools } = req.body;
    if (!Array.isArray(tools)) return res.status(400).json({ error: 'Tools array required' });

    await db.transaction(async (trx) => {
      await trx('tools').where('user_id', req.user.id).del();
      if (tools.length > 0) {
        await trx('tools').insert(tools.map((t, i) => ({
          user_id: req.user.id,
          tool_id: t.id,
          name: t.name,
          icon: t.icon || '',
          sort_order: i
        })));
      }
    });

    await cache.invalidateConfig(req.user.id);
    res.json({ tools });
  } catch (error) {
    console.error('Replace tools error:', error);
    res.status(500).json({ error: 'Failed to update tools' });
  }
}

module.exports = {
  getAllConfig,
  updateConfig,
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  getLocations,
  replaceLocations,
  getTools,
  replaceTools
};
