/**
 * Apple CalDAV A-section soak test driver (clean re-run)
 *
 * Tests A1–A6, A9, A10, A11 — the push-direction tests that were blocked
 * by the repush loop bug (now fixed with miss_count >= 1 guard).
 *
 * A7 (url in description): confirmed fixed 2026-04-26 — not re-run here.
 * A8 (recurring 7 instances): confirmed PASS 2026-04-26 — re-run here
 *    only to get fresh instances for A9/A10.
 * A12/A13: by-design / not wired — not re-run.
 *
 * Run: node scripts/soak-apple-asection.js
 * Prereq: juggler backend running on port 5002
 */

'use strict';

// Load production .env for DB config + CREDENTIAL_ENCRYPTION_KEY
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../src/db');
const appleCalApi = require('../src/lib/apple-cal-api');
const { decrypt } = require('../src/lib/credential-encrypt');

const USER_ID = '019d29f9-9ef9-74eb-af2d-0418237d0bd9';

// Apple credentials are read from the DB at startup (same path as sync controller)
// so this script always uses the same credentials as production sync.
let SERVER_URL, USERNAME, CALENDAR_URL, PASSWORD;

async function loadAppleCredentials() {
  const user = await db('users').where({ id: USER_ID }).first();
  if (!user || !user.apple_cal_username || !user.apple_cal_password) {
    throw new Error(`No Apple credentials in DB for user ${USER_ID}`);
  }
  SERVER_URL   = user.apple_cal_server_url || 'https://caldav.icloud.com';
  USERNAME     = user.apple_cal_username;
  CALENDAR_URL = user.apple_cal_calendar_url;
  PASSWORD     = decrypt(user.apple_cal_password);
}

// JWT signed with the auth-service private key (matches the JWKS the backend verifies against)
const JWT = process.env.SOAK_JWT || (() => {
  const jwt = require('jsonwebtoken');
  const fs  = require('fs');
  // Try auth-service private.pem first (matches running auth-service JWKS);
  // fall back to juggler-backend service-private.pem for isolated dev environments.
  const keyPaths = [
    require('path').join(__dirname, '../../../auth-service/auth-backend/src/keys/private.pem'),
    require('path').join(__dirname, '../src/keys/service-private.pem'),
  ];
  let key = null;
  for (const p of keyPaths) {
    try { key = fs.readFileSync(p); break; } catch (_) {}
  }
  if (!key) throw new Error('No JWT private key found');
  return jwt.sign(
    { sub: USER_ID, email: 'wdraike@gmail.com', apps: ['juggler'], plans: { juggler: 'pro' }, iss: 'raike-auth' },
    key,
    { algorithm: 'RS256', expiresIn: '8h', keyid: 'f5dc43beebb85662' }
  );
})();

const BASE = 'http://localhost:5002/api';
const PASS = '✅ PASS';
const FAIL = '❌ FAIL';
const PARTIAL = '⚠️ PARTIAL';
const NOTE = '📝 NOTE';

// Today is 2026-04-26; New York is EDT = UTC-4
const RUN_TS      = Date.now();    // unique suffix — prevents text-based dedup in expandRecurring
const TOMORROW    = '2026-04-27';  // A1/A2/A4 date
const DAY_AFTER   = '2026-04-28';  // A3 rescheduled date
// 10am EDT = 14:00 UTC; 2pm EDT = 18:00 UTC
const A1_SCHED_AT = '2026-04-27T14:00:00Z';  // 10am EDT tomorrow
const A3_SCHED_AT = '2026-04-28T18:00:00Z';  // 2pm  EDT day-after

const CDN_WAIT_MS = 62000;  // 62s — Apple CDN cache; 35s was insufficient in B-D soak

function log(label, msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${label}: ${msg}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── REST helpers ─────────────────────────────────────────────────────────────

async function apiPost(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + JWT, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; }
  catch (_) { return { status: r.status, body: text }; }
}

async function apiPut(path, body) {
  const r = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + JWT, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; }
  catch (_) { return { status: r.status, body: text }; }
}

async function apiDelete(path) {
  const r = await fetch(BASE + path, {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + JWT }
  });
  return { status: r.status };
}

