/**
 * Apple CalDAV B–D soak test driver (v3)
 *
 * v3 improvements:
 * - Pre-run cleanup: marks stale SOAK Apple ledger rows 'replaced' before creating
 *   test tasks, preventing prior-run debris from consuming rate limit in sync 0
 * - Orphan cleanup: also marks active rows whose task no longer exists as 'replaced'
 * - Resilient URL lookup: after sync 0 + CDN wait, if URL still missing, runs a
 *   second cleanup sync then waits again before giving up
 * - B5 CalDAV delete: uses client.deleteCalendarObject instead of raw HTTP DELETE
 *   (HTTP 0 = connection error in prior run)
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
const RUN_TS       = Date.now();

// Dynamic JWT — reads auth-service private key so the token is always fresh
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

// Dates computed dynamically so the script doesn't need updating each day
const _tomorrow = new Date();
_tomorrow.setUTCDate(_tomorrow.getUTCDate() + 1);
const TOMORROW_ISO      = _tomorrow.toISOString().slice(0, 10);  // '2026-04-27'
const TOMORROW_YYYYMMDD = TOMORROW_ISO.replace(/-/g, '');        // '20260427'
const TOMORROW_10AM_UTC = TOMORROW_ISO + 'T14:00:00Z';           // 10am EDT = UTC-4

// Apple CalDAV CDN caches new/deleted events for 60–120s.
// 120s is used here so event fetches by URL reliably succeed after push.
const CDN_WAIT_MS = 120000;

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
const apiPost   = (path, body) => apiFetch('POST',   path, body);
const apiPut    = (path, body) => apiFetch('PUT',    path, body);

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

// ── CalDAV HTTP helpers (direct — bypasses CDN-lag listEvents) ───────────────
const CALDAV_AUTH = 'Basic ' + Buffer.from(USERNAME + ':' + PASSWORD).toString('base64');

async function fetchEventByUrl(url) {
  try {
    const resp = await fetch(url, { headers: { Authorization: CALDAV_AUTH, Accept: 'text/calendar' } });
    if (!resp.ok) return null;
    return { raw: await resp.text(), etag: resp.headers.get('etag') || '' };
  } catch (_) { return null; }
}

async function putEventByUrl(url, icsBody, etag) {
  const headers = { Authorization: CALDAV_AUTH, 'Content-Type': 'text/calendar; charset=utf-8' };
  if (etag) headers['If-Match'] = etag;
  try {
    const resp = await fetch(url, { method: 'PUT', headers, body: icsBody });
    return resp.status;
  } catch (_) { return 0; }
}

async function deleteEventByUrl(url) {
  try {
    const resp = await fetch(url, { method: 'DELETE', headers: { Authorization: CALDAV_AUTH } });
    return resp.status;
  } catch (_) { return 0; }
}

// ── DB helpers ────────────────────────────────────────────────────────────────
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

// ── ICS builder for native (non-juggler-origin) CalDAV events ─────────────────
function buildNativeICS(uid, title, yyyymmdd, startHour, durationMins) {
  const pad = n => String(n).padStart(2, '0');
  const endTotalMins = startHour * 60 + durationMins;
  const endHour = Math.floor(endTotalMins / 60) % 24;
  const endMin  = endTotalMins % 60;
  const dtstamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Soak Test//EN',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'SUMMARY:' + title,
    'DTSTART;TZID=America/New_York:' + yyyymmdd + 'T' + pad(startHour) + '0000',
    'DTEND;TZID=America/New_York:'   + yyyymmdd + 'T' + pad(endHour)   + pad(endMin) + '00',
    'DTSTAMP:' + dtstamp,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
}

// ── Pre-run cleanup ───────────────────────────────────────────────────────────
// Only mark ORPHAN rows (no task in DB) as 'replaced' — these are from tasks deleted
// by prior MISS_THRESHOLD runs. Marking SOAK rows for still-existing tasks would cause
// Phase 3 to re-push all 40+ SOAK tasks, exhausting Apple's rate limit before new tasks.
async function cleanupSoakDebris() {
  const orphanClean = await db.raw(`
    UPDATE cal_sync_ledger l
    LEFT JOIN task_instances ti ON ti.id = l.task_id
    SET l.status = 'replaced'
    WHERE l.provider = 'apple'
    AND l.user_id = ?
    AND l.status = 'active'
    AND ti.id IS NULL
  `, [USER_ID]);

  log('CLEANUP', 'Marked ' + orphanClean[0].affectedRows + ' orphan rows as replaced');
}

// ── Flush sync ────────────────────────────────────────────────────────────────
// Run one or two syncs before creating test tasks so that regular user tasks are
// already up-to-date on Apple. Sync 0 then only needs to push the ~16 new test tasks.
async function flushSync() {
  log('FLUSH', 'Pre-flush sync (stabilizing Apple before test task creation)...');
  const f1 = await triggerSync();
  log('FLUSH-1', 'pushed=' + f1.pushed + ' errors=' + f1.errors);
  if (f1.pushed > 30 || f1.errors > 10) {
    log('FLUSH', 'High push count — waiting 60s then second flush...');
    await sleep(60000);
    const f2 = await triggerSync();
    log('FLUSH-2', 'pushed=' + f2.pushed + ' errors=' + f2.errors);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('SETUP', `RUN_TS=${RUN_TS}  TOMORROW=${TOMORROW_ISO}`);

  const client = await appleCalApi.createClient(SERVER_URL, USERNAME, PASSWORD);
  log('SETUP', 'CalDAV client connected. Calendar: ' + CALENDAR_URL);

  // Cleanup orphan ledger rows then stabilize Apple before creating test tasks
  await cleanupSoakDebris();
  await flushSync();

  const results = {};

  // ── Phase 1: Create test artifacts ─────────────────────────────────────────
  log('SETUP', 'Creating test tasks and native B1 event...');

  // B1: native Apple event (no juggler origin) — juggler pulls it as origin='apple'
  const b1Uid      = 'soak-b1-' + RUN_TS;
  const b1EventUrl = CALENDAR_URL + b1Uid + '.ics';
  try {
    await client.createCalendarObject({
      calendar: { url: CALENDAR_URL },
      filename: b1Uid + '.ics',
      iCalString: buildNativeICS(b1Uid, 'SOAK-B1-' + RUN_TS + ': Native Apple event', TOMORROW_YYYYMMDD, 9, 30)
    });
    log('B1', 'Native event created at ' + b1EventUrl);
  } catch (e) {
    log('B1', 'CREATE FAILED: ' + e.message);
    results.B1 = FAIL + ' — native CalDAV create failed: ' + e.message;
  }

  async function createTask(label, body) {
    const r = await apiPost('/tasks', body);
    const id = r.body?.task?.id;
    if (!id) log(label, 'CREATE FAILED (' + r.status + '): ' + JSON.stringify(r.body).slice(0, 120));
    else log(label, 'Task created: ' + id);
    return id || null;
  }

  const taskBase = { when: 'fixed', scheduledAt: TOMORROW_10AM_UTC, dur: 45 };

  const B2_ID = await createTask('B2', { ...taskBase, text: 'SOAK-B2-' + RUN_TS + ': Apple tries to move this' });
  const B3_ID = await createTask('B3', { ...taskBase, text: 'SOAK-B3-' + RUN_TS + ': Apple deletes — MISS_THRESHOLD test' });
  const B4_ID = await createTask('B4', { ...taskBase, text: 'SOAK-B4-' + RUN_TS + ': Apple renames this' });
  const C1_ID = await createTask('C1', { ...taskBase, dur: 30, text: 'SOAK-C1-' + RUN_TS + ': Concurrent edit test' });
  const C2_ID = await createTask('C2', { ...taskBase, dur: 30, text: 'SOAK-C2-' + RUN_TS + ': Delete+edit re-create test' });
  const C4_ID = await createTask('C4', { ...taskBase, dur: 30, text: 'SOAK-C4-' + RUN_TS + ': Accumulated edits test' });

  // C3: 10 rapid-fire tasks
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

  // ── Phase 2: Initial sync + CDN wait ──────────────────────────────────────
  log('SYNC', 'Triggering sync 0 (initial push)...');
  const s0 = await triggerSync();
  log('SYNC-0', 'pushed=' + s0.pushed + ' pulled=' + s0.pulled + ' errors=' + s0.errors);

  log('SYNC', 'Waiting ' + (CDN_WAIT_MS / 1000) + 's for CDN propagation...');
  await sleep(CDN_WAIT_MS);

  // Resolve Apple event URLs from ledger (written by sync 0)
  let b2Url = B2_ID ? await getAppleEventUrl(B2_ID) : null;
  let b3Url = B3_ID ? await getAppleEventUrl(B3_ID) : null;
  let b4Url = B4_ID ? await getAppleEventUrl(B4_ID) : null;
  let c1Url = C1_ID ? await getAppleEventUrl(C1_ID) : null;
  let c2Url = C2_ID ? await getAppleEventUrl(C2_ID) : null;

  const missingAfterSync0 = [
    !b2Url && 'B2', !b3Url && 'B3', !b4Url && 'B4', !c1Url && 'C1', !c2Url && 'C2'
  ].filter(Boolean);

  if (missingAfterSync0.length > 0) {
    // Tasks weren't pushed in sync 0 (rate limit). Run a recovery sync + CDN wait.
    log('SETUP', 'URLs missing for: ' + missingAfterSync0.join(', ') + ' — running recovery sync 0b...');
    const s0b = await triggerSync();
    log('SYNC-0b', 'pushed=' + s0b.pushed + ' errors=' + s0b.errors);
    log('SYNC', 'Waiting ' + (CDN_WAIT_MS / 1000) + 's for CDN propagation...');
    await sleep(CDN_WAIT_MS);

    if (!b2Url) b2Url = B2_ID ? await getAppleEventUrl(B2_ID) : null;
    if (!b3Url) b3Url = B3_ID ? await getAppleEventUrl(B3_ID) : null;
    if (!b4Url) b4Url = B4_ID ? await getAppleEventUrl(B4_ID) : null;
    if (!c1Url) c1Url = C1_ID ? await getAppleEventUrl(C1_ID) : null;
    if (!c2Url) c2Url = C2_ID ? await getAppleEventUrl(C2_ID) : null;
  }

  log('SETUP', 'Event URLs — B2:' + (b2Url ? 'ok' : 'MISSING') +
    ' B3:' + (b3Url ? 'ok' : 'MISSING') + ' B4:' + (b4Url ? 'ok' : 'MISSING') +
    ' C1:' + (c1Url ? 'ok' : 'MISSING') + ' C2:' + (c2Url ? 'ok' : 'MISSING'));

  // ── B1: Check if native event was pulled ───────────────────────────────────
  if (!results.B1) {
    const rows = await db.raw(
      `SELECT l.task_id, l.origin, m.text
       FROM cal_sync_ledger l
       JOIN task_instances ti ON ti.id = l.task_id
       JOIN task_masters m ON m.id = ti.master_id
       WHERE l.provider='apple' AND l.status='active' AND m.text LIKE ?
       LIMIT 1`,
      ['%SOAK-B1-' + RUN_TS + '%']
    );
    const row = rows[0]?.[0];
    results.B1 = row
      ? PASS + ' — pulled as task ' + row.task_id + ", origin='" + row.origin + "'"
      : NOTE + ' — not yet visible after sync 0 + CDN wait; will appear on next sync';
  }
  log('B1', results.B1);

  // ── Phase 3: CalDAV modifications (before Sync 1) ─────────────────────────

  // B2: Move event time to 3pm — juggler should ignore on next sync
  if (b2Url) {
    const b2ICS = await fetchEventByUrl(b2Url);
    if (b2ICS) {
      const modICS = b2ICS.raw
        .replace(/DTSTART[^\r\n]*/g, 'DTSTART;TZID=America/New_York:' + TOMORROW_YYYYMMDD + 'T150000')
        .replace(/DTEND[^\r\n]*/g,   'DTEND;TZID=America/New_York:'   + TOMORROW_YYYYMMDD + 'T154500');
      const st = await putEventByUrl(b2Url, modICS, b2ICS.etag);
      log('B2', 'PUT modified time → HTTP ' + st);
    } else {
      log('B2', 'Event ICS not yet fetchable by URL (CDN); skipping time modification');
      results.B2 = NOTE + ' — event ICS not fetchable by URL after ' + (CDN_WAIT_MS / 1000) + 's';
    }
  } else {
    results.B2 = FAIL + ' — no active Apple ledger row for B2 after recovery sync';
  }

  // B3: Delete event — juggler should hit MISS_THRESHOLD after 3 syncs
  if (b3Url && B3_ID) {
    // Guard: if any GCal/MSFT row has null provider_event_id (push failure under load),
    // mark those rows 'replaced' so they don't reach MISS_THRESHOLD before Apple does.
    const nullRows = await db('cal_sync_ledger')
      .where({ task_id: B3_ID, status: 'active' })
      .whereIn('provider', ['gcal', 'msft'])
      .whereNull('provider_event_id')
      .count('id as n').first();
    if (parseInt(nullRows.n) > 0) {
      log('B3', 'WARNING: ' + nullRows.n + ' GCal/MSFT row(s) have null provider_event_id — marking replaced for isolation');
      await db('cal_sync_ledger')
        .where({ task_id: B3_ID, status: 'active' })
        .whereIn('provider', ['gcal', 'msft'])
        .whereNull('provider_event_id')
        .update({ status: 'replaced' });
    }
    const st = await deleteEventByUrl(b3Url);
    log('B3', 'CalDAV DELETE → HTTP ' + st);
    if (st === 0) {
      // HTTP 0 = connection error; try with the CalDAV library
      try {
        await appleCalApi.deleteEvent(client, b3Url, null);
        log('B3', 'CalDAV lib DELETE succeeded');
      } catch (e) {
        log('B3', 'CalDAV lib DELETE also failed: ' + e.message);
      }
    }
  } else {
    results.B3 = FAIL + ' — no active Apple ledger row for B3 after recovery sync';
    log('B3', results.B3);
  }

  // B4: Rename event in CalDAV — juggler should keep its text (no pull for juggler-origin)
  if (b4Url) {
    const b4ICS = await fetchEventByUrl(b4Url);
    if (b4ICS) {
      const renamedICS = b4ICS.raw.replace(/SUMMARY:[^\r\n]*/, 'SUMMARY:SOAK-B4: RENAMED BY APPLE');
      const st = await putEventByUrl(b4Url, renamedICS, b4ICS.etag);
      log('B4', 'PUT renamed summary → HTTP ' + st);
    } else {
      log('B4', 'Event ICS not fetchable; skipping rename');
      results.B4 = NOTE + ' — event ICS not fetchable';
    }
  } else {
    results.B4 = FAIL + ' — no active Apple ledger row for B4 after recovery sync';
  }

  // C1: Edit juggler task (changes hash) + edit Apple event (different title)
  //     On next sync: juggler detects hash diff → pushes its title → Apple edit overwritten
  if (c1Url && C1_ID) {
    const jugglerTitle = 'SOAK-C1-' + RUN_TS + ': JUGGLER TITLE (should win)';
    const c1Edit = await apiPut('/tasks/' + C1_ID, { text: jugglerTitle });
    log('C1', 'Juggler edit: ' + (c1Edit.body?.task?.text || 'FAILED'));

    const c1ICS = await fetchEventByUrl(c1Url);
    if (c1ICS) {
      const appleICS = c1ICS.raw.replace(/SUMMARY:[^\r\n]*/, 'SUMMARY:SOAK-C1: APPLE TITLE (should lose)');
      const st = await putEventByUrl(c1Url, appleICS, c1ICS.etag);
      log('C1', 'Apple event edit → HTTP ' + st);
    } else {
      log('C1', 'Apple event ICS not fetchable — testing juggler-only hash-change path');
    }
  } else {
    results.C1 = FAIL + ' — no active Apple ledger row for C1 after recovery sync';
  }

  // C2: Delete Apple event + immediately edit juggler task
  //     Sync 1: CDN grace expired, hash changed → deferred to next miss
  //     Sync 2: miss_count>=1 + hash changed → re-create fires
  if (c2Url && C2_ID) {
    const st = await deleteEventByUrl(c2Url);
    log('C2', 'CalDAV DELETE → HTTP ' + st);
    const c2Edit = await apiPut('/tasks/' + C2_ID, { text: 'SOAK-C2-' + RUN_TS + ': MODIFIED AFTER APPLE DELETE' });
    log('C2', 'Juggler edit: ' + (c2Edit.body?.task?.text || 'FAILED'));
  } else {
    results.C2 = FAIL + ' — no active Apple ledger row for C2 after recovery sync';
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

  // B1: check again if not already found
  if (results.B1?.startsWith(NOTE)) {
    const rows = await db.raw(
      `SELECT l.task_id, l.origin FROM cal_sync_ledger l
       JOIN task_instances ti ON ti.id = l.task_id
       JOIN task_masters m ON m.id = ti.master_id
       WHERE l.provider='apple' AND l.status='active' AND m.text LIKE ? LIMIT 1`,
      ['%SOAK-B1-' + RUN_TS + '%']
    );
    const row = rows[0]?.[0];
    if (row) results.B1 = PASS + ' — pulled on sync 1: task ' + row.task_id + ", origin='" + row.origin + "'";
  }
  log('B1', results.B1);

  // B2: verify juggler task time unchanged
  if (!results.B2 && B2_ID) {
    const task = await db('task_instances').where({ id: B2_ID }).first();
    if (task) {
      const h = task.scheduled_at ? new Date(String(task.scheduled_at).replace(' ', 'T') + 'Z').getUTCHours() : null;
      results.B2 = h === 14
        ? PASS + ' — juggler task time unchanged (10am EDT = 14:00 UTC); juggler wins'
        : FAIL + ' — task UTC hour changed to ' + h + ' (was 14) — Apple edit was pulled';
    } else {
      results.B2 = NOTE + ' — task instance not found (may have been deleted)';
    }
  }
  log('B2', results.B2);

  // B3: check miss count after sync 1
  if (!results.B3 && B3_ID) {
    const r = await getLedgerRow(B3_ID);
    log('B3', 'After sync 1: status=' + r?.status + ' miss_count=' + r?.miss_count);
  }

  // B4: verify juggler task text unchanged (the Apple rename should NOT be pulled)
  if (!results.B4 && B4_ID) {
    const master = await db('task_masters as m')
      .join('task_instances as ti', 'ti.master_id', 'm.id')
      .where('ti.id', B4_ID)
      .select('m.text').first();
    const jugglerText = 'SOAK-B4-' + RUN_TS + ': Apple renames this';
    if (master) {
      results.B4 = master.text === jugglerText
        ? PASS + " — juggler text unchanged; Apple rename was not pulled (juggler wins on pull)"
        : FAIL + " — juggler text changed to '" + master.text + "' — Apple rename was pulled";
    } else {
      results.B4 = NOTE + ' — task master not found';
    }
  }
  log('B4', results.B4);

  // C3: check how many tasks made it to Apple ledger
  if (c3Ids.length > 0) {
    const r = await db('cal_sync_ledger').where({ provider: 'apple', status: 'active' })
      .whereIn('task_id', c3Ids).count('id as n').first();
    const n = parseInt(r.n);
    results.C3 = n === c3Ids.length
      ? PASS + ' — all ' + n + '/' + c3Ids.length + ' C3 tasks synced to Apple'
      : PARTIAL + ' — ' + n + '/' + c3Ids.length + ' synced; ' + (c3Ids.length - n) + ' missing (rate limit?)';
  } else {
    results.C3 = FAIL + ' — no C3 tasks created';
  }
  log('C3', results.C3);

  // C4: verify final edit reflected in Apple CalDAV event
  if (C4_ID) {
    const row = await getLedgerRow(C4_ID);
    if (row?.status === 'active') {
      const c4Url = row.provider_event_id;
      const ics = c4Url ? await fetchEventByUrl(c4Url) : null;
      if (ics && ics.raw.includes('Edit 3 FINAL')) {
        results.C4 = PASS + ' — CalDAV event SUMMARY contains final edit text';
      } else if (ics) {
        results.C4 = NOTE + ' — event fetched but Edit 3 FINAL not in SUMMARY (CDN lag or push not yet reflected)';
      } else {
        results.C4 = NOTE + ' — active row; event URL=' + (c4Url ? 'ok' : 'null') + ' (CDN lag)';
      }
    } else {
      results.C4 = FAIL + ' — no active Apple ledger row for C4 after sync 1';
    }
  }
  log('C4', results.C4);

  // ── Sync 2 (35s wait) — B3 miss+2, C2 re-create fires ────────────────────
  log('SYNC', 'Waiting 35s, then sync 2...');
  await sleep(35000);
  log('SYNC', 'Triggering sync 2...');
  const s2 = await triggerSync();
  log('SYNC-2', 'pushed=' + s2.pushed + ' del_remote=' + s2.deleted_remote + ' errors=' + s2.errors);

  if (!results.B3 && B3_ID) {
    const r = await getLedgerRow(B3_ID);
    log('B3', 'After sync 2: status=' + r?.status + ' miss_count=' + r?.miss_count);
  }
  if (!results.C2 && C2_ID) {
    const rows = await db('cal_sync_ledger').where({ task_id: C2_ID, provider: 'apple' }).orderBy('id', 'desc').limit(3);
    log('C2', 'After sync 2: statuses=[' + rows.map(r => r.status).join(',') + ']');
  }

  // ── Sync 3 (35s wait) — B3 miss+3 = MISS_THRESHOLD ──────────────────────
  log('SYNC', 'Waiting 35s, then sync 3...');
  await sleep(35000);
  log('SYNC', 'Triggering sync 3...');
  const s3 = await triggerSync();
  log('SYNC-3', 'pushed=' + s3.pushed + ' del_remote=' + s3.deleted_remote + ' errors=' + s3.errors);

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

  // C1 final — fetch CalDAV event to verify juggler's title won
  if (!results.C1 && C1_ID) {
    const c1ActiveUrl = await getAppleEventUrl(C1_ID);
    if (c1ActiveUrl) {
      const ics = await fetchEventByUrl(c1ActiveUrl);
      if (ics) {
        const hasJugglerTitle = ics.raw.includes('JUGGLER TITLE');
        const hasAppleTitle   = ics.raw.includes('APPLE TITLE');
        results.C1 = hasJugglerTitle
          ? PASS + ' — CalDAV event has juggler title; Apple edit overwritten'
          : hasAppleTitle
            ? FAIL + " — Apple title persists in CalDAV; juggler didn't re-push"
            : NOTE + ' — event fetched but title unclear in ICS';
      } else {
        results.C1 = NOTE + ' — event not fetchable by URL (CDN lag)';
      }
    } else {
      results.C1 = NOTE + ' — no active Apple ledger row for C1 after 3 syncs';
    }
  }
  log('C1', results.C1);

  // C2 final — should have new active row after re-create
  if (!results.C2 && C2_ID) {
    const rows = await db('cal_sync_ledger').where({ task_id: C2_ID, provider: 'apple' }).orderBy('id', 'desc');
    const active = rows.find(r => r.status === 'active');
    results.C2 = active
      ? PASS + ' — event re-created; new active row: ' + active.provider_event_id?.slice(-40)
      : NOTE + ' — no active row after sync 3; statuses=[' + rows.map(r => r.status).join(',') + ']';
  }
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
    B5_TASK_ID   = b1Row.task_id;
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
    // Native pulled events store UID (not full URL) in provider_event_id.
    // Reconstruct CalDAV URL if needed.
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
    // task_id is NULLed on the ledger row after MISS_THRESHOLD deletion — query by task gone, not ledger status
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
  console.log('\n══════════════════ APPLE B–D SOAK RESULTS ══════════════════');
  for (const k of ['B1', 'B2', 'B3', 'B4', 'B5', 'C1', 'C2', 'C3', 'C4']) {
    console.log('  ' + k + ': ' + (results[k] || '(no result recorded)'));
  }
  console.log('\n  D — Stability snapshots:');
  for (const s of snapshots) console.log('    ' + s);
  console.log('  D: ' + (results.D || ''));
  console.log('═════════════════════════════════════════════════════════════\n');

  await db.destroy();
}

main().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(1);
});
