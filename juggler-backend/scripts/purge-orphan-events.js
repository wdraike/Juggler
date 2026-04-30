#!/usr/bin/env node
/**
 * Detect and purge orphan provider calendar events — juggler-stamped events
 * on GCal / MSFT / Apple that have no matching active ledger row.
 *
 * These are "ghosts": events Juggler created but never cleaned up (e.g. because
 * the task was deleted before sync ran, or an old bug left stale events behind).
 *
 * Dry-run by default (prints what WOULD be deleted). Pass --apply to actually delete.
 *
 * Usage:
 *   node scripts/purge-orphan-events.js --user=<userId> [options]
 *
 * Options:
 *   --user=<id>              required
 *   --provider=gcal|msft|apple|all   default: all
 *   --start=YYYY-MM-DD       default: 30 days ago
 *   --end=YYYY-MM-DD         default: 60 days from now
 *   --apply                  actually delete (default: dry-run only)
 *   --max=N                  abort if orphan count exceeds N (default: 500)
 *   --sample=N               rows to print for eyeball check (default: 20)
 *   --log=<path>             CSV log file (default: ./purge-orphan-events-<ts>.csv)
 */

'use strict';

var fs = require('fs');
var path = require('path');
var db = require('../src/db');
var gcalAdapter = require('../src/lib/cal-adapters/gcal.adapter');
var msftAdapter = require('../src/lib/cal-adapters/msft.adapter');
var appleAdapter = require('../src/lib/cal-adapters/apple.adapter');

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

var args = process.argv.slice(2);

function getArg(name) {
  var prefix = '--' + name + '=';
  var found = args.find(function(a) { return a.startsWith(prefix); });
  return found ? found.slice(prefix.length) : null;
}

function hasFlag(name) { return args.includes('--' + name); }

var userId   = getArg('user');
var provider = getArg('provider') || 'all';
var applyMode = hasFlag('apply');
var maxOrphans = parseInt(getArg('max') || '500', 10);
var sampleSize = parseInt(getArg('sample') || '20', 10);

var now = new Date();
var defaultStart = new Date(now); defaultStart.setDate(defaultStart.getDate() - 30);
var defaultEnd   = new Date(now); defaultEnd.setDate(defaultEnd.getDate() + 60);
var timeMin = (getArg('start') ? new Date(getArg('start')) : defaultStart).toISOString();
var timeMax = (getArg('end')   ? new Date(getArg('end'))   : defaultEnd  ).toISOString();

var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
var logFile = getArg('log') || path.join(process.cwd(), 'purge-orphan-events-' + ts + '.csv');

