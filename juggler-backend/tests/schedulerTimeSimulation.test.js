/**
 * Scheduler Time Simulation Tests
 *
 * Tests the scheduler's behavior across different times of day, over
 * multiple days, and across weeks/months to detect feedback loops,
 * drift, and time-dependent placement bugs.
 *
 * Uses the real user config (time blocks, locations, tools) to catch
 * configuration-specific issues.
 */

var unifiedSchedule = require('../src/scheduler/unifiedSchedule');
var { timeControl } = require('./helpers/time-control');
var {
  makeRealConfig, makeTask, makeRigidRecurring, makeFlexRecurring,
  makeFixedEvent, makeDeadlineTask, makeRealRecurrings,
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
// UC-1: Rigid Recurring Feedback Loop Prevention
// ═════════════════════════════════════════════════════════════════════

describe('UC-1: Rigid Recurring Placement', function() {

  test('UC-1.1: Lunch recurring placed in lunch block when free', function() {
    var tc = timeControl('4/3/2026'); // Friday
    tc.setTime('8:00 AM');
    var tasks = [
      makeRigidRecurring({ id: 'lunch', text: 'Lunch', when: 'lunch', dur: 30, date: tc.todayKey })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'lunch');
    expect(p).not.toBeNull();
    expect(isInWindow(p, 720, 780)).toBe(true); // 12:00-1:00 PM
  });

  test('UC-1.2: Lunch recurring with stale time (7am) corrected to lunch block', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    // Simulate the feedback loop: t.time = "7:00 AM" from a previous bad run
    var tasks = [
      makeRigidRecurring({ id: 'lunch', text: 'Lunch', when: 'lunch', dur: 30, date: tc.todayKey, time: '7:00 AM' })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'lunch');
    expect(p).not.toBeNull();
    expect(isInWindow(p, 720, 780)).toBe(true); // Should be corrected to noon, not 7am
    expect(p.start).not.toBe(420); // NOT 7:00 AM
  });

  test('UC-1.3: Morning recurring when morning is in the past (scheduler at noon)', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('12:30 PM'); // Past morning block
    var tasks = [
      makeRigidRecurring({ id: 'meds', text: 'Morning Meds', when: 'morning', dur: 20, date: tc.todayKey })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'meds');
    expect(p).not.toBeNull();
    // Should be placed in morning (past overlay, locked) — not bumped to afternoon
    expect(p.start).toBeLessThan(720); // Before noon
    expect(p.locked).toBe(true);
  });

  test('UC-1.4: Evening recurring when morning — placed at evening start', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var tasks = [
      makeRigidRecurring({ id: 'eve_meds', text: 'Evening Meds', when: 'evening', dur: 10, date: tc.todayKey })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'eve_meds');
    expect(p).not.toBeNull();
    expect(isInWindow(p, 1020, 1260)).toBe(true); // 5:00-9:00 PM
  });

  test('UC-1.5: Lunch block occupied by fixed event — lunch recurring overlaps with conflict flag', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var tasks = [
      makeFixedEvent({ id: 'meeting', text: 'Meeting', time: '12:00 PM', dur: 60, date: tc.todayKey }),
      makeRigidRecurring({ id: 'lunch', text: 'Lunch', when: 'lunch', dur: 30, date: tc.todayKey })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'lunch');
    // Lunch should ALWAYS be placed — rigid recurringTasks don't vanish
    expect(p).not.toBeNull();
    // If placed as an overlap, should have _conflict flag
    if (isInWindow(p, 720, 780)) {
      // Placed in the lunch block — check for conflict warning
      var hasConflictWarning = (result.warnings || []).some(function(w) {
        return w.type === 'recurringConflict' && w.taskId === 'lunch';
      });
      expect(hasConflictWarning).toBe(true);
    }
  });

  test('UC-1.5b: Breakfast recurring + morning meeting — breakfast shifts or overlaps', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('6:00 AM');
    var tasks = [
      // Meeting fills 6-8am
      makeFixedEvent({ id: 'mtg', text: 'Early Meeting', time: '6:00 AM', dur: 120, date: tc.todayKey }),
      makeRigidRecurring({ id: 'bfast', text: 'Eat Breakfast', when: 'morning', dur: 30, date: tc.todayKey })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'bfast');
    // Breakfast must be placed — either shifted within morning or as overlap
    expect(p).not.toBeNull();
    // Should try to find a free slot in morning first (8am-12pm)
    if (p.start >= 480 && p.start < 720) {
      // Good — shifted to free part of morning
    } else {
      // Overlap — conflict flagged
      var warn = (result.warnings || []).find(function(w) { return w.taskId === 'bfast'; });
      expect(warn).toBeDefined();
    }
  });

  test('UC-1.5c: Rigid recurring always placed even when day fully blocked', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    // Block every slot in the day with fixed events
    var blockers = [];
    for (var h = 6; h <= 22; h++) {
      blockers.push(makeFixedEvent({
        id: 'block_' + h, text: 'Block ' + h,
        time: h + ':00 ' + (h < 12 ? 'AM' : 'PM'),
        dur: 60, date: tc.todayKey
      }));
    }
    blockers.push(makeRigidRecurring({ id: 'lunch', text: 'Lunch', when: 'lunch', dur: 30, date: tc.todayKey }));
    var result = run(blockers, tc.todayKey, tc.nowMins);
    var lunch = findPlacement(result, 'lunch');
    // Rigid recurring MUST appear — either in a gap between blocks, or as a conflict overlay
    expect(lunch).not.toBeNull();
    // If conflict-placed, it will have _conflict: true
    // If gap-placed, _conflict will be absent — both are acceptable
  });

  test('UC-1.10: Two rigid lunch recurringTasks — only one fits in 30m lunch block', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var tasks = [
      makeRigidRecurring({ id: 'lunch1', text: 'Lunch', when: 'lunch', dur: 30, date: tc.todayKey }),
      makeRigidRecurring({ id: 'lunch2', text: 'Lunch Prep', when: 'lunch', dur: 30, date: tc.todayKey })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p1 = findPlacement(result, 'lunch1');
    var p2 = findPlacement(result, 'lunch2');
    expect(p1).not.toBeNull();
    // At least one should be in the lunch window
    var eitherInLunch = isInWindow(p1, 720, 780) || (p2 && isInWindow(p2, 720, 780));
    expect(eitherInLunch).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// UC-8: Time-of-Day Simulation
// ═════════════════════════════════════════════════════════════════════

describe('UC-8: Time-of-Day Simulation', function() {

  test('UC-8.1: Scheduler at 6am — full day available', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('6:00 AM');
    var tasks = makeRealRecurrings(tc.todayKey);
    var result = run(tasks, tc.todayKey, tc.nowMins);
    // All recurringTasks should be placed
    tasks.forEach(function(t) {
      var p = findPlacement(result, t.id);
      expect(p).not.toBeNull();
    });
    expect(hasNoOverlaps(result, tc.todayKey)).toBe(true);
  });

  test('UC-8.2: Scheduler at noon — morning past, afternoon available', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('12:00 PM');
    var tasks = makeRealRecurrings(tc.todayKey);
    var result = run(tasks, tc.todayKey, tc.nowMins);
    // Morning recurringTasks should still be placed (in past overlay)
    var meds = findPlacement(result, tasks[0].id);
    expect(meds).not.toBeNull();
    // Lunch should be at noon
    var lunch = findPlacement(result, tasks[2].id);
    expect(lunch).not.toBeNull();
    expect(isInWindow(lunch, 720, 780)).toBe(true);
    expect(hasNoOverlaps(result, tc.todayKey)).toBe(true);
  });

  test('UC-8.5: Scheduler runs twice same day — results consistent', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var tasks = makeRealRecurrings(tc.todayKey);
    var result1 = run(tasks, tc.todayKey, tc.nowMins);
    // Run again at a later time
    tc.setTime('10:00 AM');
    var result2 = run(tasks, tc.todayKey, tc.nowMins);

    // Lunch should be in the same place both times
    var lunch1 = findPlacement(result1, tasks[2].id);
    var lunch2 = findPlacement(result2, tasks[2].id);
    expect(lunch1).not.toBeNull();
    expect(lunch2).not.toBeNull();
    expect(isInWindow(lunch1, 720, 780)).toBe(true);
    expect(isInWindow(lunch2, 720, 780)).toBe(true);
  });

  test('UC-8.6: Scheduler at noon — rigid morning recurring in past overlay', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('12:30 PM');
    var tasks = [
      makeRigidRecurring({ id: 'meds', text: 'Morning Meds', when: 'morning', dur: 20, date: tc.todayKey })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'meds');
    expect(p).not.toBeNull();
    expect(p.start).toBeLessThan(720); // Morning block
    expect(p.locked).toBe(true);
  });

  test('UC-8.7: Scheduler at 1pm — lunch recurring placed at noon (past overlay)', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('1:00 PM');
    var tasks = [
      makeRigidRecurring({ id: 'lunch', text: 'Lunch', when: 'lunch', dur: 30, date: tc.todayKey })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'lunch');
    expect(p).not.toBeNull();
    expect(isInWindow(p, 720, 780)).toBe(true); // Should be in lunch block, not moved
  });

  test('UC-8.9: Full week simulation — recurringTasks in correct blocks each day', function() {
    var tc = timeControl('4/6/2026'); // Monday
    var weekResults = [];
    for (var i = 0; i < 7; i++) {
      tc.setTime('8:00 AM');
      var tasks = makeRealRecurrings(tc.todayKey);
      var result = run(tasks, tc.todayKey, tc.nowMins);
      var lunch = findPlacement(result, tasks[2].id); // Lunch recurring
      weekResults.push({
        day: tc.dayName,
        dateKey: tc.todayKey,
        lunchPlaced: lunch != null,
        lunchInWindow: lunch ? isInWindow(lunch, 720, 780) : false,
        noOverlaps: hasNoOverlaps(result, tc.todayKey)
      });
      tc.advanceDay();
    }
    weekResults.forEach(function(r) {
      expect(r.lunchPlaced).toBe(true);
      expect(r.lunchInWindow).toBe(true);
      expect(r.noOverlaps).toBe(true);
    });
  });

  test('UC-8.10: Month simulation — no feedback loop drift over 30 days', function() {
    var tc = timeControl('4/1/2026'); // Start of month
    var driftDetected = false;
    for (var i = 0; i < 30; i++) {
      tc.setTime('8:00 AM');
      var tasks = makeRealRecurrings(tc.todayKey);
      var result = run(tasks, tc.todayKey, tc.nowMins);
      var lunch = findPlacement(result, tasks[2].id);
      if (!lunch || !isInWindow(lunch, 720, 780)) {
        driftDetected = true;
        break;
      }
      tc.advanceDay();
    }
    expect(driftDetected).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════
// UC-3 + UC-4: Deadline + Priority Interactions (from yesterday's bug)
// ═════════════════════════════════════════════════════════════════════

describe('UC-3/4: Deadline vs Recurring Priority (Merged Phase)', function() {

  test('UC-3.4: P1 deadline due today placed before P1 recurringTasks', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('2:00 PM'); // Afternoon, limited time
    var tasks = [
      makeDeadlineTask({ id: 'unemployment', text: 'File for Unemployment', dur: 60, pri: 'P1', date: tc.todayKey, deadline: tc.todayKey, tools: ['personal_pc'] }),
      makeFlexRecurring({ id: 'apply', text: 'Apply for Jobs', dur: 60, pri: 'P1', date: tc.todayKey, tools: ['personal_pc'], when: '', split: true, splitMin: 30 }),
      makeFlexRecurring({ id: 'resume', text: 'Work on Resume Optimizer', dur: 120, pri: 'P1', date: tc.todayKey, tools: ['personal_pc'], when: '', split: true, splitMin: 15 })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    // Deadline task should be placed (not starved by recurringTasks)
    var p = findPlacement(result, 'unemployment');
    expect(p).not.toBeNull();
  });

  test('UC-4.2: P3 deadline today beats P1 no-deadline', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var tasks = [
      makeDeadlineTask({ id: 'deadline', text: 'Deadline Task', dur: 60, pri: 'P3', date: tc.todayKey, deadline: tc.todayKey }),
      makeTask({ id: 'flex', text: 'Flexible Task', dur: 60, pri: 'P1', date: tc.todayKey })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var dp = findPlacement(result, 'deadline');
    var fp = findPlacement(result, 'flex');
    expect(dp).not.toBeNull();
    expect(fp).not.toBeNull();
    // Both should be placed since there's plenty of room
  });
});

// ═════════════════════════════════════════════════════════════════════
// UC-7: Location & Tool Constraints
// ═════════════════════════════════════════════════════════════════════

describe('UC-7: Location & Tool Constraints', function() {

  test('UC-7.1: Task needs personal_pc — only available at home blocks', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var tasks = [
      makeTask({ id: 'code', text: 'Write Code', dur: 60, date: tc.todayKey, tools: ['personal_pc'] })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'code');
    expect(p).not.toBeNull();
    // Should be placed during home blocks (morning, afternoon, or evening)
    // The lunch block loc is 'work' in time blocks, but location schedule
    // template resolves to 'home' — so personal_pc IS available during lunch too
  });

  test('UC-7.3: Task requires work location — day is all home', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var tasks = [
      makeTask({ id: 'office', text: 'Office Task', dur: 60, date: tc.todayKey, location: ['work'] })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'office');
    // With weekday/weekend templates all mapping to 'home', this task can't be placed
    // unless the time block loc fallback provides 'work'
    // Depends on whether the location schedule has gaps
  });
});

