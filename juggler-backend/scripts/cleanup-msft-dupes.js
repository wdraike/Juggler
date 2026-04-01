/**
 * One-time cleanup script: delete duplicate events from MSFT Calendar,
 * including linked duplicates created by the round-trip bug (HTML &amp; encoding).
 *
 * For each group of events with the same subject+date:
 *   - Keep the one linked to the OLDEST task (the original)
 *   - Delete the rest from MSFT Calendar
 *   - Remove the orphaned task rows and ledger records from the DB
 *
 * Usage: node scripts/cleanup-msft-dupes.js [--dry-run]
 */
const db = require('../src/db');
const msftCalApi = require('../src/lib/msft-cal-api');

const DRY_RUN = process.argv.includes('--dry-run');

async function getValidAccessToken(userId) {
  const user = await db('users').where('id', userId).first();
  if (!user || !user.msft_cal_access_token) throw new Error('Not connected');
  const expiry = user.msft_cal_token_expiry ? new Date(user.msft_cal_token_expiry) : null;
  if (expiry && expiry > new Date()) return user.msft_cal_access_token;
  const refreshed = await msftCalApi.refreshAccessToken(user.msft_cal_refresh_token);
  await db('users').where('id', userId).update({
    msft_cal_access_token: refreshed.accessToken,
    msft_cal_refresh_token: refreshed.refreshToken || user.msft_cal_refresh_token,
    msft_cal_token_expiry: new Date(Date.now() + (refreshed.expiresIn || 3600) * 1000)
  });
  return refreshed.accessToken;
}

async function deleteWithRetry(accessToken, eventId, maxRetries = 5) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await msftCalApi.deleteEvent(accessToken, eventId);
      return true;
    } catch (e) {
      if (e.message.includes('404') || e.message.includes('410')) return true;
      if (e.message.includes('429') && attempt < maxRetries) {
        const wait = Math.pow(2, attempt + 1) * 1000;
        console.log(`  Rate limited, waiting ${wait / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
  return false;
}

(async () => {
  try {
    if (DRY_RUN) console.log('=== DRY RUN — no changes will be made ===\n');

    const user = await db('users').whereNotNull('msft_cal_access_token').first();
    if (!user) { console.log('No MSFT-connected user'); return; }

    let accessToken = await getValidAccessToken(user.id);

    // Build a map of msft_event_id → task row
    const taskRows = await db('tasks')
      .where('user_id', user.id)
      .whereNotNull('msft_event_id')
      .select('id', 'text', 'msft_event_id', 'created_at', 'scheduled_at');

    const taskByEventId = {};
    for (const t of taskRows) {
      taskByEventId[t.msft_event_id] = t;
    }

    const now = new Date();
    const windowStart = new Date(now); windowStart.setDate(windowStart.getDate() - 90);
    const windowEnd = new Date(now); windowEnd.setDate(windowEnd.getDate() + 60);

    console.log('Fetching MSFT Calendar events...');
    const result = await msftCalApi.listEvents(accessToken, windowStart.toISOString(), windowEnd.toISOString());
    const events = (result && result.items) || [];
    console.log(`Total events: ${events.length}, linked to tasks: ${Object.keys(taskByEventId).length}`);

    // Group by subject+date
    const groups = {};
    for (const ev of events) {
      const dt = ev.start?.dateTime?.split('T')[0] || 'unknown';
      const key = (ev.subject || '') + '|' + dt;
      if (!groups[key]) groups[key] = [];
      const task = taskByEventId[ev.id] || null;
      groups[key].push({
        id: ev.id,
        task: task,
        taskCreatedAt: task ? new Date(task.created_at) : null
      });
    }

    // For each group with duplicates, keep only the oldest-task event
    const eventsToDelete = [];    // MSFT event IDs
    const tasksToCleanup = [];    // task IDs to remove msft_event_id + delete if round-trip clone

    for (const [key, items] of Object.entries(groups)) {
      if (items.length <= 1) continue;

      // Sort: linked items first (by oldest task created_at), then unlinked
      items.sort(function(a, b) {
        if (a.task && !b.task) return -1;
        if (!a.task && b.task) return 1;
        if (a.taskCreatedAt && b.taskCreatedAt) return a.taskCreatedAt - b.taskCreatedAt;
        return 0;
      });

      // Keep the first (oldest linked or first unlinked), delete the rest
      const keep = items[0];
      const dupes = items.slice(1);

      if (dupes.length > 0) {
        console.log(`\nDuplicate group: "${key}" (${items.length} events)`);
        console.log(`  KEEP: event ${keep.id.substring(0, 30)}...${keep.task ? ' (task ' + keep.task.id + ', created ' + keep.task.created_at + ')' : ' (unlinked)'}`);
      }

      for (const dupe of dupes) {
        eventsToDelete.push(dupe.id);
        console.log(`  DEL:  event ${dupe.id.substring(0, 30)}...${dupe.task ? ' (task ' + dupe.task.id + ', created ' + dupe.task.created_at + ')' : ' (unlinked)'}`);

        if (dupe.task) {
          tasksToCleanup.push(dupe.task.id);
        }
      }
    }

    console.log(`\nEvents to delete: ${eventsToDelete.length}`);
    console.log(`Tasks to clean up: ${tasksToCleanup.length}`);

    if (DRY_RUN) {
      console.log('\n=== DRY RUN complete — rerun without --dry-run to apply ===');
      return;
    }

    // 1. Delete duplicate events from MSFT Calendar
    let deleted = 0;
    let errors = 0;
    for (let i = 0; i < eventsToDelete.length; i++) {
      if (deleted > 0 && deleted % 500 === 0) {
        accessToken = await getValidAccessToken(user.id);
      }
      try {
        await deleteWithRetry(accessToken, eventsToDelete[i]);
        deleted++;
      } catch (e) {
        errors++;
        console.error(`  Failed to delete event: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    console.log(`\nMSFT events: ${deleted} deleted, ${errors} errors`);

    // 2. Clean up orphaned tasks and ledger records in the DB
    if (tasksToCleanup.length > 0) {
      // Remove ledger records pointing to these tasks
      const ledgerDeleted = await db('cal_sync_ledger')
        .where('user_id', user.id)
        .whereIn('task_id', tasksToCleanup)
        .del();
      console.log(`Ledger records deleted: ${ledgerDeleted}`);

      // Delete the duplicate task rows
      const taskDeleted = await db('tasks')
        .where('user_id', user.id)
        .whereIn('id', tasksToCleanup)
        .del();
      console.log(`Duplicate tasks deleted: ${taskDeleted}`);
    }

    console.log('\nDone!');
  } catch (e) {
    console.error('Fatal error:', e);
  } finally {
    await db.destroy();
  }
})();
