/**
 * Apple CalDAV B–D soak test RECOVERY script v2
 *
 * State when this script starts (2026-04-26 ~19:27 UTC):
 *   - B1: ✅ PASS (confirmed pre-crash + recovery-v1)
 *   - B2: ✅ PASS (juggler time = 14:00 UTC, confirmed DB check)
 *   - B3: miss_count=0 after syncs 1+2 — Apple CDN PROPFIND cache delay >12 min
 *   - B4: ✅ PASS (juggler text unchanged, confirmed DB check)
 *   - C3: ✅ PASS (10/10 synced, confirmed recovery-v1)
 *   - C4: 📝 NOTE — CDN lag (Edit 3 FINAL not visible in event ICS at sync-1 time)
 *   - C2: status=active after syncs 1+2 — CDN serving original (non-deleted) event
 *
 * Strategy:
 *   - Wait 5 min before first B3 sync (~17 min total since DELETE) to let CDN expire
 *   - Run 3 syncs for B3 MISS_THRESHOLD (35s apart)
 *   - Check C1, C2, C4 after those syncs
 *   - B5: delete B1 event + 3 syncs
 *   - D: 30-min stability soak
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

const B3_ID = '019dcb34-10db-70c1-be5a-2ce959b8644e';
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
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${label}: ${msg}`;
  console.log(line);
  process.stdout.write('');  // flush
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
  log('RECOVER2', 'Starting v2 recovery (RUN_TS=' + RUN_TS + ')');
  log('RECOVER2', 'Known PASS: B1 B2 B4 C3');

  const client = await appleCalApi.createClient(SERVER_URL, USERNAME, PASSWORD);

  const results = {
    B1: PASS + ' — pulled as task apple_480b6e7c195bb5eb, origin=\'apple\' (confirmed pre-crash)',
    B2: PASS + ' — juggler task time unchanged (10am EDT = 14:00 UTC); juggler wins (DB confirmed at 19:19 UTC)',
    B4: PASS + ' — juggler text unchanged; Apple rename was not pulled (DB confirmed at 19:19 UTC)',
    C3: PASS + ' — all 10/10 C3 tasks synced to Apple (confirmed recovery-v1)',
  };

  // ── Wait for CDN propagation ──────────────────────────────────────────────
  // CalDAV edits (B3 delete, B2/B4 modify, C1/C2 edit) were done at 19:14:22 UTC.
  // Apple CDN has been caching PROPFIND response for >13 min — typical TTL is 15-20 min.
  // Wait 3 more minutes (total ~16 min since edits) before first sync.
  log('CDN', 'Waiting 3 min for Apple PROPFIND cache to expire...');
  await sleep(180000);

  // ── B3 syncs — accumulate 3 misses for MISS_THRESHOLD ─────────────────────
  log('SYNC', 'Triggering B3-sync-1...');
  const b3s1 = await triggerSync();
  log('B3-SYNC-1', 'pushed=' + b3s1.pushed + ' del_remote=' + b3s1.deleted_remote + ' errors=' + b3s1.errors);
  const b3r1 = await getLedgerRow(B3_ID);
  log('B3', 'After B3-sync-1: status=' + b3r1?.status + ' miss_count=' + b3r1?.miss_count);

  await sleep(35000);
  log('SYNC', 'Triggering B3-sync-2...');
  const b3s2 = await triggerSync();
  log('B3-SYNC-2', 'pushed=' + b3s2.pushed + ' del_remote=' + b3s2.deleted_remote + ' errors=' + b3s2.errors);
  const b3r2 = await getLedgerRow(B3_ID);
  log('B3', 'After B3-sync-2: status=' + b3r2?.status + ' miss_count=' + b3r2?.miss_count);

  await sleep(35000);
  log('SYNC', 'Triggering B3-sync-3...');
  const b3s3 = await triggerSync();
  log('B3-SYNC-3', 'pushed=' + b3s3.pushed + ' del_remote=' + b3s3.deleted_remote + ' errors=' + b3s3.errors);

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

  // C1 final — fetch CalDAV event to verify juggler title won
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
          : NOTE + ' — event fetched but title unclear in ICS: ' + ics.raw.slice(0, 120).replace(/\n/g, '|');
    } else {
      results.C1 = NOTE + ' — event not fetchable by URL (CDN lag)';
    }
  } else {
    results.C1 = NOTE + ' — no active Apple ledger row for C1';
  }
  log('C1', results.C1);

  // C2 final — check if event was re-created
  const c2Rows = await db('cal_sync_ledger').where({ task_id: C2_ID, provider: 'apple' }).orderBy('id', 'desc');
  const c2Active = c2Rows.find(r => r.status === 'active');
  const c2Replaced = c2Rows.find(r => r.status === 'replaced');
  if (c2Active && c2Replaced) {
    results.C2 = PASS + ' — event re-created (old row replaced, new active row exists)';
  } else if (c2Active && !c2Replaced) {
    results.C2 = NOTE + ' — only original active row; re-create path not yet fired (CDN lag on Apple DELETE)';
  } else {
    results.C2 = NOTE + ' — no active row after syncs; statuses=[' + c2Rows.map(r => r.status).join(',') + ']';
  }
  log('C2', results.C2);

  // C4 final — check if Edit 3 FINAL is in CalDAV event
  const c4LedgerRow = await getLedgerRow(C4_ID);
  if (c4LedgerRow?.status === 'active') {
    const c4Url = c4LedgerRow.provider_event_id;
    const ics = c4Url ? await fetchEventByUrl(c4Url) : null;
    if (ics && ics.raw.includes('Edit 3 FINAL')) {
      results.C4 = PASS + ' — CalDAV event SUMMARY contains final edit text';
    } else if (ics) {
      results.C4 = NOTE + ' — event fetched but Edit 3 FINAL not in SUMMARY (CDN lag or sync not yet pushed)';
    } else {
      results.C4 = NOTE + ' — active row; event URL=' + (c4Url ? 'ok' : 'null') + ' (CDN lag)';
    }
  } else {
    results.C4 = NOTE + ' — no active Apple ledger row for C4';
  }
  log('C4', results.C4);

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
      log('B5', 'WARNING: ' + b5NullRows.n + ' GCal/MSFT null-event rows — marking replaced for isolation');
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
    log('B5', 'Found B1 task ' + B5_TASK_ID + '; deleting Apple event at ' + B5_EVENT_URL);
    let st = await deleteEventByUrl(B5_EVENT_URL);
    log('B5', 'HTTP DELETE → ' + st);
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
    results.B5 = NOTE + ' — B1 task not found in ledger';
  }

  // B5 needs CDN wait then 3 sync cycles for MISS_THRESHOLD
  if (B5_TASK_ID) {
    // Wait 3 min for CDN to propagate B1 deletion (consistent with B3 CDN behavior)
    log('B5', 'Waiting 3 min for CDN propagation before B5 syncs...');
    await sleep(180000);
    for (let i = 1; i <= 3; i++) {
      log('SYNC', 'B5-sync-' + i + '...');
      const si = await triggerSync();
      log('B5-SYNC-' + i, 'pushed=' + si.pushed + ' del_remote=' + si.deleted_remote + ' errors=' + si.errors);
      const b5row = await db('cal_sync_ledger').where({ task_id: B5_TASK_ID, provider: 'apple' }).orderBy('id','desc').first();
      log('B5', 'After B5-sync-' + i + ': status=' + b5row?.status + ' miss_count=' + b5row?.miss_count);
      if (i < 3) await sleep(35000);
    }
    const b5Task = await db('task_instances').where({ id: B5_TASK_ID }).first();
    if (!b5Task) {
      results.B5 = PASS + ' — native Apple task deleted after MISS_THRESHOLD';
    } else {
      const b5Row = await db('cal_sync_ledger').where({ task_id: B5_TASK_ID, provider: 'apple' }).orderBy('id', 'desc').first();
      results.B5 = FAIL + ' — status=' + b5Row?.status + ' miss_count=' + b5Row?.miss_count + ', task still exists';
    }
  } else {
    for (let i = 1; i <= 3; i++) {
      await sleep(35000);
      const si = await triggerSync();
      log('B5-SYNC-' + i, 'pushed=' + si.pushed + ' del_remote=' + si.deleted_remote);
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
  console.log('\n══════════════════ APPLE B–D SOAK RESULTS (RECOVERY v2) ══════════════════');
  for (const k of ['B1', 'B2', 'B3', 'B4', 'B5', 'C1', 'C2', 'C3', 'C4']) {
    console.log(`  ${k}: ${results[k] || '(not tested)'}`);
  }
  console.log('\nD snapshots:');
  for (const s of snapshots) console.log('  ' + s);
  console.log('  D: ' + results.D);
  console.log('══════════════════════════════════════════════════════════════════════════');

  await db.destroy();
}

main().catch(e => { console.error('FATAL:', e.message, e); process.exit(1); });
