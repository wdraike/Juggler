#!/usr/bin/env node
/**
 * One-shot: delete a list of GCal event IDs for a given user via the
 * existing adapter (uses batchDeleteEvents — 50 per Google batch API call).
 *
 * Usage:
 *   node scripts/gcal-delete-orphans.js <userId> <pathToIdListFile>
 *
 * The ID list file is one event ID per line. Stops on first batch failure
 * with a stderr report rather than continuing against a broken state.
 */
var fs = require('fs');
var db = require('../src/db');
var gcalAdapter = require('../src/lib/cal-adapters/gcal.adapter');

async function main() {
  var userId = process.argv[2];
  var file = process.argv[3];
  if (!userId || !file) {
    console.error('Usage: node scripts/gcal-delete-orphans.js <userId> <pathToIdListFile>');
    process.exit(2);
  }

  var ids = fs.readFileSync(file, 'utf8').split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
  if (ids.length === 0) { console.error('ID list is empty'); process.exit(2); }
  console.log('Deleting ' + ids.length + ' events for user ' + userId);

  // Load user, get token via adapter (handles refresh).
  var user = await db('users').where('id', userId).first();
  if (!user) { console.error('User not found'); process.exit(2); }
  var token = await gcalAdapter.getValidAccessToken(user);
  if (!token) { console.error('No valid gcal token for user (not connected?)'); process.exit(2); }

  var deleted = 0;
  var errors = 0;
  var BATCH_SIZE = 50;
  for (var i = 0; i < ids.length; i += BATCH_SIZE) {
    var batch = ids.slice(i, i + BATCH_SIZE);
    console.log('Batch ' + (i / BATCH_SIZE + 1) + '/' + Math.ceil(ids.length / BATCH_SIZE) + ' (' + batch.length + ' ids)');
    try {
      await gcalAdapter.batchDeleteEvents(token, batch);
      deleted += batch.length;
    } catch (e) {
      console.error('  batch failed: ' + (e && e.message));
      errors += batch.length;
    }
  }

  console.log('Done. Deleted ~' + deleted + ', errors ' + errors);
  await db.destroy();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch(function(err) {
  console.error(err);
  process.exit(1);
});
