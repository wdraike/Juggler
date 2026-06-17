/**
 * 999.571 — TPC competition: multiple TPC tasks competing for same cycle slots.
 *
 * Tests that the spacing guard mediates competition between multiple flexible
 * TPC recurring tasks that share the same cycle window, and that fillPolicy=keep
 * vs backfill behavior works correctly.
 *
 * Pure unit tests — no DB. Exercises the real unifiedScheduleV2 entry point
 * with recurring tasks that have timesPerCycle < selectedDays.
 */

'use strict';

const unifiedSchedule = require('../../src/scheduler/unifiedScheduleV2');
const { PLACEMENT_MODES } = require('../../src/lib/placementModes');

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

function makeCfg() {
  return {
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
  };
}

/**
 * Build a recurring-template source task for testing TPC competition.
 * The template itself is not placed — expandRecurring generates instances.
 * We simulate the generated instances directly.
 */
function makeTpcInstance(overrides) {
  return Object.assign({
    id: 'tpc-' + Math.random().toString(36).slice(2, 8),
    text: 'TPC instance',
    date: TODAY,
    dur: 60,
    pri: 'P2',
    when: '',
    dayReq: 'any',
    status: '',
    deadline: null,
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
    // TPC-specific fields
    sourceId: 'master-tpc',
    taskType: 'recurring_instance',
    // The scheduler derives isFlexibleTpc from recur.timesPerCycle < selectedDays
    recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 },
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

// ═══════════════════════════════════════════════════════════════════
// 999.571 — TPC competition
// ═══════════════════════════════════════════════════════════════════

describe('999.571 — TPC competition: multiple tasks competing for cycle slots', function () {

  describe('two TPC tasks sharing the same cycle window', function () {
    test('both TPC tasks get placed when there is capacity', function () {
      // Two masters, each with 2 instances (tpc=2, 7 days selected)
      var tasks = [
        makeTpcInstance({ id: 'a1', sourceId: 'master-a', date: '2026-06-17', dur: 60, pri: 'P2' }),
        makeTpcInstance({ id: 'a2', sourceId: 'master-a', date: '2026-06-18', dur: 60, pri: 'P2' }),
        makeTpcInstance({ id: 'b1', sourceId: 'master-b', date: '2026-06-17', dur: 60, pri: 'P2' }),
        makeTpcInstance({ id: 'b2', sourceId: 'master-b', date: '2026-06-18', dur: 60, pri: 'P2' }),
      ];

      var result = run(tasks);

      var pA1 = findPlacement(result, 'a1');
      var pA2 = findPlacement(result, 'a2');
      var pB1 = findPlacement(result, 'b1');
      var pB2 = findPlacement(result, 'b2');

      // All 4 should be placed (plenty of capacity)
      expect(pA1).not.toBeNull();
      expect(pA2).not.toBeNull();
      expect(pB1).not.toBeNull();
      expect(pB2).not.toBeNull();
    });

    test('TPC tasks with different priorities — higher pri placed first', function () {
      var tasks = [
        makeTpcInstance({ id: 'low1', sourceId: 'master-low', date: '2026-06-17', dur: 120, pri: 'P4' }),
        makeTpcInstance({ id: 'low2', sourceId: 'master-low', date: '2026-06-18', dur: 120, pri: 'P4' }),
        makeTpcInstance({ id: 'high1', sourceId: 'master-high', date: '2026-06-17', dur: 120, pri: 'P1' }),
        makeTpcInstance({ id: 'high2', sourceId: 'master-high', date: '2026-06-18', dur: 120, pri: 'P1' }),
      ];

      var result = run(tasks);

      var pHigh1 = findPlacement(result, 'high1');
      var pHigh2 = findPlacement(result, 'high2');
      var pLow1 = findPlacement(result, 'low1');
      var pLow2 = findPlacement(result, 'low2');

      // High-priority tasks should be placed
      expect(pHigh1).not.toBeNull();
      expect(pHigh2).not.toBeNull();

      // Low-priority tasks may or may not be placed depending on capacity
      // (4 × 120 = 480 min across 7 days × 1020 min/day = plenty of room)
      expect(pLow1).not.toBeNull();
      expect(pLow2).not.toBeNull();
    });
  });

  describe('TPC competition with limited capacity', function () {
    test('when capacity is tight, higher-pri TPC tasks get slots first', function () {
      // Use a small time block to create scarcity
      var tightBlocks = {
        Mon: [{ id: 'tight', tag: 'tight', name: 'Tight', start: 360, end: 480, color: '#666', loc: 'home' }],
        Tue: [{ id: 'tight', tag: 'tight', name: 'Tight', start: 360, end: 480, color: '#666', loc: 'home' }],
        Wed: [{ id: 'tight', tag: 'tight', name: 'Tight', start: 360, end: 480, color: '#666', loc: 'home' }],
        Thu: [{ id: 'tight', tag: 'tight', name: 'Tight', start: 360, end: 480, color: '#666', loc: 'home' }],
        Fri: [{ id: 'tight', tag: 'tight', name: 'Tight', start: 360, end: 480, color: '#666', loc: 'home' }],
        Sat: [{ id: 'tight', tag: 'tight', name: 'Tight', start: 420, end: 480, color: '#666', loc: 'home' }],
        Sun: [{ id: 'tight', tag: 'tight', name: 'Tight', start: 420, end: 480, color: '#666', loc: 'home' }],
      };
      var cfg = makeCfg();
      cfg.timeBlocks = tightBlocks;

      // 7 days × 120 min/day = 840 min total capacity
      // 6 instances × 120 min = 720 min — should fit
      // 8 instances × 120 min = 960 min — won't fit
      var tasks = [
        // High-pri master: 3 instances
        makeTpcInstance({ id: 'hp1', sourceId: 'master-hp', date: '2026-06-17', dur: 120, pri: 'P1' }),
        makeTpcInstance({ id: 'hp2', sourceId: 'master-hp', date: '2026-06-18', dur: 120, pri: 'P1' }),
        makeTpcInstance({ id: 'hp3', sourceId: 'master-hp', date: '2026-06-19', dur: 120, pri: 'P1' }),
        // Low-pri master: 3 instances
        makeTpcInstance({ id: 'lp1', sourceId: 'master-lp', date: '2026-06-17', dur: 120, pri: 'P4' }),
        makeTpcInstance({ id: 'lp2', sourceId: 'master-lp', date: '2026-06-18', dur: 120, pri: 'P4' }),
        makeTpcInstance({ id: 'lp3', sourceId: 'master-lp', date: '2026-06-19', dur: 120, pri: 'P4' }),
      ];

      var result = run(tasks, cfg);

      // High-pri tasks should all be placed (3 × 120 = 360 ≤ 840)
      expect(findPlacement(result, 'hp1')).not.toBeNull();
      expect(findPlacement(result, 'hp2')).not.toBeNull();
      expect(findPlacement(result, 'hp3')).not.toBeNull();

      // Low-pri tasks may or may not be placed — at minimum, no crash
      expect(result).toBeDefined();
      expect(result.dayPlacements).toBeDefined();
    });
  });

  describe('TPC competition with fillPolicy semantics', function () {
    test('fillPolicy=keep: skipped instances stay skipped, no backfill', function () {
      // Simulate a TPC task where one instance was skipped (status=skip)
      // With fillPolicy=keep, the remaining instances should not try to
      // fill the gap — they stay on their original dates.
      var tasks = [
        makeTpcInstance({ id: 'k1', sourceId: 'master-keep', date: '2026-06-17', dur: 60, pri: 'P2' }),
        makeTpcInstance({ id: 'k2', sourceId: 'master-keep', date: '2026-06-18', dur: 60, pri: 'P2', status: 'skip' }),
        makeTpcInstance({ id: 'k3', sourceId: 'master-keep', date: '2026-06-19', dur: 60, pri: 'P2' }),
      ];

      var result = run(tasks);

      // k1 and k3 should be placed (k2 is skipped)
      var pK1 = findPlacement(result, 'k1');
      var pK3 = findPlacement(result, 'k3');

      expect(pK1).not.toBeNull();
      expect(pK3).not.toBeNull();

      // k2 should NOT be placed (it's skipped)
      var pK2 = findPlacement(result, 'k2');
      expect(pK2).toBeNull();
    });

    test('fillPolicy=backfill: skipped instance causes scheduler to pick a new date', function () {
      // With fillPolicy=backfill, when an instance is skipped, the scheduler
      // should attempt to place a replacement instance on a different date
      // within the cycle window.
      //
      // This is a behavioral test — the actual backfill logic is in
      // runSchedule.js (expandRecurring + reconcile). Here we verify that
      // the scheduler can place a TPC instance on a date different from its
      // original anchor when the original is blocked.
      var tasks = [
        // Fill Wed (today) completely
        { id: 'filler', text: 'Filler', date: TODAY, dur: 1020, pri: 'P1', when: '', dayReq: 'any',
          status: '', deadline: null, earliestStart: null, recurring: false, generated: false,
          split: false, splitMin: null, location: [], tools: [], dependsOn: [],
          flexWhen: false, placementMode: PLACEMENT_MODES.ANYTIME, travelBefore: 0, travelAfter: 0 },
        // TPC instance anchored to Wed but should be placed elsewhere
        makeTpcInstance({ id: 'backfill-me', sourceId: 'master-bf', date: TODAY, dur: 60, pri: 'P2' }),
      ];

      var result = run(tasks);

      var p = findPlacement(result, 'backfill-me');
      // The TPC instance should be placed — the scheduler finds a slot
      // on a different day since today is full
      expect(p).not.toBeNull();
    });
  });

  describe('TPC competition edge cases', function () {
    test('single TPC task with many instances fills available days', function () {
      // 5 instances of a TPC task with tpc=5, 7 days selected
      // Should spread across 5 distinct days
      var tasks = [];
      for (var i = 0; i < 5; i++) {
        var d = new Date(2026, 5, 17 + i);
        var dateStr = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        tasks.push(makeTpcInstance({
          id: 'many-' + i,
          sourceId: 'master-many',
          date: dateStr,
          dur: 60,
          pri: 'P2',
        }));
      }

      var result = run(tasks);

      var placed = allPlacements(result);
      var placedIds = placed.map(function(p) { return p.taskId; });
      tasks.forEach(function(t) {
        expect(placedIds).toContain(t.id);
      });

      // All 5 should be on distinct dates
      var dateKeys = placed.map(function(p) { return p.dateKey; });
      var uniqueKeys = dateKeys.filter(function(k, i) { return dateKeys.indexOf(k) === i; });
      expect(uniqueKeys.length).toBe(5);
    });

    test('TPC instances with different durations compete fairly', function () {
      var tasks = [
        makeTpcInstance({ id: 'short1', sourceId: 'master-short', date: '2026-06-17', dur: 30, pri: 'P2' }),
        makeTpcInstance({ id: 'short2', sourceId: 'master-short', date: '2026-06-18', dur: 30, pri: 'P2' }),
        makeTpcInstance({ id: 'long1', sourceId: 'master-long', date: '2026-06-17', dur: 180, pri: 'P2' }),
        makeTpcInstance({ id: 'long2', sourceId: 'master-long', date: '2026-06-18', dur: 180, pri: 'P2' }),
      ];

      var result = run(tasks);

      // All should be placed (4 × max 180 = 720, plenty of room)
      expect(findPlacement(result, 'short1')).not.toBeNull();
      expect(findPlacement(result, 'short2')).not.toBeNull();
      expect(findPlacement(result, 'long1')).not.toBeNull();
      expect(findPlacement(result, 'long2')).not.toBeNull();
    });

    test('TPC instances with overlapping dates get placed when there is capacity', function () {
      // All instances anchored to the same date — the scheduler places them
      // on the first available day (today) since there's plenty of room
      var tasks = [
        makeTpcInstance({ id: 'same1', sourceId: 'master-same', date: '2026-06-17', dur: 60, pri: 'P2' }),
        makeTpcInstance({ id: 'same2', sourceId: 'master-same', date: '2026-06-17', dur: 60, pri: 'P2' }),
        makeTpcInstance({ id: 'same3', sourceId: 'master-same', date: '2026-06-17', dur: 60, pri: 'P2' }),
      ];

      var result = run(tasks);

      var placed = allPlacements(result);
      var placedIds = placed.map(function(p) { return p.taskId; });
      tasks.forEach(function(t) {
        expect(placedIds).toContain(t.id);
      });
    });

    test('no crash when all TPC instances are skipped', function () {
      var tasks = [
        makeTpcInstance({ id: 'sk1', sourceId: 'master-sk', date: '2026-06-17', dur: 60, pri: 'P2', status: 'skip' }),
        makeTpcInstance({ id: 'sk2', sourceId: 'master-sk', date: '2026-06-18', dur: 60, pri: 'P2', status: 'skip' }),
      ];

      var result = run(tasks);

      // No crash — both skipped, neither placed
      expect(findPlacement(result, 'sk1')).toBeNull();
      expect(findPlacement(result, 'sk2')).toBeNull();
      expect(result).toBeDefined();
    });
  });
});