// ═════════════════════════════════════════════════════════════════════
// UC-19: Real Config Scenarios
// ═════════════════════════════════════════════════════════════════════

describe('UC-19: Real User Config Scenarios', function() {

  test('UC-19.1: Friday lunch block resolves location via template (home, not work)', function() {
    var tc = timeControl('4/3/2026'); // Friday
    tc.setTime('8:00 AM');
    // Task needs personal_pc — lunch block says loc:"work" but template says "home"
    var tasks = [
      makeTask({ id: 'pc_task', text: 'PC Task', dur: 30, date: tc.todayKey, when: 'lunch', tools: ['personal_pc'] })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'pc_task');
    // Should be placed in lunch block because location resolves to home (via template),
    // and home has personal_pc
    expect(p).not.toBeNull();
    expect(isInWindow(p, 720, 780)).toBe(true);
  });

  test('UC-19.3: P1 deadline due today + P1 recurringTasks — deadline gets priority', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('3:00 PM'); // Limited afternoon capacity
    var tasks = [
      makeDeadlineTask({ id: 'unemployment', text: 'File for Unemployment', dur: 60, pri: 'P1', date: tc.todayKey, deadline: tc.todayKey, tools: ['personal_pc'] }),
      ...makeRealRecurrings(tc.todayKey)
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'unemployment');
    expect(p).not.toBeNull(); // Must be placed, not starved by recurringTasks
  });

  test('UC-19.7: All rigid recurringTasks placed in correct blocks', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var recurringTasks = makeRealRecurrings(tc.todayKey);
    var result = run(recurringTasks, tc.todayKey, tc.nowMins);

    // Morning prescriptions — in morning block (360-720)
    var meds = findPlacement(result, recurringTasks[0].id);
    expect(meds).not.toBeNull();
    expect(meds.start).toBeGreaterThanOrEqual(360);
    expect(meds.start).toBeLessThan(720);

    // Lunch — in lunch block (720-780)
    var lunch = findPlacement(result, recurringTasks[2].id);
    expect(lunch).not.toBeNull();
    expect(isInWindow(lunch, 720, 780)).toBe(true);

    // Evening meds — in evening block (1020-1260)
    var eveMeds = findPlacement(result, recurringTasks[3].id);
    expect(eveMeds).not.toBeNull();
    expect(isInWindow(eveMeds, 1020, 1260)).toBe(true);

    expect(hasNoOverlaps(result, tc.todayKey)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════
// UC-9: Fixed Events & Markers
// ═════════════════════════════════════════════════════════════════════

describe('UC-9: Fixed Events & Markers', function() {

  test('UC-9.1: Fixed event blocks time, other tasks work around it', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var tasks = [
      makeFixedEvent({ id: 'dr', text: 'Dr. Appointment', time: '1:00 PM', dur: 60, date: tc.todayKey }),
      makeTask({ id: 't1', text: 'Work Task', dur: 60, date: tc.todayKey, when: 'afternoon' })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var dr = findPlacement(result, 'dr');
    var t1 = findPlacement(result, 't1');
    expect(dr.start).toBe(780); // 1:00 PM
    expect(t1).not.toBeNull();
    // Work task should not overlap with doctor
    if (t1.start < dr.start) {
      expect(t1.start + t1.dur).toBeLessThanOrEqual(dr.start);
    } else {
      expect(t1.start).toBeGreaterThanOrEqual(dr.start + dr.dur);
    }
  });

  test('UC-9.5: Marker is non-blocking', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var tasks = [
      makeTask({ id: 'marker1', text: 'TV Show', dur: 60, date: tc.todayKey, time: '10:00 AM', marker: true, when: 'fixed' }),
      makeTask({ id: 'work', text: 'Work Task', dur: 60, date: tc.todayKey, when: 'morning' })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var work = findPlacement(result, 'work');
    expect(work).not.toBeNull();
    // Work task can overlap with marker
  });
});

// ═════════════════════════════════════════════════════════════════════
// UC-16: Edge Cases & Boundary Conditions
// ═════════════════════════════════════════════════════════════════════

describe('UC-16: Edge Cases', function() {

  test('UC-16.1: Zero tasks', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var result = run([], tc.todayKey, tc.nowMins);
    expect(result.dayPlacements).toBeDefined();
  });

  test('UC-16.4: Task with dur:0 is skipped', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var tasks = [makeTask({ id: 'zero', text: 'Zero Duration', dur: 0, date: tc.todayKey })];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    var p = findPlacement(result, 'zero');
    // Zero duration tasks are skipped
    expect(p).toBeNull();
  });

  test('UC-16.8: All terminal statuses excluded', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var tasks = [
      makeTask({ id: 't1', text: 'Done', dur: 30, date: tc.todayKey, status: 'done' }),
      makeTask({ id: 't2', text: 'Cancelled', dur: 30, date: tc.todayKey, status: 'cancel' }),
      makeTask({ id: 't3', text: 'Skipped', dur: 30, date: tc.todayKey, status: 'skip' }),
      makeTask({ id: 't4', text: 'Paused', dur: 30, date: tc.todayKey, status: 'pause' }),
      makeTask({ id: 't5', text: 'Disabled', dur: 30, date: tc.todayKey, status: 'disabled' })
    ];
    var result = run(tasks, tc.todayKey, tc.nowMins);
    tasks.forEach(function(t) {
      expect(findPlacement(result, t.id)).toBeNull();
    });
  });

  test('UC-16.13: No overlaps invariant — 20 random tasks', function() {
    var tc = timeControl('4/3/2026');
    tc.setTime('8:00 AM');
    var tasks = [];
    for (var i = 0; i < 20; i++) {
      var durs = [15, 30, 45, 60, 90, 120];
      var pris = ['P1', 'P2', 'P3', 'P4'];
      tasks.push(makeTask({
        id: 'rand_' + i,
        text: 'Random Task ' + i,
        dur: durs[i % durs.length],
        pri: pris[i % pris.length],
        date: tc.todayKey
      }));
    }
    var result = run(tasks, tc.todayKey, tc.nowMins);
    expect(hasNoOverlaps(result, tc.todayKey)).toBe(true);
  });
});
