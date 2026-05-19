/**
 * heal-stale-pending-tasks.js
 *
 * One-shot fix for incomplete one-off tasks whose scheduled_at has passed
 * without a scheduler re-run being triggered. Root cause: computeNextTaskEnd
 * in useTaskState.js previously only watched status='active' tasks, so pending
 * tasks never armed the nudge timer.
 *
 * Finds distinct users with stale pending task_instances (non-recurring,
 * scheduled_at < NOW, status='') and runs the scheduler for each one.
 *
 * Usage: node scripts/heal-stale-pending-tasks.js [--dry-run]
 */
var db = require('../src/db');
var { runScheduleAndPersist } = require('../src/scheduler/runSchedule');

var DRY_RUN = process.argv.includes('--dry-run');

(async function() {
  console.log('heal-stale-pending-tasks' + (DRY_RUN ? ' [DRY RUN]' : ''));

  var rows = await db('task_instances as ti')
    .join('task_masters as tm', 'ti.master_id', 'tm.id')
    .where('ti.status', '')
    .whereNotNull('ti.scheduled_at')
    .where('ti.scheduled_at', '<', db.fn.now())
    .where('tm.recurring', false)
    .whereNull('tm.disabled_at')
    .distinct('ti.user_id')
    .select('ti.user_id');

  var userIds = rows.map(function(r) { return r.user_id; });
  console.log('Users with stale pending tasks: ' + userIds.length);

  if (userIds.length === 0) {
    console.log('Nothing to heal.');
    await db.destroy();
    return;
  }

  userIds.forEach(function(id) { console.log('  ' + id); });

  if (DRY_RUN) {
    console.log('\nDry run — no scheduler runs fired.');
    await db.destroy();
    return;
  }

  var ok = 0, fail = 0;
  for (var i = 0; i < userIds.length; i++) {
    var userId = userIds[i];
    try {
      await runScheduleAndPersist(userId);
      console.log('[' + (i + 1) + '/' + userIds.length + '] OK  ' + userId);
      ok++;
    } catch (e) {
      console.error('[' + (i + 1) + '/' + userIds.length + '] ERR ' + userId + ': ' + e.message);
      fail++;
    }
  }

  console.log('\nDone. ' + ok + ' healed, ' + fail + ' failed.');
  await db.destroy();
})();
