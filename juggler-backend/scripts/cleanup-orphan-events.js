#!/usr/bin/env node
/**
 * Cleanup orphan calendar events — events that exist in GCal/MSFT
 * but have no matching task (created by killed sync processes).
 *
 * 1. Batch-deletes orphan events via provider APIs
 * 2. Marks their ledger entries as deleted
 * 3. Also deletes orphaned recurring instances (null text, missing template)
 *
 * Usage: node scripts/cleanup-orphan-events.js
 */

var db = require('../src/db');
var gcal = require('../src/lib/cal-adapters/gcal.adapter');
var msft = require('../src/lib/cal-adapters/msft.adapter');

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function run() {
  var user = await db('users').first();
  if (!user) { console.error('No user found'); process.exit(1); }
  var userId = user.id;

  // --- Step 1: Delete orphan ledger entries (task_id IS NULL, event still exists) ---
  var orphanLedger = await db('cal_sync_ledger')
    .where('user_id', userId)
    .where('status', 'active')
    .whereNull('task_id')
    .whereNotNull('provider_event_id')
    .select('id', 'provider', 'provider_event_id', 'event_summary');

  console.log('Found ' + orphanLedger.length + ' orphan ledger entries to clean up');

  // Group by provider
  var byProvider = {};
  orphanLedger.forEach(function(r) {
    if (!byProvider[r.provider]) byProvider[r.provider] = [];
    byProvider[r.provider].push(r);
  });

  var providers = [
    { name: 'gcal', adapter: gcal, connected: !!user.gcal_refresh_token },
    { name: 'msft', adapter: msft, connected: !!user.msft_cal_refresh_token }
  ];

  for (var pi = 0; pi < providers.length; pi++) {
    var p = providers[pi];
    var entries = byProvider[p.name] || [];
    if (entries.length === 0 || !p.connected) continue;

    console.log('\n--- ' + p.name.toUpperCase() + ': ' + entries.length + ' orphan events ---');
    var token = await p.adapter.getValidAccessToken(user);

    // Batch delete in chunks
    var batchSize = p.name === 'gcal' ? 50 : 20;
    var deleted = 0;
    var failed = 0;

    for (var i = 0; i < entries.length; i += batchSize) {
      var chunk = entries.slice(i, i + batchSize);
      var eventIds = chunk.map(function(e) { return e.provider_event_id; });

      try {
        if (p.adapter.batchDeleteEvents) {
          var results = await p.adapter.batchDeleteEvents(token, eventIds);
          var chunkFailed = 0;
          results.forEach(function(r) { if (r.error) chunkFailed++; });
          deleted += (chunk.length - chunkFailed);
          failed += chunkFailed;
        } else {
          for (var j = 0; j < eventIds.length; j++) {
            try {
              await p.adapter.deleteEvent(token, eventIds[j]);
              deleted++;
            } catch (e) {
              if (!e.message.includes('404') && !e.message.includes('410')) failed++;
              else deleted++; // already gone
            }
          }
        }
      } catch (e) {
        // Batch failed — try individual
        console.log('  Batch failed, falling back to individual: ' + e.message);
        for (var k = 0; k < eventIds.length; k++) {
          try {
            await p.adapter.deleteEvent(token, eventIds[k]);
            deleted++;
          } catch (e2) {
            if (!e2.message.includes('404') && !e2.message.includes('410')) {
              failed++;
              if (e2.message.includes('rateLimitExceeded')) {
                console.log('  Rate limited, waiting 5s...');
                await delay(5000);
                // Retry once
                try {
                  await p.adapter.deleteEvent(token, eventIds[k]);
                  deleted++;
                  failed--;
                } catch (e3) { /* give up on this one */ }
              }
            } else {
              deleted++; // 404/410 = already gone
            }
          }
        }
      }

      // Mark ledger entries as deleted
      var ledgerIds = chunk.map(function(e) { return e.id; });
      await db('cal_sync_ledger').whereIn('id', ledgerIds).update({
        status: 'deleted_local',
        provider_event_id: null,
        synced_at: db.fn.now()
      });

      var pct = Math.round((i + chunk.length) / entries.length * 100);
      process.stdout.write('  ' + pct + '% (' + deleted + ' deleted, ' + failed + ' failed)\r');

      // Small pause between batches to avoid rate limiting
      if (i + batchSize < entries.length) await delay(500);
    }

    console.log('\n  Done: ' + deleted + ' deleted, ' + failed + ' failed');
  }

  // --- Step 2: Clean up orphaned recurring instances (missing templates) ---
  console.log('\n--- Cleaning orphaned recurring instances ---');
  var orphanInstances = await db('tasks')
    .where('user_id', userId)
    .whereNotNull('source_id')
    .whereNotNull('scheduled_at')
    .whereRaw('source_id NOT IN (SELECT id FROM tasks WHERE user_id = ? AND task_type = ?)', [userId, 'recurring_template'])
    .select('id', 'text', 'source_id', 'gcal_event_id', 'msft_event_id');

  console.log('Found ' + orphanInstances.length + ' orphaned recurring instances');

  if (orphanInstances.length > 0) {
    // Delete their calendar events first
    for (var pi2 = 0; pi2 < providers.length; pi2++) {
      var p2 = providers[pi2];
      if (!p2.connected) continue;
      var eventIdCol = p2.name === 'gcal' ? 'gcal_event_id' : 'msft_event_id';
      var evIds = orphanInstances
        .map(function(t) { return t[eventIdCol]; })
        .filter(function(id) { return !!id; });

      if (evIds.length === 0) continue;
      console.log('  Deleting ' + evIds.length + ' ' + p2.name + ' events for orphaned instances...');

      var token2 = await p2.adapter.getValidAccessToken(user);
      var bSize = p2.name === 'gcal' ? 50 : 20;
      for (var bi = 0; bi < evIds.length; bi += bSize) {
        var batch = evIds.slice(bi, bi + bSize);
        try {
          if (p2.adapter.batchDeleteEvents) {
            await p2.adapter.batchDeleteEvents(token2, batch);
          }
        } catch (e) {
          // Ignore batch errors — events may already be gone
        }
        if (bi + bSize < evIds.length) await delay(500);
      }
    }

    // Delete the tasks and their ledger entries
    var orphanIds = orphanInstances.map(function(t) { return t.id; });
    await db('cal_sync_ledger')
      .where('user_id', userId)
      .whereIn('task_id', orphanIds)
      .update({ status: 'deleted_local', task_id: null, synced_at: db.fn.now() });

    // Delete in batches of 100 to avoid huge IN clauses
    for (var di = 0; di < orphanIds.length; di += 100) {
      var delBatch = orphanIds.slice(di, di + 100);
      await db('tasks').whereIn('id', delBatch).del();
    }
    console.log('  Deleted ' + orphanInstances.length + ' orphaned instances from DB');
  }

  console.log('\nCleanup complete.');
  await db.destroy();
}

run().catch(function(err) {
  console.error('FATAL:', err);
  db.destroy().then(function() { process.exit(1); });
});
