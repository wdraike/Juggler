// One-shot: re-parent completed instances that are stranded under non-recurring masters.
// These are created when recurring was toggled off before the ledger+archival fix was applied.
// Run once, then discard.
var db = require('../src/db');
var tasksWrite = require('../src/lib/tasks-write');

var DRY_RUN = process.argv.includes('--dry-run');

(async function() {
  var orphans = await db('task_instances as ti')
    .join('task_masters as tm', 'ti.master_id', 'tm.id')
    .where('tm.recurring', 0)
    .whereNot('ti.id', db.raw('ti.master_id'))  // exclude templates (id == master_id)
    .whereIn('ti.status', ['done', 'cancel', 'skip'])
    .select('ti.id', 'ti.master_id', 'ti.user_id', 'ti.status', 'ti.scheduled_at', 'tm.text');

  console.log('Found ' + orphans.length + ' done/cancel/skip instance(s) under non-recurring masters:');
  orphans.forEach(function(r) {
    console.log('  ' + r.id + '  status=' + r.status + '  sa=' + r.scheduled_at + '  master=' + r.master_id + '  text=' + r.text);
  });

  if (orphans.length === 0 || DRY_RUN) {
    if (DRY_RUN) console.log('[dry-run] no changes made.');
    await db.destroy();
    return;
  }

  // Group by user_id so archiveInstances gets the right user each time
  var byUser = {};
  orphans.forEach(function(r) {
    if (!byUser[r.user_id]) byUser[r.user_id] = [];
    byUser[r.user_id].push(r.id);
  });

  for (var userId of Object.keys(byUser)) {
    var ids = byUser[userId];
    var archived = await tasksWrite.archiveInstances(db, userId, ids);
    console.log('Re-parented ' + archived + ' instance(s) to archival master for user ' + userId + '.');
  }

  await db.destroy();
  console.log('Done.');
})().catch(function(e) { console.error(e); process.exit(1); });
