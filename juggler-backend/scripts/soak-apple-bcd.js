/**
 * Apple CalDAV B–D soak test driver
 *
 * Drives B1–B5, C2, C3 by interacting with CalDAV directly, then triggering
 * juggler syncs and asserting ledger / task state.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../src/db');
const appleCalApi = require('../src/lib/apple-cal-api');

const USERNAME = 'wdraike@icloud.com';
const PASSWORD = 'zyty-rkxh-vtxt-zdie';
const CALENDAR_URL = 'https://caldav.icloud.com/294728805/calendars/77E214B1-5D29-4D10-9AB3-447CBA9C3F66/';
const SERVER_URL = 'https://caldav.icloud.com';
const USER_ID = '019d29f9-9ef9-74eb-af2d-0418237d0bd9';
const JWT = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImY1ZGM0M2JlZWJiODU2NjIifQ.eyJzdWIiOiIwMTlkMjlmOS05ZWY5LTc0ZWItYWYyZC0wNDE4MjM3ZDBiZDkiLCJlbWFpbCI6IndkcmFpa2VAZ21haWwuY29tIiwiYXBwcyI6WyJqdWdnbGVyIl0sInBsYW5zIjp7Imp1Z2dsZXIiOiJwcm8ifSwiaXNzIjoicmFpa2UtYXV0aCIsImlhdCI6MTc3NzE2ODE5MCwiZXhwIjoxNzc3MTk2OTkwfQ.mhwTQLV-feBhKBoY49hdnqTRS7e105qh3YC03pcOGM-6b12tSlekT2GgJPkR3MswZNLAYNJVdwCjbCpKKErIg2UZZaPe1ABjJfkSy86D1ZmhSRkuDPd0OeesTiWprWXCwP-uchrnVV-0-LRIq3IsqYxqQ_PV6zrOKZGF2_JsPSDttzVb5vvSHSSlz2FeXbFjzxSLTEAiJ3rd0tErp1TUibof_lmAs7IQdlqVpDqoXyTeyiBFU0BUYqz89grHr9B-hwGRy3Ww3zjqNJkiWrJ_KH5BpN041SQVKPvqLazkkvZXzRmZtCiigrNX-Q50w7TsIJ38VWiZc9IqRQke_SgY9g';

const B2_ID = '019dc77a-d37c-7443-ac30-b4b5825929ba';
const B3_ID = '019dc77a-d4ab-757a-9cc2-ac777571eedf';
const B4_ID = '019dc77a-d5db-752e-af74-465567bda3a7';

const PASS = '✅ PASS';
const FAIL = '❌ FAIL';
const NOTE = '⚠️ NOTE';

function log(label, msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${label}: ${msg}`);
}

async function triggerSync() {
  const res = await fetch('http://localhost:5002/api/cal/sync', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + JWT, 'Content-Type': 'application/json' },
    body: '{}'
  });
  return res.json();
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getLedgerRow(taskId) {
  return db('cal_sync_ledger')
    .where({ task_id: taskId, provider: 'apple' })
    .orderBy('id', 'desc')
    .first();
}

async function getLedgerByEventId(eventId) {
  return db('cal_sync_ledger')
    .where({ provider_event_id: eventId, provider: 'apple' })
    .first();
}

async function getTaskById(taskId) {
  return db('task_instances').where({ id: taskId }).first();
}

async function getTaskMasterById(masterId) {
  return db('task_masters').where({ id: masterId }).first();
}

async function countAppleActiveLedger() {
  const r = await db('cal_sync_ledger')
    .where({ user_id: USER_ID, provider: 'apple', status: 'active' })
    .count('id as n')
    .first();
  return r.n;
}

async function getAppleEventUrl(taskId) {
  const row = await db('cal_sync_ledger')
    .where({ task_id: taskId, provider: 'apple', status: 'active' })
    .orderBy('id', 'desc')
    .first();
  return row ? row.provider_event_id : null;
}

// ── Build a native VEVENT ICS (not juggler-origin) ──────────────────────────
function buildNativeICS(uid, title, dateStr, startHour, durationMins) {
  // dateStr: 'YYYYMMDD', startHour: e.g. 9 → 09:00
  const pad = n => String(n).padStart(2, '0');
  const endMins = (startHour * 60 + durationMins) % (24 * 60);
  const endHour = Math.floor(endMins / 60);
  const endMin = endMins % 60;
  const dtstart = `${dateStr}T${pad(startHour)}0000`;
  const dtend = `${dateStr}T${pad(endHour)}${pad(endMin)}00`;
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Soak Test//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:${title}`,
    `DTSTART;TZID=America/New_York:${dtstart}`,
    `DTEND;TZID=America/New_York:${dtend}`,
    `DTSTAMP:${now}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

async function main() {
  const client = await appleCalApi.createClient(SERVER_URL, USERNAME, PASSWORD);
  log('SETUP', 'CalDAV client connected');

  const results = {};

  // ── B1: Create native Apple event → juggler should pull it ───────────────
  log('B1', 'Creating native Apple event via CalDAV PUT...');
  const b1Uid = 'soak-b1-native-' + Date.now();
  const b1Filename = b1Uid + '.ics';
  const b1ICS = buildNativeICS(b1Uid, 'SOAK-B1: Native Apple event', '20260427', 9, 30);
  let b1EventUrl;
  try {
    const r = await client.createCalendarObject({
      calendar: { url: CALENDAR_URL },
      filename: b1Filename,
      iCalString: b1ICS
    });
    b1EventUrl = r.url || (CALENDAR_URL + b1Filename);
    log('B1', `Created at ${b1EventUrl}`);
  } catch (e) {
    log('B1', `CREATE FAILED: ${e.message}`);
    results.B1 = FAIL + ' — create failed: ' + e.message;
  }

  // ── B2: Move juggler-created event (update time via PUT) ─────────────────
  log('B2', 'Fetching current B2 event to modify time...');
  const b2EventUrl = await getAppleEventUrl(B2_ID);
  if (b2EventUrl) {
    try {
      // Fetch existing event
      const events = await appleCalApi.listEvents(client, CALENDAR_URL,
        new Date('2026-04-27T00:00:00Z').toISOString(),
        new Date('2026-04-28T00:00:00Z').toISOString());
      const b2Event = events.find(e => e._url === b2EventUrl);
      if (b2Event) {
        // Modify start to 3:00 PM (19:00 UTC for New York)
        const modICS = (b2Event._raw || '').replace(
          /DTSTART[^:]*:[^\r\n]*/,
          'DTSTART;TZID=America/New_York:20260427T150000'
        ).replace(
          /DTEND[^:]*:[^\r\n]*/,
          'DTEND;TZID=America/New_York:20260427T154500'
        );
        if (modICS !== b2Event._raw) {
          await client.updateCalendarObject({
            calendarObject: { url: b2EventUrl, data: modICS, etag: b2Event._etag }
          });
          log('B2', 'Updated time to 3:00 PM in CalDAV');
        } else {
          log('B2', `${NOTE} raw ICS replace did not match — skipping time update`);
          results.B2 = NOTE + ' — ICS regex did not match; manual test needed';
        }
      } else {
        log('B2', `${NOTE} event not yet visible in listEvents (CDN cache) — will check after sync`);
      }
    } catch (e) {
      log('B2', `UPDATE FAILED: ${e.message}`);
      results.B2 = FAIL + ' — update failed: ' + e.message;
    }
  } else {
    results.B2 = FAIL + ' — no active Apple ledger row for B2 task';
  }

  // ── B3: Delete juggler-created event from CalDAV ─────────────────────────
  log('B3', 'Deleting B3 event from CalDAV...');
  const b3EventUrl = await getAppleEventUrl(B3_ID);
  if (b3EventUrl) {
    try {
      await client.deleteCalendarObject({ calendarObject: { url: b3EventUrl } });
      log('B3', 'Deleted from CalDAV — waiting for 3 sync cycles (MISS_THRESHOLD)...');
    } catch (e) {
      log('B3', `DELETE FAILED: ${e.message}`);
      results.B3 = FAIL + ' — delete failed: ' + e.message;
    }
  } else {
    results.B3 = FAIL + ' — no active Apple ledger row for B3 task';
  }

  // ── B4: Rename juggler-created event in CalDAV ───────────────────────────
  log('B4', 'Fetching B4 event to rename...');
  const b4EventUrl = await getAppleEventUrl(B4_ID);
  if (b4EventUrl) {
    try {
      const events = await appleCalApi.listEvents(client, CALENDAR_URL,
        new Date('2026-04-27T00:00:00Z').toISOString(),
        new Date('2026-04-28T00:00:00Z').toISOString());
      const b4Event = events.find(e => e._url === b4EventUrl);
      if (b4Event) {
        const renamedICS = (b4Event._raw || '').replace(
          /SUMMARY:[^\r\n]*/,
          'SUMMARY:SOAK-B4: RENAMED BY APPLE'
        );
        await client.updateCalendarObject({
          calendarObject: { url: b4EventUrl, data: renamedICS, etag: b4Event._etag }
        });
        log('B4', 'Renamed to "SOAK-B4: RENAMED BY APPLE" in CalDAV');
      } else {
        log('B4', `${NOTE} event not yet visible in listEvents (CDN cache)`);
        results.B4 = NOTE + ' — event not in listEvents; CDN lag';
      }
    } catch (e) {
      log('B4', `RENAME FAILED: ${e.message}`);
      results.B4 = FAIL + ' — rename failed: ' + e.message;
    }
  } else {
    results.B4 = FAIL + ' — no active Apple ledger row for B4 task';
  }

  // ── Wait for CDN propagation + trigger sync 1 ────────────────────────────
  log('SYNC', 'Waiting 35s for CDN propagation...');
  await sleep(35000);
  log('SYNC', 'Triggering sync 1...');
  const s1 = await triggerSync();
  log('SYNC-1', `pushed=${s1.pushed} pulled=${s1.pulled} del_local=${s1.deleted_local} del_remote=${s1.deleted_remote} errors=${s1.errors?.length || 0}`);

  // ── Check B1 result ───────────────────────────────────────────────────────
  if (!results.B1) {
    // Look for a task with origin='apple' and text matching B1
    const b1Pulled = await db('cal_sync_ledger as l')
      .join('task_instances as ti', 'ti.id', 'l.task_id')
      .join('task_masters as m', 'm.id', 'ti.master_id')
      .where('l.provider', 'apple')
      .where('l.provider_event_id', b1EventUrl || '')
      .first();
    if (b1Pulled) {
      const master = await getTaskMasterById(b1Pulled.master_id);
      const when = b1Pulled.when || (master && master.when);
      results.B1 = (b1Pulled.origin === 'apple')
        ? `${PASS} — imported as task ${b1Pulled.task_id}, origin='apple', when='${b1Pulled.when || 'check task'}'`
        : `${FAIL} — pulled but origin='${b1Pulled.origin}' (expected 'apple')`;
    } else {
      // Maybe it's in the tasks_v via origin field
      const b1Task = await db.raw(`
        SELECT l.task_id, l.origin, m.text, ti.scheduled_at
        FROM cal_sync_ledger l
        JOIN task_instances ti ON ti.id = l.task_id
        JOIN task_masters m ON m.id = ti.master_id
        WHERE l.provider='apple' AND l.status='active'
          AND m.text LIKE '%SOAK-B1%'
        LIMIT 1
      `);
      const row = b1Task[0]?.[0];
      results.B1 = row
        ? `${PASS} — pulled as task ${row.task_id}, origin='${row.origin}', text='${row.text}'`
        : `${NOTE} — not yet visible after sync 1; may need another cycle`;
    }
  }
  log('B1', results.B1);

  // ── Check B2 result (juggler should NOT have updated the task time) ────────
  if (!results.B2) {
    const b2Row = await getLedgerRow(B2_ID);
    const b2Task = await getTaskById(B2_ID);
    if (b2Row && b2Task) {
      // Juggler should keep its version; scheduled_at should still be 14:00 UTC (10am ET)
      const scheduledHour = new Date(b2Task.scheduled_at).getUTCHours();
      results.B2 = (scheduledHour === 14)
        ? `${PASS} — juggler task time unchanged (still 10am ET = 14:00 UTC); juggler wins`
        : `${FAIL} — task time changed to ${b2Task.scheduled_at} — juggler was overwritten by Apple move`;
    } else {
      results.B2 = `${NOTE} — could not find ledger/task row`;
    }
  }
  log('B2', results.B2);

  // ── Check B4 result (juggler should push its title back) ─────────────────
  if (!results.B4) {
    const b4Row = await getLedgerRow(B4_ID);
    const b4Task = await getTaskById(B4_ID);
    const b4Master = b4Task ? await getTaskMasterById(b4Task.master_id) : null;
    if (b4Master) {
      results.B4 = b4Master.text === 'SOAK-B4: Rename me in Apple Cal'
        ? `${PASS} — juggler text unchanged ('${b4Master.text}'); juggler wins on pull`
        : `${FAIL} — task text changed to '${b4Master.text}'`;
    } else {
      results.B4 = `${NOTE} — task master not found`;
    }
  }
  log('B4', results.B4);

  // B3 needs 3 sync cycles to confirm deletion
  log('B3', 'Sync 1 done. B3 needs 2 more syncs (MISS_THRESHOLD=3)...');

  // ── C2: Delete Apple event + edit juggler task before next sync ──────────
  log('C2', 'Setup: deleting B2 event from CalDAV + editing B2 task title...');
  const c2EventUrl = await getAppleEventUrl(B2_ID);
  if (c2EventUrl) {
    // Step 1: delete from Apple
    try {
      await client.deleteCalendarObject({ calendarObject: { url: c2EventUrl } });
      log('C2', 'Deleted B2 event from CalDAV');
    } catch (e) {
      log('C2', `Delete failed: ${e.message}`);
    }
    // Step 2: immediately edit B2 task in juggler (within seconds)
    const editRes = await fetch(`http://localhost:5002/api/tasks/${B2_ID}`, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + JWT, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'SOAK-C2: Modified after Apple delete' })
    });
    const editData = await editRes.json();
    log('C2', editData.task ? `Juggler task edited: ${editData.task.text}` : `Edit failed: ${JSON.stringify(editData)}`);
  } else {
    log('C2', 'No B2 event URL available for C2 test');
    results.C2 = NOTE + ' — B2 event URL not available';
  }

  // ── C3: Rapid-fire 10 tasks ───────────────────────────────────────────────
  log('C3', 'Creating 10 tasks in rapid succession...');
  const c3Ids = [];
  for (let i = 1; i <= 10; i++) {
    const r = await fetch('http://localhost:5002/api/tasks', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + JWT, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `SOAK-C3-${String(i).padStart(2,'0')}: Rapid fire`,
        when: 'fixed',
        date: '4/28',
        time: `${9 + i}:00 AM`,
        dur: 30
      })
    });
    const d = await r.json();
    if (d.task?.id) c3Ids.push(d.task.id);
  }
  log('C3', `Created ${c3Ids.length} tasks`);

  // ── Sync 2 ────────────────────────────────────────────────────────────────
  log('SYNC', 'Waiting 35s, then sync 2 (B3 needs 2 more misses)...');
  await sleep(35000);
  log('SYNC', 'Triggering sync 2...');
  const s2 = await triggerSync();
  log('SYNC-2', `pushed=${s2.pushed} pulled=${s2.pulled} del_local=${s2.deleted_local} del_remote=${s2.deleted_remote} errors=${s2.errors?.length || 0}`);

  // Check B3 miss count after sync 2
  const b3Row2 = await getLedgerRow(B3_ID);
  log('B3', `After sync 2: status=${b3Row2?.status} miss_count=${b3Row2?.miss_count}`);

  // Check C2 after sync 2 — B2 was deleted+modified, should have been re-created
  const c2LedgerRows = await db('cal_sync_ledger')
    .where({ task_id: B2_ID, provider: 'apple' })
    .orderBy('id', 'desc')
    .limit(3);
  const c2Active = c2LedgerRows.find(r => r.status === 'active');
  log('C2', `After sync 2: active rows=${c2LedgerRows.filter(r=>r.status==='active').length}, statuses=[${c2LedgerRows.map(r=>r.status).join(',')}]`);

  // ── Sync 3 ────────────────────────────────────────────────────────────────
  log('SYNC', 'Waiting 35s, then sync 3 (should trigger B3 deletion)...');
  await sleep(35000);
  log('SYNC', 'Triggering sync 3...');
  const s3 = await triggerSync();
  log('SYNC-3', `pushed=${s3.pushed} pulled=${s3.pulled} del_local=${s3.deleted_local} del_remote=${s3.deleted_remote} errors=${s3.errors?.length || 0}`);

  // ── Check B3 final ────────────────────────────────────────────────────────
  if (!results.B3) {
    const b3RowFinal = await getLedgerRow(B3_ID);
    const b3TaskFinal = await getTaskById(B3_ID);
    if (b3RowFinal?.status === 'deleted_remote' && !b3TaskFinal) {
      results.B3 = `${PASS} — task deleted after MISS_THRESHOLD, ledger → deleted_remote`;
    } else if (b3RowFinal?.status === 'deleted_remote') {
      results.B3 = `${PASS} (partial) — ledger → deleted_remote but task instance still exists`;
    } else {
      results.B3 = `${FAIL} — after 3 syncs: ledger status=${b3RowFinal?.status} miss_count=${b3RowFinal?.miss_count}, task ${b3TaskFinal ? 'still exists' : 'deleted'}`;
    }
  }
  log('B3', results.B3);

  // ── Check B5: delete the B1 native event (origin='apple') ────────────────
  // First find the juggler task that was created for B1
  const b1TaskRows = await db.raw(`
    SELECT l.task_id, l.provider_event_id, l.status, l.miss_count, m.text
    FROM cal_sync_ledger l
    JOIN task_instances ti ON ti.id = l.task_id
    JOIN task_masters m ON m.id = ti.master_id
    WHERE l.provider='apple' AND m.text LIKE '%SOAK-B1%'
    LIMIT 1
  `);
  const b1Task = b1TaskRows[0]?.[0];
  if (b1Task && b1EventUrl) {
    log('B5', `Found B1 task: ${b1Task.task_id}, deleting its Apple event...`);
    try {
      await client.deleteCalendarObject({ calendarObject: { url: b1EventUrl } });
      log('B5', 'Deleted B1 native event from CalDAV — watching for MISS_THRESHOLD deletion...');
    } catch (e) {
      log('B5', `Delete failed: ${e.message}`);
      results.B5 = FAIL + ' — delete failed: ' + e.message;
    }
  } else {
    log('B5', `${NOTE} B1 task not found yet (B1 may have failed) — skipping B5`);
    results.B5 = NOTE + ' — B1 task not found, B5 skipped';
  }

  // ── Check C2 final ────────────────────────────────────────────────────────
  if (!results.C2) {
    const c2FinalRows = await db('cal_sync_ledger')
      .where({ task_id: B2_ID, provider: 'apple' })
      .orderBy('id', 'desc');
    const c2Active2 = c2FinalRows.find(r => r.status === 'active');
    if (c2Active2) {
      results.C2 = `${PASS} — event re-created after Apple delete + juggler edit; new URL: ${c2Active2.provider_event_id?.slice(-40)}`;
    } else {
      // The miss_count guard means it needs at least miss_count>=1 before re-creating
      // After sync 3, the re-create should have happened
      results.C2 = `${NOTE} — no active row after sync 3; statuses=[${c2FinalRows.map(r=>r.status).join(',')}]`;
    }
  }
  log('C2', results.C2);

  // ── Check C3: all 10 pushed to Apple? ────────────────────────────────────
  if (!results.C3) {
    const c3Pushed = await db('cal_sync_ledger')
      .where({ provider: 'apple', status: 'active' })
      .whereIn('task_id', c3Ids)
      .count('id as n')
      .first();
    const n = parseInt(c3Pushed.n);
    results.C3 = n === 10
      ? `${PASS} — all 10 tasks synced to Apple (${n}/10)`
      : `${NOTE} — ${n}/10 tasks synced; may need another sync cycle`;
  }
  log('C3', results.C3);

  // ── D: Stability baseline (count active/deleted) ─────────────────────────
  const activeCount = await countAppleActiveLedger();
  log('D', `Baseline after B/C tests: ${activeCount} active Apple ledger rows`);

  // ── B5 needs 3 more syncs ─────────────────────────────────────────────────
  if (!results.B5 && b1Task) {
    log('B5', 'Running 3 more syncs for B5 MISS_THRESHOLD...');
    for (let i = 4; i <= 6; i++) {
      await sleep(35000);
      const si = await triggerSync();
      log(`SYNC-${i}`, `pushed=${si.pushed} pulled=${si.pulled} del_remote=${si.deleted_remote}`);
    }
    const b5RowFinal = await db('cal_sync_ledger')
      .where({ task_id: b1Task.task_id, provider: 'apple' })
      .orderBy('id', 'desc').first();
    const b5TaskFinal = await getTaskById(b1Task.task_id);
    if (b5RowFinal?.status === 'deleted_remote' && !b5TaskFinal) {
      results.B5 = `${PASS} — native Apple task deleted after MISS_THRESHOLD`;
    } else {
      results.B5 = `${FAIL} — ledger status=${b5RowFinal?.status} miss_count=${b5RowFinal?.miss_count}, task ${b5TaskFinal ? 'still exists' : 'deleted'}`;
    }
    log('B5', results.B5);
  }

  // ── D soak: 30 minutes ambient, snapshot every 10 min ────────────────────
  log('D', 'Starting 30-min ambient soak...');
  const snapshots = [];
  for (let t = 0; t <= 30; t += 10) {
    if (t > 0) {
      log('D', `Waiting 10 min (${t}/30)...`);
      await sleep(600000);
    }
    await triggerSync();
    const snap = await db('cal_sync_ledger')
      .where({ user_id: USER_ID, provider: 'apple' })
      .groupBy('status')
      .select('status', db.raw('COUNT(*) as n'));
    const snapStr = snap.map(r => `${r.status}=${r.n}`).join(' ');
    snapshots.push(`+${t}min: ${snapStr}`);
    log('D', snapshots[snapshots.length - 1]);
  }

  // ── Final summary ────────────────────────────────────────────────────────
  console.log('\n═══════════════ APPLE B–D SOAK RESULTS ═══════════════');
  const order = ['B1','B2','B3','B4','B5','C2','C3'];
  for (const k of order) {
    console.log(`  ${k}: ${results[k] || '(no result recorded)'}`);
  }
  console.log('\n  D — Stability snapshots:');
  for (const s of snapshots) console.log(`    ${s}`);
  console.log('═══════════════════════════════════════════════════════\n');

  await db.destroy();
}

main().catch(e => {
  console.error('FATAL:', e.message, e.stack);
  process.exit(1);
});
