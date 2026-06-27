/**
 * 999.874 sub-item 2 — Multi-step spacing algorithm for flexible TPC
 * recurring tasks.
 *
 * Tests the full spacing algorithm:
 *   R1 — _targetDate and _deadlineDate assigned by expandRecurring
 *   R2 — Placement prefers _targetDate
 *   R3 — Start-on relaxation when target day is full
 *   R4 — Average spacing recalculation after placement
 *   R5 — Recursive cascade (R4 + R3 loop)
 *   R6 — SPACING_BLOCKED reason code for unplaceable instances
 *   R7 — Existing instances preserved
 *   R8 — Non-flexible TPC not affected
 *
 * Pure unit tests — no DB. Exercises the real unifiedScheduleV2 entry point
 * with recurringHistoryByMaster to seed the spacing history.
 *
 * NOTE: _deadlineDate from expandRecurring is stored on the item but does NOT
 * control the search window — deadlineDate (from t.deadline) does. Tests must
 * set t.deadline to extend the search window beyond the anchor date.
 */

'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');
const { REASON_CODES } = require('../../../shared/scheduler/reasonCodes');

// ── Config ────────────────────────────────────────────────────────

const TODAY = '2026-06-17'; // Wednesday
const NOW_MINS = 540; // 9:00 AM

const BASIC_BLOCKS = {
  Mon: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Tue: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Wed: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Thu: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Fri: [{ id: 'all', tag: 'all', name: 'All Day', start: 360, end: 1380, color: '#666', loc: 'home' }],
  Sat: [{ id: 'all', tag: 'all', name: 'All Day', start: 420, end: 1380, color: '#666', loc: 'home' }],
  Sun: [{ id: 'all', tag: 'all', name: 'All Day', start: 420, end: 1380, color: '#666', loc: 'home' }],
};

function makeCfg(overrides) {
  return Object.assign({
    timeBlocks: BASIC_BLOCKS,
    toolMatrix: {},
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    hourLocationOverrides: {},
    scheduleTemplates: null,
    splitMinDefault: 15,
    preferences: {},
    timezone: 'America/New_York',
  }, overrides || {});
}

/**
 * Build a flexible TPC recurring instance for testing spacing algorithm.
 * isFlexibleTpc is derived from recur.timesPerCycle < selectedDays.
 * The _targetDate and _deadlineDate simulate what expandRecurring would set.
 *
 * IMPORTANT: deadline must be set to extend the search window beyond the
 * anchor date. Without it, deadlineDate falls back to anchorDate and the
 * search window is clamped to a single day.
 */
function makeTpcInstance(overrides) {
  return Object.assign({
    id: 'spc-' + Math.random().toString(36).slice(2, 8),
    text: 'Spacing algorithm test',
    date: TODAY,
    dur: 60,
    pri: 'P2',
    when: '',
    dayReq: 'any',
    status: '',
    deadline: null, // must be set explicitly to extend search window
    earliestStart: null,
    recurring: true,
    generated: true,
    split: false,
    splitMin: null,
    location: [],
    tools: [],
    dependsOn: [],
    flexWhen: false,
    placementMode: PLACEMENT_MODES.ANYTIME,
    travelBefore: 0,
    travelAfter: 0,
    sourceId: 'master-spacing-algo',
    taskType: 'recurring_instance',
    recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 },
    // Simulate what expandRecurring would set (R1)
    _targetDate: null,
    _deadlineDate: null,
  }, overrides);
}

