/**
 * MCP Data & Calendar Tools — export/import and calendar sync
 */

const { z } = require('zod');
const safeStringify = require('../safeStringify');
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

      var { fetchTasksWithEventIds } = require('../../controllers/task.controller');
      var [taskRows, locationRows, toolRows, projectRows, configRows] = await Promise.all([
        fetchTasksWithEventIds(db, userId, function(q) { q.orderBy('created_at', 'asc'); }),
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

      return { content: [{ type: 'text', text: safeStringify(result) }] };
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

      return { content: [{ type: 'text', text: safeStringify({
        googleCalendar: { connected: gcalConnected, lastSyncedAt: gcalLastSynced, autoSync: autoSync },
        microsoftCalendar: { connected: msftConnected, lastSyncedAt: msftLastSynced }
      }) }] };
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
        return { content: [{ type: 'text', text: safeStringify(result) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: 'Sync error: ' + err.message }], isError: true };
      }
    }
  );
  // ── integrity_check ──
  server.tool(
    'integrity_check',
    'Scan for data integrity issues: orphaned instances, empty text, broken dependencies, impossible constraints, duplicate instances. Returns a report with counts and details.',
    {
      autoFix: z.boolean().optional().describe('If true, auto-fix safe issues (delete orphans, clear broken deps). Default: false (report only).')
    },
    async ({ autoFix }) => {
      var fix = !!autoFix;
      var issues = [];
      var fixed = [];

      // 1. Orphaned instances: source_id points to non-existent master
      var orphaned = await db('task_instances as i')
        .leftJoin('task_masters as m', 'i.master_id', 'm.id')
        .where('i.user_id', userId)
        .whereNull('m.id')
        .select('i.id', 'i.master_id');
      if (orphaned.length > 0) {
        issues.push({ type: 'orphaned_instance', count: orphaned.length, ids: orphaned.map(function(r) { return r.id; }).slice(0, 20) });
        if (fix) {
          await db('task_instances').whereIn('id', orphaned.map(function(r) { return r.id; })).del();
          fixed.push('Deleted ' + orphaned.length + ' orphaned instances');
        }
      }

      // 2. Tasks with empty/null text
      var nameless = await db('task_masters').where('user_id', userId)
        .where(function() { this.whereNull('text').orWhere('text', ''); })
        .select('id');
      if (nameless.length > 0) {
        issues.push({ type: 'empty_text', count: nameless.length, ids: nameless.map(function(r) { return r.id; }).slice(0, 20) });
      }

      // 3. Instances with split_ordinal > split_total
      var badSplit = await db('task_instances').where('user_id', userId)
        .whereRaw('split_ordinal > split_total')
        .select('id', 'split_ordinal', 'split_total');
      if (badSplit.length > 0) {
        issues.push({ type: 'split_ordinal_exceeds_total', count: badSplit.length, ids: badSplit.map(function(r) { return r.id; }).slice(0, 20) });
      }

      // 4. Orphaned calendar_sync rows (task deleted but sync record remains)
      var orphanedSync = await db('calendar_sync as cs')
        .leftJoin('task_instances as i', 'cs.task_id', 'i.id')
        .where('cs.user_id', userId)
        .whereNull('cs.deleted_at')
        .whereNull('i.id')
        .select('cs.id', 'cs.task_id', 'cs.provider');
      if (orphanedSync.length > 0) {
        issues.push({ type: 'orphaned_sync', count: orphanedSync.length, details: orphanedSync.slice(0, 20).map(function(r) { return { syncId: r.id, taskId: r.task_id, provider: r.provider }; }) });
        if (fix) {
          await db('calendar_sync').whereIn('id', orphanedSync.map(function(r) { return r.id; })).update({ deleted_at: db.fn.now() });
          fixed.push('Soft-deleted ' + orphanedSync.length + ' orphaned sync records');
        }
      }

      // 5. Duplicate active instances (same source_id + date with status='')
      var dupes = await db('task_instances').where('user_id', userId)
        .where('status', '')
        .whereNotNull('master_id')
        .whereNotNull('date')
        .groupBy('master_id', 'date')
        .havingRaw('COUNT(*) > 1')
        .select('master_id', 'date', db.raw('COUNT(*) as cnt'));
      if (dupes.length > 0) {
        issues.push({ type: 'duplicate_instances', count: dupes.length, details: dupes.slice(0, 20).map(function(r) { return { masterId: r.master_id, date: r.date, count: r.cnt }; }) });
      }

      // 6. dependsOn referencing non-existent tasks
      var allMasters = await db('task_masters').where('user_id', userId).select('id', 'depends_on');
      var masterIds = new Set(allMasters.map(function(r) { return r.id; }));
      var brokenDeps = [];
      allMasters.forEach(function(r) {
        if (!r.depends_on) return;
        var deps;
        try { deps = typeof r.depends_on === 'string' ? JSON.parse(r.depends_on) : r.depends_on; } catch(e) { return; }
        if (!Array.isArray(deps)) return;
        var broken = deps.filter(function(d) { return !masterIds.has(d); });
        if (broken.length > 0) brokenDeps.push({ taskId: r.id, brokenIds: broken });
      });
      if (brokenDeps.length > 0) {
        issues.push({ type: 'broken_dependencies', count: brokenDeps.length, details: brokenDeps.slice(0, 20) });
        if (fix) {
          for (var bi = 0; bi < brokenDeps.length; bi++) {
            var bd = brokenDeps[bi];
            var master = allMasters.find(function(m) { return m.id === bd.taskId; });
            if (!master) continue;
            var deps2;
            try { deps2 = typeof master.depends_on === 'string' ? JSON.parse(master.depends_on) : master.depends_on; } catch(e) { continue; }
            var cleaned = deps2.filter(function(d) { return masterIds.has(d); });
            await db('task_masters').where('id', bd.taskId).update({ depends_on: JSON.stringify(cleaned), updated_at: db.fn.now() });
          }
          fixed.push('Cleaned broken deps from ' + brokenDeps.length + ' tasks');
        }
      }

      // 7. Orphaned masters: non-recurring masters with no instance row
      var orphanedMasters = await db('task_masters as m')
        .leftJoin('task_instances as i', 'i.master_id', 'm.id')
        .where('m.user_id', userId)
        .where('m.recurring', 0)
        .whereNull('i.id')
        .select('m.id', 'm.text', 'm.status');
      if (orphanedMasters.length > 0) {
        issues.push({ type: 'orphaned_master', count: orphanedMasters.length, details: orphanedMasters.slice(0, 20).map(function(r) { return { id: r.id, text: r.text, status: r.status }; }) });
        if (fix) {
          // Recreate instance rows for orphaned one-off masters
          var insertRows = orphanedMasters.map(function(m) {
            return {
              id: m.id, master_id: m.id, user_id: userId,
              occurrence_ordinal: 1, split_ordinal: 1, split_total: 1,
              dur: 30, status: m.status || '',
              generated: 0, created_at: db.fn.now(), updated_at: db.fn.now()
            };
          });
          for (var oi = 0; oi < insertRows.length; oi += 50) {
            await db('task_instances').insert(insertRows.slice(oi, oi + 50));
          }
          fixed.push('Recreated ' + orphanedMasters.length + ' instance rows for orphaned masters');
        }
      }

      // 8. Impossible constraints: startAfter > deadline
      var impossible = await db('task_masters').where('user_id', userId)
        .whereNotNull('start_after_at')
        .whereNotNull('deadline')
        .whereRaw('start_after_at > deadline')
        .select('id', 'text', 'start_after_at', 'deadline');
      if (impossible.length > 0) {
        issues.push({ type: 'impossible_constraint', count: impossible.length, details: impossible.slice(0, 20).map(function(r) { return { id: r.id, text: r.text, startAfter: r.start_after_at, deadline: r.deadline }; }) });
      }

      return {
        content: [{
          type: 'text',
          text: safeStringify({
            healthy: issues.length === 0,
            issueCount: issues.length,
            issues: issues,
            fixed: fix ? fixed : undefined
          })
        }]
      };
    }
  );
}

module.exports = { registerDataTools };
