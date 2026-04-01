/**
 * One-time cleanup script: delete orphaned duplicate events from MSFT Calendar.
 * Uses exponential backoff to respect Graph API rate limits.
 *
 * Usage: node scripts/cleanup-msft-dupes.js
 */
const db = require('../src/db');
const msftCalApi = require('../src/lib/msft-cal-api');

async function getValidAccessToken(userId) {
  const user = await db('users').where('id', userId).first();
  if (!user || !user.msft_cal_access_token) throw new Error('Not connected');
  const expiry = user.msft_cal_token_expiry ? new Date(user.msft_cal_token_expiry) : null;
  if (expiry && expiry > new Date()) return user.msft_cal_access_token;
  const refreshed = await msftCalApi.refreshAccessToken(user.msft_cal_refresh_token);
  await db('users').where('id', userId).update({
    msft_cal_access_token: refreshed.access_token,
    msft_cal_refresh_token: refreshed.refresh_token || user.msft_cal_refresh_token,
    msft_cal_token_expiry: new Date(Date.now() + refreshed.expires_in * 1000)
  });
  return refreshed.access_token;
}

async function deleteWithRetry(accessToken, eventId, maxRetries = 5) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await msftCalApi.deleteEvent(accessToken, eventId);
      return true;
    } catch (e) {
      if (e.message.includes('404') || e.message.includes('410')) return true; // Already gone
      if (e.message.includes('429') && attempt < maxRetries) {
        const wait = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s, 16s, 32s
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
    const user = await db('users').whereNotNull('msft_cal_access_token').first();
    if (!user) { console.log('No MSFT-connected user'); return; }

    let accessToken = await getValidAccessToken(user.id);

    const keepEvents = new Set(
      await db('tasks').where('user_id', user.id).whereNotNull('msft_event_id').pluck('msft_event_id')
    );

    const now = new Date();
    const windowStart = new Date(now); windowStart.setDate(windowStart.getDate() - 90);
    const windowEnd = new Date(now); windowEnd.setDate(windowEnd.getDate() + 60);

    console.log('Fetching MSFT Calendar events...');
    const result = await msftCalApi.listEvents(accessToken, windowStart.toISOString(), windowEnd.toISOString());
    const events = (result && result.items) || [];
    console.log(`Total events: ${events.length}, linked to tasks: ${keepEvents.size}`);

    // Group by subject+date
    const groups = {};
    for (const ev of events) {
      const dt = ev.start?.dateTime?.split('T')[0] || 'unknown';
      const key = (ev.subject || '') + '|' + dt;
      if (!groups[key]) groups[key] = [];
      groups[key].push({ id: ev.id, linked: keepEvents.has(ev.id) });
    }

    const toDelete = [];
    for (const [key, items] of Object.entries(groups)) {
      if (items.length <= 1) continue;
      const linked = items.filter(i => i.linked);
      const unlinked = items.filter(i => !i.linked);
      if (linked.length >= 1) {
        toDelete.push(...unlinked.map(u => u.id));
      } else {
        // Keep one, delete rest
        toDelete.push(...items.slice(1).map(u => u.id));
      }
    }

    console.log(`\nOrphaned events to delete: ${toDelete.length}\n`);

    let deleted = 0;
    let errors = 0;
    const BATCH_SIZE = 4; // Graph API concurrency-friendly batch
    const BATCH_DELAY = 1000; // 1 second between batches

    for (let i = 0; i < toDelete.length; i++) {
      // Refresh token if needed every 500 deletes
      if (deleted > 0 && deleted % 500 === 0) {
        accessToken = await getValidAccessToken(user.id);
      }

      try {
        await deleteWithRetry(accessToken, toDelete[i]);
        deleted++;
      } catch (e) {
        errors++;
        console.error(`  Failed: ${e.message}`);
      }

      // Rate limit: pause between each delete
      await new Promise(r => setTimeout(r, BATCH_DELAY));

      if ((deleted + errors) % 50 === 0) {
        console.log(`Progress: ${deleted} deleted, ${errors} errors, ${toDelete.length - deleted - errors} remaining`);
      }
    }

    console.log(`\nDone! Deleted: ${deleted}, Errors: ${errors}`);
  } catch (e) {
    console.error('Fatal error:', e);
  } finally {
    await db.destroy();
  }
})();
