#!/usr/bin/env node
/**
 * Report duplicate task_instances rows for the same recurring occurrence.
 *
 * Symptom (from user): on the daily view, a scheduled recurring task (e.g.
 * "Eat dinner", "Call mom") also appears in the bottom "Unscheduled" list.
 * The most likely data cause is more than one row in `task_instances` for
 * the same (master_id, date) — only one gets a placement, the other(s) show
 * up as unscheduled because their `id` doesn't match the placement's id.
 *
 * What counts as a duplicate:
 *  - Two or more rows sharing (master_id, date, occurrence_ordinal, split_ordinal).
 *    For a non-split recurring, split_total=1 and split_ordinal=1 across all
 *    instances, so any (master_id, date) pair with >1 row is a duplicate.
 *  - For split recurrings, split_total>1 rows per (master_id, date) are
 *    expected — one per chunk — but two rows with the same split_ordinal
 *    are a duplicate.
 *
 * This script is READ-ONLY. It prints the offending groups so you can pick
 * which rows to keep (usually: the one with a matching scheduler placement)
 * and delete the rest manually, or follow up with a targeted cleanup script.
 *
 * Usage:
 *   node scripts/report-duplicate-instances.js              # all users
 *   node scripts/report-duplicate-instances.js <userId>     # one user
 */

var db = require('../src/db');

async function run() {
  var userFilter = process.argv[2];

  // Group by (user_id, master_id, date, occurrence_ordinal, split_ordinal)
  // and find any group with count > 1. Exclude terminal statuses — those
  // are historic done/skip/cancel instances and co-existence with fresh
  // open rows is expected by the scheduler (see the _dedup_* placeholders
  // in runSchedule.js).
  var q = db('task_instances')
    .select('user_id', 'master_id', 'date', 'occurrence_ordinal', 'split_ordinal')
    .count({ cnt: 'id' })
    .whereNotNull('master_id')
    .whereNotNull('date')
    .where(function() {
      this.whereNull('status').orWhere('status', '').orWhere('status', 'wip');
    })
    .groupBy('user_id', 'master_id', 'date', 'occurrence_ordinal', 'split_ordinal')
    .having('cnt', '>', 1);
  if (userFilter) q = q.where('user_id', userFilter);

  var groups = await q;

  if (groups.length === 0) {
    console.log('No duplicate task_instances rows found.');
    process.exit(0);
  }

  console.log('Found ' + groups.length + ' duplicate group(s) in task_instances.');
  console.log('Each group below shares (master_id, date, occurrence_ordinal, split_ordinal)');
  console.log('and should have exactly one row. Extras explain the "unscheduled duplicate"');
  console.log('the daily view shows for recurring tasks that are also on the grid.\n');

  for (var gi = 0; gi < groups.length; gi++) {
    var g = groups[gi];
    console.log('── user=' + g.user_id + '  master=' + g.master_id + '  date=' + g.date +
                '  occ=' + g.occurrence_ordinal + '  split=' + g.split_ordinal +
                '  rows=' + g.cnt + ' ──');

    // Pull the actual rows in the group so the user can see ids, statuses,
    // and scheduled_at to decide which to keep.
    var rows = await db('task_instances')
      .where({
        user_id: g.user_id,
        master_id: g.master_id,
        date: g.date,
        occurrence_ordinal: g.occurrence_ordinal,
        split_ordinal: g.split_ordinal
      })
      .select('id', 'status', 'scheduled_at', 'dur', 'time', 'generated', 'created_at', 'updated_at');

    // Find the master's name/project to make the report readable.
    var master = await db('task_masters')
      .where('id', g.master_id)
      .select('text', 'project')
      .first();
    if (master) {
      console.log('  task: ' + JSON.stringify(master.text || '') +
                  (master.project ? '  project: ' + JSON.stringify(master.project) : ''));
    }
    rows.forEach(function(r) {
      console.log('    id=' + r.id +
                  '  status=' + JSON.stringify(r.status || '') +
                  '  scheduled_at=' + (r.scheduled_at ? new Date(r.scheduled_at).toISOString() : 'null') +
                  '  time=' + (r.time || 'null') +
                  '  dur=' + r.dur +
                  '  generated=' + (r.generated ? '1' : '0') +
                  '  created=' + (r.created_at ? new Date(r.created_at).toISOString() : 'null'));
    });
    console.log('');
  }

  console.log('How to resolve:');
  console.log('  1. For each group, identify the row that currently has a scheduler');
  console.log('     placement (usually the most recently updated one with scheduled_at set).');
  console.log('  2. Keep that row.');
  console.log('  3. DELETE the other row(s) directly in task_instances (or let me');
  console.log('     know you want a parallel --apply script that auto-prunes the');
  console.log('     older duplicates).');
  process.exit(0);
}

run().catch(function(err) {
  console.error('Error:', err);
  process.exit(1);
});
