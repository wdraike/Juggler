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

  // Batching notes:
  //   - Google's per-user Calendar API limit is 600 req/min. Each sub-request
  //     inside a batch counts as one unit, so a 50-batch is 50 units.
  //   - `batchDeleteEvents` returns per-item results; the caller must inspect
  //     them (the function does NOT throw on per-item failures). Earlier
  //     versions of this script only caught batch-level throws and
  //     silently reported success on rate-limited runs.
  //   - On rate-limit (403 rateLimitExceeded), back off and retry the failed
  //     subset. Pure 5xx would also be transient; treat them the same way.
  var BATCH_SIZE = 50;
  var PAUSE_BETWEEN_BATCHES_MS = 3000;
  var MAX_RETRIES = 5;
  var pending = ids.slice();
  var deleted = 0;
  var permanentErrors = [];
  var round = 0;

  while (pending.length > 0 && round < MAX_RETRIES) {
    round++;
    console.log('--- round ' + round + ', ' + pending.length + ' ids left ---');
    var stillPending = [];

    for (var i = 0; i < pending.length; i += BATCH_SIZE) {
      var batch = pending.slice(i, i + BATCH_SIZE);
      var batchLabel = 'batch ' + (Math.floor(i / BATCH_SIZE) + 1) + '/' + Math.ceil(pending.length / BATCH_SIZE);
      try {
        var results = await gcalAdapter.batchDeleteEvents(token, batch);
        var okCount = 0;
        var retryCount = 0;
        var failCount = 0;
        for (var ri = 0; ri < results.length; ri++) {
          var r = results[ri];
          if (!r.error) {
            deleted++;
            okCount++;
          } else if (/HTTP 403|HTTP 429|HTTP 5\d\d/.test(r.error)) {
            stillPending.push(r.eventId);
            retryCount++;
          } else {
            permanentErrors.push({ eventId: r.eventId, error: r.error });
            failCount++;
          }
        }
        console.log(batchLabel + ': ok=' + okCount + ' retry=' + retryCount + ' fail=' + failCount);
      } catch (e) {
        // Whole batch threw (network / 5xx on the batch envelope). Retry all.
        console.error(batchLabel + ' threw: ' + (e && e.message));
        for (var ri2 = 0; ri2 < batch.length; ri2++) stillPending.push(batch[ri2]);
      }
      // Throttle between batches to stay under 600/min.
      if (i + BATCH_SIZE < pending.length) {
        await new Promise(function(r) { setTimeout(r, PAUSE_BETWEEN_BATCHES_MS); });
      }
    }

    pending = stillPending;
    if (pending.length > 0 && round < MAX_RETRIES) {
      // Exponential backoff: 10s, 20s, 40s, 80s, 160s — plenty of time for
      // a 60s rate-limit window to reset.
      var waitMs = 10000 * Math.pow(2, round - 1);
      console.log('backing off ' + (waitMs / 1000) + 's before round ' + (round + 1));
      await new Promise(function(r) { setTimeout(r, waitMs); });
    }
  }

  if (pending.length > 0) {
    console.log('gave up after ' + round + ' rounds; ' + pending.length + ' still pending');
  }
  console.log('Done. Deleted ' + deleted + ', permanent errors ' + permanentErrors.length + ', still pending ' + pending.length);
  if (permanentErrors.length > 0) {
    console.log('First 5 permanent errors:');
    permanentErrors.slice(0, 5).forEach(function(e) { console.log('  ' + e.eventId + ': ' + e.error); });
  }
  await db.destroy();
  process.exit((permanentErrors.length > 0 || pending.length > 0) ? 1 : 0);
}

main().catch(function(err) {
  console.error(err);
  process.exit(1);
});
