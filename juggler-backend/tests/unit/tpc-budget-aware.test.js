/**
 * 999.013 — TPC Budget-Aware Tests
 *
 * Verifies that expandRecurring respects dayMinutes to cap timesPerCycle
 * instances when available time in a cycle is insufficient.
 *
 * The core logic lives in shared/scheduler/expandRecurring.js:
 *   - dayMinutes (opts) maps dateKey → total available minutes for that day
 *   - When tpc < selectedDayCount, the budget calculator sums dayMinutes across
 *     all candidate days in the cycle, subtracts time already booked by existing
 *     instances, and caps slotsNeeded to ⌊remainingMinutes / src.dur⌋
 *   - Instances that exceed the budget are emitted with _tpcBudgetUnscheduled=true
 */

const { expandRecurring } = require('../../../shared/scheduler/expandRecurring');

/**
 * Build a recurring-template source task for testing
 */
function makeSource(overrides) {
  return {
    id: 'tpc_test_1',
    text: 'TPC budget task',
    date: '2026-06-01', // Monday
    dur: 120,
    pri: 'P2',
    recurring: true,
    rigid: false,
    recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 },
    dayReq: 'any',
    taskType: 'recurring_template',
    ...overrides
  };
}

/**
 * Build a dayMinutes map where every day in the date range gets the same value.
 * Keys are YYYY-MM-DD strings as produced by formatDateKey.
 */
function uniformDayMinutes(minutesPerDay, startDate, endDate) {
  var map = {};
  var cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  var end = new Date(endDate);
  end.setHours(23, 59, 59, 999);
  while (cursor <= end) {
    var y = cursor.getFullYear();
    var m = String(cursor.getMonth() + 1).padStart(2, '0');
    var d = String(cursor.getDate()).padStart(2, '0');
    map[y + '-' + m + '-' + d] = minutesPerDay;
    cursor.setDate(cursor.getDate() + 1);
  }
  return map;
}

describe('999.013 — TPC budget-aware expandRecurring', () => {
  // June 1 (Mon) to June 7 (Sun) = one full 7-day cycle
  var startDate = new Date(2026, 5, 1);
  var endDate = new Date(2026, 5, 7);

  describe('when budget is sufficient', () => {
    test('all tpc instances fit when dayMinutes=480 and 3×120=360 ≤ 480 per day', () => {
      var src = makeSource({
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 3 }
      });
      // dur=120 (from makeSource default), 3 instances * 120 = 360 ≤ 480
      var dayMin = uniformDayMinutes(480, startDate, endDate);
      var result = expandRecurring([src], startDate, endDate, {
        dayMinutes: dayMin
      });

      // 3 instances generated (all within budget)
      expect(result.length).toBe(3);
      result.forEach(function(inst) {
        expect(inst._tpcBudgetUnscheduled).toBe(false);
        expect(inst.sourceId).toBe('tpc_test_1');
        expect(inst.taskType).toBe('generated');
      });
    });
  });

  describe('when budget is insufficient', () => {
    test('caps at 3 when dayMinutes=50, tpc=5, dur=90 (3×90=270, 4×90=360 > 5×50=250)', () => {
      var src = makeSource({
        dur: 90,
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 5 }
      });
      // 7 candidate days × 50 = 350 total cycle minutes
      // 3 × 90 = 270 ≤ 350, 4 × 90 = 360 > 350 → budget caps at 3
      // 5 - 3 = 2 budget-exceeded instances with _tpcBudgetUnscheduled=true
      var dayMin = uniformDayMinutes(50, startDate, endDate);
      var result = expandRecurring([src], startDate, endDate, {
        dayMinutes: dayMin
      });

      // Should emit all 5 (3 within budget + 2 budget-unscheduled)
      expect(result.length).toBe(5);

      var budgetScheduled = result.filter(function(inst) {
        return inst._tpcBudgetUnscheduled !== true;
      });
      var budgetUnscheduled = result.filter(function(inst) {
        return inst._tpcBudgetUnscheduled === true;
      });

      // 3 fit within the 350-minute budget
      expect(budgetScheduled.length).toBe(3);
      // 2 exceed the budget
      expect(budgetUnscheduled.length).toBe(2);

      budgetUnscheduled.forEach(function(inst) {
        expect(inst._tpcBudgetUnscheduled).toBe(true);
        expect(inst.sourceId).toBe('tpc_test_1');
      });
    });
  });

  describe('when dayMinutes is null/undefined', () => {
    test('no budget capping when dayMinutes is null', () => {
      var src = makeSource({
        dur: 90,
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 5 }
      });
      // No dayMinutes → no budget logic → all 5 instances generated without flags
      var result = expandRecurring([src], startDate, endDate, {
        dayMinutes: null
      });

      expect(result.length).toBe(5);
      result.forEach(function(inst) {
        // _tpcBudgetUnscheduled should be false or undefined
        expect(inst._tpcBudgetUnscheduled).toBeFalsy();
      });
    });

    test('no budget capping when dayMinutes is omitted', () => {
      var src = makeSource({
        dur: 90,
        recur: { type: 'weekly', days: 'MTWRFSU', timesPerCycle: 5 }
      });
      // dayMinutes not in opts → no budget logic → all 5 generated
      var result = expandRecurring([src], startDate, endDate, {});

      expect(result.length).toBe(5);
      result.forEach(function(inst) {
        expect(inst._tpcBudgetUnscheduled).toBeFalsy();
      });
    });
  });
});
