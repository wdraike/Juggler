/**
 * MCP Data & Calendar Tools — export/import and calendar sync
 */

const { z } = require('zod');
const db = require('../../db');
const { rowToTask } = require('../../controllers/task.controller');

function registerDataTools(server, userId) {

  // Helper: get user timezone
  async function getUserTimezone() {
    var user = await db('users').where('id', userId).select('timezone').first();
    return (user && user.timezone) || 'America/New_York';
  }

  // ── export_data ──
  server.tool(
    'export_data',
    'Export all user data as JSON (tasks, projects, locations, tools, config). Useful for backups.',
    {},
    async () => {
      var tz = await getUserTimezone();

      var [taskRows, locationRows, toolRows, projectRows, configRows] = await Promise.all([
        db('tasks').where('user_id', userId).orderBy('created_at', 'asc'),
        db('locations').where('user_id', userId).orderBy('sort_order'),
        db('tools').where('user_id', userId).orderBy('sort_order'),
        db('projects').where('user_id', userId).orderBy('sort_order'),
        db('user_config').where('user_id', userId)
      ]);

      var tasks = taskRows.map(function(r) { return rowToTask(r, tz); });
      var config = {};
      configRows.forEach(function(row) {
        config[row.config_key] = typeof row.config_value === 'string'
          ? JSON.parse(row.config_value) : row.config_value;
      });

      var result = {
        tasks: tasks,
        locations: locationRows.map(function(l) { return { id: l.location_id, name: l.name, icon: l.icon }; }),
        tools: toolRows.map(function(t) { return { id: t.tool_id, name: t.name, icon: t.icon }; }),
        projects: projectRows.map(function(p) { return { id: p.id, name: p.name, color: p.color, icon: p.icon }; }),
        config: config,
        exported: new Date().toISOString()
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── get_calendar_status ──
  server.tool(
    'get_calendar_status',
    'Check Google Calendar and Microsoft Calendar connection status, last sync time, and auto-sync settings.',
    {},
    async () => {
      var user = await db('users').where('id', userId).first();

      var gcalConnected = !!(user && user.gcal_refresh_token);
      var gcalLastSynced = (user && user.gcal_last_synced_at) || null;
      var msftConnected = !!(user && user.msft_cal_refresh_token);
      var msftLastSynced = (user && user.msft_cal_last_synced_at) || null;

      var autoSyncRow = await db('user_config')
        .where({ user_id: userId, config_key: 'auto_sync' })
        .first();
      var autoSync = autoSyncRow
        ? (typeof autoSyncRow.config_value === 'string' ? JSON.parse(autoSyncRow.config_value) : autoSyncRow.config_value)
        : null;

      return { content: [{ type: 'text', text: JSON.stringify({
        googleCalendar: { connected: gcalConnected, lastSyncedAt: gcalLastSynced, autoSync: autoSync },
        microsoftCalendar: { connected: msftConnected, lastSyncedAt: msftLastSynced }
      }, null, 2) }] };
    }
  );

  // ── sync_calendar ──
  server.tool(
    'sync_calendar',
    'Trigger a calendar sync (push local changes to calendar and pull remote changes). Syncs all connected calendar providers via the unified sync engine.',
    {},
    async () => {
      var user = await db('users').where('id', userId).first();
      if (!user) {
        return { content: [{ type: 'text', text: 'Error: User not found' }], isError: true };
      }

      if (!user.gcal_refresh_token && !user.msft_cal_refresh_token) {
        return { content: [{ type: 'text', text: 'No calendar provider connected. Connect Google or Microsoft Calendar in the app first.' }] };
      }

      try {
        var calSyncController = require('../../controllers/cal-sync.controller');
        var result = await new Promise(function(resolve, reject) {
          var fakeReq = { user: user };
          var fakeRes = {
            json: function(data) { resolve(data); },
            status: function(code) { return { json: function(data) { reject(new Error(data.error || 'Sync failed')); } }; }
          };
          calSyncController.sync(fakeReq, fakeRes);
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: 'Sync error: ' + err.message }], isError: true };
      }
    }
  );
}

module.exports = { registerDataTools };
