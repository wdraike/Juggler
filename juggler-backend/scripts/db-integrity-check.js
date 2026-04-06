#!/usr/bin/env node
/**
 * Database Integrity Check — audits all data for orphans, invalid values,
 * broken references, and inconsistent state.
 *
 * Usage:
 *   node scripts/db-integrity-check.js          # report only
 *   node scripts/db-integrity-check.js --fix    # report + fix issues
 */

require('dotenv').config();
var db = require('../src/db');

var FIX = process.argv.includes('--fix');
var issues = [];
var fixed = [];

function issue(category, msg, data) {
  issues.push({ category: category, msg: msg, data: data });
}

function log(msg) { console.log(msg); }

async function run() {
  log('=== Juggler Database Integrity Check ===');
  log('Mode: ' + (FIX ? 'REPORT + FIX' : 'REPORT ONLY'));
  log('');

  var allTasks = await db('tasks').select();
  var taskById = {};
  allTasks.forEach(function(t) { taskById[t.id] = t; });
  var allUsers = await db('users').select('id');
  var userIds = {};
  allUsers.forEach(function(u) { userIds[u.id] = true; });
  var allProjects = await db('projects').select('user_id', 'name');
  var projectSet = {};
  allProjects.forEach(function(p) { projectSet[p.user_id + ':' + p.name] = true; });

  // ── 1. Orphaned recurring instances (source_id → missing task) ──
  log('1. Checking orphaned recurring instances...');
  var orphans = allTasks.filter(function(t) {
    return t.source_id && !taskById[t.source_id];
  });
  orphans.forEach(function(t) {
    issue('orphan', 'Instance ' + t.id + ' references missing source ' + t.source_id, t);
  });
  if (FIX && orphans.length > 0) {
    var ids = orphans.map(function(t) { return t.id; });
    await db('tasks').whereIn('id', ids).del();
    fixed.push('Deleted ' + ids.length + ' orphaned instances');
  }

  // ── 2. Invalid task_type ──
  log('2. Checking task_type values...');
  var validTypes = ['task', 'recurring_template', 'recurring_instance'];
  allTasks.forEach(function(t) {
    if (validTypes.indexOf(t.task_type) < 0) {
      issue('task_type', 'Task ' + t.id + ' has invalid task_type: ' + t.task_type, t);
    }
  });

  // ── 3. Invalid status ──
  log('3. Checking status values...');
  var validStatuses = ['', 'done', 'wip', 'cancel', 'skip', 'pause', 'disabled'];
  allTasks.forEach(function(t) {
    var st = t.status || '';
    if (validStatuses.indexOf(st) < 0) {
      issue('status', 'Task ' + t.id + ' has invalid status: "' + st + '"', t);
    }
  });

  // ── 4. Invalid pri ──
  log('4. Checking pri values...');
  var validPri = ['P1', 'P2', 'P3', 'P4'];
  allTasks.forEach(function(t) {
    if (t.pri && validPri.indexOf(t.pri) < 0) {
      issue('pri', 'Task ' + t.id + ' has invalid pri: "' + t.pri + '"', t);
    }
  });

  // ── 5. recurring_instance without proper task_type ──
  log('5. Checking instances have correct task_type...');
  allTasks.forEach(function(t) {
    if (t.source_id && t.task_type !== 'recurring_instance') {
      issue('type_mismatch', 'Task ' + t.id + ' has source_id but task_type=' + t.task_type, t);
    }
  });

  // ── 6. recurring=1 but task_type='task' ──
  log('6. Checking recurring flag vs task_type...');
  allTasks.forEach(function(t) {
    if (t.recurring && t.task_type === 'task' && !t.source_id) {
      issue('recurring_flag', 'Task ' + t.id + ' (' + (t.text || '').substring(0, 40) + ') has recurring=1 but task_type=task', t);
    }
  });
  if (FIX) {
    var badRecurring = allTasks.filter(function(t) { return t.recurring && t.task_type === 'task' && !t.source_id; });
    if (badRecurring.length > 0) {
      await db('tasks').whereIn('id', badRecurring.map(function(t) { return t.id; })).update({ recurring: 0 });
      fixed.push('Cleared recurring flag on ' + badRecurring.length + ' plain tasks');
    }
  }

  // ── 7. depends_on referencing non-existent tasks ──
  log('7. Checking dependency references...');
  allTasks.forEach(function(t) {
    var deps = [];
    try { deps = typeof t.depends_on === 'string' ? JSON.parse(t.depends_on || '[]') : (t.depends_on || []); } catch (e) { return; }
    if (!Array.isArray(deps)) return;
    deps.forEach(function(depId) {
      if (!taskById[depId]) {
        issue('broken_dep', 'Task ' + t.id + ' depends on non-existent task ' + depId, t);
      }
    });
  });
  if (FIX) {
    var depsToFix = allTasks.filter(function(t) {
      var deps = [];
      try { deps = typeof t.depends_on === 'string' ? JSON.parse(t.depends_on || '[]') : (t.depends_on || []); } catch (e) { return false; }
      if (!Array.isArray(deps)) return false;
      return deps.some(function(d) { return !taskById[d]; });
    });
    for (var i = 0; i < depsToFix.length; i++) {
      var t = depsToFix[i];
      var deps = typeof t.depends_on === 'string' ? JSON.parse(t.depends_on) : t.depends_on;
      var cleaned = deps.filter(function(d) { return taskById[d]; });
      await db('tasks').where('id', t.id).update({ depends_on: JSON.stringify(cleaned) });
    }
    if (depsToFix.length > 0) fixed.push('Cleaned broken deps on ' + depsToFix.length + ' tasks');
  }

  // ── 8. cal_sync_ledger with missing task_id ──
  log('8. Checking cal_sync_ledger references...');
  var ledgerRows = await db('cal_sync_ledger').whereNotNull('task_id').where('status', 'active').select('id', 'task_id');
  ledgerRows.forEach(function(r) {
    if (!taskById[r.task_id]) {
      issue('cal_sync_orphan', 'cal_sync_ledger #' + r.id + ' references missing task ' + r.task_id, r);
    }
  });
  if (FIX) {
    var badLedger = ledgerRows.filter(function(r) { return !taskById[r.task_id]; });
    if (badLedger.length > 0) {
      await db('cal_sync_ledger').whereIn('id', badLedger.map(function(r) { return r.id; }))
        .update({ task_id: null, status: 'deleted_local', synced_at: db.fn.now() });
      fixed.push('Cleared ' + badLedger.length + ' orphaned cal_sync_ledger entries');
    }
  }

  // ── 9. preferred_time=1 but preferred_time_mins is null ──
  log('9. Checking Time Window mode completeness...');
  allTasks.forEach(function(t) {
    if (t.preferred_time === 1 && t.task_type === 'recurring_template' && t.preferred_time_mins == null) {
      issue('time_window_no_mins', 'Template ' + t.id + ' (' + (t.text || '').substring(0, 40) + ') has preferred_time=1 but no preferred_time_mins', t);
    }
  });

  // ── 10. preferred_time=1 with time_flex null ──
  allTasks.forEach(function(t) {
    if (t.preferred_time === 1 && t.task_type === 'recurring_template' && t.time_flex == null) {
      issue('time_window_no_flex', 'Template ' + t.id + ' (' + (t.text || '').substring(0, 40) + ') has preferred_time=1 but no time_flex', t);
    }
  });

  // ── 11. preferred_time_mins out of range ──
  log('10. Checking value ranges...');
  allTasks.forEach(function(t) {
    if (t.preferred_time_mins != null && (t.preferred_time_mins < 0 || t.preferred_time_mins > 1439)) {
      issue('range', 'Task ' + t.id + ' preferred_time_mins=' + t.preferred_time_mins + ' (valid: 0-1439)', t);
    }
  });

  // ── 12. time_flex out of range ──
  allTasks.forEach(function(t) {
    if (t.time_flex != null && (t.time_flex < 0 || t.time_flex > 480)) {
      issue('range', 'Task ' + t.id + ' time_flex=' + t.time_flex + ' (valid: 0-480)', t);
    }
  });

  // ── 13. dur out of range ──
  allTasks.forEach(function(t) {
    if (t.dur != null && (t.dur <= 0 || t.dur > 1440)) {
      issue('range', 'Task ' + t.id + ' dur=' + t.dur + ' (valid: 1-1440)', t);
    }
  });

  // ── 14. Tasks with non-existent user_id ──
  log('11. Checking user references...');
  allTasks.forEach(function(t) {
    if (!userIds[t.user_id]) {
      issue('no_user', 'Task ' + t.id + ' references non-existent user ' + t.user_id, t);
    }
  });

  // ── 15. Tasks referencing projects that don't exist ──
  log('12. Checking project references...');
  allTasks.forEach(function(t) {
    if (t.project && !projectSet[t.user_id + ':' + t.project]) {
      issue('no_project', 'Task ' + t.id + ' references project "' + t.project + '" not in projects table', t);
    }
  });

  // ── 16. Invalid JSON columns ──
  log('13. Checking JSON column validity...');
  var jsonCols = ['location', 'tools', 'depends_on', 'recur'];
  allTasks.forEach(function(t) {
    jsonCols.forEach(function(col) {
      if (t[col] == null || t[col] === '') return;
      if (typeof t[col] === 'object') return; // already parsed by driver
      try { JSON.parse(t[col]); } catch (e) {
        issue('bad_json', 'Task ' + t.id + ' has invalid JSON in ' + col + ': ' + String(t[col]).substring(0, 50), t);
      }
    });
  });

  // ── 17. Terminal status with unscheduled=1 ──
  log('14. Checking terminal status consistency...');
  allTasks.forEach(function(t) {
    var st = t.status || '';
    if ((st === 'done' || st === 'cancel' || st === 'skip') && t.unscheduled) {
      issue('terminal_unscheduled', 'Task ' + t.id + ' is ' + st + ' but unscheduled=1', t);
    }
  });
  if (FIX) {
    var termUnsch = allTasks.filter(function(t) {
      var st = t.status || '';
      return (st === 'done' || st === 'cancel' || st === 'skip') && t.unscheduled;
    });
    if (termUnsch.length > 0) {
      await db('tasks').whereIn('id', termUnsch.map(function(t) { return t.id; })).update({ unscheduled: null });
      fixed.push('Cleared unscheduled on ' + termUnsch.length + ' terminal-status tasks');
    }
  }

  // ── 18. recurring_template with non-null scheduled_at (should use preferred_time_mins) ──
  log('15. Checking template scheduled_at...');
  allTasks.forEach(function(t) {
    if (t.task_type === 'recurring_template' && t.scheduled_at && t.preferred_time_mins != null) {
      issue('template_scheduled_at', 'Template ' + t.id + ' (' + (t.text || '').substring(0, 40) + ') has both scheduled_at and preferred_time_mins — scheduled_at is redundant', t);
    }
  });

  // ── 19. Instances with source_id pointing to non-template ──
  log('16. Checking source_id points to templates...');
  allTasks.forEach(function(t) {
    if (t.source_id && taskById[t.source_id]) {
      var src = taskById[t.source_id];
      if (src.task_type !== 'recurring_template') {
        issue('source_not_template', 'Instance ' + t.id + ' source ' + t.source_id + ' has task_type=' + src.task_type + ' (expected recurring_template)', t);
      }
    }
  });

  // ── 20. Recurring instances with recurring=0 ──
  log('17. Checking recurring flag on instances...');
  allTasks.forEach(function(t) {
    if (t.task_type === 'recurring_instance' && !t.recurring) {
      issue('instance_not_recurring', 'Instance ' + t.id + ' has task_type=recurring_instance but recurring=0', t);
    }
  });

  // ── 21. Templates with recurring=0 ──
  allTasks.forEach(function(t) {
    if (t.task_type === 'recurring_template' && !t.recurring) {
      issue('template_not_recurring', 'Template ' + t.id + ' (' + (t.text || '').substring(0, 40) + ') has task_type=recurring_template but recurring=0', t);
    }
  });

  // ── 22. Duplicate instances (same source_id + same scheduled date) ──
  log('18. Checking for duplicate instances...');
  var instancesBySourceDate = {};
  allTasks.forEach(function(t) {
    if (t.task_type !== 'recurring_instance' || !t.source_id || !t.scheduled_at) return;
    var dateKey = t.source_id + ':' + String(t.scheduled_at).substring(0, 10);
    if (!instancesBySourceDate[dateKey]) instancesBySourceDate[dateKey] = [];
    instancesBySourceDate[dateKey].push(t);
  });
  Object.keys(instancesBySourceDate).forEach(function(key) {
    var group = instancesBySourceDate[key];
    if (group.length > 1) {
      var activeCount = group.filter(function(t) { return !t.status || t.status === ''; }).length;
      if (activeCount > 1) {
        issue('dup_instance', activeCount + ' active instances for ' + key + ': ' + group.map(function(t) { return t.id; }).join(', '));
      }
    }
  });

  // ── 23. Non-recurring tasks with recur JSON (would be re-expanded) ──
  log('19. Checking recur JSON on non-recurring tasks...');
  allTasks.forEach(function(t) {
    if (t.task_type === 'task' && !t.recurring && t.recur) {
      var recur = typeof t.recur === 'string' ? JSON.parse(t.recur) : t.recur;
      if (recur && recur.type && recur.type !== 'none') {
        issue('stale_recur', 'Task ' + t.id + ' (' + (t.text || '').substring(0, 40) + ') has task_type=task but recur=' + JSON.stringify(recur) + ' — will be re-expanded by scheduler', t);
      }
    }
  });
  if (FIX) {
    var staleRecur = allTasks.filter(function(t) {
      if (t.task_type !== 'task' || t.recurring) return false;
      var recur = typeof t.recur === 'string' ? JSON.parse(t.recur) : t.recur;
      return recur && recur.type && recur.type !== 'none';
    });
    if (staleRecur.length > 0) {
      await db('tasks').whereIn('id', staleRecur.map(function(t) { return t.id; })).update({ recur: null });
      fixed.push('Cleared stale recur JSON on ' + staleRecur.length + ' non-recurring tasks');
    }
  }

  // ── Report ──
  log('');
  log('=== RESULTS ===');
  log('Total tasks: ' + allTasks.length);
  log('Issues found: ' + issues.length);

  if (issues.length > 0) {
    // Group by category
    var byCategory = {};
    issues.forEach(function(i) {
      if (!byCategory[i.category]) byCategory[i.category] = [];
      byCategory[i.category].push(i);
    });
    Object.keys(byCategory).forEach(function(cat) {
      var items = byCategory[cat];
      log('');
      log('  [' + cat.toUpperCase() + '] (' + items.length + ')');
      items.forEach(function(i) {
        log('    - ' + i.msg);
      });
    });
  } else {
    log('  No issues found!');
  }

  if (FIX && fixed.length > 0) {
    log('');
    log('=== FIXES APPLIED ===');
    fixed.forEach(function(f) { log('  ✓ ' + f); });
  }

  log('');
  await db.destroy();
}

run().catch(function(err) {
  console.error('FATAL:', err);
  process.exit(1);
});
