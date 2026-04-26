#!/usr/bin/env node
/**
 * Read-only GCal cross-side anomaly verifier.
 *
 * Seven anomaly classes:
 *
 *   A. Broken pair      — active ledger row → GCal event missing
 *   B. Orphan event     — juggler-stamped GCal event with no active ledger row
 *   C. Stale task ref   — active ledger row whose task_id no longer resolves
 *   D. Duplicate ledger — same task_id with >1 active ledger row for gcal
 *   E. Uncovered group  — scheduled pending instance(s) with zero GCal coverage
 *   F. Mis-spanned      — split-chunk contiguous run where the leader's GCal event
 *                         start or end differs from the expected run span
 *   G. Start mismatch   — non-split task where GCal event_start differs from
 *                         task's scheduled_at by more than 2 minutes
 *
 * Exit 0 = no anomalies. Exit 1 = at least one anomaly found.
 *
 * Usage:
 *   node scripts/verify-cal-anomalies-gcal.js [--start=YYYY-MM-DD] [--end=YYYY-MM-DD] [--json]
 */

'use strict';

const db = require('../src/db');
const gcalAdapter = require('../src/lib/cal-adapters/gcal.adapter');

const DEFAULT_TIMEZONE = 'America/New_York';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

function getArg(name) {
  const prefix = '--' + name + '=';
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const now = new Date();
const windowStartDefault = new Date(now); windowStartDefault.setDate(windowStartDefault.getDate() - 30);
const windowEndDefault   = new Date(now); windowEndDefault.setDate(windowEndDefault.getDate() + 60);

const timeMin = (getArg('start') ? new Date(getArg('start')) : windowStartDefault).toISOString();
const timeMax = (getArg('end')   ? new Date(getArg('end'))   : windowEndDefault  ).toISOString();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isJugglerStamped(event) {
  const desc = event.description || '';
  return desc.includes('Synced from Raike & Sons') || desc.includes('Synced from Juggler');
}

// Strip trailing -N (where N < 100) to get the split-group key.
// e.g. "master-31628-2" → "master-31628"  (split chunk → base key)
//      "master-31628"   → "master-31628"  (primary chunk — 31628 ≥ 100, unchanged)
function getBaseKey(taskId) {
  const m = taskId.match(/^(.*)-(\d+)$/);
  if (m && parseInt(m[2], 10) < 100) return m[1];
  return taskId;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

function pad(str, len) {
  const s = String(str || '');
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function fmtTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  const user = await db('users').first();
  if (!user) { console.error('No user found'); await db.destroy(); process.exit(1); }
  const tz = user.timezone || DEFAULT_TIMEZONE;

  if (!jsonMode) {
    console.log('GCal anomaly verifier — user ' + user.id);
    console.log('Window: ' + timeMin.slice(0, 10) + ' → ' + timeMax.slice(0, 10));
    console.log('Timezone: ' + tz);
    console.log('');
  }

  // -----------------------------------------------------------------------
  // 1. Active ledger rows
  // -----------------------------------------------------------------------
  const ledgerRows = await db('cal_sync_ledger')
    .where('user_id', user.id)
    .where('provider', 'gcal')
    .where('status', 'active')
    .select('id', 'task_id', 'provider_event_id', 'origin',
            'event_summary', 'event_start', 'event_end', 'miss_count', 'last_pushed_hash', 'synced_at');

  const ledgerByEventId = {};
  const ledgerByTaskId  = {};
  for (const row of ledgerRows) {
    if (row.provider_event_id) {
      (ledgerByEventId[row.provider_event_id] ||= []).push(row);
    }
    if (row.task_id) {
      (ledgerByTaskId[row.task_id] ||= []).push(row);
    }
  }

  // -----------------------------------------------------------------------
  // 2. Live GCal events
  // -----------------------------------------------------------------------
  const gcalEventsById = {};
  let gcalEventCount = 0;
  try {
    const token = await gcalAdapter.getValidAccessToken(user);
    const gcalEvents = await gcalAdapter.listEvents(token, timeMin, timeMax, user.id);
    gcalEventCount = gcalEvents.length;
    for (const event of gcalEvents) {
      gcalEventsById[event.id] = event;
    }
  } catch (err) {
    console.error('ERROR fetching GCal events: ' + err.message);
    await db.destroy();
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // 3. Tasks referenced by the ledger (for C, D, F, G)
  // -----------------------------------------------------------------------
  const taskIdSet = Object.keys(ledgerByTaskId);
  const tasksById = {};
  if (taskIdSet.length > 0) {
    const taskRows = await db('tasks_v')
      .where('user_id', user.id)
      .whereIn('id', taskIdSet)
      .select('id', 'text', 'status', 'scheduled_at', 'when', 'dur', 'split_total');
    for (const task of taskRows) {
      tasksById[task.id] = task;
    }
  }

  // -----------------------------------------------------------------------
  // 4. All scheduled pending instances in window (for E + F)
  //    Pending status is empty string (''), not NULL — whereNull alone misses them.
  // -----------------------------------------------------------------------
  const scheduledInstances = await db('task_instances')
    .where('user_id', user.id)
    .where(function () { this.whereNull('status').orWhere('status', ''); })
    .whereNotNull('scheduled_at')
    .where('scheduled_at', '>=', new Date(timeMin))
    .where('scheduled_at', '<', new Date(timeMax))
    .select('id', 'scheduled_at', 'dur', 'split_total');

  // Group by split-group base key, sort each group by scheduled_at
  const instancesByBaseKey = {};
  for (const inst of scheduledInstances) {
    const bk = getBaseKey(inst.id);
    (instancesByBaseKey[bk] ||= []).push(inst);
  }
  for (const key of Object.keys(instancesByBaseKey)) {
    instancesByBaseKey[key].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  }

  // Build set of covered base keys (any active ledger row means the group is covered)
  const coveredBaseKeys = new Set();
  for (const row of ledgerRows) {
    if (row.task_id) coveredBaseKeys.add(getBaseKey(row.task_id));
  }

  // -----------------------------------------------------------------------
  // 5. Anomaly detection — A through G
  // -----------------------------------------------------------------------

  // A. Broken pairs
  const brokenPairs = ledgerRows.filter(
    (row) => row.provider_event_id && !gcalEventsById[row.provider_event_id]
  );

  // B. Orphan events
  const orphanEvents = [];
  for (const evId of Object.keys(gcalEventsById)) {
    const event = gcalEventsById[evId];
    if (!ledgerByEventId[evId] && isJugglerStamped(event)) {
      orphanEvents.push(event);
    }
  }

  // C. Stale ledger task refs
  const staleLedger = ledgerRows.filter(
    (row) => row.task_id && !tasksById[row.task_id]
  );

  // D. Duplicate ledger rows
  const duplicateLedger = [];
  for (const tid of Object.keys(ledgerByTaskId)) {
    if (ledgerByTaskId[tid].length > 1) {
      duplicateLedger.push({ task_id: tid, rows: ledgerByTaskId[tid] });
    }
  }

  // E. Uncovered groups — scheduled pending instances with no active ledger at all
  const uncoveredGroups = [];
  for (const bk of Object.keys(instancesByBaseKey)) {
    if (coveredBaseKeys.has(bk)) continue;
    const group = instancesByBaseKey[bk];
    const earliest = group[0];
    const latest = group[group.length - 1];
    uncoveredGroups.push({
      baseKey:  bk,
      count:    group.length,
      startMs:  new Date(earliest.scheduled_at).getTime(),
      endMs:    new Date(latest.scheduled_at).getTime() + (latest.dur || 0) * 60000,
    });
  }

  // F. Mis-spanned split-chunk runs — for each split group, find contiguous runs and
  //    verify the run leader's GCal event spans exactly that run's start → end.
  //
  //    Uses task.split_total > 1 (not getBaseKey heuristic) to identify split chunks,
  //    so the primary chunk (whose ID ordinal is ≥ 100) is correctly included.
  const misSpanned = [];
  const checkedSplitGroups = new Set();

  for (const row of ledgerRows) {
    if (!row.task_id || !row.event_start || !row.event_end) continue;
    const task = tasksById[row.task_id];
    if (!task || Number(task.split_total || 1) <= 1) continue;

    const baseKey = getBaseKey(row.task_id);
    if (checkedSplitGroups.has(baseKey)) continue;
    checkedSplitGroups.add(baseKey);

    const group = instancesByBaseKey[baseKey];
    if (!group || group.length === 0) continue;

    // Find all contiguous runs within the group (60-second gap tolerance)
    const runs = [];
    let currentRun = [group[0]];
    for (let i = 1; i < group.length; i++) {
      const prev = currentRun[currentRun.length - 1];
      const curr = group[i];
      const prevEndMs   = new Date(prev.scheduled_at).getTime() + (prev.dur || 0) * 60000;
      const currStartMs = new Date(curr.scheduled_at).getTime();
      if (Math.abs(currStartMs - prevEndMs) <= 60000) {
        currentRun.push(curr);
      } else {
        runs.push(currentRun);
        currentRun = [curr];
      }
    }
    runs.push(currentRun);

    // For each run, the leader is the first instance; its ledger row must span the full run.
    for (const run of runs) {
      const leader    = run[0];
      const lastChunk = run[run.length - 1];
      const runStartMs = new Date(leader.scheduled_at).getTime();
      const runEndMs   = new Date(lastChunk.scheduled_at).getTime() + (lastChunk.dur || 0) * 60000;

      const leaderLedgerRows = ledgerByTaskId[leader.id] || [];
      if (leaderLedgerRows.length === 0) continue; // no active ledger for leader — class E covers it

      const leaderLedger = leaderLedgerRows[0];
      if (!leaderLedger.event_start || !leaderLedger.event_end) continue;

      const ledgerStartMs = new Date(leaderLedger.event_start).getTime();
      const ledgerEndMs   = new Date(leaderLedger.event_end).getTime();
      const startDiffMin  = Math.round((ledgerStartMs - runStartMs) / 60000);
      const endDiffMin    = Math.round((ledgerEndMs - runEndMs) / 60000);

      if (Math.abs(startDiffMin) > 1 || Math.abs(endDiffMin) > 1) {
        misSpanned.push({
          ledger:          leaderLedger,
          baseKey,
          runChunkCount:   run.length,
          totalChunkCount: group.length,
          expectedStartMs: runStartMs,
          expectedEndMs:   runEndMs,
          actualStartMs:   ledgerStartMs,
          actualEndMs:     ledgerEndMs,
          startDiffMin,
          endDiffMin,
        });
      }
    }
  }

  // G. Start-time mismatch — non-split tasks where GCal event_start differs from
  //    task's scheduled_at by more than 2 minutes. Split chunks are handled by F.
  const startMismatch = [];
  for (const row of ledgerRows) {
    if (!row.task_id || !row.event_start) continue;
    const task = tasksById[row.task_id];
    if (!task || !task.scheduled_at) continue;
    if (Number(task.split_total || 1) > 1) continue;

    const ledgerStartMs = new Date(row.event_start).getTime();
    const taskStartMs   = new Date(task.scheduled_at).getTime();
    const diffMin       = Math.round((ledgerStartMs - taskStartMs) / 60000);

    if (Math.abs(diffMin) > 2) {
      startMismatch.push({ ledger: row, task, taskStartMs, ledgerStartMs, diffMin });
    }
  }

  // -----------------------------------------------------------------------
  // 6. Output
  // -----------------------------------------------------------------------

  const totalAnomalies = brokenPairs.length + orphanEvents.length + staleLedger.length +
                         duplicateLedger.length + uncoveredGroups.length + misSpanned.length +
                         startMismatch.length;

  if (jsonMode) {
    console.log(JSON.stringify({
      window:  { start: timeMin.slice(0, 10), end: timeMax.slice(0, 10) },
      user_id: user.id,
      counts: {
        active_ledger_rows:    ledgerRows.length,
        gcal_events_in_window: gcalEventCount,
        scheduled_instances:   scheduledInstances.length,
        broken_pairs:          brokenPairs.length,
        orphan_events:         orphanEvents.length,
        stale_ledger:          staleLedger.length,
        duplicate_ledger:      duplicateLedger.length,
        uncovered_groups:      uncoveredGroups.length,
        mis_spanned:           misSpanned.length,
        start_mismatch:        startMismatch.length,
        total_anomalies:       totalAnomalies,
      },
      brokenPairs:     brokenPairs.map((r) => ({
        ledger_id: r.id, task_id: r.task_id, event_id: r.provider_event_id,
        summary: r.event_summary, miss_count: r.miss_count,
      })),
      orphanEvents:    orphanEvents.map((e) => ({
        event_id: e.id, title: e.title || e.summary,
      })),
      staleLedger:     staleLedger.map((r) => ({
        ledger_id: r.id, task_id: r.task_id, event_id: r.provider_event_id,
      })),
      duplicateLedger: duplicateLedger.map((d) => ({
        task_id: d.task_id, ledger_ids: d.rows.map((r) => r.id),
      })),
      uncoveredGroups: uncoveredGroups.map((g) => ({
        base_key: g.baseKey, chunk_count: g.count,
        start: fmtTime(g.startMs), end: fmtTime(g.endMs),
      })),
      misSpanned: misSpanned.map((m) => ({
        ledger_id:      m.ledger.id,
        base_key:       m.baseKey,
        run_chunks:     m.runChunkCount,
        total_chunks:   m.totalChunkCount,
        gcal_start:     fmtTime(m.actualStartMs),
        gcal_end:       fmtTime(m.actualEndMs),
        juggler_start:  fmtTime(m.expectedStartMs),
        juggler_end:    fmtTime(m.expectedEndMs),
        start_diff_min: m.startDiffMin,
        end_diff_min:   m.endDiffMin,
      })),
      startMismatch: startMismatch.map((s) => ({
        ledger_id:    s.ledger.id,
        task_id:      s.task.id,
        summary:      s.ledger.event_summary,
        gcal_start:   fmtTime(s.ledgerStartMs),
        juggler_start: fmtTime(s.taskStartMs),
        diff_min:     s.diffMin,
      })),
      result: totalAnomalies === 0 ? 'PASS' : 'FAIL',
    }, null, 2));
  } else {
    console.log('Active ledger rows: ' + ledgerRows.length +
                '  |  GCal events in window: ' + gcalEventCount +
                '  |  Scheduled instances: ' + scheduledInstances.length);
    console.log('');

    console.log('A. Broken pairs (active ledger → missing GCal event):  ' + brokenPairs.length);
    for (const r of brokenPairs) {
      const tl = r.task_id ? ' task=' + r.task_id.slice(0, 8) + '…' : '';
      const ml = r.miss_count ? ' miss=' + r.miss_count : '';
      console.log('  - ledger#' + pad(r.id, 6) + tl + ' "' + truncate(r.event_summary, 40) + '"' +
                  ' event=' + (r.provider_event_id || '?') + ml);
    }

    console.log('');
    console.log('B. Orphan events (GCal-stamped, no active ledger):  ' + orphanEvents.length);
    for (const oev of orphanEvents) {
      console.log('  - event=' + oev.id + ' "' + truncate(oev.title || oev.summary, 50) + '"');
    }

    console.log('');
    console.log('C. Stale ledger task refs (active ledger → missing task):  ' + staleLedger.length);
    for (const sr of staleLedger) {
      const sat = sr.synced_at ? new Date(sr.synced_at).toISOString().slice(0, 10) : 'unknown';
      console.log('  - ledger#' + pad(sr.id, 6) + ' task_id=' + (sr.task_id || 'null') +
                  ' event=' + (sr.provider_event_id || '?') + ' last-synced=' + sat);
    }

    console.log('');
    console.log('D. Duplicate active ledger rows (same task_id, gcal):  ' + duplicateLedger.length);
    for (const dup of duplicateLedger) {
      const dtask = tasksById[dup.task_id];
      const dname = dtask ? '"' + truncate(dtask.text, 30) + '"' : '(deleted)';
      const dids = dup.rows.map((x) => 'ledger#' + x.id).join(', ');
      console.log('  - task=' + dup.task_id.slice(0, 8) + '… ' + dname + ' → ' + dids);
    }

    console.log('');
    console.log('E. Uncovered groups (scheduled instances with no GCal event):  ' +
                uncoveredGroups.length);
    for (const g of uncoveredGroups) {
      console.log('  - ' + g.count + ' chunk(s)  ' +
                  fmtTime(g.startMs) + ' → ' + fmtTime(g.endMs) +
                  '  key=' + truncate(g.baseKey, 50));
    }

    console.log('');
    console.log('F. Mis-spanned split-chunk runs (GCal event span ≠ Juggler run span):  ' +
                misSpanned.length);
    for (const m of misSpanned) {
      const drifts = [];
      if (Math.abs(m.startDiffMin) > 1) drifts.push('start=' + (m.startDiffMin > 0 ? '+' : '') + m.startDiffMin + 'min');
      if (Math.abs(m.endDiffMin) > 1)   drifts.push('end=' + (m.endDiffMin > 0 ? '+' : '') + m.endDiffMin + 'min');
      console.log('  - ledger#' + pad(m.ledger.id, 6) +
                  ' "' + truncate(m.ledger.event_summary, 30) + '"' +
                  '  run=' + m.runChunkCount + '/' + m.totalChunkCount + ' chunks' +
                  '  juggler=' + fmtTime(m.expectedStartMs) + ' → ' + fmtTime(m.expectedEndMs) +
                  '  gcal=' + fmtTime(m.actualStartMs) + ' → ' + fmtTime(m.actualEndMs) +
                  '  drift: ' + drifts.join(', '));
    }

    console.log('');
    console.log('G. Start-time mismatch (GCal event_start ≠ task scheduled_at, >2 min):  ' +
                startMismatch.length);
    for (const s of startMismatch) {
      console.log('  - ledger#' + pad(s.ledger.id, 6) +
                  ' "' + truncate(s.ledger.event_summary, 40) + '"' +
                  '  task=' + s.task.id.slice(0, 8) + '…' +
                  '  juggler=' + fmtTime(s.taskStartMs) +
                  '  gcal=' + fmtTime(s.ledgerStartMs) +
                  '  diff=' + (s.diffMin > 0 ? '+' : '') + s.diffMin + 'min');
    }

    console.log('');
    if (totalAnomalies === 0) {
      console.log('RESULT: PASS — no anomalies (' + ledgerRows.length + ' active ledger rows cleanly paired)');
    } else {
      console.log('RESULT: FAIL — ' + totalAnomalies + ' anomal' + (totalAnomalies === 1 ? 'y' : 'ies') + ' found');
    }
  }

  await db.destroy();
  process.exit(totalAnomalies === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('FATAL:', err);
  db.destroy().catch(() => {}).then(() => { process.exit(1); });
});
