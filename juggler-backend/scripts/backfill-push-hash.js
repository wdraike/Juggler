#!/usr/bin/env node
/**
 * One-shot: recompute last_pushed_hash for every active cal_sync_ledger
 * row using the CURRENT taskHash function, based on the current task row.
 *
 * Run this after expanding the taskHash field list but BEFORE deploying
 * the new sync. Without it, the next sync will see every ledger row as
 * "changed" (old hash vs new hash function) and push every single active
 * event — rate-limit storm.
 *
 * Usage: node scripts/backfill-push-hash.js [userId]
 * With no userId: all users.
 */
var db = require('../src/db');
var rowToTask = require('../src/controllers/task.controller').rowToTask;
var { taskHash } = require('../src/controllers/cal-sync-helpers');

async function main() {
  var userId = process.argv[2] || null;

  var query = db('cal_sync_ledger').where('status', 'active');
  if (userId) query = query.where('user_id', userId);
  var ledgerRows = await query.select('id', 'user_id', 'task_id', 'provider');
  console.log('Ledger rows to process: ' + ledgerRows.length);

  // Batch-load tasks so we don't do N queries
  var taskIds = [...new Set(ledgerRows.map(function(r) { return r.task_id; }).filter(Boolean))];
  console.log('Distinct task IDs: ' + taskIds.length);

  var taskRowsById = {};
  var CHUNK = 500;
  for (var i = 0; i < taskIds.length; i += CHUNK) {
    var chunk = taskIds.slice(i, i + CHUNK);
    var rows = await db('tasks_v').whereIn('id', chunk).select();
    for (var k = 0; k < rows.length; k++) taskRowsById[rows[k].id] = rows[k];
  }
  console.log('Loaded ' + Object.keys(taskRowsById).length + ' task rows');

  // Per-user timezone (users may differ)
  var userIds = [...new Set(ledgerRows.map(function(r) { return r.user_id; }))];
  var users = await db('users').whereIn('id', userIds).select('id', 'timezone');
  var tzByUser = {};
  users.forEach(function(u) { tzByUser[u.id] = u.timezone || 'America/New_York'; });

  var updates = 0;
  var skipped = 0;
  var missing = 0;
  var BATCH = 200;
  var pending = [];

  async function flushBatch() {
    if (pending.length === 0) return;
    // Use a CASE-WHEN update so one round-trip per BATCH
    var caseExpr = 'CASE id';
    var bindings = [];
    var ids = [];
    pending.forEach(function(p) {
      caseExpr += ' WHEN ? THEN ?';
      bindings.push(p.id, p.hash);
      ids.push(p.id);
    });
    caseExpr += ' ELSE last_pushed_hash END';
    await db('cal_sync_ledger')
      .whereIn('id', ids)
      .update({ last_pushed_hash: db.raw(caseExpr, bindings) });
    pending.length = 0;
  }

  for (var li = 0; li < ledgerRows.length; li++) {
    var ledger = ledgerRows[li];
    var row = taskRowsById[ledger.task_id];
    if (!row) { missing++; continue; }
    var tz = tzByUser[ledger.user_id] || 'America/New_York';
    var task = rowToTask(row, tz);
    // Match cal-sync.controller.js's display-time localize so the hash
    // we write here matches what the controller will compute at sync time.
    if (row.scheduled_at && (!task.date || !task.time)) {
      var utcToLocal = require('../src/scheduler/dateHelpers').utcToLocal;
      var local = utcToLocal(row.scheduled_at, tz);
      if (local) {
        if (!task.date) task.date = local.date;
        if (!task.time) task.time = local.time;
        if (!task.day) task.day = local.day;
      }
    }
    var newHash = taskHash(task);
    pending.push({ id: ledger.id, hash: newHash });
    updates++;
    if (pending.length >= BATCH) await flushBatch();
  }
  await flushBatch();

  console.log('Done. Updated: ' + updates + ', missing-task: ' + missing + ', skipped: ' + skipped);
  await db.destroy();
}

main().catch(function(err) { console.error(err); process.exit(1); });