function run(tasks, cfgOverride) {
  const cfg = cfgOverride || makeCfg();
  const statuses = {};
  tasks.forEach(function (t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg);
}

function findPlacement(result, taskId) {
  var found = null;
  Object.keys(result.dayPlacements || {}).forEach(function (dk) {
    (result.dayPlacements[dk] || []).forEach(function (p) {
      if (p.task && p.task.id === taskId) found = { dateKey: dk, start: p.start, dur: p.dur, entry: p };
    });
  });
  return found;
}

function allPlacements(result) {
  var list = [];
  Object.keys(result.dayPlacements || {}).forEach(function (dk) {
    (result.dayPlacements[dk] || []).forEach(function (p) {
      list.push({ dateKey: dk, start: p.start, end: p.start + p.dur, taskId: p.task && p.task.id });
    });
  });
  return list;
}

function findUnplaced(result, taskId) {
  return (result.unplaced || []).find(function (t) { return t.id === taskId; });
}

// ═══════════════════════════════════════════════════════════════════
// 999.874 sub-item 2 — Multi-step spacing algorithm
// ═══════════════════════════════════════════════════════════════════

describe('999.874 — Multi-step spacing algorithm', function () {

  // ── R1: _targetDate and _deadlineDate assigned by expandRecurring ──
  describe('R1 — _targetDate and _deadlineDate from expandRecurring', function () {

    test('instance with _targetDate set uses it as preferred placement day', function () {
      // Instance with _targetDate = 2026-06-17 (today), deadline = 2026-06-20
      // The scheduler should prefer the target date over the anchor date.
      var task = makeTpcInstance({
        id: 'r1-target',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-20', // extends search window
        _targetDate: '2026-06-17',
        _deadlineDate: '2026-06-20',
      });

      var result = run([task]);
      var p = findPlacement(result, 'r1-target');
      expect(p).not.toBeNull();
      // Should be placed on target date (2026-06-17) since it has free slots
      expect(p.dateKey).toBe('2026-06-17');
    });

    test('instance with _targetDate in the future places on target date', function () {
      // _targetDate = 2026-06-19 (Friday), 2 days from now
      // deadline must be set to extend search window beyond anchor
      var task = makeTpcInstance({
        id: 'r1-future',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-22', // extends search window to include target
        _targetDate: '2026-06-19',
        _deadlineDate: '2026-06-22',
      });

      var result = run([task]);
      var p = findPlacement(result, 'r1-future');
      expect(p).not.toBeNull();
      // Should prefer the target date
      expect(p.dateKey).toBe('2026-06-19');
    });

    test('instance with _targetDate before anchorDate keeps earliest start', function () {
      // _targetDate before the anchor date — should not go into the past
      var task = makeTpcInstance({
        id: 'r1-past-target',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-20',
        _targetDate: '2026-06-15', // before anchor
        _deadlineDate: '2026-06-20',
      });

      var result = run([task]);
      var p = findPlacement(result, 'r1-past-target');
      expect(p).not.toBeNull();
      // Should be placed on or after anchor date (2026-06-17), not on the past target
      expect(p.dateKey >= '2026-06-17').toBe(true);
    });

    test('instance without _targetDate falls back to normal placement', function () {
      // No _targetDate set — should use normal findEarliestSlot behavior
      var task = makeTpcInstance({
        id: 'r1-no-target',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-20',
        _targetDate: null,
        _deadlineDate: null,
      });

      var result = run([task]);
      var p = findPlacement(result, 'r1-no-target');
      expect(p).not.toBeNull();
      expect(p.dateKey).toBe('2026-06-17');
    });
  });

  // ── R2: Placement prefers _targetDate ──
  describe('R2 — Placement prefers _targetDate', function () {

    test('placement starts search at _targetDate when set', function () {
      // _targetDate = 2026-06-19, anchor = 2026-06-17
      // The search should start at 2026-06-19 (the target), not 2026-06-17
      var task = makeTpcInstance({
        id: 'r2-pref',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-22',
        _targetDate: '2026-06-19',
        _deadlineDate: '2026-06-22',
      });

      var result = run([task]);
      var p = findPlacement(result, 'r2-pref');
      expect(p).not.toBeNull();
      // Should land on the target date since it has free slots
      expect(p.dateKey).toBe('2026-06-19');
    });

    test('placement with _targetDate respects deadlineDate cap', function () {
      // _targetDate = 2026-06-19, deadline = 2026-06-18 (before target!)
      // The search window is capped by deadline, so target is unreachable
      var task = makeTpcInstance({
        id: 'r2-deadline-cap',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-18', // before target
        _targetDate: '2026-06-19',
        _deadlineDate: '2026-06-18',
      });

      var result = run([task]);
      var p = findPlacement(result, 'r2-deadline-cap');
      // Should still be placed (on or before deadline), but not on target
      expect(p).not.toBeNull();
      expect(p.dateKey <= '2026-06-18').toBe(true);
    });
  });

  // ── R3: Start-on relaxation when target day is full ──
  describe('R3 — Start-on relaxation', function () {

    test('relaxes forward when _targetDate has no free slot', function () {
      // Fill the target date (2026-06-17) with a long task that consumes all capacity
      // Then place a flexible TPC instance with _targetDate = 2026-06-17
      // It should relax forward to the next available day
      var filler = makeTpcInstance({
        id: 'r3-filler',
        date: '2026-06-17',
        dur: 1000, // consumes most of the day
        sourceId: 'master-filler',
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 7 }, // not flexible
      });

      var task = makeTpcInstance({
        id: 'r3-relax',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-22',
        sourceId: 'master-relax',
        _targetDate: '2026-06-17',
        _deadlineDate: '2026-06-22',
      });

      var result = run([filler, task]);
      var p = findPlacement(result, 'r3-relax');
      expect(p).not.toBeNull();
      // Should have relaxed forward from 2026-06-17 to a later date
      expect(p.dateKey > '2026-06-17').toBe(true);
    });

    test('relaxation skips days occupied by same master', function () {
      // Place an instance on 2026-06-18 for the same master
      // Then try to place another instance with _targetDate = 2026-06-17
      // The relaxation should skip 2026-06-18 (occupied by same master)
      var first = makeTpcInstance({
        id: 'r3-first',
        date: '2026-06-18',
        dur: 60,
        deadline: '2026-06-22',
        sourceId: 'master-occupy',
        _targetDate: '2026-06-18',
        _deadlineDate: '2026-06-22',
      });

      var second = makeTpcInstance({
        id: 'r3-second',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-22',
        sourceId: 'master-occupy',
        _targetDate: '2026-06-17',
        _deadlineDate: '2026-06-22',
      });

      var result = run([first, second]);
      var p = findPlacement(result, 'r3-second');
      expect(p).not.toBeNull();
      // Should skip 2026-06-18 (occupied by first) and land on 2026-06-19 or later
      expect(p.dateKey).not.toBe('2026-06-18');
      expect(p.dateKey >= '2026-06-19').toBe(true);
    });

    test('relaxation respects allowed day-of-week', function () {
      // _targetDate = 2026-06-17 (Wednesday), but dayReq only allows weekends
      // Should relax forward to Saturday (2026-06-20) or Sunday (2026-06-21)
      var task = makeTpcInstance({
        id: 'r3-dow',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-22',
        dayReq: 'Sa,Su', // only weekends
        _targetDate: '2026-06-17',
        _deadlineDate: '2026-06-22',
      });

      var result = run([task]);
      var p = findPlacement(result, 'r3-dow');
      expect(p).not.toBeNull();
      // Should be on a weekend day
      var dow = new Date(p.dateKey).getDay();
      expect(dow === 0 || dow === 6).toBe(true);
    });

    test('relaxation returns null when no valid day within cycle', function () {
      // _targetDate = 2026-06-17, deadline = 2026-06-17 (same day, no room to relax)
      // Fill the day completely so no slot is available
      var filler = makeTpcInstance({
        id: 'r3-filler2',
        date: '2026-06-17',
        dur: 1000,
        sourceId: 'master-filler2',
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 7 },
      });

      var task = makeTpcInstance({
        id: 'r3-no-relax',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-17', // no room to relax
        sourceId: 'master-no-relax',
        _targetDate: '2026-06-17',
        _deadlineDate: '2026-06-17',
      });

      var result = run([filler, task]);
      var p = findPlacement(result, 'r3-no-relax');
      // Should be unplaced — no valid day within the window
      expect(p).toBeNull();
      var unplaced = findUnplaced(result, 'r3-no-relax');
      expect(unplaced).not.toBeNull();
    });
  });

  // ── R4: Average spacing recalculation after placement ──
  describe('R4 — Average spacing recalculation', function () {

    test('recalcFlexibleTpcSpacing updates remaining instances after placement', function () {
      // Two instances of the same master. After the first is placed,
      // the second's _targetDate should be recalculated to maintain spacing.
      var first = makeTpcInstance({
        id: 'r4-first',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-25',
        sourceId: 'master-recalc',
        _targetDate: '2026-06-17',
        _deadlineDate: '2026-06-20',
      });

      var second = makeTpcInstance({
        id: 'r4-second',
        date: '2026-06-18',
        dur: 60,
        deadline: '2026-06-25',
        sourceId: 'master-recalc',
        _targetDate: '2026-06-18',
        _deadlineDate: '2026-06-21',
      });

      var result = run([first, second]);
      var p1 = findPlacement(result, 'r4-first');
      var p2 = findPlacement(result, 'r4-second');
      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      // Both should be placed on distinct dates
      expect(p1.dateKey).not.toBe(p2.dateKey);
      // The spacing between them should be at least minGap (3 days for weekly)
      var diff = Math.abs(new Date(p2.dateKey) - new Date(p1.dateKey)) / 86400000;
      expect(diff >= 3).toBe(true);
    });

    test('three instances spread evenly by recalculation', function () {
      // Three instances of the same master. After each placement,
      // remaining instances get recalculated targets.
      var instances = [];
      for (var i = 0; i < 3; i++) {
        var d = new Date(2026, 5, 17 + i);
        var dateStr = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        instances.push(makeTpcInstance({
          id: 'r4-multi-' + i,
          date: dateStr,
          dur: 60,
          deadline: '2026-06-30',
          sourceId: 'master-multi',
          _targetDate: dateStr,
          _deadlineDate: new Date(d.getTime() + 3 * 86400000).toISOString().slice(0, 10),
        }));
      }

      var result = run(instances);
      var placed = allPlacements(result);
      var masterPlaced = placed.filter(function (p) { return p.taskId && p.taskId.indexOf('r4-multi') === 0; });
      expect(masterPlaced.length).toBe(3);

      // All should be on distinct dates with at least minGap between them
      var dateKeys = masterPlaced.map(function (p) { return p.dateKey; }).sort();
      var uniqueKeys = dateKeys.filter(function (k, i, arr) { return arr.indexOf(k) === i; });
      expect(uniqueKeys.length).toBe(3);

      // Check spacing between consecutive placements
      for (var j = 1; j < uniqueKeys.length; j++) {
        var diff = Math.abs(new Date(uniqueKeys[j]) - new Date(uniqueKeys[j - 1])) / 86400000;
        expect(diff >= 3).toBe(true);
      }
    });
  });

  // ── R5: Recursive cascade ──
  describe('R5 — Recursive cascade', function () {

    test('cascade: placement triggers recalculation, which triggers relaxation', function () {
      // Three instances. The first two fill the early days, forcing the third
      // to relax forward after recalculation.
      var first = makeTpcInstance({
        id: 'r5-first',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-30',
        sourceId: 'master-cascade',
        _targetDate: '2026-06-17',
        _deadlineDate: '2026-06-25',
      });

      var second = makeTpcInstance({
        id: 'r5-second',
        date: '2026-06-18',
        dur: 60,
        deadline: '2026-06-30',
        sourceId: 'master-cascade',
        _targetDate: '2026-06-18',
        _deadlineDate: '2026-06-25',
      });

      var third = makeTpcInstance({
        id: 'r5-third',
        date: '2026-06-19',
        dur: 60,
        deadline: '2026-06-30',
        sourceId: 'master-cascade',
        _targetDate: '2026-06-19',
        _deadlineDate: '2026-06-25',
      });

      var result = run([first, second, third]);
      var p1 = findPlacement(result, 'r5-first');
      var p2 = findPlacement(result, 'r5-second');
      var p3 = findPlacement(result, 'r5-third');
      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      expect(p3).not.toBeNull();

      // All should be on distinct dates with spacing
      var dates = [p1.dateKey, p2.dateKey, p3.dateKey].sort();
      expect(dates[0]).not.toBe(dates[1]);
      expect(dates[1]).not.toBe(dates[2]);

      // The cascade should have spread them out
      var diff12 = Math.abs(new Date(dates[1]) - new Date(dates[0])) / 86400000;
      var diff23 = Math.abs(new Date(dates[2]) - new Date(dates[1])) / 86400000;
      expect(diff12 >= 3 || diff23 >= 3).toBe(true);
    });
  });

  // ── R6: SPACING_BLOCKED reason code ──
  describe('R6 — SPACING_BLOCKED reason code', function () {

    test('unplaceable flexible TPC instance gets SPACING_BLOCKED reason', function () {
      // Fill the entire cycle so no slot is available
      var filler = makeTpcInstance({
        id: 'r6-filler',
        date: '2026-06-17',
        dur: 1000,
        sourceId: 'master-filler6',
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 7 },
      });

      var task = makeTpcInstance({
        id: 'r6-blocked',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-17', // no room to relax
        sourceId: 'master-blocked',
        _targetDate: '2026-06-17',
        _deadlineDate: '2026-06-17',
      });

      var result = run([filler, task]);
      var p = findPlacement(result, 'r6-blocked');
      expect(p).toBeNull();

      var unplaced = findUnplaced(result, 'r6-blocked');
      expect(unplaced).not.toBeNull();
      expect(unplaced._unplacedReason).toBe(REASON_CODES.SPACING_BLOCKED);
    });

    test('non-flexible TPC instance does NOT get SPACING_BLOCKED', function () {
      // Non-flexible TPC (tpc >= selectedDays) should not get spacing_blocked
      var filler = makeTpcInstance({
        id: 'r6-filler2',
        date: '2026-06-17',
        dur: 1000,
        sourceId: 'master-filler6b',
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 7 },
      });

      var task = makeTpcInstance({
        id: 'r6-not-blocked',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-17',
        sourceId: 'master-not-blocked',
        // Non-flexible: tpc >= selectedDays
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 7 },
        _targetDate: null, // non-flexible doesn't get _targetDate
        _deadlineDate: null,
      });

      var result = run([filler, task]);
      var unplaced = findUnplaced(result, 'r6-not-blocked');
      // If unplaced, the reason should NOT be SPACING_BLOCKED
      if (unplaced) {
        expect(unplaced._unplacedReason).not.toBe(REASON_CODES.SPACING_BLOCKED);
      }
    });
  });

  // ── R7: Existing instances preserved ──
  describe('R7 — Existing instances preserved', function () {

    test('existing placement from history is preserved as reference', function () {
      // Seed history with a placement on 2026-06-10
      // New instance should be placed respecting the gap from that reference
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-preserve': '2026-06-10' }
      });

      var task = makeTpcInstance({
        id: 'r7-preserve',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-22',
        sourceId: 'master-preserve',
        _targetDate: '2026-06-17',
        _deadlineDate: '2026-06-22',
      });

      var result = run([task], cfg);
      var p = findPlacement(result, 'r7-preserve');
      expect(p).not.toBeNull();
      // Should be placed on or after 2026-06-13 (2026-06-10 + 3 days minGap)
      expect(p.dateKey >= '2026-06-13').toBe(true);
    });

    test('lastByMaster updated after each placement for same master', function () {
      // Two instances of the same master. After the first is placed,
      // lastByMaster should be updated so the second respects the gap.
      var first = makeTpcInstance({
        id: 'r7-first',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-30',
        sourceId: 'master-update-r7',
        _targetDate: '2026-06-17',
        _deadlineDate: '2026-06-25',
      });

      var second = makeTpcInstance({
        id: 'r7-second',
        date: '2026-06-18',
        dur: 60,
        deadline: '2026-06-30',
        sourceId: 'master-update-r7',
        _targetDate: '2026-06-18',
        _deadlineDate: '2026-06-25',
      });

      var result = run([first, second]);
      var p1 = findPlacement(result, 'r7-first');
      var p2 = findPlacement(result, 'r7-second');
      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      // Should be on distinct dates with spacing
      expect(p1.dateKey).not.toBe(p2.dateKey);
      var diff = Math.abs(new Date(p2.dateKey) - new Date(p1.dateKey)) / 86400000;
      expect(diff >= 3).toBe(true);
    });
  });

  // ── R8: Non-flexible TPC not affected ──
  describe('R8 — Non-flexible TPC not affected', function () {

    test('non-flexible TPC (tpc >= selectedDays) ignores spacing algorithm', function () {
      // tpc=7, days=7 → not flexible → no _targetDate processing
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-rigid-r8': '2026-06-15' }
      });

      var task = makeTpcInstance({
        id: 'r8-rigid',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-20',
        sourceId: 'master-rigid-r8',
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 7 },
        _targetDate: null,
        _deadlineDate: null,
      });

      var result = run([task], cfg);
      var p = findPlacement(result, 'r8-rigid');
      // Non-flexible TPC should still be placed normally
      expect(p).not.toBeNull();
    });

    test('non-recurring task ignores spacing algorithm', function () {
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-nonrec': '2026-06-15' }
      });

      var task = {
        id: 'r8-nonrec',
        text: 'Non-recurring',
        date: TODAY,
        dur: 60,
        pri: 'P2',
        when: '',
        dayReq: 'any',
        status: '',
        deadline: null,
        earliestStart: null,
        recurring: false,
        generated: false,
        split: false,
        splitMin: null,
        location: [],
        tools: [],
        dependsOn: [],
        flexWhen: false,
        placementMode: PLACEMENT_MODES.ANYTIME,
        travelBefore: 0,
        travelAfter: 0,
        sourceId: 'master-nonrec',
      };

      var result = run([task], cfg);
      var p = findPlacement(result, 'r8-nonrec');
      expect(p).not.toBeNull();
    });

    test('daily recurrence with tpc=3 (flexible) uses spacing algorithm', function () {
      // Daily recurrence with tpc=3, selectedDays=7 → flexible
      // Should use the spacing algorithm
      var task = makeTpcInstance({
        id: 'r8-daily-flex',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-20',
        sourceId: 'master-daily-flex',
        recur: { type: 'daily', days: 'MTWRFSU', timesPerCycle: 3 },
        _targetDate: '2026-06-17',
        _deadlineDate: '2026-06-20',
      });

      var result = run([task]);
      var p = findPlacement(result, 'r8-daily-flex');
      expect(p).not.toBeNull();
      // Daily cycle: minGap = max(1, floor(1*0.5)) = 1
      // Should be placed on or after target date
      expect(p.dateKey >= '2026-06-17').toBe(true);
    });
  });

  // ── Integration: Full algorithm end-to-end ──
  describe('Integration — Full algorithm end-to-end', function () {

    test('multiple instances spread across cycle with target dates', function () {
      // 4 instances of the same master, each with a target date
      // The algorithm should spread them with proper spacing
      var instances = [];
      for (var i = 0; i < 4; i++) {
        var d = new Date(2026, 5, 17 + i);
        var dateStr = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        instances.push(makeTpcInstance({
          id: 'r9-spread-' + i,
          date: dateStr,
          dur: 60,
          deadline: '2026-07-05',
          sourceId: 'master-spread-r9',
          _targetDate: dateStr,
          _deadlineDate: new Date(d.getTime() + 5 * 86400000).toISOString().slice(0, 10),
        }));
      }

      var result = run(instances);
      var placed = allPlacements(result);
      var masterPlaced = placed.filter(function (p) { return p.taskId && p.taskId.indexOf('r9-spread') === 0; });
      expect(masterPlaced.length).toBe(4);

      // All should be placed on distinct dates
      var dateKeys = masterPlaced.map(function (p) { return p.dateKey; }).sort();
      var uniqueKeys = dateKeys.filter(function (k, i, arr) { return arr.indexOf(k) === i; });
      expect(uniqueKeys.length).toBe(4);

      // Check spacing: at least minGap (3) between consecutive placements
      for (var j = 1; j < uniqueKeys.length; j++) {
        var diff = Math.abs(new Date(uniqueKeys[j]) - new Date(uniqueKeys[j - 1])) / 86400000;
        expect(diff >= 3).toBe(true);
      }
    });

    test('spacing algorithm with biweekly recurrence', function () {
      // Biweekly recurrence: cycleDays=14, minGap = max(1, floor(14*0.5)) = 7
      var first = makeTpcInstance({
        id: 'r9-bi-first',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-07-05',
        sourceId: 'master-biweekly',
        recur: { type: 'biweekly', days: 'MTWRFSU', timesPerCycle: 2 },
        _targetDate: '2026-06-17',
        _deadlineDate: '2026-06-30',
      });

      var second = makeTpcInstance({
        id: 'r9-bi-second',
        date: '2026-06-18',
        dur: 60,
        deadline: '2026-07-05',
        sourceId: 'master-biweekly',
        recur: { type: 'biweekly', days: 'MTWRFSU', timesPerCycle: 2 },
        _targetDate: '2026-06-18',
        _deadlineDate: '2026-06-30',
      });

      var result = run([first, second]);
      var p1 = findPlacement(result, 'r9-bi-first');
      var p2 = findPlacement(result, 'r9-bi-second');
      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      // Biweekly minGap = 7
      var diff = Math.abs(new Date(p2.dateKey) - new Date(p1.dateKey)) / 86400000;
      expect(diff >= 7).toBe(true);
    });

    test('spacing algorithm with monthly recurrence', function () {
      // Monthly recurrence: cycleDays=30, minGap = max(1, floor(30*0.5)) = 15
      var first = makeTpcInstance({
        id: 'r9-month-first',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-07-20',
        sourceId: 'master-monthly',
        recur: { type: 'monthly', days: 'MTWRFSU', timesPerCycle: 2, monthDays: [1, 15] },
        _targetDate: '2026-06-17',
        _deadlineDate: '2026-07-15',
      });

      var second = makeTpcInstance({
        id: 'r9-month-second',
        date: '2026-06-18',
        dur: 60,
        deadline: '2026-07-20',
        sourceId: 'master-monthly',
        recur: { type: 'monthly', days: 'MTWRFSU', timesPerCycle: 2, monthDays: [1, 15] },
        _targetDate: '2026-06-18',
        _deadlineDate: '2026-07-15',
      });

      var result = run([first, second]);
      var p1 = findPlacement(result, 'r9-month-first');
      var p2 = findPlacement(result, 'r9-month-second');
      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      // Monthly minGap = 15
      var diff = Math.abs(new Date(p2.dateKey) - new Date(p1.dateKey)) / 86400000;
      expect(diff >= 15).toBe(true);
    });
  });
});
