/**
 * Cleanup script: deduplicate active cal_sync_ledger records and delete
 * the extra calendar events from both GCal and MSFT.
 *
 * For each task with multiple active ledger records for the same provider:
 *   - Keep the record whose provider_event_id matches the task's current event ID
 *   - Delete the extra events from the calendar provider
 *   - Delete the extra ledger records from the DB
 *
 * Usage: node scripts/cleanup-dupe-ledger.js [--dry-run]
 */
const db = require('../src/db');
const gcalAdapter = require('../src/lib/cal-adapters/gcal.adapter');
const msftAdapter = require('../src/lib/cal-adapters/msft.adapter');
const gcalApi = require('../src/lib/gcal-api');
const msftCalApi = require('../src/lib/msft-cal-api');

const DRY_RUN = process.argv.includes('--dry-run');

async function deleteGcalEvent(token, eventId) {
  try {
    await gcalApi.deleteEvent(token, eventId);
    return true;
  } catch (e) {
    if (e.message.includes('404') || e.message.includes('410')) return true;
    if (e.message.includes('429')) {
      await new Promise(r => setTimeout(r, 5000));
      try { await gcalApi.deleteEvent(token, eventId); return true; } catch (e2) {
        if (e2.message.includes('404') || e2.message.includes('410')) return true;
        throw e2;
      }
    }
    throw e;
  }
}

async function deleteMsftEvent(token, eventId) {
  try {
    await msftCalApi.deleteEvent(token, eventId);
    return true;
  } catch (e) {
    if (e.message.includes('404') || e.message.includes('410')) return true;
    if (e.message.includes('429')) {
      await new Promise(r => setTimeout(r, 5000));
      try { await msftCalApi.deleteEvent(token, eventId); return true; } catch (e2) {
        if (e2.message.includes('404') || e2.message.includes('410')) return true;
        throw e2;
      }
    }
    throw e;
  }
}

(async () => {
  try {
    if (DRY_RUN) console.log('=== DRY RUN — no changes will be made ===\n');

    const user = await db('users').whereNotNull('gcal_refresh_token').orWhereNotNull('msft_cal_access_token').first();
    if (!user) { console.log('No calendar-connected user'); return; }

    // Get tokens
    let gcalToken = null, msftToken = null;
    if (user.gcal_refresh_token) {
      try { gcalToken = await gcalAdapter.getValidAccessToken(user); } catch (e) {
        console.log('GCal token refresh failed:', e.message);
      }
    }
    if (user.msft_cal_refresh_token) {
      try { msftToken = await msftAdapter.getValidAccessToken(user); } catch (e) {
        console.log('MSFT token refresh failed:', e.message);
      }
    }

    // Find all tasks with multiple active ledger records per provider
    const dupes = await db('cal_sync_ledger')
      .where({ user_id: user.id, status: 'active' })
      .whereNotNull('task_id')
      .groupBy('task_id', 'provider')
      .havingRaw('COUNT(*) > 1')
      .select('task_id', 'provider', db.raw('COUNT(*) as cnt'));

    if (dupes.length === 0) {
      console.log('No duplicate ledger records found. All clean!');
      return;
    }

    let totalEventsToDelete = 0;
    let totalLedgerToDelete = 0;
    const actions = []; // { provider, eventId, ledgerId, taskId, summary }

    for (const dupe of dupes) {
      // Get all active ledger records for this task+provider
      const records = await db('cal_sync_ledger')
        .where({ user_id: user.id, provider: dupe.provider, status: 'active', task_id: dupe.task_id })
        .select('id', 'provider_event_id', 'event_summary', 'created_at')
        .orderBy('created_at', 'desc');

      // Get the task's current event ID for this provider
      const task = await db('tasks').where('id', dupe.task_id).first();
      const eventIdCol = dupe.provider === 'gcal' ? 'gcal_event_id' : 'msft_event_id';
      const currentEventId = task ? task[eventIdCol] : null;

      // Keep the record that matches the task's current event ID, or the newest
      let keepId = null;
      for (const r of records) {
        if (r.provider_event_id === currentEventId) {
          keepId = r.id;
          break;
        }
      }
      if (!keepId) keepId = records[0].id; // Keep newest if no match

      const toRemove = records.filter(r => r.id !== keepId);
      const summary = (records[0].event_summary || '(no title)').substring(0, 50);
      console.log(`\n[${dupe.provider}] "${summary}" — ${records.length} records, keeping 1, removing ${toRemove.length}`);

      for (const r of toRemove) {
        console.log(`  DEL: ledger #${r.id}, event ${(r.provider_event_id || 'null').substring(0, 30)}...`);
        actions.push({
          provider: dupe.provider,
          eventId: r.provider_event_id,
          ledgerId: r.id,
          taskId: dupe.task_id,
          summary: summary
        });
        totalEventsToDelete++;
        totalLedgerToDelete++;
      }
    }

    console.log(`\nTotal: ${totalEventsToDelete} events to delete, ${totalLedgerToDelete} ledger records to remove`);

    if (DRY_RUN) {
      console.log('\n=== DRY RUN complete — rerun without --dry-run to apply ===');
      return;
    }

    // Execute deletions
    let eventsDeleted = 0, eventsError = 0;
    let ledgerDeleted = 0;

    for (const action of actions) {
      // Delete event from provider
      if (action.eventId) {
        try {
          if (action.provider === 'gcal' && gcalToken) {
            await deleteGcalEvent(gcalToken, action.eventId);
          } else if (action.provider === 'msft' && msftToken) {
            await deleteMsftEvent(msftToken, action.eventId);
          }
          eventsDeleted++;
        } catch (e) {
          eventsError++;
          console.error(`  Failed to delete ${action.provider} event: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 500));
      }

      // Delete ledger record
      await db('cal_sync_ledger').where('id', action.ledgerId).del();
      ledgerDeleted++;
    }

    console.log(`\nDone! Events deleted: ${eventsDeleted}, errors: ${eventsError}, ledger records removed: ${ledgerDeleted}`);
  } catch (e) {
    console.error('Fatal error:', e);
  } finally {
    await db.destroy();
  }
})();
