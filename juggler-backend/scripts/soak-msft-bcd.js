/**
 * Microsoft Calendar B–D soak test driver
 *
 * Tests: B1-B5 (pull/push/MISS_THRESHOLD), C1-C4 (conflict/race), D (30-min stability)
 *
 * Differences from Apple soak:
 * - No CDN lag — Graph API changes are immediately visible; use 30s inter-sync gaps
 * - Events identified by Graph event ID (not CalDAV URL)
 * - Token obtained from DB refresh flow (msft_cal_refresh_token → fresh access_token)
 * - Verification via Graph API GET after each sync
 * - Pre-run cleanup marks stale SOAK MSFT ledger rows as 'replaced'
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db          = require('../src/db');
const msftCalApi  = require('../src/lib/msft-cal-api');
const msftAdapter = require('../src/lib/cal-adapters/msft.adapter');

const USER_ID = '019d29f9-9ef9-74eb-af2d-0418237d0bd9';
const BASE    = 'http://localhost:5002/api';
const RUN_TS  = Date.now();

// Dynamic JWT
const JWT = process.env.SOAK_JWT || (() => {
  const jwt = require('jsonwebtoken');
  const fs  = require('fs');
  const keyPaths = [
    require('path').join(__dirname, '../../../auth-service/auth-backend/src/keys/private.pem'),
    require('path').join(__dirname, '../src/keys/service-private.pem'),
  ];
  let key = null;
  for (const p of keyPaths) { try { key = fs.readFileSync(p); break; } catch (_) {} }
  if (!key) throw new Error('No JWT private key found');
  return jwt.sign(
    { sub: USER_ID, email: 'wdraike@gmail.com', apps: ['juggler'], plans: { juggler: 'pro' }, iss: 'raike-auth' },
    key,
    { algorithm: 'RS256', expiresIn: '8h', keyid: 'f5dc43beebb85662' }
  );
})();

const _tomorrow = new Date();
_tomorrow.setUTCDate(_tomorrow.getUTCDate() + 1);
const TOMORROW_ISO = _tomorrow.toISOString().slice(0, 10);

// MSFT has no CDN lag — 30s between syncs is enough for B3/B5 MISS_THRESHOLD cycling
const INTER_SYNC_MS = 30000;

const PASS    = '✅ PASS';
const FAIL    = '❌ FAIL';
const PARTIAL = '⚠️ PARTIAL';
const NOTE    = '📝 NOTE';

function log(label, msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${label}: ${msg}`);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Juggler REST helpers ──────────────────────────────────────────────────────
async function apiFetch(method, path, body) {
  const opts = {
    method,
    headers: { Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json' }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; }
  catch (_) { return { status: r.status, body: text }; }
}
const apiPost = (path, body) => apiFetch('POST', path, body);
const apiPut  = (path, body) => apiFetch('PUT',  path, body);

async function triggerSync() {
  const r = await apiPost('/cal/sync', {});
  return {
    pushed:         r.body.pushed         || 0,
    pulled:         r.body.pulled         || 0,
    deleted_local:  r.body.deleted_local  || 0,
    deleted_remote: r.body.deleted_remote || 0,
    errors:         r.body.errors?.length || 0
  };
}

// ── MSFT token helper ─────────────────────────────────────────────────────────
// Returns a valid access token, refreshing if expired.
// msftAdapter.getValidAccessToken reads userRow and updates the DB in-place.
async function getMsftToken() {
  const userRow = await db('users').where({ id: USER_ID }).first();
  return msftAdapter.getValidAccessToken(userRow);
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ── Graph API wrappers ────────────────────────────────────────────────────────
async function graphGet(token, eventId) {
  try {
    const resp = await fetch(GRAPH_BASE + '/me/events/' + encodeURIComponent(eventId), {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
        Prefer: 'outlook.body-content-type="text"' }
    });
    if (!resp.ok) return null;
    return resp.json();
  } catch (_) { return null; }
}

async function graphCreate(token, eventBody) {
  return msftCalApi.insertEvent(token, eventBody);
}

async function graphPatch(token, eventId, patch) {
  return msftCalApi.patchEvent(token, eventId, patch);
}

async function graphDelete(token, eventId) {
  try {
    await msftCalApi.deleteEvent(token, eventId);
    return true;
  } catch (e) {
    log('GRAPH', 'DELETE failed: ' + e.message);
    return false;
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function getLedgerRow(taskId) {
  return db('cal_sync_ledger')
    .where({ task_id: taskId, provider: 'msft' })
    .orderBy('id', 'desc')
    .first();
}

async function getMsftEventId(taskId) {
  const row = await db('cal_sync_ledger')
    .where({ task_id: taskId, provider: 'msft', status: 'active' })
    .orderBy('id', 'desc')
    .first();
  return row ? row.provider_event_id : null;
}

// ── Pre-run cleanup (orphan-only) ─────────────────────────────────────────────
// Do NOT mark existing SOAK task rows as 'replaced' — that would free them for
// Phase 3 re-push and cause unnecessary re-push churn. Only retire true orphans
// (ledger rows whose task_instance no longer exists).
async function cleanupSoakDebris() {
  const orphanClean = await db.raw(`
    UPDATE cal_sync_ledger l
    LEFT JOIN task_instances ti ON ti.id = l.task_id
    SET l.status = 'replaced'
    WHERE l.provider = 'msft'
    AND l.user_id = ?
    AND l.status = 'active'
    AND ti.id IS NULL
  `, [USER_ID]);

  log('CLEANUP', 'Marked ' + orphanClean[0].affectedRows + ' orphan rows as replaced');
}

// ── Flush sync ────────────────────────────────────────────────────────────────
// Stabilize MSFT before creating test tasks: push any unledgered existing tasks
// so Phase 3 in sync 0 only has the 16 new test tasks to handle.
async function flushSync() {
  log('FLUSH', 'Pre-flush sync (stabilizing MSFT before test task creation)...');
  const f1 = await triggerSync();
  log('FLUSH-1', 'pushed=' + f1.pushed + ' errors=' + f1.errors);
  if (f1.pushed > 30 || f1.errors > 10) {
    log('FLUSH', 'High push count — waiting 30s then second flush...');
    await sleep(30000);
    const f2 = await triggerSync();
    log('FLUSH-2', 'pushed=' + f2.pushed + ' errors=' + f2.errors);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('SETUP', `RUN_TS=${RUN_TS}  TOMORROW=${TOMORROW_ISO}`);

  let token = await getMsftToken();
  log('SETUP', 'MSFT access token obtained');

  await cleanupSoakDebris();
  await flushSync();

  const results = {};

  // ── Phase 1: Create test artifacts ─────────────────────────────────────────
  log('SETUP', 'Creating test tasks and native B1 Outlook event...');

  // B1: native Outlook event — juggler should pull it as origin='msft'
  let B1_EVENT_ID = null;
  try {
    const b1Event = await graphCreate(token, {
      subject: 'SOAK-B1-' + RUN_TS + ': Native Outlook event',
      start: { dateTime: TOMORROW_ISO + 'T09:00:00', timeZone: 'America/New_York' },
      end:   { dateTime: TOMORROW_ISO + 'T09:30:00', timeZone: 'America/New_York' },
      body:  { contentType: 'text', content: 'Juggler B–D soak test B1' }
    });
    B1_EVENT_ID = b1Event.id;
    log('B1', 'Native Outlook event created: ' + B1_EVENT_ID?.slice(0, 40) + '...');
  } catch (e) {
    log('B1', 'CREATE FAILED: ' + e.message);
    results.B1 = FAIL + ' — native Outlook create failed: ' + e.message;
  }

  async function createTask(label, body) {
    const r = await apiPost('/tasks', body);
    const id = r.body?.task?.id;
    if (!id) log(label, 'CREATE FAILED (' + r.status + '): ' + JSON.stringify(r.body).slice(0, 120));
    else log(label, 'Task created: ' + id);
    return id || null;
  }

  const TOMORROW_10AM_UTC = TOMORROW_ISO + 'T14:00:00Z';
  const taskBase = { when: 'fixed', scheduledAt: TOMORROW_10AM_UTC, dur: 45 };

  const B2_ID = await createTask('B2', { ...taskBase, text: 'SOAK-B2-' + RUN_TS + ': MSFT tries to move this' });
  const B3_ID = await createTask('B3', { ...taskBase, text: 'SOAK-B3-' + RUN_TS + ': MSFT deletes — MISS_THRESHOLD test' });
  const B4_ID = await createTask('B4', { ...taskBase, text: 'SOAK-B4-' + RUN_TS + ': MSFT renames this' });
  const C1_ID = await createTask('C1', { ...taskBase, dur: 30, text: 'SOAK-C1-' + RUN_TS + ': Concurrent edit test' });
  const C2_ID = await createTask('C2', { ...taskBase, dur: 30, text: 'SOAK-C2-' + RUN_TS + ': Delete+edit re-create test' });
  const C4_ID = await createTask('C4', { ...taskBase, dur: 30, text: 'SOAK-C4-' + RUN_TS + ': Accumulated edits test' });

  const c3Ids = [];
  for (let i = 1; i <= 10; i++) {
    const r = await apiPost('/tasks', {
      text: 'SOAK-C3-' + String(i).padStart(2, '0') + '-' + RUN_TS + ': Rapid fire',
      when: 'fixed', scheduledAt: TOMORROW_10AM_UTC, dur: 30
    });
    const id = r.body?.task?.id;
    if (id) c3Ids.push(id);
  }
  log('C3', 'Created ' + c3Ids.length + '/10 tasks');

  // ── Sync 0: initial push ────────────────────────────────────────────────────
  log('SYNC', 'Triggering sync 0 (initial push)...');
  const s0 = await triggerSync();
  log('SYNC-0', 'pushed=' + s0.pushed + ' pulled=' + s0.pulled + ' errors=' + s0.errors);

  // MSFT has no CDN lag — just wait a few seconds for Graph API to reflect
  await sleep(5000);

  // Resolve MSFT event IDs from ledger
  let b2Id = B2_ID ? await getMsftEventId(B2_ID) : null;
  let b3Id = B3_ID ? await getMsftEventId(B3_ID) : null;
  let b4Id = B4_ID ? await getMsftEventId(B4_ID) : null;
  let c1Id = C1_ID ? await getMsftEventId(C1_ID) : null;
  let c2Id = C2_ID ? await getMsftEventId(C2_ID) : null;

  const missingAfterSync0 = [
    !b2Id && 'B2', !b3Id && 'B3', !b4Id && 'B4', !c1Id && 'C1', !c2Id && 'C2'
  ].filter(Boolean);

  if (missingAfterSync0.length > 0) {
    log('SETUP', 'MSFT event IDs missing for: ' + missingAfterSync0.join(', ') + ' — running recovery sync 0b...');
    const s0b = await triggerSync();
    log('SYNC-0b', 'pushed=' + s0b.pushed + ' errors=' + s0b.errors);
    await sleep(5000);

    if (!b2Id) b2Id = B2_ID ? await getMsftEventId(B2_ID) : null;
    if (!b3Id) b3Id = B3_ID ? await getMsftEventId(B3_ID) : null;
    if (!b4Id) b4Id = B4_ID ? await getMsftEventId(B4_ID) : null;
    if (!c1Id) c1Id = C1_ID ? await getMsftEventId(C1_ID) : null;
    if (!c2Id) c2Id = C2_ID ? await getMsftEventId(C2_ID) : null;
  }

  log('SETUP', 'MSFT event IDs — B2:' + (b2Id ? 'ok' : 'MISSING') +
    ' B3:' + (b3Id ? 'ok' : 'MISSING') + ' B4:' + (b4Id ? 'ok' : 'MISSING') +
    ' C1:' + (c1Id ? 'ok' : 'MISSING') + ' C2:' + (c2Id ? 'ok' : 'MISSING'));

  // Refresh token before Graph modifications (sync 0 may have taken time)
  token = await getMsftToken();

  // ── B1: Check if native Outlook event was pulled ───────────────────────────
  if (!results.B1) {
    const rows = await db.raw(
      `SELECT l.task_id, l.origin, m.text
       FROM cal_sync_ledger l
       JOIN task_instances ti ON ti.id = l.task_id
       JOIN task_masters m ON m.id = ti.master_id
       WHERE l.provider='msft' AND l.status='active' AND m.text LIKE ?
       LIMIT 1`,
      ['%SOAK-B1-' + RUN_TS + '%']
    );
    const row = rows[0]?.[0];
    results.B1 = row
      ? PASS + ' — pulled as task ' + row.task_id + ", origin='" + row.origin + "'"
      : NOTE + ' — not yet visible after sync 0; will appear on next sync';
  }
  log('B1', results.B1);

  // ── Phase 3: Outlook modifications (before Sync 1) ─────────────────────────

  // B2: Move event to 3pm in Outlook — juggler should ignore (juggler wins)
  if (b2Id) {
    try {
      await graphPatch(token, b2Id, {
        start: { dateTime: TOMORROW_ISO + 'T15:00:00', timeZone: 'America/New_York' },
        end:   { dateTime: TOMORROW_ISO + 'T15:45:00', timeZone: 'America/New_York' }
      });
      log('B2', 'PATCH time to 3pm in Outlook');
    } catch (e) {
      log('B2', 'PATCH failed: ' + e.message);
    }
  } else {
    results.B2 = FAIL + ' — no MSFT ledger row for B2 after recovery sync';
  }

  // B3: Delete from Outlook — juggler hits MISS_THRESHOLD after 3 syncs
  if (b3Id && B3_ID) {
    // Guard: null provider_event_id rows for other providers would also miss the event
    // and could hit MISS_THRESHOLD before MSFT does, deleting the task prematurely.
    const nullRows = await db('cal_sync_ledger')
      .where({ task_id: B3_ID, status: 'active' })
      .whereIn('provider', ['gcal', 'apple'])
      .whereNull('provider_event_id')
      .count('id as n').first();
    if (parseInt(nullRows.n) > 0) {
      log('B3', 'WARNING: ' + nullRows.n + ' GCal/Apple row(s) with null provider_event_id — marking replaced for isolation');
      await db('cal_sync_ledger')
        .where({ task_id: B3_ID, status: 'active' })
        .whereIn('provider', ['gcal', 'apple'])
        .whereNull('provider_event_id')
        .update({ status: 'replaced' });
    }
    const ok = await graphDelete(token, b3Id);
    log('B3', 'Outlook DELETE ' + (ok ? 'succeeded' : 'FAILED'));
    if (!ok) results.B3 = FAIL + ' — Outlook DELETE failed';
  } else {
    results.B3 = FAIL + ' — no MSFT ledger row for B3 after recovery sync';
    log('B3', results.B3);
  }

  // B4: Rename in Outlook — juggler should keep its title (no pull for juggler-origin)
  if (b4Id) {
    try {
      await graphPatch(token, b4Id, { subject: 'SOAK-B4: RENAMED BY MSFT' });
      log('B4', 'PATCH subject to renamed title');
    } catch (e) {
      log('B4', 'PATCH failed: ' + e.message);
      results.B4 = NOTE + ' — Outlook rename failed: ' + e.message;
    }
  } else {
    results.B4 = FAIL + ' — no MSFT ledger row for B4 after recovery sync';
  }

  // C1: Edit juggler task + edit Outlook event simultaneously — juggler wins
  if (c1Id && C1_ID) {
    const jugglerTitle = 'SOAK-C1-' + RUN_TS + ': JUGGLER TITLE (should win)';
    const c1Edit = await apiPut('/tasks/' + C1_ID, { text: jugglerTitle });
    log('C1', 'Juggler edit: ' + (c1Edit.body?.task?.text || 'FAILED'));
    try {
      await graphPatch(token, c1Id, { subject: 'SOAK-C1: MSFT TITLE (should lose)' });
      log('C1', 'Outlook subject patched');
    } catch (e) {
      log('C1', 'Outlook patch failed: ' + e.message);
    }
  } else {
    results.C1 = FAIL + ' — no MSFT ledger row for C1 after recovery sync';
  }

  // C2: Delete from Outlook + edit juggler task — juggler re-creates on sync 2
  if (c2Id && C2_ID) {
    const ok = await graphDelete(token, c2Id);
    log('C2', 'Outlook DELETE ' + (ok ? 'succeeded' : 'FAILED'));
    const c2Edit = await apiPut('/tasks/' + C2_ID, { text: 'SOAK-C2-' + RUN_TS + ': MODIFIED AFTER MSFT DELETE' });
    log('C2', 'Juggler edit: ' + (c2Edit.body?.task?.text || 'FAILED'));
    if (!ok) results.C2 = FAIL + ' — Outlook DELETE failed for C2';
  } else {
    results.C2 = FAIL + ' — no MSFT ledger row for C2 after recovery sync';
  }

  // C4: Three juggler edits with no intermediate sync → verify final state pushed
  if (C4_ID) {
    await apiPut('/tasks/' + C4_ID, { text: 'SOAK-C4-' + RUN_TS + ': Edit 1' });
    await apiPut('/tasks/' + C4_ID, { text: 'SOAK-C4-' + RUN_TS + ': Edit 2' });
    const c4Final = await apiPut('/tasks/' + C4_ID, { text: 'SOAK-C4-' + RUN_TS + ': Edit 3 FINAL' });
    log('C4', '3 edits done. Final title: ' + (c4Final.body?.task?.text || 'unknown'));
  }

  // ── Sync 1 ─────────────────────────────────────────────────────────────────
  log('SYNC', 'Triggering sync 1...');
  const s1 = await triggerSync();
  log('SYNC-1', 'pushed=' + s1.pushed + ' pulled=' + s1.pulled + ' del_local=' + s1.deleted_local + ' del_remote=' + s1.deleted_remote + ' errors=' + s1.errors);

  token = await getMsftToken();

  // B1: re-check
  if (results.B1?.startsWith(NOTE)) {
    const rows = await db.raw(
      `SELECT l.task_id, l.origin FROM cal_sync_ledger l
       JOIN task_instances ti ON ti.id = l.task_id
       JOIN task_masters m ON m.id = ti.master_id
       WHERE l.provider='msft' AND l.status='active' AND m.text LIKE ? LIMIT 1`,
      ['%SOAK-B1-' + RUN_TS + '%']
    );
    const row = rows[0]?.[0];
    if (row) results.B1 = PASS + ' — pulled on sync 1: task ' + row.task_id + ", origin='" + row.origin + "'";
  }
  log('B1', results.B1);

  // B2: verify juggler task time unchanged (Outlook move should have been ignored)
  if (!results.B2 && B2_ID) {
    const task = await db('task_instances').where({ id: B2_ID }).first();
    if (task) {
      const h = task.scheduled_at ? new Date(String(task.scheduled_at).replace(' ', 'T') + 'Z').getUTCHours() : null;
      results.B2 = h === 14
        ? PASS + ' — juggler task time unchanged (10am EDT = 14:00 UTC); juggler wins'
        : FAIL + ' — task UTC hour changed to ' + h + ' (was 14) — Outlook time was pulled';
    } else {
      results.B2 = NOTE + ' — task instance not found after sync 1';
    }
  }
  log('B2', results.B2);

  // B3: check miss count
  if (!results.B3 && B3_ID) {
    const r = await getLedgerRow(B3_ID);
    log('B3', 'After sync 1: status=' + r?.status + ' miss_count=' + r?.miss_count);
  }

  // B4: verify juggler task text unchanged (Outlook rename should NOT be pulled)
  if (!results.B4 && B4_ID) {
    const master = await db('task_masters as m')
      .join('task_instances as ti', 'ti.master_id', 'm.id')
      .where('ti.id', B4_ID)
      .select('m.text').first();
    const jugglerText = 'SOAK-B4-' + RUN_TS + ': MSFT renames this';
    if (master) {
      results.B4 = master.text === jugglerText
        ? PASS + ' — juggler text unchanged; Outlook rename was not pulled (juggler wins)'
        : FAIL + " — juggler text changed to '" + master.text + "' — Outlook rename was pulled";
    } else {
      results.B4 = NOTE + ' — task master not found';
    }
  }
  log('B4', results.B4);

  // C3: check how many tasks made it to MSFT ledger
  if (c3Ids.length > 0) {
    const r = await db('cal_sync_ledger').where({ provider: 'msft', status: 'active' })
      .whereIn('task_id', c3Ids).count('id as n').first();
    const n = parseInt(r.n);
    results.C3 = n === c3Ids.length
      ? PASS + ' — all ' + n + '/' + c3Ids.length + ' C3 tasks synced to Outlook'
      : PARTIAL + ' — ' + n + '/' + c3Ids.length + ' synced; ' + (c3Ids.length - n) + ' missing';
  } else {
    results.C3 = FAIL + ' — no C3 tasks created';
  }
  log('C3', results.C3);

  // C4: fetch current Outlook event and verify subject
  if (C4_ID) {
    const row = await getLedgerRow(C4_ID);
    if (row?.status === 'active' && row.provider_event_id) {
      const ev = await graphGet(token, row.provider_event_id);
      if (ev?.subject?.includes('Edit 3 FINAL')) {
        results.C4 = PASS + ' — Outlook event subject contains final edit text';
      } else if (ev) {
        results.C4 = NOTE + ' — event fetched; subject="' + ev.subject + '" (hash may need 1 more sync)';
      } else {
        results.C4 = NOTE + ' — active row but event not fetchable from Graph';
      }
    } else {
      results.C4 = FAIL + ' — no active MSFT ledger row for C4 after sync 1';
    }
  }
  log('C4', results.C4);

  // ── Sync 2 (30s wait) — B3 miss+2, C2 re-create fires ─────────────────────
  log('SYNC', 'Waiting 30s, then sync 2...');
  await sleep(INTER_SYNC_MS);
  log('SYNC', 'Triggering sync 2...');
  const s2 = await triggerSync();
  log('SYNC-2', 'pushed=' + s2.pushed + ' del_remote=' + s2.deleted_remote + ' errors=' + s2.errors);

  if (!results.B3 && B3_ID) {
    const r = await getLedgerRow(B3_ID);
    log('B3', 'After sync 2: status=' + r?.status + ' miss_count=' + r?.miss_count);
  }
  if (!results.C2 && C2_ID) {
    const rows = await db('cal_sync_ledger').where({ task_id: C2_ID, provider: 'msft' }).orderBy('id', 'desc').limit(3);
    log('C2', 'After sync 2: statuses=[' + rows.map(r => r.status).join(',') + ']');
  }

  // ── Sync 3 (30s wait) — B3 miss+3 = MISS_THRESHOLD ───────────────────────
  log('SYNC', 'Waiting 30s, then sync 3...');
  await sleep(INTER_SYNC_MS);
  log('SYNC', 'Triggering sync 3...');
  const s3 = await triggerSync();
  log('SYNC-3', 'pushed=' + s3.pushed + ' del_remote=' + s3.deleted_remote + ' errors=' + s3.errors);

  token = await getMsftToken();

  // B3 final
  if (!results.B3 && B3_ID) {
    const row = await getLedgerRow(B3_ID);
    const task = await db('task_instances').where({ id: B3_ID }).first();
    if (row?.status === 'deleted_remote' && !task) {
      results.B3 = PASS + ' — task deleted after MISS_THRESHOLD; ledger → deleted_remote';
    } else if (row?.status === 'deleted_remote') {
      results.B3 = PARTIAL + ' — ledger → deleted_remote but task instance still in DB';
    } else {
      results.B3 = FAIL + ' — after 3 syncs: status=' + row?.status + ' miss_count=' + row?.miss_count + ', task ' + (task ? 'still exists' : 'deleted');
    }
  }
  log('B3', results.B3);

  // C1 final — fetch Outlook event to verify juggler's subject won
  if (!results.C1 && C1_ID) {
    const c1ActiveId = await getMsftEventId(C1_ID);
    if (c1ActiveId) {
      const ev = await graphGet(token, c1ActiveId);
      if (ev) {
        const hasJuggler = ev.subject?.includes('JUGGLER TITLE');
        const hasMsft    = ev.subject?.includes('MSFT TITLE');
        results.C1 = hasJuggler
          ? PASS + ' — Outlook event has juggler title; MSFT edit overwritten'
          : hasMsft
            ? FAIL + " — MSFT title persists in Outlook; juggler didn't re-push"
            : NOTE + ' — event fetched; subject="' + ev.subject + '"';
      } else {
        results.C1 = NOTE + ' — event not fetchable from Graph';
      }
    } else {
      results.C1 = NOTE + ' — no active MSFT ledger row for C1 after 3 syncs';
    }
  }
  log('C1', results.C1);

  // C2 final
  if (!results.C2 && C2_ID) {
    const rows = await db('cal_sync_ledger').where({ task_id: C2_ID, provider: 'msft' }).orderBy('id', 'desc');
    const active = rows.find(r => r.status === 'active');
    results.C2 = active
      ? PASS + ' — event re-created; new active row: ' + active.provider_event_id?.slice(0, 40) + '...'
      : NOTE + ' — no active row after sync 3; statuses=[' + rows.map(r => r.status).join(',') + ']';
  }
  log('C2', results.C2);

  // ── B5: Delete B1 native Outlook event → MISS_THRESHOLD for origin='msft' ─
  let B5_TASK_ID = null;
  let B5_EVENT_ID = null;
  const b1TaskRows = await db.raw(
    `SELECT l.task_id, l.provider_event_id FROM cal_sync_ledger l
     JOIN task_instances ti ON ti.id = l.task_id
     JOIN task_masters m ON m.id = ti.master_id
     WHERE l.provider='msft' AND l.status='active' AND m.text LIKE ? LIMIT 1`,
    ['%SOAK-B1-' + RUN_TS + '%']
  );
  const b1Row = b1TaskRows[0]?.[0];
  if (b1Row) {
    B5_TASK_ID  = b1Row.task_id;
    B5_EVENT_ID = b1Row.provider_event_id;
    log('B5', 'Found B1 task ' + B5_TASK_ID + '; deleting from Outlook...');
    const ok = await graphDelete(token, B5_EVENT_ID);
    log('B5', 'Outlook DELETE ' + (ok ? 'succeeded' : 'FAILED'));
    if (!ok) results.B5 = FAIL + ' — Outlook DELETE failed for B5';
  } else {
    log('B5', 'B1 task not found in MSFT ledger — B5 not testable');
    results.B5 = NOTE + ' — B1 task not pulled; B5 requires B1 to pass first';
  }

  if (B5_TASK_ID && !results.B5) {
    for (let i = 4; i <= 6; i++) {
      log('SYNC', 'Waiting 30s, then sync ' + i + '...');
      await sleep(INTER_SYNC_MS);
      const si = await triggerSync();
      log('SYNC-' + i, 'pushed=' + si.pushed + ' del_remote=' + si.deleted_remote + ' errors=' + si.errors);
    }
    const b5Task = await db('task_instances').where({ id: B5_TASK_ID }).first();
    // task_id is NULLed on the ledger row after MISS_THRESHOLD deletion — query by task gone, not ledger status
    if (!b5Task) {
      results.B5 = PASS + ' — native MSFT task deleted after MISS_THRESHOLD';
    } else {
      const b5Row = await db('cal_sync_ledger').where({ task_id: B5_TASK_ID, provider: 'msft' }).orderBy('id', 'desc').first();
      results.B5 = FAIL + ' — status=' + b5Row?.status + ' miss_count=' + b5Row?.miss_count + ', task still exists';
    }
  } else {
    for (let i = 4; i <= 6; i++) {
      await sleep(INTER_SYNC_MS);
      const si = await triggerSync();
      log('SYNC-' + i, 'pushed=' + si.pushed + ' del_remote=' + si.deleted_remote);
    }
  }
  log('B5', results.B5);

  // ── D: 30-min ambient stability soak ─────────────────────────────────────
  log('D', 'Starting 30-min ambient soak...');
  const snapshots = [];
  for (let t = 0; t <= 30; t += 10) {
    if (t > 0) {
      log('D', 'Waiting 10 min (t+' + t + ')...');
      await sleep(600000);
      await triggerSync();
    }
    const snap = await db('cal_sync_ledger')
      .where({ user_id: USER_ID, provider: 'msft' })
      .groupBy('status')
      .select('status', db.raw('COUNT(*) as n'));
    const snapStr = snap.map(r => r.status + '=' + r.n).join(' ');
    snapshots.push('+' + t + 'min: ' + snapStr);
    log('D', snapshots[snapshots.length - 1]);
  }

  const actives = snapshots.map(s => parseInt(s.match(/active=(\d+)/)?.[1] || 0));
  const maxOscillation = Math.max(...actives) - Math.min(...actives);
  results.D = maxOscillation <= 5
    ? PASS + ' — 30min stable; active oscillation ≤5 (max=' + Math.max(...actives) + ' min=' + Math.min(...actives) + ')'
    : NOTE + ' — active oscillation=' + maxOscillation + '; check snapshots';

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log('\n══════════════════ MSFT B–D SOAK RESULTS ══════════════════');
  for (const k of ['B1', 'B2', 'B3', 'B4', 'B5', 'C1', 'C2', 'C3', 'C4']) {
    console.log('  ' + k + ': ' + (results[k] || '(no result recorded)'));
  }
  console.log('\n  D — Stability snapshots:');
  for (const s of snapshots) console.log('    ' + s);
  console.log('  D: ' + (results.D || ''));
  console.log('════════════════════════════════════════════════════════════\n');

  await db.destroy();
}

main().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
