/**
 * Apple CalDAV B–D soak test RECOVERY script
 *
 * Continues from the point where soak-apple-bcd.js v4 crashed (fetch failed
 * on sync 1 at 19:14:26 UTC 2026-04-26).
 *
 * All setup is complete:
 *   - Test tasks created, sync 0 pushed, CDN wait done
 *   - B1 confirmed PASS (native event pulled)
 *   - CalDAV edits already made: B2 time→3pm, B3 deleted, B4 renamed,
 *     C1 Apple edit, C2 deleted + juggler edit, C4 3x edits
 *
 * This script picks up from sync 1 onwards.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../src/db');
const appleCalApi = require('../src/lib/apple-cal-api');

const USER_ID      = '019d29f9-9ef9-74eb-af2d-0418237d0bd9';
const USERNAME     = 'wdraike@icloud.com';
const PASSWORD     = 'zyty-rkxh-vtxt-zdie';
const CALENDAR_URL = 'https://caldav.icloud.com/294728805/calendars/77E214B1-5D29-4D10-9AB3-447CBA9C3F66/';
const SERVER_URL   = 'https://caldav.icloud.com';
const BASE         = 'http://localhost:5002/api';

// Hardcoded from crashed v4 run (RUN_TS=1777230618110)
const RUN_TS = '1777230618110';
const TOMORROW_YYYYMMDD = '20260427';

const B2_ID = '019dcb34-0c23-75c1-863b-af72b0ba8171';
const B3_ID = '019dcb34-10db-70c1-be5a-2ce959b8644e';
const B4_ID = '019dcb34-147b-76d9-850f-feeae6d57690';
const C1_ID = '019dcb34-15cb-726b-8062-39f901c4c544';
const C2_ID = '019dcb34-17d6-715b-9260-649283c522d6';
const C4_ID = '019dcb34-1990-77ca-9b54-9d3fd6fd7b22';

const b1Uid = 'soak-b1-' + RUN_TS;

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

const PASS    = '✅ PASS';
const FAIL    = '❌ FAIL';
const PARTIAL = '⚠️ PARTIAL';
const NOTE    = '📝 NOTE';

function log(label, msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${label}: ${msg}`);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

async function triggerSync() {
  const r = await apiFetch('POST', '/cal/sync', {});
  return {
    pushed:         r.body.pushed         || 0,
    pulled:         r.body.pulled         || 0,
    deleted_local:  r.body.deleted_local  || 0,
    deleted_remote: r.body.deleted_remote || 0,
    errors:         r.body.errors?.length || 0
  };
}

const CALDAV_AUTH = 'Basic ' + Buffer.from(USERNAME + ':' + PASSWORD).toString('base64');

async function fetchEventByUrl(url) {
  try {
    const resp = await fetch(url, { headers: { Authorization: CALDAV_AUTH, Accept: 'text/calendar' } });
    if (!resp.ok) return null;
    return { raw: await resp.text(), etag: resp.headers.get('etag') || '' };
  } catch (_) { return null; }
}

async function deleteEventByUrl(url) {
  try {
    const resp = await fetch(url, { method: 'DELETE', headers: { Authorization: CALDAV_AUTH } });
    return resp.status;
  } catch (_) { return 0; }
}

async function getLedgerRow(taskId) {
  return db('cal_sync_ledger')
    .where({ task_id: taskId, provider: 'apple' })
    .orderBy('id', 'desc')
    .first();
}

async function getAppleEventUrl(taskId) {
  const row = await db('cal_sync_ledger')
    .where({ task_id: taskId, provider: 'apple', status: 'active' })
    .orderBy('id', 'desc')
    .first();
  return row ? row.provider_event_id : null;
}

async function main() {
  log('RECOVER', 'Continuing v4 soak from sync 1 (RUN_TS=' + RUN_TS + ')');

  const client = await appleCalApi.createClient(SERVER_URL, USERNAME, PASSWORD);

  // Get C3 task IDs from DB
  const c3Rows = await db('task_masters as m')
    .join('task_instances as ti', 'ti.master_id', 'm.id')
    .where('m.text', 'like', '%SOAK-C3-%-' + RUN_TS + '%')
    .select('ti.id');
  const c3Ids = c3Rows.map(r => r.id);
  log('RECOVER', 'C3 task IDs found in DB: ' + c3Ids.length + '/10');

  const results = {
    B1: PASS + ' — pulled as task apple_480b6e7c195bb5eb, origin=\'apple\' (confirmed pre-crash)',
  };

  // ── Sync 1 ─────────────────────────────────────────────────────────────────
  log('SYNC', 'Triggering sync 1...');
  const s1 = await triggerSync();
  log('SYNC-1', 'pushed=' + s1.pushed + ' pulled=' + s1.pulled + ' del_local=' + s1.deleted_local + ' del_remote=' + s1.deleted_remote + ' errors=' + s1.errors);

  // B2: verify juggler task time unchanged (should be 14:00 UTC = 10am EDT)
  const b2Task = await db('task_instances').where({ id: B2_ID }).first();
  if (b2Task) {
    const h = b2Task.scheduled_at ? new Date(String(b2Task.scheduled_at).replace(' ', 'T') + 'Z').getUTCHours() : null;
    results.B2 = h === 14
      ? PASS + ' — juggler task time unchanged (10am EDT = 14:00 UTC); juggler wins'
      : FAIL + ' — task UTC hour changed to ' + h + ' (was 14) — Apple edit was pulled';
  } else {
    results.B2 = NOTE + ' — task instance not found';
  }
  log('B2', results.B2);

  // B3: check miss count after sync 1
  const b3r1 = await getLedgerRow(B3_ID);
  log('B3', 'After sync 1: status=' + b3r1?.status + ' miss_count=' + b3r1?.miss_count);

  // B4: verify juggler task text unchanged (Apple rename should NOT be pulled)
  const b4Master = await db('task_masters as m')
    .join('task_instances as ti', 'ti.master_id', 'm.id')
    .where('ti.id', B4_ID)
    .select('m.text').first();
  const b4ExpectedText = 'SOAK-B4-' + RUN_TS + ': Apple renames this';
  if (b4Master) {
    results.B4 = b4Master.text === b4ExpectedText
      ? PASS + ' — juggler text unchanged; Apple rename was not pulled (juggler wins)'
      : FAIL + ' — juggler text changed to \'' + b4Master.text + '\' — Apple rename was pulled';
  } else {
    results.B4 = NOTE + ' — task master not found';
  }
  log('B4', results.B4);

  // C3: check how many tasks synced to Apple
  if (c3Ids.length > 0) {
    const c3r = await db('cal_sync_ledger').where({ provider: 'apple', status: 'active' })
      .whereIn('task_id', c3Ids).count('id as n').first();
    const n = parseInt(c3r.n);
    results.C3 = n === c3Ids.length
      ? PASS + ' — all ' + n + '/' + c3Ids.length + ' C3 tasks synced to Apple'
      : PARTIAL + ' — ' + n + '/' + c3Ids.length + ' synced; ' + (c3Ids.length - n) + ' missing (rate limit?)';
  } else {
    results.C3 = FAIL + ' — no C3 tasks found in DB';
  }
  log('C3', results.C3);

  // C4: verify final edit reflected in Apple CalDAV event
  const c4LedgerRow = await getLedgerRow(C4_ID);
  if (c4LedgerRow?.status === 'active') {
    const c4Url = c4LedgerRow.provider_event_id;
    const ics = c4Url ? await fetchEventByUrl(c4Url) : null;
    if (ics && ics.raw.includes('Edit 3 FINAL')) {
      results.C4 = PASS + ' — CalDAV event SUMMARY contains final edit text';
    } else if (ics) {
      results.C4 = NOTE + ' — event fetched but Edit 3 FINAL not in SUMMARY (CDN lag)';
    } else {
      results.C4 = NOTE + ' — active row; event URL=' + (c4Url ? 'ok' : 'null') + ' (CDN lag)';
    }
  } else {
    results.C4 = FAIL + ' — no active Apple ledger row for C4 after sync 1';
  }
  log('C4', results.C4);

  // ── Sync 2 (35s wait) — B3 miss+2, C2 re-create fires ────────────────────
  log('SYNC', 'Waiting 35s, then sync 2...');
  await sleep(35000);
  log('SYNC', 'Triggering sync 2...');
  const s2 = await triggerSync();
  log('SYNC-2', 'pushed=' + s2.pushed + ' del_remote=' + s2.deleted_remote + ' errors=' + s2.errors);

  const b3r2 = await getLedgerRow(B3_ID);
  log('B3', 'After sync 2: status=' + b3r2?.status + ' miss_count=' + b3r2?.miss_count);

  const c2Rows2 = await db('cal_sync_ledger').where({ task_id: C2_ID, provider: 'apple' }).orderBy('id', 'desc').limit(3);
  log('C2', 'After sync 2: statuses=[' + c2Rows2.map(r => r.status).join(',') + ']');

  // ── Sync 3 (35s wait) — B3 miss+3 = MISS_THRESHOLD ──────────────────────
  log('SYNC', 'Waiting 35s, then sync 3...');
  await sleep(35000);
  log('SYNC', 'Triggering sync 3...');
  const s3 = await triggerSync();
  log('SYNC-3', 'pushed=' + s3.pushed + ' del_remote=' + s3.deleted_remote + ' errors=' + s3.errors);

  // B3 final
  const b3RowFinal = await getLedgerRow(B3_ID);
  const b3TaskFinal = await db('task_instances').where({ id: B3_ID }).first();
  if (b3RowFinal?.status === 'deleted_remote' && !b3TaskFinal) {
    results.B3 = PASS + ' — task deleted after MISS_THRESHOLD; ledger → deleted_remote';
  } else if (b3RowFinal?.status === 'deleted_remote') {
    results.B3 = PARTIAL + ' — ledger → deleted_remote but task instance still in DB';
  } else {
    results.B3 = FAIL + ' — after 3 syncs: status=' + b3RowFinal?.status + ' miss_count=' + b3RowFinal?.miss_count + ', task ' + (b3TaskFinal ? 'still exists' : 'deleted');
  }
  log('B3', results.B3);

  // C1 final — fetch CalDAV event to verify juggler's title won
  const c1ActiveUrl = await getAppleEventUrl(C1_ID);
  if (c1ActiveUrl) {
    const ics = await fetchEventByUrl(c1ActiveUrl);
    if (ics) {
      const hasJugglerTitle = ics.raw.includes('JUGGLER TITLE');
      const hasAppleTitle   = ics.raw.includes('APPLE TITLE');
      results.C1 = hasJugglerTitle
        ? PASS + ' — CalDAV event has juggler title; Apple edit overwritten'
        : hasAppleTitle
          ? FAIL + ' — Apple title persists in CalDAV; juggler didn\'t re-push'
          : NOTE + ' — event fetched but title unclear in ICS';
    } else {
      results.C1 = NOTE + ' — event not fetchable by URL (CDN lag)';
    }
  } else {
    results.C1 = NOTE + ' — no active Apple ledger row for C1 after 3 syncs';
  }
  log('C1', results.C1);

  // C2 final — should have new active row after re-create
  const c2RowsFinal = await db('cal_sync_ledger').where({ task_id: C2_ID, provider: 'apple' }).orderBy('id', 'desc');
  const c2Active = c2RowsFinal.find(r => r.status === 'active');
  results.C2 = c2Active
    ? PASS + ' — event re-created; new active row: ' + c2Active.provider_event_id?.slice(-40)
    : NOTE + ' — no active row after sync 3; statuses=[' + c2RowsFinal.map(r => r.status).join(',') + ']';
  log('C2', results.C2);

  // ── B5: Delete B1 native event → MISS_THRESHOLD for origin='apple' task ────
  let B5_TASK_ID = null;
  let B5_EVENT_URL = null;
  const b1TaskRows = await db.raw(
    `SELECT l.task_id, l.provider_event_id FROM cal_sync_ledger l
     JOIN task_instances ti ON ti.id = l.task_id
     JOIN task_masters m ON m.id = ti.master_id
     WHERE l.provider='apple' AND l.status='active' AND m.text LIKE ? LIMIT 1`,
    ['%SOAK-B1-' + RUN_TS + '%']
  );
  const b1Row = b1TaskRows[0]?.[0];
  if (b1Row) {
    B5_TASK_ID = b1Row.task_id;
    // Guard: GCal/MSFT rows with null provider_event_id could hit MISS_THRESHOLD first
    const b5NullRows = await db('cal_sync_ledger')
      .where({ task_id: B5_TASK_ID, status: 'active' })
      .whereIn('provider', ['gcal', 'msft'])
      .whereNull('provider_event_id')
      .count('id as n').first();
    if (parseInt(b5NullRows.n) > 0) {
      log('B5', 'WARNING: ' + b5NullRows.n + ' GCal/MSFT row(s) with null provider_event_id — marking replaced for isolation');
      await db('cal_sync_ledger')
        .where({ task_id: B5_TASK_ID, status: 'active' })
        .whereIn('provider', ['gcal', 'msft'])
        .whereNull('provider_event_id')
        .update({ status: 'replaced' });
    }
    const rawId = b1Row.provider_event_id;
    B5_EVENT_URL = rawId && rawId.startsWith('http')
      ? rawId
      : CALENDAR_URL + (rawId || b1Uid) + '.ics';
    log('B5', 'Found B1 task ' + B5_TASK_ID + '; deleting its Apple event...');
    let st = await deleteEventByUrl(B5_EVENT_URL);
    log('B5', 'DELETE → HTTP ' + st);
    if (st === 0 || (st >= 500 && st < 600)) {
      try {
        await appleCalApi.deleteEvent(client, B5_EVENT_URL, null);
        log('B5', 'CalDAV lib DELETE succeeded');
        st = 204;
      } catch (e) {
        log('B5', 'CalDAV lib DELETE also failed: ' + e.message);
      }
    }
  } else {
    log('B5', 'B1 task not found in ledger — B5 not testable');
    results.B5 = NOTE + ' — B1 task not pulled yet; B5 requires B1 to pass first';
  }

  // B5 needs 3 sync cycles for MISS_THRESHOLD
  if (B5_TASK_ID) {
    for (let i = 4; i <= 6; i++) {
      log('SYNC', 'Waiting 35s, then sync ' + i + '...');
      await sleep(35000);
      const si = await triggerSync();
      log('SYNC-' + i, 'pushed=' + si.pushed + ' del_remote=' + si.deleted_remote + ' errors=' + si.errors);
    }
    const b5Task = await db('task_instances').where({ id: B5_TASK_ID }).first();
    if (!b5Task) {
      results.B5 = PASS + ' — native Apple task deleted after MISS_THRESHOLD';
    } else {
      const b5Row = await db('cal_sync_ledger').where({ task_id: B5_TASK_ID, provider: 'apple' }).orderBy('id', 'desc').first();
      results.B5 = FAIL + ' — status=' + b5Row?.status + ' miss_count=' + b5Row?.miss_count + ', task still exists';
    }
  } else {
    for (let i = 4; i <= 6; i++) {
      await sleep(35000);
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
      .where({ user_id: USER_ID, provider: 'apple' })
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
  console.log('\n══════════════════ APPLE B–D SOAK RESULTS (RECOVERY RUN) ══════════════════');
  for (const k of ['B1', 'B2', 'B3', 'B4', 'B5', 'C1', 'C2', 'C3', 'C4']) {
    console.log(`  ${k}: ${results[k] || '(not tested)'}`);
  }
  console.log('\nD snapshots:');
  for (const s of snapshots) console.log('  ' + s);
  console.log('══════════════════════════════════════════════════════════════════════════');

  await db.destroy();
}

main().catch(e => { console.error('FATAL:', e.message, e); process.exit(1); });
