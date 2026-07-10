/**
 * BUG-812b regression — scheduledAt anchor guard (successor form)
 *
 * Covers: BUG-812 lineage. REWRITTEN for 999.1440 — the original wip
 * de-anchor guard no longer exists:
 *
 *   1. `wip` was removed from the status lifecycle (juggler 450b00b4;
 *      shared/task-status SSOT — wip is never emitted, only tolerated in
 *      legacy rows). The scheduler has NO wip-specific anchor path anymore:
 *      a status:'wip' task schedules exactly like its placementMode says.
 *
 *   2. The guard's INTENT (a task whose t.time is unparseable must anchor at
 *      its persisted scheduled_at instead of silently de-anchoring) lives on
 *      as the W2/Odin DB-single-source fixed-anchor guard
 *      (unifiedScheduleV2.js ~325): non-recurring FIXED task + anchorMin
 *      still null + t.scheduledAt + _cfg.timezone → anchorMin derived via
 *      utcToLocal(new Date(t.scheduledAt), _cfg.timezone). Note it reads the
 *      DISPLAY timezone from cfg, NOT t.tz (using row.tz would desync from
 *      the localToUtc writeback — ernie BLOCK-1).
 *
 *   3. The old B812b-5 "raw string → Invalid Date" mutation pin is DEAD:
 *      utcToLocal's 'ZZ' invalid-date bug was fixed in juggler ae41e05d
 *      (999.1186 parseDbUtc SSOT) — ISO-Z strings now parse correctly in
 *      both input forms.
 *
 * Fixture:
 *   t.scheduledAt = '2026-06-22T18:30:00.000Z'
 *   cfg.timezone  = 'America/New_York' → UTC-4 (EDT) → local 2:30 PM = 870
 */

'use strict';

var unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../src/scheduler/constants');

// The target date must match t.date so the task is in-window for today.
var TODAY = '2026-06-22';

function makeDates() {
  return [
    { key: TODAY, date: new Date(2026, 5, 22), isoDow: 1, isToday: true },
    { key: '2026-06-23', date: new Date(2026, 5, 23), isoDow: 2, isToday: false },
  ];
}

function makeCfg() {
  return {
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    preferences: {},
    // The successor fixed-anchor guard derives local time from the DISPLAY
    // timezone on cfg (999.1440 — see header §2), not from t.tz.
    timezone: 'America/New_York',
  };
}

var _seq = 0;
function uid(prefix) { return prefix + '_812b_' + (++_seq); }

// Base task shape matching makeTask in bug815b test for consistency.
function makeTask(overrides) {
  return Object.assign({
    id: uid('t'),
    text: 'WIP Task',
    date: TODAY,
    dur: 30,
    pri: 'P2',
    when: '',
    dayReq: 'any',
    status: 'wip',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: false,
    split: false,
    generated: false,
    section: '',
  }, overrides);
}

// Drive the full production entry point — identical pattern to bug815b.
// statuses map is built from task.status exactly as runSchedule.js does.
function run(tasks) {
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  // nowMins=480 (8 AM) — wip tasks are placed even before/at nowMins because
  // the immovable path (tryPlaceAtTime) bypasses the nowMins gate.
  return unifiedSchedule(tasks, statuses, TODAY, 480 /* 8:00 AM */, makeCfg());
}

// Returns the start minute of the first placement for taskId on TODAY,
// or null if the task was not placed on that day.
function placedStartMin(result, taskId) {
  var placements = result.dayPlacements[TODAY] || [];
  for (var i = 0; i < placements.length; i++) {
    var p = placements[i];
    if (p && p.task && p.task.id === taskId) return p.start;
  }
  return null;
}

// Returns true if taskId appears in any day's placements.
function isPlacedAnywhere(result, taskId) {
  return Object.keys(result.dayPlacements).some(function(dk) {
    return (result.dayPlacements[dk] || []).some(function(p) {
      return p && p.task && p.task.id === taskId;
    });
  });
}

// ── BUG-812b: de-anchor guard — wip with unparseable t.time + valid scheduledAt ─