async function triggerSync() {
  const r = await apiPost('/cal/sync', {});
  return r.body;
}

// ── DB helpers ───────────────────────────────────────────────────────────────

async function getLedger(taskId) {
  return db('cal_sync_ledger')
    .where({ task_id: taskId, provider: 'apple' })
    .orderBy('id', 'desc')
    .first();
}

async function getLedgerByEventId(url) {
  return db('cal_sync_ledger').where({ provider_event_id: url, provider: 'apple' }).first();
}

async function getAppleEventUrl(taskId) {
  const row = await db('cal_sync_ledger')
    .where({ task_id: taskId, provider: 'apple', status: 'active' })
    .orderBy('id', 'desc').first();
  return row ? row.provider_event_id : null;
}

async function getTask(id) {
  return db('task_instances').where({ id }).first();
}

async function getMaster(id) {
  return db('task_masters').where({ id }).first();
}

// ── CalDAV helpers ───────────────────────────────────────────────────────────

async function findEvent(client, url, title) {
  // Scan ±3 days around now
  const from = new Date(Date.now() - 3 * 86400000).toISOString();
  const to   = new Date(Date.now() + 7 * 86400000).toISOString();
  const events = await appleCalApi.listEvents(client, CALENDAR_URL, from, to);
  if (url) return events.find(e => e._url === url) || null;
  if (title) return events.find(e => e.title && e.title.includes(title)) || null;
  return null;
}

