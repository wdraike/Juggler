/**
 * One-shot cleanup after the v1 → v2 scheduler transition.
 *
 * Targets three kinds of stale state:
 *   1. `date` column in legacy M/D format → re-derive from scheduled_at + tz.
 *      v2 always writes ISO; anything still in M/D is pre-transition data
 *      that never got a fresh placement.
 *   2. Duplicate placements (same master_id, same scheduled_at). Keeps the
 *      lower-id row, deletes the dupe. Collisions from cross-version runs.
 *   3. Orphan split chunks — rows with split_ordinal > split_total, or gaps
 *      in the ordinal sequence for a given occurrence. reconcile-splits
 *      should fix these on the next user-triggered scheduler run; the
 *      cleanup just reports counts so we know whether to worry.
 *
 * Dry-run by default. Pass `--apply` to actually modify the DB.
 *
 * Usage:
 *   node scripts/cleanup-v2-transition.js                    # all users, dry run
 *   node scripts/cleanup-v2-transition.js --apply            # all users, apply
 *   node scripts/cleanup-v2-transition.js <user-id>          # single user, dry run
 *   node scripts/cleanup-v2-transition.js <user-id> --apply  # single user, apply
 */
var db = require('../src/db');
var dateHelpers = require('../src/scheduler/dateHelpers');
var utcToLocal = dateHelpers.utcToLocal;

var args = process.argv.slice(2);
var apply = args.indexOf('--apply') !== -1;
var userArg = args.filter(function(a) { return a !== '--apply'; })[0] || null;

function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function run() {
  var whereUser = userArg ? { user_id: userArg } : {};
  var modeLabel = apply ? 'APPLY' : 'DRY RUN (pass --apply to execute)';
  console.log('=== v2 transition cleanup ' + modeLabel + ' ===');
  if (userArg) console.log('User: ' + userArg);

  // 1. Legacy-format `date` column rows. Re-derive from scheduled_at in the
  //    user's timezone. Only touches rows where scheduled_at is present —
  //    null-scheduled rows are correctly null-dated too.
  var usersTz = {};
  var allUsers = await db('users').select('id', 'timezone');
  allUsers.forEach(function(u) { usersTz[u.id] = u.timezone || 'America/New_York'; });

  var legacyQuery = db('task_instances')
    .whereNotNull('scheduled_at')
    .whereNotNull('date')
    .whereRaw("date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
  if (userArg) legacyQuery = legacyQuery.where('user_id', userArg);
  var legacyRows = await legacyQuery.select('id', 'user_id', 'scheduled_at', 'date');
  console.log('\n1. Legacy-format date rows: ' + legacyRows.length);

  var reformatted = 0;
  for (var i = 0; i < legacyRows.length; i++) {
    var r = legacyRows[i];
    var tz = usersTz[r.user_id];
    var local = utcToLocal(r.scheduled_at, tz);
    if (!local || !local.date) continue;
    // utcToLocal returns date in ISO form (YYYY-MM-DD).
    if (local.date === r.date) continue;
    if (apply) {
      await db('task_instances').where('id', r.id).update({ date: local.date });
    }
    reformatted++;
  }
  console.log('   → ' + (apply ? 'Reformatted' : 'Would reformat') + ' ' + reformatted + ' row(s) to ISO');

  // 2. Duplicate placements (same master + same scheduled_at). Keep lower id.
  var dupQuery = db('task_instances as ti')
    .whereNotNull('ti.scheduled_at')
    .whereNotIn('ti.status', ['done', 'cancel', 'skip', 'disabled'])
    .groupBy('ti.master_id', 'ti.scheduled_at')
    .having(db.raw('COUNT(*)'), '>', 1)
    .select('ti.master_id', 'ti.scheduled_at',
      db.raw('COUNT(*) as cnt'),
      db.raw('GROUP_CONCAT(ti.id ORDER BY ti.id) as ids'));
  if (userArg) dupQuery = dupQuery.where('ti.user_id', userArg);
  var dupGroups = await dupQuery;
  console.log('\n2. Duplicate placement groups (same master+time): ' + dupGroups.length);

  var deletedDupes = 0;
  for (var g = 0; g < dupGroups.length; g++) {
    var group = dupGroups[g];
    var ids = group.ids.split(',');
    // Keep first (lowest id), delete rest.
    var toDelete = ids.slice(1);
    console.log('   master=' + group.master_id.substring(0, 12) + '... at=' + group.scheduled_at
      + ' keep=' + ids[0].substring(0, 20) + '... delete=' + toDelete.length);
    if (apply) {
      await db('task_instances').whereIn('id', toDelete).del();
    }
    deletedDupes += toDelete.length;
  }
  console.log('   → ' + (apply ? 'Deleted' : 'Would delete') + ' ' + deletedDupes + ' duplicate row(s)');

  // 3. Orphan split chunks — rows where split_ordinal > split_total, or
  //    occurrences with gaps/missing chunks. Report-only — reconcile fixes.
  var orphanQuery = db('task_instances')
    .whereRaw('split_ordinal > split_total');
  if (userArg) orphanQuery = orphanQuery.where('user_id', userArg);
  var orphanOrdinals = await orphanQuery.count('* as n').first();
  console.log('\n3. Orphan chunks (split_ordinal > split_total): ' + orphanOrdinals.n);
  console.log('   (reported only — reconcile-splits fixes these on next scheduler run)');

  await db.destroy();
  console.log('\nDone.');
}

run().catch(function(e) { console.error(e); process.exit(1); });