describe('BUG-812b: scheduledAt anchor guard — FIXED task with unparseable t.time uses scheduledAt (wip path removed)', function() {

  test('B812b-1: FIXED task with t.time=unparseable + valid scheduledAt anchors at 870 (2:30 PM EDT)', function() {
    // PRIMARY pin of the successor guard (999.1440 — see header §2).
    // FIXED non-recurring + unparseable t.time + t.scheduledAt + cfg.timezone
    // → anchorMin = 870 via utcToLocal(new Date(scheduledAt), cfg.timezone).
    var fixedTask = makeTask({
      id: uid('fixed_guard'),
      status: '',
      placementMode: 'fixed',
      time: 'not-a-time',          // parseTimeToMinutes → null; forces guard to fire
      scheduledAt: '2026-06-22T18:30:00.000Z', // UTC 18:30 = 2:30 PM EDT (UTC-4)
    });

    var result = run([fixedTask]);

    // Guard must derive anchorMin=870 and pin the event at 2:30 PM.
    expect(placedStartMin(result, fixedTask.id)).toBe(870);
  });

  test('B812b-1b: ex-wip status has NO special anchor path — schedules by placementMode (wip removed from lifecycle)', function() {
    // 999.1440: `wip` was removed from the status lifecycle (juggler
    // 450b00b4; shared/task-status SSOT). A legacy status:'wip' row with an
    // unparseable t.time and a scheduledAt is NOT pinned at 870 anymore — as
    // a default (anytime-mode) task it places at the first free slot
    // (nowMins = 480), because ANYTIME tasks never anchor on bare
    // t.time/scheduledAt.
    var legacyWip = makeTask({
      id: uid('legacy_wip'),
      status: 'wip',
      time: 'not-a-time',
      scheduledAt: '2026-06-22T18:30:00.000Z',
      tz: 'America/New_York',
    });

    var result = run([legacyWip]);

    expect(placedStartMin(result, legacyWip.id)).toBe(480);
  });

  test('B812b-2: FIXED task with parseable t.time DOES NOT trigger guard (guard is conditional, not default)', function() {
    // Confirm the guard is gated on anchorMin==null. When t.time is parseable,
    // anchorMin = parseTimeToMinutes(t.time) = 540 (9:00 AM) and the
    // scheduledAt fallback is bypassed — a validly-parsed t.time is never
    // overridden by scheduled_at.
    var fixedTask = makeTask({
      id: uid('fixed_parseable'),
      status: '',
      placementMode: 'fixed',
      time: '9:00 AM',              // parseTimeToMinutes → 540; guard must NOT fire
      scheduledAt: '2026-06-22T18:30:00.000Z', // would yield 870 if guard fired
    });

    var result = run([fixedTask]);

    // Must be placed at 540 (from t.time), NOT 870 (from scheduledAt).
    expect(placedStartMin(result, fixedTask.id)).toBe(540);
    expect(placedStartMin(result, fixedTask.id)).not.toBe(870);
  });

  test('B812b-3: wip with t.time=unparseable + NO scheduledAt is still placed (guard gracefully no-ops)', function() {
    // When the guard fires (anchorMin==null, st=wip) but t.scheduledAt is absent,
    // the outer condition (t.scheduledAt && t.tz) is false → guard no-ops.
    // The wip gets anchorMin=null → isStartedWithAnchor=false → queued normally.
    // It should still be placed (just not pinned at a specific minute).
    // This confirms the guard does not BLOCK placement when scheduledAt is absent.
    var wipTask = makeTask({
      id: uid('wip_no_sa'),
      time: 'not-a-time',          // parseTimeToMinutes → null
      scheduledAt: null,            // no scheduledAt → guard outer condition false
      tz: 'America/New_York',
    });

    var result = run([wipTask]);

    // Task must be placed somewhere (not dropped); it just won't be at 870.
    expect(isPlacedAnywhere(result, wipTask.id)).toBe(true);
  });

  test('B812b-4: wip with t.time=unparseable + scheduledAt but NO tz — guard no-ops gracefully', function() {
    // Guard condition: anchorMin==null && st==='wip' && t.scheduledAt && t.tz
    // Missing t.tz → outer condition false → guard does not fire.
    // Task still gets placed via normal queue path.
    var wipTask = makeTask({
      id: uid('wip_no_tz'),
      time: 'not-a-time',
      scheduledAt: '2026-06-22T18:30:00.000Z',
      tz: null,                     // missing tz → guard must not fire
    });

    var result = run([wipTask]);

    // Not pinned at 870 (guard didn't fire), but must be placed somewhere.
    expect(isPlacedAnywhere(result, wipTask.id)).toBe(true);
    expect(placedStartMin(result, wipTask.id)).not.toBe(870);
  });

  test('B812b-5: utcToLocal parses BOTH Date and ISO-Z string forms (ZZ bug fixed, 999.1186)', function() {
    // 999.1440 rewrite: the old pin asserted the raw ISO-Z STRING form
    // produced Invalid Date ('...000ZZ') — that was utcToLocal's own bug,
    // fixed in juggler ae41e05d (999.1186): parsing now routes through the
    // shared parseDbUtc SSOT, which handles explicit-zone ISO strings
    // correctly instead of blindly appending 'Z'. Both input forms must now
    // yield the same valid local time — the de-anchor failure mode this
    // suite was born from is structurally impossible.
    var dateHelpers = require('../../src/scheduler/dateHelpers');

    var rawStr = '2026-06-22T18:30:00.000Z';
    var asDate = new Date(rawStr);
    var tz = 'America/New_York';

    var viaDate = dateHelpers.utcToLocal(asDate, tz);
    expect(viaDate.time).toMatch(/2:30 PM/i);

    var viaString = dateHelpers.utcToLocal(rawStr, tz);
    expect(viaString.time).toMatch(/2:30 PM/i);
    expect(viaString.date).toBe('2026-06-22');
  });
});