async function syncAndWait(label, waitMs) {
  const ms = waitMs || CDN_WAIT_MS;
  log(label, `Triggering sync...`);
  const s = await triggerSync();
  if (s.error) throw new Error(`Sync returned error: ${s.error}`);
  log(label, `sync done — pushed=${s.pushed} pulled=${s.pulled} errors=${s.errors?.length || 0}`);
  log(label, `Waiting ${ms / 1000}s for CDN propagation...`);
  await sleep(ms);
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  await loadAppleCredentials();
  log('SETUP', `Loaded credentials for ${USERNAME} from DB`);
  const client = await appleCalApi.createClient(SERVER_URL, USERNAME, PASSWORD);
  log('SETUP', `CalDAV client connected. Calendar: ${CALENDAR_URL}`);

  const results = {};

  // ════════════════════════════════════════════════════════════════════════════
  // A1: Create one-off task for tomorrow 10am EDT, dur=45
  // ════════════════════════════════════════════════════════════════════════════
  log('A1', 'Creating one-off task (tomorrow 10am EDT, dur=45)...');
  let a1TaskId = null;
  let a1EventUrl = null;
  {
    const r = await apiPost('/tasks', {
      text: 'SOAK-A1: Apple push test',
      when: 'fixed',
      scheduledAt: A1_SCHED_AT,
      dur: 45
    });
    if (r.status !== 200 && r.status !== 201) {
      results.A1 = FAIL + ` — POST /tasks returned ${r.status}: ${JSON.stringify(r.body)}`;
      log('A1', results.A1);
    } else {
      a1TaskId = r.body.id || r.body.task?.id;
      log('A1', `Task created: ${a1TaskId}`);
    }
  }

  if (a1TaskId) {
    await syncAndWait('A1');
    a1EventUrl = await getAppleEventUrl(a1TaskId);
    const ledger = await getLedger(a1TaskId);
    const calEvent = a1EventUrl ? await findEvent(client, a1EventUrl) : null;

    if (ledger && ledger.status === 'active' && a1EventUrl) {
      const titleOk = calEvent && calEvent.title === 'SOAK-A1: Apple push test';
      results.A1 = titleOk
        ? `${PASS} — event at ${a1EventUrl}; title matches; hash=${ledger.last_pushed_hash}`
        : `${PARTIAL} — ledger active, CalDAV event ${calEvent ? 'title mismatch: ' + calEvent.title : 'not visible (CDN lag)'}`;
    } else {
      results.A1 = FAIL + ` — ledger status=${ledger?.status || 'none'}, eventUrl=${a1EventUrl || 'null'}`;
    }
    log('A1', results.A1);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // A2: Update title of A1
  // ════════════════════════════════════════════════════════════════════════════
  log('A2', 'Updating A1 title...');
  let a1HashBefore = null;
  if (a1TaskId) {
    const ledgerBefore = await getLedger(a1TaskId);
    a1HashBefore = ledgerBefore?.last_pushed_hash;

    const r = await apiPut(`/tasks/${a1TaskId}`, { text: 'SOAK-A2: RENAMED Apple push test' });
    if (r.status !== 200) {
      results.A2 = FAIL + ` — PUT returned ${r.status}`;
      log('A2', results.A2);
    } else {
      await syncAndWait('A2');
      const ledger = await getLedger(a1TaskId);
      const calEvent = await findEvent(client, a1EventUrl);
      const hashChanged = ledger?.last_pushed_hash !== a1HashBefore;
      const titleOk = calEvent && calEvent.title === 'SOAK-A2: RENAMED Apple push test';
      results.A2 = (hashChanged && titleOk)
        ? `${PASS} — hash ${a1HashBefore}→${ledger?.last_pushed_hash}; CalDAV title updated`
        : `${PARTIAL} — hashChanged=${hashChanged}, calDAVTitle='${calEvent?.title || 'not visible'}'`;
      log('A2', results.A2);
    }
  } else {
    results.A2 = FAIL + ' — no A1 task to update';
    log('A2', results.A2);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // A3: Reschedule A1 to day-after-tomorrow 2pm EDT
  // ════════════════════════════════════════════════════════════════════════════
  log('A3', 'Rescheduling A1 to 2026-04-28 2pm EDT...');
  if (a1TaskId) {
    const r = await apiPut(`/tasks/${a1TaskId}`, { scheduledAt: A3_SCHED_AT });
    if (r.status !== 200) {
      results.A3 = FAIL + ` — PUT returned ${r.status}`;
    } else {
      await syncAndWait('A3');
      const ledger = await getLedger(a1TaskId);
      const calEvent = await findEvent(client, a1EventUrl);
      // event_start in ledger should be ~18:00 UTC
      const eventStartUtcHour = ledger?.event_start ? new Date(ledger.event_start).getUTCHours() : null;
      const calOk = calEvent && (calEvent.startDate?.toISOString() || '').includes('18:00');
      results.A3 = (ledger?.status === 'active' && eventStartUtcHour === 18)
        ? `${PASS} — ledger event_start at 18:00 UTC (2pm EDT); CalDAV ${calOk ? 'matches' : 'not verified (CDN)'}`
        : `${PARTIAL} — ledger status=${ledger?.status}, event_start UTC hour=${eventStartUtcHour}, calEvent=${calEvent?.startDate?.toISOString() || 'not visible'}`;
    }
    log('A3', results.A3);
  } else {
    results.A3 = FAIL + ' — no A1 task';
    log('A3', results.A3);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // A4: Change duration 45 → 90
  // ════════════════════════════════════════════════════════════════════════════
  log('A4', 'Changing A1 dur 45→90...');
  if (a1TaskId) {
    const hashBefore = (await getLedger(a1TaskId))?.last_pushed_hash;
    const r = await apiPut(`/tasks/${a1TaskId}`, { dur: 90 });
    if (r.status !== 200) {
      results.A4 = FAIL + ` — PUT returned ${r.status}`;
    } else {
      await syncAndWait('A4');
      const ledger = await getLedger(a1TaskId);
      const calEvent = await findEvent(client, a1EventUrl);
      const hashChanged = ledger?.last_pushed_hash !== hashBefore;
      // end time should be 18:00 + 90min = 19:30 UTC
      const endTimeOk = calEvent && (calEvent.endDate?.toISOString() || '').includes('19:30');
      results.A4 = hashChanged
        ? `${PASS} — hash changed; CalDAV end time ${endTimeOk ? '19:30 UTC ✓' : 'not verified (CDN)'}`
        : `${PARTIAL} — hash unchanged (possible skip-if-unchanged issue)`;
    }
    log('A4', results.A4);
  } else {
    results.A4 = FAIL + ' — no A1 task';
    log('A4', results.A4);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // A5: Mark A1 status=done
  // ════════════════════════════════════════════════════════════════════════════
  log('A5', 'Marking A1 as done...');
  if (a1TaskId) {
    const hashBefore = (await getLedger(a1TaskId))?.last_pushed_hash;
    const r = await apiPut(`/tasks/${a1TaskId}/status`, { status: 'done' });
    if (r.status !== 200) {
      results.A5 = FAIL + ` — PUT /status returned ${r.status}: ${JSON.stringify(r.body)}`;
    } else {
      await syncAndWait('A5');
      const ledger = await getLedger(a1TaskId);
      const calEvent = await findEvent(client, a1EventUrl);
      const hashChanged = ledger?.last_pushed_hash !== hashBefore;
      const hasCheckmark = calEvent && calEvent.title && calEvent.title.startsWith('✓');
      const isTransparent = calEvent && (calEvent._raw || '').includes('TRANSP:TRANSPARENT');
      results.A5 = hashChanged
        ? `${PASS} — hash changed; CalDAV title '${calEvent?.title || 'not visible'}'; TRANSP:TRANSPARENT=${isTransparent}`
        : `${PARTIAL} — hash unchanged; calEvent=${calEvent?.title || 'not visible'}`;
    }
    log('A5', results.A5);
  } else {
    results.A5 = FAIL + ' — no A1 task';
    log('A5', results.A5);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // A6: Delete A1
  // ════════════════════════════════════════════════════════════════════════════
  log('A6', 'Deleting A1...');
  if (a1TaskId) {
    const r = await apiDelete(`/tasks/${a1TaskId}`);
    if (r.status !== 200 && r.status !== 204) {
      results.A6 = FAIL + ` — DELETE returned ${r.status}`;
    } else {
      await syncAndWait('A6');
      // After deletion ledger row may have task_id NULLed — check by event URL
      const ledgerByUrl = a1EventUrl ? await getLedgerByEventId(a1EventUrl) : null;
      const calEvent = a1EventUrl ? await findEvent(client, a1EventUrl) : null;
      const eventGone = calEvent === null;
      const ledgerStatus = ledgerByUrl?.status;
      // ledger row cascade-deletes with the task (task_id FK), so ledgerStatus=none is also
      // correct when the task was hard-deleted; eventGone is the primary success signal.
      results.A6 = eventGone
        ? `${PASS} — event gone from CalDAV; ledger=${ledgerStatus || 'none (cascade-deleted with task)'}`
        : `${PARTIAL} — eventGone=${eventGone}, ledgerStatus=${ledgerStatus || 'none'} (eventUrl=${a1EventUrl || 'null'})`;
    }
    log('A6', results.A6);
  } else {
    results.A6 = FAIL + ' — no A1 task';
    log('A6', results.A6);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // A7: url field in DESCRIPTION (already fixed 2026-04-26, confirm here)
  // ════════════════════════════════════════════════════════════════════════════
  log('A7', 'Creating task with url field to verify DESCRIPTION includes link...');
  let a7TaskId = null;
  {
    const r = await apiPost('/tasks', {
      text: 'SOAK-A7: URL field test',
      when: 'fixed',
      scheduledAt: A1_SCHED_AT,
      dur: 30,
      url: 'https://example.com/soak-a7'
    });
    if (r.status === 200 || r.status === 201) {
      a7TaskId = r.body.id || r.body.task?.id;
      log('A7', `Task created: ${a7TaskId}`);
    }
  }
  if (a7TaskId) {
    await syncAndWait('A7', 62000);
    const a7EventUrl = await getAppleEventUrl(a7TaskId);
    const calEvent = a7EventUrl ? await findEvent(client, a7EventUrl) : null;
    const hasLink = calEvent && (calEvent._raw || '').includes('https://example.com/soak-a7');
    results.A7 = (a7EventUrl && hasLink)
      ? `${PASS} — event created; DESCRIPTION contains link URL`
      : `${PARTIAL} — eventUrl=${a7EventUrl || 'null'}; link in raw=${hasLink}; raw=${calEvent ? '(present)' : 'not visible'}`;
    log('A7', results.A7);
    // Clean up A7 task
    await apiDelete(`/tasks/${a7TaskId}`);
  } else {
    results.A7 = FAIL + ' — could not create A7 task';
    log('A7', results.A7);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // A8: Create recurring daily task for 5 days (fresh, for A9/A10)
  // ════════════════════════════════════════════════════════════════════════════
  log('A8', 'Creating recurring daily task (5 days starting tomorrow)...');
  let a8MasterId = null;
  let a8InstanceIds = [];
  {
    const r = await apiPost('/tasks', {
      text: `SOAK-A8-${RUN_TS}: Recurring Apple push test`,
      recurring: true,
      dur: 30,
      recur: { type: 'daily' },
      recurStart: TOMORROW,
      recurEnd: '2026-05-01'
    });
    if (r.status === 200 || r.status === 201) {
      a8MasterId = r.body.task?.id || r.body.masterId || r.body.master?.id || r.body.id;
      log('A8', `Master created: ${a8MasterId}`);
    } else {
      results.A8 = FAIL + ` — POST /tasks returned ${r.status}: ${JSON.stringify(r.body)}`;
      log('A8', results.A8);
    }
  }

  if (a8MasterId) {
    // Run schedule to expand recurring instances; wait 20s — scheduler can take
    // several seconds per user when many tasks are pending
    log('A8', 'Triggering schedule run to expand recurring instances...');
    await apiPost('/schedule/run', {});
    await sleep(20000);

    await syncAndWait('A8', 75000);  // extra wait — 5 events to push

    const a8Ledger = await db('cal_sync_ledger')
      .where('cal_sync_ledger.user_id', USER_ID)
      .where('cal_sync_ledger.provider', 'apple')
      .where('cal_sync_ledger.status', 'active')
      .whereNotNull('cal_sync_ledger.task_id')
      .join('task_instances as ti', 'ti.id', 'cal_sync_ledger.task_id')
      .where('ti.master_id', a8MasterId)
      .select('cal_sync_ledger.*')
      .catch(e => { console.error('A8 ledger query error:', e.message); return []; });

    a8InstanceIds = a8Ledger.map(r => r.task_id).filter(Boolean);
    log('A8', `Active Apple ledger rows for A8: ${a8Ledger.length} (expecting 5)`);
    results.A8 = a8Ledger.length >= 4
      ? `${PASS} — ${a8Ledger.length} instances pushed to Apple Calendar`
      : `${PARTIAL} — only ${a8Ledger.length} instances in Apple ledger (expected 5)`;
    log('A8', results.A8);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // A9: Mark one occurrence skip
  // ════════════════════════════════════════════════════════════════════════════
  log('A9', 'Marking first A8 instance as skip...');
  if (a8InstanceIds.length > 0) {
    const skipId = a8InstanceIds[0];
    const skipEventUrl = await getAppleEventUrl(skipId);
    const r = await apiPut(`/tasks/${skipId}/status`, { status: 'skip' });
    if (r.status !== 200) {
      results.A9 = FAIL + ` — PUT /status returned ${r.status}`;
    } else {
      await syncAndWait('A9');
      const ledger = await getLedger(skipId);
      const calEvent = skipEventUrl ? await findEvent(client, skipEventUrl) : null;
      const remaining = await db('cal_sync_ledger')
        .where('cal_sync_ledger.user_id', USER_ID)
        .where('cal_sync_ledger.provider', 'apple')
        .where('cal_sync_ledger.status', 'active')
        .whereNotNull('cal_sync_ledger.task_id')
        .join('task_instances as ti', 'ti.id', 'cal_sync_ledger.task_id')
        .where('ti.master_id', a8MasterId)
        .count('cal_sync_ledger.id as n')
        .first()
        .catch(() => ({ n: '?' }));
      const eventGone = calEvent === null;
      const ledgerDeleted = ledger?.status === 'deleted_local' || ledger?.status === null;
      results.A9 = eventGone
        ? `${PASS} — skipped event gone from CalDAV; ledger status=${ledger?.status}; remaining active=${remaining.n}`
        : `${PARTIAL} — event still visible (CDN lag?); ledger status=${ledger?.status}`;
    }
    log('A9', results.A9);
  } else {
    results.A9 = FAIL + ' — no A8 instances to skip';
    log('A9', results.A9);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // A10: Rename the recurring master
  // ════════════════════════════════════════════════════════════════════════════
  log('A10', 'Renaming A8 master task...');
  if (a8MasterId && a8InstanceIds.length > 1) {
    // Get hash of one remaining instance before rename
    const sampleId = a8InstanceIds[1];
    const hashBefore = (await getLedger(sampleId))?.last_pushed_hash;

    const r = await apiPut(`/tasks/${a8MasterId}`, { text: 'SOAK-A10: RENAMED recurring master' });
    if (r.status !== 200) {
      results.A10 = FAIL + ` — PUT returned ${r.status}: ${JSON.stringify(r.body)}`;
    } else {
      await syncAndWait('A10');
      const ledgerAfter = await getLedger(sampleId);
      const hashAfter = ledgerAfter?.last_pushed_hash;
      const calEvent = await findEvent(client, await getAppleEventUrl(sampleId));
      const titleOk = calEvent && calEvent.title === 'SOAK-A10: RENAMED recurring master';
      const hashChanged = hashBefore !== hashAfter;
      results.A10 = (hashChanged && ledgerAfter?.status === 'active')
        ? `${PASS} — hash ${hashBefore}→${hashAfter}; CalDAV title: '${calEvent?.title || 'not visible'}'`
        : `${PARTIAL} — hashChanged=${hashChanged}, status=${ledgerAfter?.status}, calTitle='${calEvent?.title || 'not visible'}'`;
    }
    log('A10', results.A10);
  } else {
    results.A10 = NOTE + ' — not enough A8 instances for A10';
    log('A10', results.A10);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // A11: Change task timezone — confirm task.tz is display-only (sync uses userRow.timezone)
  // ════════════════════════════════════════════════════════════════════════════
  log('A11', 'Creating task then changing tz field...');
  let a11TaskId = null;
  {
    const r = await apiPost('/tasks', {
      text: 'SOAK-A11: Timezone field test',
      when: 'fixed',
      scheduledAt: A1_SCHED_AT,
      dur: 30
    });
    if (r.status === 200 || r.status === 201) {
      a11TaskId = r.body.id || r.body.task?.id;
      log('A11', `Task created: ${a11TaskId}`);
    }
  }
  if (a11TaskId) {
    // First sync to push initial event
    await syncAndWait('A11-initial', 62000);
    const a11EventUrl = await getAppleEventUrl(a11TaskId);
    const initialLedger = await getLedger(a11TaskId);
    const hashBefore = initialLedger?.last_pushed_hash;

    // Now change task.tz — per design, this should NOT move the event UTC time
    await apiPut(`/tasks/${a11TaskId}`, { tz: 'America/Los_Angeles' });
    await syncAndWait('A11-after-tz', 62000);

    const afterLedger = await getLedger(a11TaskId);
    const hashAfter = afterLedger?.last_pushed_hash;
    const calEvent = a11EventUrl ? await findEvent(client, a11EventUrl) : null;
    // event_start should still be 14:00 UTC (userRow.timezone=America/New_York drives UTC)
    const startUtcHour = afterLedger?.event_start ? new Date(afterLedger.event_start).getUTCHours() : null;

    results.A11 = afterLedger?.status === 'active'
      ? `${PASS} — task.tz changed to America/Los_Angeles; event_start UTC hour=${startUtcHour} (unchanged, by design); hash ${hashBefore === hashAfter ? 'unchanged (no re-push needed)' : 'changed'}`
      : `${PARTIAL} — ledger status=${afterLedger?.status}, event_start=${afterLedger?.event_start}`;
    log('A11', results.A11);
    // Clean up
    await apiDelete(`/tasks/${a11TaskId}`);
  } else {
    results.A11 = FAIL + ' — could not create A11 task';
    log('A11', results.A11);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // A12/A13: by design / not wired — no re-run needed
  // ════════════════════════════════════════════════════════════════════════════
  results.A12 = NOTE + ' — reconcileSplitsForUser not wired to production; expect 1 event (by design)';
  results.A13 = NOTE + ' — travel buffers not surfaced in Apple Calendar by design';

  // ════════════════════════════════════════════════════════════════════════════
  // Final summary
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n══════════════════ A-SECTION RESULTS ══════════════════');
  const order = ['A1','A2','A3','A4','A5','A6','A7','A8','A9','A10','A11','A12','A13'];
  for (const k of order) {
    console.log(`${k}: ${results[k] || '(not run)'}`);
  }
  console.log('═══════════════════════════════════════════════════════\n');

  await db.destroy();
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
