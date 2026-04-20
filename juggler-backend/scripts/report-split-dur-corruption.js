#!/usr/bin/env node
/**
 * Report split-master rows whose `dur` was clobbered to one chunk (`split_min`)
 * by the `runSchedule.js` persist bug (pre-fix line 593: `dbUpdate.dur =
 * placement.dur`).
 *
 * Only affects non-recurring split masters — for recurring templates, the
 * scheduler writes to instance chunks whose dur is already split_min, so no
 * corruption occurs there. The signature of corruption is therefore:
 *     task_type = 'master'  AND  split = 1  AND  split_min > 0  AND  dur = split_min
 *
 * The original total duration cannot be recovered from DB state — each run
 * overwrote it. This script is read-only: it lists candidates so you can
 * restore the correct `dur` manually via the task editor.
 *
 * Usage:
 *   node scripts/report-split-dur-corruption.js           # all users
 *   node scripts/report-split-dur-corruption.js <userId>  # one user
 */

var db = require('../src/db');

async function run() {
  var userFilter = process.argv[2];

  var q = db('task_masters')
    .where('split', 1)
    .where('split_min', '>', 0)
    .whereRaw('dur = split_min')
    .whereNot('task_type', 'recurring_template');
  if (userFilter) q = q.where('user_id', userFilter);

  var rows = await q.select('user_id', 'id', 'text', 'project', 'dur', 'split_min', 'task_type', 'recurring');

  if (rows.length === 0) {
    console.log('No split-master corruption candidates found.');
    process.exit(0);
  }

  console.log('Found ' + rows.length + ' candidate row(s) where dur == split_min on a split master.');
  console.log('These likely had their `dur` clobbered by the pre-fix scheduler persist bug.');
  console.log('The original total duration cannot be recovered programmatically — restore manually.\n');

  var byUser = {};
  rows.forEach(function(r) {
    if (!byUser[r.user_id]) byUser[r.user_id] = [];
    byUser[r.user_id].push(r);
  });

  Object.keys(byUser).forEach(function(uid) {
    console.log('── user ' + uid + ' ──');
    byUser[uid].forEach(function(r) {
      var parts = [
        'id=' + r.id,
        'name=' + JSON.stringify(r.text || ''),
        'project=' + JSON.stringify(r.project || ''),
        'dur=' + r.dur,
        'split_min=' + r.split_min,
        'type=' + r.task_type,
        'recurring=' + (r.recurring ? '1' : '0')
      ];
      console.log('  ' + parts.join('  '));
    });
    console.log('');
  });

  console.log('Fix path: open each task in the UI and set Duration to its intended total.');
  console.log('Going forward, the scheduler will no longer overwrite dur on split masters.');
  process.exit(0);
}

run().catch(function(err) {
  console.error('Error:', err);
  process.exit(1);
});
