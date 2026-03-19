#!/usr/bin/env node
/**
 * One-time habit cleanup:
 *
 * 1. Delete orphaned rc_dh* / rc_rc_* cascading instances (spawned from non-templates)
 * 2. Backfill source_id on dh* instances missing it (match by text + user_id)
 * 3. Clear recur from all habit_instance rows (only templates should have recur)
 * 4. Delete habit_instance rows with NULL text that can't be matched to a template
 *
 * Usage: node scripts/fix-habit-source-ids.js [--dry-run]
 */

var path = require('path');
var db = require(path.join(__dirname, '..', 'juggler-backend', 'src', 'db'));

var dryRun = process.argv.includes('--dry-run');

async function main() {
  if (dryRun) console.log('=== DRY RUN — no changes will be made ===\n');

  // ── Step 1: Delete cascading rc_ instances whose source is NOT a habit_template ──
  // These are the rc_dh*, rc_rc_dh* etc. that should never have been created
  var templateIds = await db('tasks')
    .where('task_type', 'habit_template')
    .pluck('id');
  var templateIdSet = new Set(templateIds);

  var rcInstances = await db('tasks')
    .where('id', 'like', 'rc_%')
    .select('id', 'source_id', 'text', 'task_type', 'status');

  var toDelete = rcInstances.filter(function(r) {
    // Delete if source is not a template (cascading spawn)
    // or if source_id is null (orphaned)
    return !r.source_id || !templateIdSet.has(r.source_id);
  });

  // Don't delete rc_ instances that have meaningful status (done/wip) — user interacted with them
  var safeToDelete = toDelete.filter(function(r) {
    return !r.status || r.status === '';
  });
  var keepButOrphaned = toDelete.filter(function(r) {
    return r.status && r.status !== '';
  });

  console.log('Step 1: Orphaned rc_ instances');
  console.log('  Total rc_ rows: ' + rcInstances.length);
  console.log('  Orphaned (source not a template): ' + toDelete.length);
  console.log('  Safe to delete (no status): ' + safeToDelete.length);
  console.log('  Keeping (has status): ' + keepButOrphaned.length);

  if (!dryRun && safeToDelete.length > 0) {
    var deleteIds = safeToDelete.map(function(r) { return r.id; });
    // Delete in chunks to avoid query size limits
    for (var i = 0; i < deleteIds.length; i += 500) {
      await db('tasks').whereIn('id', deleteIds.slice(i, i + 500)).del();
    }
    console.log('  Deleted ' + safeToDelete.length + ' rows');
  }

  // ── Step 2: Backfill source_id on instances missing it ──
  var templates = await db('tasks')
    .where('task_type', 'habit_template')
    .select('id', 'text', 'user_id');

  var totalSourceFixed = 0;
  for (var tmpl of templates) {
    if (dryRun) {
      var count = await db('tasks')
        .where('task_type', 'habit_instance')
        .where('user_id', tmpl.user_id)
        .where('text', tmpl.text)
        .whereNull('source_id')
        .count('* as cnt')
        .first();
      if (count.cnt > 0) {
        console.log('  Would fix ' + count.cnt + ' instances for "' + tmpl.text + '"');
        totalSourceFixed += count.cnt;
      }
    } else {
      var updated = await db('tasks')
        .where('task_type', 'habit_instance')
        .where('user_id', tmpl.user_id)
        .where('text', tmpl.text)
        .whereNull('source_id')
        .update({ source_id: tmpl.id });
      if (updated > 0) {
        console.log('  Fixed ' + updated + ' instances for "' + tmpl.text + '" (' + tmpl.id + ')');
        totalSourceFixed += updated;
      }
    }
  }
  console.log('\nStep 2: Backfill source_id');
  console.log('  Fixed: ' + totalSourceFixed);

  // ── Step 3: Clear recur from all habit_instance rows ──
  if (dryRun) {
    var recurCount = await db('tasks')
      .where('task_type', 'habit_instance')
      .whereNotNull('recur')
      .count('* as cnt')
      .first();
    console.log('\nStep 3: Clear recur from instances');
    console.log('  Would clear: ' + recurCount.cnt);
  } else {
    var cleared = await db('tasks')
      .where('task_type', 'habit_instance')
      .whereNotNull('recur')
      .update({ recur: null });
    console.log('\nStep 3: Clear recur from instances');
    console.log('  Cleared: ' + cleared);
  }

  // ── Step 4: Delete habit_instance rows with NULL text and no source_id ──
  // These are unrecoverable orphans
  if (dryRun) {
    var nullTextCount = await db('tasks')
      .where('task_type', 'habit_instance')
      .whereNull('text')
      .whereNull('source_id')
      .count('* as cnt')
      .first();
    console.log('\nStep 4: Delete unrecoverable orphans (NULL text, no source)');
    console.log('  Would delete: ' + nullTextCount.cnt);
  } else {
    var deletedNulls = await db('tasks')
      .where('task_type', 'habit_instance')
      .whereNull('text')
      .whereNull('source_id')
      .del();
    console.log('\nStep 4: Delete unrecoverable orphans (NULL text, no source)');
    console.log('  Deleted: ' + deletedNulls);
  }

  // ── Step 5: Fix orphaned rc_ rows that have status (from Step 1) ──
  // Re-point them to the correct template by matching text
  if (keepButOrphaned.length > 0) {
    var tmplByText = {};
    templates.forEach(function(t) {
      var key = t.user_id + '|' + t.text;
      tmplByText[key] = t.id;
    });

    var repointed = 0;
    for (var row of keepButOrphaned) {
      if (!row.text) continue;
      // Need user_id to match
      var full = await db('tasks').where('id', row.id).select('user_id', 'text').first();
      if (!full) continue;
      var tmplId = tmplByText[full.user_id + '|' + full.text];
      if (tmplId) {
        if (!dryRun) {
          await db('tasks').where('id', row.id).update({
            source_id: tmplId,
            task_type: 'habit_instance',
            recur: null
          });
        }
        repointed++;
      }
    }
    console.log('\nStep 5: Re-point orphaned rc_ with status to correct template');
    console.log('  ' + (dryRun ? 'Would fix' : 'Fixed') + ': ' + repointed);
  }

  // ── Summary ──
  console.log('\n=== Verification ===');
  var remaining = await db('tasks')
    .where('task_type', 'habit_instance')
    .whereNull('source_id')
    .count('* as cnt')
    .first();
  console.log('Habit instances still missing source_id: ' + remaining.cnt);

  var recurLeft = await db('tasks')
    .where('task_type', 'habit_instance')
    .whereNotNull('recur')
    .count('* as cnt')
    .first();
  console.log('Habit instances still with recur: ' + recurLeft.cnt);

  var orphanedRc = await db('tasks')
    .where('id', 'like', 'rc_%')
    .whereNull('source_id')
    .count('* as cnt')
    .first();
  console.log('Orphaned rc_ rows (no source_id): ' + orphanedRc.cnt);

  await db.destroy();
}

main().catch(function(err) {
  console.error(err);
  process.exit(1);
});
