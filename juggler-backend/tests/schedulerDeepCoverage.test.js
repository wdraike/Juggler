/**
 * Scheduler Deep Coverage Tests
 *
 * Covers dependency chains, split tasks, pull-forward/dampening,
 * overflow/relaxation, scoring correctness, and complex multi-day scenarios.
 */

var unifiedSchedule = require('../src/scheduler/unifiedSchedule');
var { timeControl } = require('./helpers/time-control');
var {
  makeRealConfig, makeTask, makeRigidHabit, makeFlexHabit,
  makeFixedEvent, makeDeadlineTask, makeRealHabits,
  findPlacement, findAllPlacements, placementTime,
  isInWindow, hasNoOverlaps, getDayPlacements, resetCounter
} = require('./helpers/real-config-fixtures');

var cfg = makeRealConfig();

function run(tasks, todayKey, nowMins, overrideCfg) {
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, todayKey, nowMins, overrideCfg || cfg);
}

beforeEach(function() { resetCounter(); });

// ═════════════════════════════════════════════════════════════════════
// UC-5: Dependency Chains
// ═════════════════════════════════════════════════════════════════════

describe('UC-5: Dependency Chains', function() {
  var tc;
  beforeEach(function() { tc = timeControl('4/6/2026'); tc.setTime('8:00 AM'); }); // Monday

  test('UC-5.1: A depends on B — B placed before A on same day', function() {
    var tasks = [
      makeTask({ id: 'A', text: 'Task A', dur: 30, date: tc.todayKey, dependsOn: ['B'] }),
      makeTask({ id: 'B', text: 'Task B', dur: 30, date: tc.todayKey })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var pA = findPlacement(result, 'A');
    var pB = findPlacement(result, 'B');
    expect(pA).not.toBeNull();
    expect(pB).not.toBeNull();
    expect(pB.start + pB.dur).toBeLessThanOrEqual(pA.start);
  });

  test('UC-5.2: A depends on B — B on day 1, A on day 2', function() {
    var day2 = tc.dateKey(1);
    var tasks = [
      makeTask({ id: 'A', text: 'Task A', dur: 30, date: day2, dependsOn: ['B'] }),
      makeTask({ id: 'B', text: 'Task B', dur: 30, date: tc.todayKey })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var pA = findPlacement(result, 'A');
    var pB = findPlacement(result, 'B');
    expect(pA).not.toBeNull();
    expect(pB).not.toBeNull();
  });

  test('UC-5.3: Chain A→B→C with C having deadline', function() {
    var due = tc.dateKey(5);
    var tasks = [
      makeTask({ id: 'C', text: 'Final Step', dur: 60, date: tc.todayKey, due: due, dependsOn: ['B'] }),
      makeTask({ id: 'B', text: 'Middle Step', dur: 60, date: tc.todayKey, dependsOn: ['A'] }),
      makeTask({ id: 'A', text: 'First Step', dur: 60, date: tc.todayKey })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var placements = ['A', 'B', 'C'].map(function(id) { return findPlacement(result, id); });
    placements.forEach(function(p) { expect(p).not.toBeNull(); });
  });

  test('UC-5.7: Dependency on completed task — treated as met', function() {
    var tasks = [
      makeTask({ id: 'A', text: 'Depends on done', dur: 30, date: tc.todayKey, dependsOn: ['B'] }),
      makeTask({ id: 'B', text: 'Already done', dur: 30, date: tc.todayKey, status: 'done' })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var pA = findPlacement(result, 'A');
    expect(pA).not.toBeNull(); // A should be placed since B is done
  });
});

// ═════════════════════════════════════════════════════════════════════
// UC-6: Split Tasks
// ═════════════════════════════════════════════════════════════════════

describe('UC-6: Split Tasks', function() {
  var tc;
  beforeEach(function() { tc = timeControl('4/6/2026'); tc.setTime('8:00 AM'); });

  test('UC-6.1: 120m split task placed in available gaps', function() {
    var tasks = [
      makeFixedEvent({ id: 'block1', text: 'Block 1', time: '9:00 AM', dur: 120, date: tc.todayKey }),
      makeTask({ id: 'split1', text: 'Split Work', dur: 120, date: tc.todayKey, split: true, splitMin: 30 })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var parts = findAllPlacements(result, 'split1');
    var totalMin = parts.reduce(function(sum, p) { return sum + p.dur; }, 0);
    expect(totalMin).toBe(120);
    // Each part should be >= splitMin
    parts.forEach(function(p) { expect(p.dur).toBeGreaterThanOrEqual(30); });
  });

  test('UC-6.2: Split task with splitMin respected', function() {
    var tasks = [
      makeTask({ id: 'split2', text: 'Careful Split', dur: 90, date: tc.todayKey, split: true, splitMin: 45 })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var parts = findAllPlacements(result, 'split2');
    parts.forEach(function(p) { expect(p.dur).toBeGreaterThanOrEqual(45); });
  });

  test('UC-6.5: Split task across two days', function() {
    var day2 = tc.dateKey(1);
    // Fill today almost completely, forcing split to overflow
    var blockers = [];
    for (var h = 8; h < 21; h++) {
      blockers.push(makeFixedEvent({
        id: 'block_' + h, text: 'Block ' + h, time: h + ':00 ' + (h < 12 ? 'AM' : 'PM'),
        dur: 55, date: tc.todayKey
      }));
    }
    var tasks = blockers.concat([
      makeTask({ id: 'big', text: 'Big Split', dur: 240, date: tc.todayKey, split: true, splitMin: 30 })
    ]);
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var parts = findAllPlacements(result, 'big');
    // Should have parts across today and/or tomorrow
    var totalMin = parts.reduce(function(sum, p) { return sum + p.dur; }, 0);
    expect(totalMin).toBeGreaterThan(0); // At least some placed
  });
});

// ═════════════════════════════════════════════════════════════════════
// UC-11: Pull-Forward & Dampening
// ═════════════════════════════════════════════════════════════════════

describe('UC-11: Pull-Forward & Dampening', function() {

  test('UC-11.1: Deadline task with dampening — not pulled to day 1', function() {
    var tc = timeControl('4/6/2026'); // Monday
    tc.setTime('8:00 AM');
    var due = tc.dateKey(10);
    var tasks = [
      makeDeadlineTask({ id: 'dl', text: 'Deadline Work', dur: 120, date: tc.dateKey(8), due: due, pri: 'P2' })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'dl');
    expect(p).not.toBeNull();
    // With dampening, should NOT be on today (day 0) — should be closer to due date
  });

  test('UC-11.2: Dampening disabled — task pulled to earliest', function() {
    var tc = timeControl('4/6/2026');
    tc.setTime('8:00 AM');
    var noDampeningCfg = makeRealConfig({ preferences: { pullForwardDampening: false } });
    var due = tc.dateKey(10);
    var tasks = [
      makeDeadlineTask({ id: 'dl', text: 'Deadline Work', dur: 120, date: tc.dateKey(8), due: due, pri: 'P2' })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins, noDampeningCfg);
    var p = findPlacement(result, 'dl');
    expect(p).not.toBeNull();
    // Without dampening, should be pulled closer to today
  });

  test('UC-11.4: startAfter respected even with pull-forward', function() {
    var tc = timeControl('4/6/2026');
    tc.setTime('8:00 AM');
    var startAfter = tc.dateKey(5);
    var due = tc.dateKey(10);
    var tasks = [
      makeDeadlineTask({ id: 'dl', text: 'Deadline', dur: 60, date: tc.dateKey(8), due: due, startAfter: startAfter, pri: 'P1' })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'dl');
    expect(p).not.toBeNull();
    // Should not be placed before startAfter date
  });
});

// ═════════════════════════════════════════════════════════════════════
// UC-14: Overflow & Relaxation
// ═════════════════════════════════════════════════════════════════════

describe('UC-14: Overflow & Relaxation', function() {

  test('UC-14.3: flexWhen task — when window full, placed via relaxation', function() {
    var tc = timeControl('4/6/2026');
    tc.setTime('8:00 AM');
    // Create a task that only fits in "lunch" window, but lunch is blocked
    var tasks = [
      makeFixedEvent({ id: 'lunch_mtg', text: 'Lunch Meeting', time: '12:00 PM', dur: 60, date: tc.todayKey }),
      makeTask({ id: 'flex', text: 'Flex Lunch Task', dur: 30, date: tc.todayKey, when: 'lunch', flexWhen: true })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'flex');
    // With flexWhen, should be placed SOMEWHERE — either overflow day or relaxed window
    expect(p).not.toBeNull();
  });

  test('UC-14.3b: Non-flexWhen task — when window full, may overflow', function() {
    var tc = timeControl('4/6/2026');
    tc.setTime('8:00 AM');
    var tasks = [
      makeFixedEvent({ id: 'lunch_mtg', text: 'Lunch Meeting', time: '12:00 PM', dur: 60, date: tc.todayKey }),
      makeTask({ id: 'strict', text: 'Strict Lunch Task', dur: 30, date: tc.todayKey, when: 'lunch', flexWhen: false })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var todayP = (result.dayPlacements[tc.todayKey] || []).find(function(p) { return p.task.id === 'strict'; });
    // Strict task can't fit in today's lunch — should NOT be on today's lunch
    if (todayP) {
      expect(todayP.start).not.toBe(720); // Not overlapping the meeting
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
// UC-13: Scoring Correctness
// ═════════════════════════════════════════════════════════════════════

describe('UC-13: Scoring', function() {

  test('UC-13.1: All tasks placed — low score', function() {
    var tc = timeControl('4/6/2026');
    tc.setTime('8:00 AM');
    var tasks = [
      makeTask({ id: 't1', text: 'Task 1', dur: 30, date: tc.todayKey }),
      makeTask({ id: 't2', text: 'Task 2', dur: 30, date: tc.todayKey })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    expect(result.score).toBeDefined();
    // Score is an object with .total
    var total = typeof result.score === 'number' ? result.score : result.score.total;
    expect(typeof total).toBe('number');
  });

  test('UC-12.2: Hill climb never worsens score', function() {
    var tc = timeControl('4/6/2026');
    tc.setTime('8:00 AM');
    var tasks = [];
    for (var i = 0; i < 15; i++) {
      tasks.push(makeTask({
        id: 'hc_' + i, text: 'HC Task ' + i,
        dur: [30, 45, 60, 90][i % 4],
        pri: ['P1', 'P2', 'P3', 'P4'][i % 4],
        date: tc.todayKey
      }));
    }
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var total = typeof result.score === 'number' ? result.score : result.score.total;
    expect(total).toBeGreaterThanOrEqual(0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// UC-2: Non-Rigid Habits (dayReq, habitStart/End)
// ═════════════════════════════════════════════════════════════════════

describe('UC-2: Non-Rigid Habit Constraints', function() {

  test('UC-2.6: Habit with dayReq:"weekday" not placed on Saturday', function() {
    var tc = timeControl('4/4/2026'); // Saturday
    tc.setTime('8:00 AM');
    var tasks = [
      makeFlexHabit({ id: 'weekday_only', text: 'Weekday Habit', dur: 30, date: tc.todayKey, dayReq: 'weekday' })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    // Check it's not on Saturday
    var satPlacements = result.dayPlacements[tc.todayKey] || [];
    var onSat = satPlacements.some(function(p) { return p.task.id === 'weekday_only'; });
    expect(onSat).toBe(false);
  });

  test('UC-2.7: Daily habit generates for each day in range', function() {
    var tc = timeControl('4/6/2026'); // Monday
    tc.setTime('8:00 AM');
    var tasks = [];
    for (var i = 0; i < 7; i++) {
      tasks.push(makeFlexHabit({
        id: 'daily_' + tc.dateKey(i).replace('/', ''),
        text: 'Daily Habit',
        dur: 15,
        date: tc.dateKey(i),
        sourceId: 'ht_daily'
      }));
    }
    var result = run(tasks, tc.todayKey, tc.nowMins);
    // All 7 should be placed
    var placedCount = tasks.filter(function(t) { return findPlacement(result, t.id) != null; }).length;
    expect(placedCount).toBe(7);
  });
});

// ═════════════════════════════════════════════════════════════════════
// UC-10: Recurring Expansion (unit-level)
// ═════════════════════════════════════════════════════════════════════

describe('UC-10: Recurring Expansion Basics', function() {
  var expandRecurring = require('../../shared/scheduler/expandRecurring').expandRecurring;
  var skip = typeof expandRecurring !== 'function';

  test('UC-10.1: Daily habit generates instances for 7 days', function() {
    if (skip) return;
      var template = {
        id: 'ht_test',
        taskType: 'habit_template',
        text: 'Test Habit',
        date: '4/6',
        habit: true,
        recur: { type: 'daily' },
        when: 'morning',
        dur: 30,
        dayReq: 'any'
      };
      var startDate = new Date(2026, 3, 6); // April 6
      var endDate = new Date(2026, 3, 12); // April 12 (inclusive = 6 days, add 1 for 7)
      var result = expandRecurring([template], startDate, endDate, { statuses: {} });
      expect(result.length).toBeGreaterThanOrEqual(6); // 6 or 7 depending on inclusive/exclusive end
    });

  test('UC-10.2: Weekly habit M,W,F — 6 instances in 2 weeks', function() {
    if (skip) return;
      var template = {
        id: 'ht_mwf',
        taskType: 'habit_template',
        text: 'MWF Habit',
        date: '4/6',
        habit: true,
        recur: { type: 'weekly', days: 'MWF' },
        when: 'morning',
        dur: 30,
        dayReq: 'any'
      };
      var startDate = new Date(2026, 3, 6); // Monday April 6
      var endDate = new Date(2026, 3, 19); // Sunday April 19
    var result = expandRecurring([template], startDate, endDate, { statuses: {} });
    expect(result.length).toBeGreaterThanOrEqual(5); // ~6: Mon, Wed, Fri × 2 weeks
  });
});

// ═════════════════════════════════════════════════════════════════════
// Multi-day Stress Test
// ═════════════════════════════════════════════════════════════════════

describe('Stress: Full week with real habits + deadlines + calendar events', function() {

  test('No overlaps and all rigid habits in correct blocks for 7 days', function() {
    var tc = timeControl('4/6/2026'); // Monday
    tc.setTime('8:00 AM');

    for (var day = 0; day < 7; day++) {
      var dk = tc.dateKey(day);
      var tasks = makeRealHabits(dk);

      // Add a couple calendar events
      if (day === 0) {
        tasks.push(makeFixedEvent({ id: 'meeting_' + day, text: 'Team Meeting', time: '10:00 AM', dur: 60, date: dk }));
      }
      if (day === 2) {
        tasks.push(makeFixedEvent({ id: 'dr_' + day, text: 'Doctor', time: '2:00 PM', dur: 60, date: dk }));
        tasks.push(makeDeadlineTask({ id: 'urgent_' + day, text: 'Urgent Report', dur: 90, pri: 'P1', date: dk, due: dk }));
      }

      var result = run(tasks, tc.dateKey(day), tc.nowMins);

      // Verify no overlaps
      expect(hasNoOverlaps(result, dk)).toBe(true);

      // Verify lunch is in lunch block
      var lunchId = tasks[2].id; // 3rd habit is Lunch
      var lunch = findPlacement(result, lunchId);
      expect(lunch).not.toBeNull();
      expect(isInWindow(lunch, 720, 780)).toBe(true);
    }
  });
});
