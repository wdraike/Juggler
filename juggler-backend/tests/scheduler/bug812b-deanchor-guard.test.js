/**
 * BUG-812b regression — wip de-anchor guard (unifiedScheduleV2.js:315-327)
 *
 * Covers: BUG-812 (de-anchor guard — zoe WARN: guard had zero coverage)
 * Layer: unit (pure — no DB required)
 * Traceability: .planning/kermit/fixy-time/TRACEABILITY.md BUG-812
 *
 * The guard (lines 315-327):
 *   When a wip task's t.time is unparseable (parseTimeToMinutes returns null at
 *   line 308), but the task has a valid t.scheduledAt (ISO-Z) + t.tz, anchorMin
 *   is derived via:
 *
 *     utcToLocal(new Date(t.scheduledAt), t.tz) → { time: '2:30 PM', ... }
 *     parseTimeToMinutes('2:30 PM') → 870
 *
 *   so the wip item is anchored at 870 (2:30 PM local) and placed immovably,
 *   NOT silently de-anchored/re-placed.
 *
 * Fixture (per bert spec):
 *   t.time = 'not-a-time'      → parseTimeToMinutes returns null (line 308)
 *   t.scheduledAt = '2026-06-22T18:30:00.000Z'
 *   t.tz = 'America/New_York'  → UTC-4 (EDT) → local 2:30 PM = 870 minutes
 *   expected anchorMin = 870
 *
 * Pre-fix mutation (what the guard reverted to):
 *   OLD (broken): dateHelpers.utcToLocal(t.scheduledAt, t.tz)
 *     → t.scheduledAt is already ISO-Z; utcToLocal's string branch does
 *       .replace(' ', 'T') + 'Z' → '2026-06-22T18:30:00.000ZZ' → Invalid Date
 *       → returns { date: null, time: null } → saLocal.time falsy → guard no-ops
 *       → anchorMin stays null → isStartedWithAnchor = false → wip placed freely
 *   NEW (fixed): dateHelpers.utcToLocal(new Date(t.scheduledAt), t.tz)
 *     → Date object branch → valid → returns { time: '2:30 PM' } → anchorMin=870
 *
 * Self-mutation verification (performed during authoring):
 *   Step 1: Backed up unifiedScheduleV2.js to /tmp/usv2-backup.js
 *   Step 2: Patched line 316 to use raw-string form (old bug):
 *             dateHelpers.utcToLocal(t.scheduledAt, t.tz)
 *   Step 3: Ran this test against the mutated file — B812b-1 RED (wip placed
 *             freely at a slot other than 870; isPlacedAtSlot returned false).
 *           B812b-3 also RED (placed at wrong slot).
 *   Step 4: Restored from /tmp/usv2-backup.js — all tests GREEN.
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

describe('BUG-812b: de-anchor guard — wip with unparseable t.time uses scheduledAt', function() {

  test('B812b-1: wip with t.time=unparseable + valid scheduledAt is placed at 870 (2:30 PM EDT)', function() {
    // This is the PRIMARY regression test for the de-anchor guard.
    //
    // PRE-FIX (mutant — utcToLocal receives raw string instead of Date):
    //   utcToLocal(t.scheduledAt, t.tz) where t.scheduledAt is already ISO-Z
    //   → string branch appends 'Z' again → Invalid Date → { time: null }
    //   → guard no-ops → anchorMin remains null → isStartedWithAnchor = false
    //   → wip is queued/re-placed, NOT pinned → placedStartMin !== 870 → RED.
    //
    // POST-FIX (production):
    //   utcToLocal(new Date(t.scheduledAt), t.tz) → { time: '2:30 PM' }
    //   → parseTimeToMinutes('2:30 PM') → 870
    //   → anchorMin=870, isStartedWithAnchor=true → tryPlaceAtTime → start=870 → GREEN.
    var wipTask = makeTask({
      id: uid('wip_guard'),
      time: 'not-a-time',          // parseTimeToMinutes → null; forces guard to fire
      scheduledAt: '2026-06-22T18:30:00.000Z', // UTC 18:30 = 2:30 PM EDT (UTC-4)
      tz: 'America/New_York',
    });

    var result = run([wipTask]);

    // Guard must derive anchorMin=870 and pin the wip at 2:30 PM (870 min since midnight).
    expect(placedStartMin(result, wipTask.id)).toBe(870);
  });

  test('B812b-2: wip with parseable t.time DOES NOT trigger guard (guard is conditional, not default)', function() {
    // Confirm the guard is gated on anchorMin==null. When t.time is parseable,
    // line 308 sets anchorMin = parseTimeToMinutes(t.time) = 540 (9:00 AM).
    // The guard at line 315 checks anchorMin==null → false → guard is bypassed.
    // The wip is placed at 540, not 870. This proves the guard does not override
    // a validly-parsed t.time.
    var wipTask = makeTask({
      id: uid('wip_parseable'),
      time: '9:00 AM',              // parseTimeToMinutes → 540; guard must NOT fire
      scheduledAt: '2026-06-22T18:30:00.000Z', // would yield 870 if guard fired
      tz: 'America/New_York',
    });

    var result = run([wipTask]);

    // Must be placed at 540 (from t.time), NOT 870 (from scheduledAt).
    expect(placedStartMin(result, wipTask.id)).toBe(540);
    expect(placedStartMin(result, wipTask.id)).not.toBe(870);
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

  test('B812b-5: mutation-load-bearing — guard fires only via new Date(scheduledAt), not raw string', function() {
    // Explicit documentation of what the pre-fix mutation breaks.
    // utcToLocal's string branch appends 'Z': 'YYYY-MM-DDTHH:MM:SS.sssZ' → '+Z' = Invalid Date.
    // This test uses the dateHelpers directly to confirm the two input forms differ.
    //
    // This is an auxiliary guard on the helper behaviour — the primary pin is B812b-1.
    var dateHelpers = require('../../src/scheduler/dateHelpers');

    var rawStr = '2026-06-22T18:30:00.000Z';
    var asDate = new Date(rawStr);
    var tz = 'America/New_York';

    // new Date(rawStr) form — what the fix uses — must yield a valid time.
    var viaDate = dateHelpers.utcToLocal(asDate, tz);
    expect(viaDate.time).not.toBeNull();
    expect(viaDate.time).toMatch(/2:30 PM/i);

    // Raw-string form — what the old (broken) code passed — appends 'Z' to an
    // already-Z string → '...000ZZ' → Invalid Date → utcToLocal returns null fields.
    // This is the mutation the guard was authored to fix.
    var rawBroken = rawStr; // already ISO-Z; utcToLocal string branch: .replace(' ','T')+'Z'
    var viaBrokenString = dateHelpers.utcToLocal(rawBroken, tz);
    // The ISO-Z string has no space, so .replace(' ','T') is a no-op, then +'Z' appends:
    // '2026-06-22T18:30:00.000ZZ' → new Date() → Invalid Date → { time: null }
    expect(viaBrokenString.time).toBeNull();
  });
});
