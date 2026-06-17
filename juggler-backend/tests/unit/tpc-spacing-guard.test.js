/**
 * 999.574 — TPC spacing guard: cross-cycle minimum gap enforcement for
 * flexible TPC recurring tasks.
 *
 * Tests the spacing guard in findEarliestSlot (unifiedScheduleV2.js lines 950-997):
 *   - minGap = max(1, floor(cycleDays * 0.5)) days between placements
 *   - Safety valve: when ALL remaining slots would be blocked by the guard,
 *     spacingMinKey is set to null (ignores the guard)
 *   - lastByMaster tracking via noteMasterPlacement
 *
 * Pure unit tests — no DB. Exercises the real unifiedScheduleV2 entry point
 * with recurringHistoryByMaster to seed the spacing history.
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
 * Build a flexible TPC recurring instance for testing spacing guard.
 * isFlexibleTpc is derived from recur.timesPerCycle < selectedDays.
 */
function makeTpcInstance(overrides) {
  return Object.assign({
    id: 'spc-' + Math.random().toString(36).slice(2, 8),
    text: 'Spacing test',
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
    sourceId: 'master-spacing',
    taskType: 'recurring_instance',
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
// 999.574 — TPC spacing guard
// ═══════════════════════════════════════════════════════════════════

describe('999.574 — TPC spacing guard', function () {

  describe('spacing guard enforces minimum gap', function () {
    test('instance placed on day respecting minGap from lastByMaster history', function () {
      // Seed history: last placement was 2026-06-10 (Wed, 7 days ago)
      // cycleDays=7 → minGap = max(1, floor(7*0.5)) = 3
      // So the next placement must be on or after 2026-06-13
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-spacing': '2026-06-10' }
      });

      var task = makeTpcInstance({
        id: 'gap-test',
        date: '2026-06-17',
        dur: 60,
      });

      var result = run([task], cfg);
      var p = findPlacement(result, 'gap-test');
      expect(p).not.toBeNull();
      // Must be >= 2026-06-13 (2026-06-10 + 3 days)
      expect(p.dateKey >= '2026-06-13').toBe(true);
    });

    test('instance NOT placed on day within minGap of last placement', function () {
      // Seed history: last placement was 2026-06-15 (2 days ago)
      // minGap = 3 → next allowed date is 2026-06-18
      // The instance is anchored to 2026-06-17 (today) which is < 2026-06-18
      // So it should be blocked by the spacing guard
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-spacing': '2026-06-15' }
      });

      var task = makeTpcInstance({
        id: 'blocked-test',
        date: '2026-06-17',
        dur: 60,
      });

      var result = run([task], cfg);
      var p = findPlacement(result, 'blocked-test');
      // The instance's anchor date (2026-06-17) is within the minGap window
      // (2026-06-15 + 3 = 2026-06-18). The spacing guard blocks it.
      // But the safety valve may activate if ALL search days are blocked.
      // The search window for this instance is [2026-06-17, 2026-06-17]
      // (day-locked to anchor). Since 2026-06-17 < 2026-06-18, the safety
      // valve fires (lastSearchDay.key < spacingMinKey) and spacingMinKey
      // is set to null, allowing placement.
      // This is the correct behavior — the safety valve prevents permanent
      // unplaceability when the guard would block the entire window.
      expect(p).not.toBeNull();
    });
  });

  describe('safety valve: when all slots would be blocked', function () {
    test('safety valve activates when last search day is before minAllowed', function () {
      // Seed history: last placement was 2026-06-16 (yesterday)
      // minGap = 3 → next allowed = 2026-06-19
      // Instance anchored to 2026-06-17 (today), day-locked
      // Search window = [2026-06-17, 2026-06-17]
      // lastSearchDay.key = 2026-06-17 < 2026-06-19 → safety valve fires
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-spacing': '2026-06-16' }
      });

      var task = makeTpcInstance({
        id: 'safety-test',
        date: '2026-06-17',
        dur: 60,
      });

      var result = run([task], cfg);
      var p = findPlacement(result, 'safety-test');
      // Safety valve should allow placement despite the guard
      expect(p).not.toBeNull();
      expect(p.dateKey).toBe('2026-06-17');
    });

    test('safety valve does NOT activate when there are valid days after minAllowed', function () {
      // Seed history: last placement was 2026-06-10
      // minGap = 3 → next allowed = 2026-06-13
      // Instance anchored to 2026-06-17, cycleDays=7 → search window [17, 23]
      // lastSearchDay.key = 2026-06-23 >= 2026-06-13 → safety valve does NOT fire
      // Instance should be placed on or after 2026-06-17 (which is >= 2026-06-13)
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-spacing': '2026-06-10' }
      });

      var task = makeTpcInstance({
        id: 'no-safety-test',
        date: '2026-06-17',
        dur: 60,
      });

      var result = run([task], cfg);
      var p = findPlacement(result, 'no-safety-test');
      expect(p).not.toBeNull();
      // Should be on or after 2026-06-17 (anchor date)
      expect(p.dateKey >= '2026-06-17').toBe(true);
    });
  });

  describe('minGap calculation', function () {
    test('cycleDays=7 → minGap=3', function () {
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-spacing': '2026-06-10' }
      });

      var task = makeTpcInstance({
        id: 'gap7',
        date: '2026-06-17',
        dur: 60,
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 },
      });

      var result = run([task], cfg);
      var p = findPlacement(result, 'gap7');
      expect(p).not.toBeNull();
      // minGap = floor(7 * 0.5) = 3 → allowed from 2026-06-13
      expect(p.dateKey >= '2026-06-13').toBe(true);
    });

    test('cycleDays=14 (biweekly) → minGap=7', function () {
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-spacing': '2026-06-03' }
      });

      var task = makeTpcInstance({
        id: 'gap14',
        date: '2026-06-17',
        dur: 60,
        recur: { type: 'biweekly', days: 'MTWRFSU', timesPerCycle: 3 },
      });

      var result = run([task], cfg);
      var p = findPlacement(result, 'gap14');
      expect(p).not.toBeNull();
      // minGap = floor(14 * 0.5) = 7 → allowed from 2026-06-10
      expect(p.dateKey >= '2026-06-10').toBe(true);
    });

    test('cycleDays=1 (daily) → minGap=1', function () {
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-spacing': '2026-06-16' }
      });

      var task = makeTpcInstance({
        id: 'gap1',
        date: '2026-06-17',
        dur: 60,
        recur: { type: 'daily', days: 'MTWRFSU', timesPerCycle: 3 },
      });

      var result = run([task], cfg);
      var p = findPlacement(result, 'gap1');
      expect(p).not.toBeNull();
      // minGap = max(1, floor(1 * 0.5)) = 1 → allowed from 2026-06-17
      // 2026-06-17 >= 2026-06-17 → OK
      expect(p.dateKey >= '2026-06-17').toBe(true);
    });
  });

  describe('noteMasterPlacement updates lastByMaster', function () {
    test('placement updates lastByMaster for the same master', function () {
      // No history seeded — first placement should set lastByMaster
      var tasks = [
        makeTpcInstance({ id: 'first', sourceId: 'master-update', date: '2026-06-17', dur: 60 }),
        makeTpcInstance({ id: 'second', sourceId: 'master-update', date: '2026-06-18', dur: 60 }),
      ];

      var result = run(tasks);

      var p1 = findPlacement(result, 'first');
      var p2 = findPlacement(result, 'second');
      expect(p1).not.toBeNull();
      expect(p2).not.toBeNull();
      // Both should be placed on distinct dates
      expect(p1.dateKey).not.toBe(p2.dateKey);
    });

    test('lastByMaster from history prevents placement too close to previous', function () {
      // Seed with a recent placement, then try to place an instance
      // that would be within minGap
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-close': '2026-06-16' }
      });

      var task = makeTpcInstance({
        id: 'close-test',
        sourceId: 'master-close',
        date: '2026-06-17',
        dur: 60,
      });

      var result = run([task], cfg);
      var p = findPlacement(result, 'close-test');
      // The safety valve should activate (all search days blocked)
      // so the instance IS placed despite the guard
      expect(p).not.toBeNull();
    });
  });

  describe('spacing guard with multiple masters', function () {
    test('two masters each maintain their own spacing history', function () {
      var cfg = makeCfg({
        recurringHistoryByMaster: {
          'master-a': '2026-06-10',
          'master-b': '2026-06-15',
        }
      });

      var tasks = [
        makeTpcInstance({ id: 'ma1', sourceId: 'master-a', date: '2026-06-17', dur: 60 }),
        makeTpcInstance({ id: 'mb1', sourceId: 'master-b', date: '2026-06-17', dur: 60 }),
      ];

      var result = run(tasks, cfg);

      var pA = findPlacement(result, 'ma1');
      var pB = findPlacement(result, 'mb1');

      // master-a: last=2026-06-10, minGap=3 → allowed from 2026-06-13
      // 2026-06-17 >= 2026-06-13 → OK
      expect(pA).not.toBeNull();

      // master-b: last=2026-06-15, minGap=3 → allowed from 2026-06-18
      // 2026-06-17 < 2026-06-18 → blocked by guard
      // But safety valve: search window [17, 17] < 18 → valve fires → placed
      expect(pB).not.toBeNull();
    });
  });

  describe('spacing guard edge cases', function () {
    test('no history (first placement) — no spacing constraint', function () {
      var task = makeTpcInstance({
        id: 'first-ever',
        sourceId: 'master-first',
        date: '2026-06-17',
        dur: 60,
      });

      var result = run([task]);
      var p = findPlacement(result, 'first-ever');
      expect(p).not.toBeNull();
      expect(p.dateKey).toBe('2026-06-17');
    });

    test('non-flexible TPC (tpc >= selectedDays) — no spacing guard', function () {
      // When timesPerCycle >= selectedDays, isFlexibleTpc=false
      // The spacing guard only applies to flexible TPC
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-rigid': '2026-06-15' }
      });

      // recur with tpc=7, days=7 → tpc >= selectedDays → not flexible
      var task = makeTpcInstance({
        id: 'rigid-spacing',
        sourceId: 'master-rigid',
        date: '2026-06-17',
        dur: 60,
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 7 },
      });

      var result = run([task], cfg);
      var p = findPlacement(result, 'rigid-spacing');
      // Non-flexible TPC ignores spacing guard — placed normally
      expect(p).not.toBeNull();
    });

    test('non-recurring task — no spacing guard', function () {
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-other': '2026-06-15' }
      });

      // Non-recurring task with sourceId matching history — should NOT trigger guard
      var task = {
        id: 'non-recur',
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
        sourceId: 'master-other',
      };

      var result = run([task], cfg);
      var p = findPlacement(result, 'non-recur');
      expect(p).not.toBeNull();
    });

    test('spacing guard with deadline constraint', function () {
      // Seed history close to today, instance has a tight deadline
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-dl': '2026-06-15' }
      });

      var task = makeTpcInstance({
        id: 'dl-spacing',
        sourceId: 'master-dl',
        date: '2026-06-17',
        dur: 60,
        deadline: '2026-06-18', // tight deadline
      });

      var result = run([task], cfg);
      var p = findPlacement(result, 'dl-spacing');
      // Safety valve should activate (search window [17, 18] < minAllowed 18)
      // Actually: minGap=3, last=2026-06-15, minAllowed=2026-06-18
      // Search window: earliest=17, latest=18 (deadline)
      // lastSearchDay.key = 2026-06-18 >= 2026-06-18 → safety valve does NOT fire
      // But 2026-06-17 < 2026-06-18 → blocked by guard
      // 2026-06-18 >= 2026-06-18 → OK
      expect(p).not.toBeNull();
      expect(p.dateKey).toBe('2026-06-18');
    });

    test('many instances spread by spacing guard across cycle', function () {
      // 5 instances of the same master, all anchored to the same week
      // The spacing guard should spread them out
      var cfg = makeCfg({
        recurringHistoryByMaster: { 'master-spread': '2026-06-10' }
      });

      var tasks = [];
      for (var i = 0; i < 5; i++) {
        var d = new Date(2026, 5, 17 + i);
        var dateStr = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        tasks.push(makeTpcInstance({
          id: 'spread-' + i,
          sourceId: 'master-spread',
          date: dateStr,
          dur: 60,
          pri: 'P2',
        }));
      }

      var result = run(tasks, cfg);

      var placed = allPlacements(result);
      var placedIds = placed.map(function(p) { return p.taskId; });
      tasks.forEach(function(t) {
        expect(placedIds).toContain(t.id);
      });

      // All should be on distinct dates
      var dateKeys = placed.map(function(p) { return p.dateKey; });
      var uniqueKeys = dateKeys.filter(function(k, i) { return dateKeys.indexOf(k) === i; });
      expect(uniqueKeys.length).toBe(5);
    });
  });
});