if (!userId) {
  console.error('Usage: node scripts/purge-orphan-events.js --user=<userId> [--provider=gcal|msft|apple|all] [--apply] [--max=N] [--sample=N] [--log=path]');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

function isJugglerStamped(event) {
  var desc = event.description || '';
  var rawBody = (event._raw && event._raw.body && event._raw.body.content) || '';
  var combined = desc + ' ' + rawBody;
  return combined.indexOf('Synced from Raike & Sons')     !== -1
      || combined.indexOf('Synced from Raike &amp; Sons') !== -1
      || combined.indexOf('Synced from Juggler')          !== -1;
}

function csvRow(fields) {
  return fields.map(function(f) {
    var s = String(f == null ? '' : f);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(',') + '\n';
}

var csvHeader = csvRow(['provider', 'event_id', 'summary', 'start', 'end', 'ledger_status', 'action', 'error']);

// Retry/backoff pattern from gcal-delete-orphans.js
async function batchDeleteWithRetry(adapter, token, eventIds, batchSize) {
  var PAUSE_BETWEEN_BATCHES_MS = 3000;
  var MAX_RETRIES = 5;
  var pending = eventIds.slice();
  var deleted = 0;
  var permanentErrors = [];
  var round = 0;

  while (pending.length > 0 && round < MAX_RETRIES) {
    round++;
    console.log('    round ' + round + ', ' + pending.length + ' ids left');
    var stillPending = [];

    for (var i = 0; i < pending.length; i += batchSize) {
      var batch = pending.slice(i, i + batchSize);
      try {
        var results = adapter.batchDeleteEvents
          ? await adapter.batchDeleteEvents(token, batch)
          : batch.map(function(id) { return { eventId: id, error: 'no_batch_support' }; });

        for (var ri = 0; ri < results.length; ri++) {
          var r = results[ri];
          if (!r.error) {
            deleted++;
          } else if (/HTTP 403|HTTP 429|HTTP 5\d\d|rateLimitExceeded/.test(r.error)) {
            stillPending.push(r.eventId);
          } else {
            permanentErrors.push({ eventId: r.eventId, error: r.error });
          }
        }
      } catch (e) {
        // Whole batch threw — retry all
        for (var ri2 = 0; ri2 < batch.length; ri2++) stillPending.push(batch[ri2]);
      }

      if (i + batchSize < pending.length) {
        await delay(PAUSE_BETWEEN_BATCHES_MS);
      }
    }

    pending = stillPending;
    if (pending.length > 0 && round < MAX_RETRIES) {
      var waitMs = 10000 * Math.pow(2, round - 1);
      console.log('    backoff ' + (waitMs / 1000) + 's');
      await delay(waitMs);
    }
  }

  return { deleted: deleted, pending: pending, permanentErrors: permanentErrors };
}

// ---------------------------------------------------------------------------
// Per-provider processing
// ---------------------------------------------------------------------------

async function processProvider(pid, adapter, user, logStream) {
  console.log('\n=== ' + pid.toUpperCase() + ' ===');

  // Apple: family calendar guard
  if (pid === 'apple') {
    var calendars = await appleAdapter.getEnabledCalendars(user.id);
    // Block if any FULL-SYNC calendar is named Family — Juggler writes to full-sync
    // calendars, so a full-sync Family calendar could contain Juggler-stamped events.
    // Ingest-only Family calendars are safe: Juggler never writes to them so no
    // stamped events exist there, and the stamp filter protects against false positives.
    var familyCal = calendars.find(function(c) {
      return /family/i.test(c.display_name || '') && c.sync_direction !== 'ingest';
    });
    if (familyCal) {
      console.error('ERROR: Apple Family Calendar detected as full-sync (' + (familyCal.display_name || familyCal.calendar_id) + ').');
      console.error('Refusing to operate. Change it to ingest-only or disable it in calendar settings.');
      process.exit(3);
    }
  }

  // Auth
  var token;
  try {
    token = await adapter.getValidAccessToken(user);
  } catch (e) {
    console.log('  ' + pid + ' not connected: ' + e.message);
    return { orphans: 0, deleted: 0, failed: 0 };
  }

  // Build active event ID set from ledger
  var activeRows = await db('cal_sync_ledger')
    .where('user_id', userId)
    .where('provider', pid)
    .where('status', 'active')
    .whereNotNull('provider_event_id')
    .select('provider_event_id', 'status');

  var activeIds = new Set(activeRows.map(function(r) { return r.provider_event_id; }));
  console.log('  Active ledger entries: ' + activeIds.size);

  // Also build a map of all non-active ledger rows (for reporting ledger_status)
  var allLedgerRows = await db('cal_sync_ledger')
    .where('user_id', userId)
    .where('provider', pid)
    .whereNotNull('provider_event_id')
    .select('provider_event_id', 'status');
  var ledgerStatusMap = {};
  allLedgerRows.forEach(function(r) { ledgerStatusMap[r.provider_event_id] = r.status; });

  // Fetch live events from provider
  var events;
  try {
    events = await adapter.listEvents(token, timeMin, timeMax, userId);
  } catch (e) {
    console.error('  Failed to list events: ' + e.message);
    return { orphans: 0, deleted: 0, failed: 0 };
  }

  console.log('  Provider events in window: ' + events.length);

  // Detect orphans
  var orphans = events.filter(function(ev) {
    return !activeIds.has(ev.id) && isJugglerStamped(ev);
  });

  console.log('  Orphan events (stamped, no active ledger): ' + orphans.length);

  if (orphans.length === 0) {
    console.log('  Nothing to purge.');
    return { orphans: 0, deleted: 0, failed: 0 };
  }

  if (orphans.length > maxOrphans) {
    console.error('  ABORT: ' + orphans.length + ' orphans exceeds --max=' + maxOrphans + '. Inspect first, then increase --max if safe.');
    process.exit(4);
  }

  // Write CSV rows for this provider
  orphans.forEach(function(ev) {
    var ledgerStatus = ledgerStatusMap[ev.id] || 'none';
    var action = applyMode ? 'WOULD_DELETE_APPLY' : 'WOULD_DELETE';
    logStream.write(csvRow([pid, ev.id, ev.title, ev.startDateTime, ev.endDateTime, ledgerStatus, action, '']));
  });

  // Eyeball sample
  if (orphans.length >= sampleSize) {
    console.log('\n  Sample of ' + sampleSize + ' orphan events (random):');
    console.log('  ' + ['event_id', 'summary', 'start', 'ledger_status'].map(function(h) { return h.padEnd(36); }).join('  '));
    var shuffled = orphans.slice().sort(function() { return Math.random() - 0.5; }).slice(0, sampleSize);
    shuffled.forEach(function(ev) {
      var ledgerStatus = ledgerStatusMap[ev.id] || 'none';
      console.log('  ' + [
        String(ev.id).slice(0, 36).padEnd(36),
        String(ev.title || '').slice(0, 36).padEnd(36),
        String(ev.startDateTime || '').slice(0, 19).padEnd(19),
        ledgerStatus
      ].join('  '));
    });
    console.log('');
  }

  if (!applyMode) {
    console.log('  DRY-RUN: would delete ' + orphans.length + ' events. Re-run with --apply to actually delete.');
    return { orphans: orphans.length, deleted: 0, failed: 0 };
  }

  // --- Apply: delete orphans ---
  var batchSizes = { gcal: 50, msft: 20, apple: 1 };
  var batchSize = batchSizes[pid] || 20;

  // Apple stores UIDs as provider_event_id but deleteEvent needs the CalDAV URL.
  // Use ev._url for deletion; maintain a map back to ev.id (UID) for ledger lookups.
  var deleteKeyByEvId = {};
  var evIdByDeleteKey = {};
  orphans.forEach(function(ev) {
    var deleteKey = (pid === 'apple' && ev._url) ? ev._url : ev.id;
    deleteKeyByEvId[ev.id] = deleteKey;
    evIdByDeleteKey[deleteKey] = ev.id;
  });
  var deleteKeys = orphans.map(function(ev) { return deleteKeyByEvId[ev.id]; });

  // Reverse map: deleteKey → orphan event object
  var evByDeleteKey = {};
  orphans.forEach(function(ev) { evByDeleteKey[deleteKeyByEvId[ev.id]] = ev; });

  console.log('  Deleting ' + orphans.length + ' orphan events...');
  var result = await batchDeleteWithRetry(adapter, token, deleteKeys, batchSize);

  console.log('  Deleted: ' + result.deleted + ', permanent errors: ' + result.permanentErrors.length + ', still pending: ' + result.pending.length);

  // Identify which keys were successfully deleted
  var failedKeys = new Set(result.permanentErrors.map(function(e) { return e.eventId; }).concat(result.pending));
  var deletedKeys = deleteKeys.filter(function(k) { return !failedKeys.has(k); });

  // Update CSV log with actual outcomes
  deletedKeys.forEach(function(dKey) {
    var ev = evByDeleteKey[dKey];
    var ledgerStatus = ledgerStatusMap[ev ? ev.id : dKey] || 'none';
    logStream.write(csvRow([pid, ev ? ev.id : dKey, ev ? ev.title : '', ev ? ev.startDateTime : '', ev ? ev.endDateTime : '', ledgerStatus, 'DELETED', '']));
  });
  result.permanentErrors.concat(result.pending.map(function(k) { return { eventId: k, error: 'still_pending' }; })).forEach(function(e) {
    var ev = evByDeleteKey[e.eventId];
    var ledgerStatus = ledgerStatusMap[ev ? ev.id : e.eventId] || 'none';
    logStream.write(csvRow([pid, ev ? ev.id : e.eventId, ev ? ev.title : '', ev ? ev.startDateTime : '', ev ? ev.endDateTime : '', ledgerStatus, 'FAILED', e.error]));
  });

  // Upsert ledger tombstones for successfully deleted events
  // Use ev.id (the UID / provider_event_id stored in the ledger) for the lookup.
  if (deletedKeys.length > 0) {
    for (var di = 0; di < deletedKeys.length; di++) {
      var dKey2 = deletedKeys[di];
      var orphanEv = evByDeleteKey[dKey2];
      var ledgerEvId = orphanEv ? orphanEv.id : dKey2; // UID stored in ledger

      var existing = await db('cal_sync_ledger')
        .where('user_id', userId)
        .where('provider', pid)
        .where('provider_event_id', ledgerEvId)
        .first();

      if (existing) {
        await db('cal_sync_ledger').where('id', existing.id)
          .update({ status: 'deleted_remote', provider_event_id: null, synced_at: db.fn.now() });
      } else {
        await db('cal_sync_ledger').insert({
          user_id: userId,
          provider: pid,
          task_id: null,
          provider_event_id: null,
          origin: 'cleanup',
          status: 'deleted_remote',
          event_summary: orphanEv ? orphanEv.title : null,
          event_start: orphanEv ? orphanEv.startDateTime : null,
          event_end: orphanEv ? orphanEv.endDateTime : null,
          synced_at: db.fn.now(),
          created_at: db.fn.now(),
          updated_at: db.fn.now()
        });
      }
    }
    console.log('  Ledger tombstones written: ' + deletedKeys.length);
  }

  return {
    orphans: orphans.length,
    deleted: result.deleted,
    failed: result.permanentErrors.length + result.pending.length
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('purge-orphan-events.js');
  console.log('User:     ' + userId);
  console.log('Provider: ' + provider);
  console.log('Window:   ' + timeMin.slice(0, 10) + ' → ' + timeMax.slice(0, 10));
  console.log('Mode:     ' + (applyMode ? 'APPLY' : 'DRY-RUN'));
  console.log('Log:      ' + logFile);
  console.log('');

  var user = await db('users').where('id', userId).first();
  if (!user) { console.error('User not found: ' + userId); process.exit(2); }

  var logStream = fs.createWriteStream(logFile, { flags: 'a' });
  logStream.write(csvHeader);

  var providerDefs = [
    { id: 'gcal',  adapter: gcalAdapter  },
    { id: 'msft',  adapter: msftAdapter  },
    { id: 'apple', adapter: appleAdapter },
  ];

  var toRun = provider === 'all'
    ? providerDefs
    : providerDefs.filter(function(p) { return p.id === provider; });

  if (toRun.length === 0) {
    console.error('Unknown provider: ' + provider + '. Use gcal, msft, apple, or all.');
    process.exit(2);
  }

  var totalOrphans = 0;
  var totalDeleted = 0;
  var totalFailed  = 0;

  for (var pi = 0; pi < toRun.length; pi++) {
    var pd = toRun[pi];
    var r = await processProvider(pd.id, pd.adapter, user, logStream);
    totalOrphans += r.orphans;
    totalDeleted += r.deleted;
    totalFailed  += r.failed;
  }

  logStream.end();

  console.log('\n=== SUMMARY ===');
  console.log('Total orphans found: ' + totalOrphans);
  if (applyMode) {
    console.log('Deleted: ' + totalDeleted);
    console.log('Failed:  ' + totalFailed);
  } else {
    console.log('(dry-run — re-run with --apply to delete)');
  }
  console.log('Log: ' + logFile);

  await db.destroy();
  process.exit((applyMode && totalFailed > 0) ? 1 : 0);
}

main().catch(function(err) {
  console.error('FATAL:', err);
  db.destroy().then(function() { process.exit(1); });
});
