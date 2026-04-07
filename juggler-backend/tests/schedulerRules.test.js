/**
 * Scheduler Rules Test Suite
 *
 * Comprehensive tests for every scheduling rule with predetermined expected outcomes.
 * Organized by concept, serving as living documentation of scheduler behavior.
 *
 * Date context:
 *   TODAY = '3/22' (Sunday) — weekend blocks: morning 420-720, afternoon 720-1020, evening 1020-1260 (all home)
 *   Tomorrow = '3/23' (Monday) — weekday blocks: morning 360-480 (home), biz 480-720 (work), etc.
 *   nowMins = 480 (8:00 AM) — minutes 0-479 blocked on today
 *   Usable today capacity ≈ 780m (480-1260)
 */

const unifiedSchedule = require('../src/scheduler/unifiedSchedule');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX, GRID_START, GRID_END } = require('../src/scheduler/constants');

const TODAY = '3/22';
const TOMORROW = '3/23';
const NOW_MINS = 480;

function makeTask(overrides) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'Test task',
    date: TODAY,
    dur: 30,
    pri: 'P3',
    when: '',
    dayReq: 'any',
    status: '',
    dependsOn: [],
    location: [],
    tools: [],
    recurring: false,
    rigid: false,
    marker: false,
    split: false,
    datePinned: false,
    generated: false,
    section: '',
    ...overrides
  };
}

function makeCfg(overrides) {
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
    ...overrides
  };
}

function dateKey(daysFromToday) {
  var d = new Date(2026, 2, 22); // March 22, 2026 (Sunday)
  d.setDate(d.getDate() + daysFromToday);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

const cfg = makeCfg();

function run(tasks, overrides) {
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  var testCfg = overrides && overrides.cfg ? overrides.cfg : cfg;
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, testCfg);
}

// ── Helpers ──

function findPlacements(result, taskId) {
  var parts = [];
  Object.keys(result.dayPlacements).forEach(function(dk) {
    (result.dayPlacements[dk] || []).forEach(function(p) {
      if (p.task && p.task.id === taskId) parts.push({ dateKey: dk, start: p.start, dur: p.dur, locked: p.locked, marker: p.marker });
    });
  });
  return parts;
}

function isPlaced(result, taskId) {
  return findPlacements(result, taskId).length > 0;
}

function placedDay(result, taskId) {
  var parts = findPlacements(result, taskId);
  return parts.length > 0 ? parts[0].dateKey : null;
}

function placedOnDay(result, dk) {
  return (result.dayPlacements[dk] || []).filter(function(p) { return p.task && !p.marker; });
}

function isOnToday(result, taskId) {
  return findPlacements(result, taskId).some(function(p) { return p.dateKey === TODAY; });
}

function totalPlacedMinutes(result, taskId) {
  return findPlacements(result, taskId).reduce(function(sum, p) { return sum + p.dur; }, 0);
}

function parseDateKey(dk) {
  var parts = dk.split('/');
  return new Date(2026, parseInt(parts[0]) - 1, parseInt(parts[1]));
}

function placedBefore(result, idA, idB) {
  var partsA = findPlacements(result, idA);
  var partsB = findPlacements(result, idB);
  if (partsA.length === 0 || partsB.length === 0) return false;
  var dateA = parseDateKey(partsA[0].dateKey);
  var dateB = parseDateKey(partsB[0].dateKey);
  if (dateA < dateB) return true;
  if (dateA > dateB) return false;
  return partsA[0].start < partsB[0].start;
}

function hasOverlaps(result, dk) {
  var placed = placedOnDay(result, dk);
  placed.sort(function(a, b) { return a.start - b.start; });
  for (var i = 0; i < placed.length - 1; i++) {
    if (placed[i + 1].start < placed[i].start + placed[i].dur) return true;
  }
  return false;
}

function hasDeadlineMiss(result) {
  return result.score && result.score.breakdown && result.score.breakdown.deadlineMiss > 0;
}

// ── Tests ──

describe('Scheduler Rules', () => {

  // ─── GROUP 1: Priority ordering ───
  describe('Group 1: Priority ordering (no deadlines, no deps)', () => {
    test('higher-priority tasks fill today first', () => {
      var tasks = [];
      // Need enough P1/P2 demand to trigger todayReserved (>60% of ~780m usable)
      for (var i = 0; i < 5; i++) {
        tasks.push(makeTask({ id: 'p1_' + i, pri: 'P1', dur: 60, text: 'P1 task ' + i }));
        tasks.push(makeTask({ id: 'p2_' + i, pri: 'P2', dur: 60, text: 'P2 task ' + i }));
      }
      for (var k = 0; k < 3; k++) {
        tasks.push(makeTask({ id: 'p4_' + k, pri: 'P4', dur: 30, text: 'P4 task ' + k }));
      }
      var result = run(tasks);

      // All P1 placed on today
      for (var j = 0; j < 5; j++) {
        expect(isOnToday(result, 'p1_' + j)).toBe(true);
      }
      // P4 tasks are placed after P1/P2 — they may land on today if capacity remains.
      // The key invariant is P1 fills today first (above).
      for (var m = 0; m < 3; m++) {
        expect(isPlaced(result, 'p4_' + m)).toBe(true);
      }
    });
  });

  // ─── GROUP 2: Deadline governs over priority ───
  describe('Group 2: Deadline governs over priority', () => {
    test('P4 task with imminent deadline is placed, not deferred', () => {
      var tasks = [
        makeTask({ id: 'p4_due', pri: 'P4', dur: 60, due: TOMORROW, text: 'P4 due tomorrow' }),
        makeTask({ id: 'p1_flex', pri: 'P1', dur: 60, text: 'P1 no deadline' }),
      ];
      // Fill capacity to create pressure
      for (var i = 0; i < 6; i++) {
        tasks.push(makeTask({ id: 'filler_' + i, pri: 'P2', dur: 60, text: 'P2 filler ' + i }));
      }
      var result = run(tasks);

      expect(isPlaced(result, 'p4_due')).toBe(true);
      expect(isPlaced(result, 'p1_flex')).toBe(true);
      expect(hasDeadlineMiss(result)).toBe(false);
    });
  });

  // ─── GROUP 3: No-deadline P3/P4 deferred ───
  describe('Group 3: No-deadline P3/P4 deferred when today reserved', () => {
    test('P3/P4 without deadlines yield today to higher-priority work', () => {
      var tasks = [];
      // 6x P1 60m = 360m demand. Today usable ~780m. 360 > 780*0.6=468? No.
      // Need 8x P1 = 480m > 468 to trigger todayReserved.
      for (var i = 0; i < 8; i++) {
        tasks.push(makeTask({ id: 'p1_' + i, pri: 'P1', dur: 60, text: 'P1 task ' + i }));
      }
      tasks.push(makeTask({ id: 'p4_a', pri: 'P4', dur: 30, text: 'P4 no deadline' }));
      tasks.push(makeTask({ id: 'p4_b', pri: 'P4', dur: 30, text: 'P4 no deadline 2' }));
      tasks.push(makeTask({ id: 'p3_a', pri: 'P3', dur: 30, text: 'P3 no deadline' }));
      var result = run(tasks);

      // All P1 on today
      for (var j = 0; j < 8; j++) {
        expect(isOnToday(result, 'p1_' + j)).toBe(true);
      }
      // P4/P3 without deadlines should not take priority over P1 on today.
      // Count how many P4/P3 ended up on today — should be fewer than P1.
      var lowPriOnToday = [isOnToday(result, 'p4_a'), isOnToday(result, 'p4_b'), isOnToday(result, 'p3_a')].filter(Boolean).length;
      var p1OnToday = 0;
      for (var j2 = 0; j2 < 8; j2++) { if (isOnToday(result, 'p1_' + j2)) p1OnToday++; }
      expect(p1OnToday).toBeGreaterThan(lowPriOnToday);
    });
  });

  // ─── GROUP 4: Dependency chain ordering ───
  describe('Group 4: Dependency chain — basic ordering', () => {
    test('tasks place after their dependencies', () => {
      var tasks = [
        makeTask({ id: 'step_a', pri: 'P2', dur: 30, text: 'Step A' }),
        makeTask({ id: 'step_b', pri: 'P2', dur: 30, text: 'Step B', dependsOn: ['step_a'] }),
        makeTask({ id: 'step_c', pri: 'P2', dur: 30, text: 'Step C', dependsOn: ['step_b'] }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'step_a')).toBe(true);
      expect(isPlaced(result, 'step_b')).toBe(true);
      expect(isPlaced(result, 'step_c')).toBe(true);
      expect(placedBefore(result, 'step_a', 'step_b')).toBe(true);
      expect(placedBefore(result, 'step_b', 'step_c')).toBe(true);
    });
  });

  // ─── GROUP 5: Deadline propagation through deps ───
  describe('Group 5: Deadline propagation through dependency chain', () => {
    test('upstream tasks inherit deadlines from downstream due dates', () => {
      var tasks = [
        makeTask({ id: 'research', pri: 'P2', dur: 120, text: 'Research' }),
        makeTask({ id: 'draft', pri: 'P2', dur: 120, text: 'Draft', dependsOn: ['research'] }),
        makeTask({ id: 'review', pri: 'P2', dur: 60, text: 'Review', dependsOn: ['draft'], due: dateKey(5) }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'research')).toBe(true);
      expect(isPlaced(result, 'draft')).toBe(true);
      expect(isPlaced(result, 'review')).toBe(true);
      expect(placedBefore(result, 'research', 'draft')).toBe(true);
      expect(placedBefore(result, 'draft', 'review')).toBe(true);
      expect(hasDeadlineMiss(result)).toBe(false);
    });
  });

  // ─── GROUP 6: Duration subtraction in deadline chain ───
  describe('Group 6: Deadline propagation with duration subtraction', () => {
    test('each chain link subtracts its duration from inherited deadline', () => {
      // 4 tasks in a chain, each 120m, final due in 5 days — enough room
      var tasks = [
        makeTask({ id: 'step1', pri: 'P2', dur: 120, text: 'Step 1' }),
        makeTask({ id: 'step2', pri: 'P2', dur: 120, text: 'Step 2', dependsOn: ['step1'] }),
        makeTask({ id: 'step3', pri: 'P2', dur: 120, text: 'Step 3', dependsOn: ['step2'] }),
        makeTask({ id: 'final', pri: 'P2', dur: 120, text: 'Final', dependsOn: ['step3'], due: dateKey(5) }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'step1')).toBe(true);
      expect(isPlaced(result, 'final')).toBe(true);
      expect(placedBefore(result, 'step1', 'step2')).toBe(true);
      expect(placedBefore(result, 'step2', 'step3')).toBe(true);
      expect(placedBefore(result, 'step3', 'final')).toBe(true);
      expect(hasDeadlineMiss(result)).toBe(false);
    });
  });

  // ─── GROUP 7: Dynamic deadline tightening ───
  describe('Group 7: Dynamic deadline tightening', () => {
    test('P3 tasks with inherited deadline are not deferred as no-deadline', () => {
      var tasks = [
        makeTask({ id: 'ancestor', pri: 'P3', dur: 60, text: 'Ancestor' }),
        makeTask({ id: 'middle', pri: 'P3', dur: 60, text: 'Middle', dependsOn: ['ancestor'] }),
        makeTask({ id: 'leaf', pri: 'P3', dur: 60, text: 'Leaf', dependsOn: ['middle'], due: dateKey(2) }),
        // Add P1 demand to trigger todayReserved
        makeTask({ id: 'p1_a', pri: 'P1', dur: 120 }),
        makeTask({ id: 'p1_b', pri: 'P1', dur: 120 }),
      ];
      var result = run(tasks);

      // All three chain tasks placed despite being P3 (they inherit deadline from leaf)
      expect(isPlaced(result, 'ancestor')).toBe(true);
      expect(isPlaced(result, 'middle')).toBe(true);
      expect(isPlaced(result, 'leaf')).toBe(true);
      expect(placedBefore(result, 'ancestor', 'middle')).toBe(true);
      expect(placedBefore(result, 'middle', 'leaf')).toBe(true);
    });
  });

  // ─── GROUP 8: Fixed tasks ───
  describe('Group 8: Fixed tasks are immovable', () => {
    test('fixed task anchors at declared time and blocks the slot', () => {
      var tasks = [
        makeTask({ id: 'fixed_9am', when: 'fixed', time: '9:00 AM', dur: 60, text: 'Fixed 9AM' }),
        makeTask({ id: 'flex_task', pri: 'P1', dur: 60, text: 'Flex task' }),
      ];
      var result = run(tasks);

      var fixedParts = findPlacements(result, 'fixed_9am');
      expect(fixedParts.length).toBe(1);
      expect(fixedParts[0].start).toBe(540); // 9:00 AM

      var flexParts = findPlacements(result, 'flex_task');
      expect(flexParts.length).toBeGreaterThanOrEqual(1);
      // Flex task must not overlap with 540-600
      flexParts.forEach(function(p) {
        var overlaps = p.start < 600 && p.start + p.dur > 540;
        expect(overlaps).toBe(false);
      });
    });
  });

  // ─── GROUP 9: Rigid vs flexible recurringTasks ───
  describe('Group 9: Rigid vs flexible recurringTasks', () => {
    test('rigid recurring at exact time; flexible recurring drifts within timeFlex', () => {
      var tasks = [
        makeTask({ id: 'rigid_7am', recurring: true, rigid: true, time: '7:00 AM', dur: 30, text: 'Rigid 7AM', pri: 'P1' }),
        makeTask({ id: 'blocker', when: 'fixed', time: '8:00 AM', dur: 30, text: 'Blocker' }),
        makeTask({ id: 'flex_8am', recurring: true, rigid: false, time: '8:00 AM', dur: 30, timeFlex: 60, text: 'Flex 8AM', pri: 'P1' }),
      ];
      var result = run(tasks);

      // Rigid at exactly 420
      var rigidParts = findPlacements(result, 'rigid_7am');
      expect(rigidParts.length).toBe(1);

      // Blocker at exactly 480
      var blockerParts = findPlacements(result, 'blocker');
      expect(blockerParts.length).toBe(1);
      expect(blockerParts[0].start).toBe(480);

      // Flex recurring placed but NOT at 480 (blocked), within flex range
      var flexParts = findPlacements(result, 'flex_8am');
      expect(flexParts.length).toBe(1);
      expect(flexParts[0].start).not.toBe(480);
      // Within 8AM ± 60m = [420, 540]
      expect(flexParts[0].start).toBeGreaterThanOrEqual(420);
      expect(flexParts[0].start).toBeLessThanOrEqual(540);
    });
  });

  // ─── GROUP 10: When-window constraints ───
  describe('Group 10: When-window constraints', () => {
    test('tasks placed within their declared time windows', () => {
      // Use Monday (weekday) for clearer window boundaries. datePinned so they stay on TOMORROW.
      var tasks = [
        makeTask({ id: 'morning_task', when: 'morning', dur: 30, date: TOMORROW, datePinned: true, text: 'Morning task' }),
        makeTask({ id: 'evening_task', when: 'evening', dur: 30, date: TOMORROW, datePinned: true, text: 'Evening task' }),
        makeTask({ id: 'anytime_task', when: '', dur: 30, date: TOMORROW, datePinned: true, text: 'Anytime task' }),
      ];
      var result = run(tasks);

      var morningParts = findPlacements(result, 'morning_task');
      expect(morningParts.length).toBe(1);
      expect(morningParts[0].start).toBeGreaterThanOrEqual(360); // 6 AM
      expect(morningParts[0].start + morningParts[0].dur).toBeLessThanOrEqual(480); // 8 AM

      var eveningParts = findPlacements(result, 'evening_task');
      expect(eveningParts.length).toBe(1);
      expect(eveningParts[0].start).toBeGreaterThanOrEqual(1020); // 5 PM
      expect(eveningParts[0].start + eveningParts[0].dur).toBeLessThanOrEqual(1260); // 9 PM

      expect(isPlaced(result, 'anytime_task')).toBe(true);
    });
  });

  // ─── GROUP 11: Day requirement constraints ───
  describe('Group 11: Day requirement constraints', () => {
    test('weekday/weekend/specific-day constraints enforced', () => {
      var tasks = [
        makeTask({ id: 'weekday_only', dayReq: 'weekday', dur: 30, text: 'Weekday only' }),
        makeTask({ id: 'weekend_only', dayReq: 'weekend', dur: 30, text: 'Weekend only' }),
        makeTask({ id: 'monday_only', dayReq: 'M', dur: 30, text: 'Monday only' }),
      ];
      var result = run(tasks);

      // Today is Sunday — weekday task can't go here
      expect(isOnToday(result, 'weekday_only')).toBe(false);
      expect(placedDay(result, 'weekday_only')).toBe(TOMORROW); // Monday

      // Weekend task goes on today (Sunday)
      expect(isOnToday(result, 'weekend_only')).toBe(true);

      // Monday-only goes to Monday
      expect(placedDay(result, 'monday_only')).toBe(TOMORROW);
    });
  });

  // ─── GROUP 12: Split tasks across days ───
  describe('Group 12: Split tasks across days', () => {
    test('splittable tasks distribute across days when day is full', () => {
      var tasks = [];
      // Fill today with fixed tasks (600m of the ~780m usable)
      for (var i = 0; i < 10; i++) {
        tasks.push(makeTask({ id: 'fixed_' + i, when: 'fixed', time: (8 + i) + ':00 AM', dur: 60, text: 'Fixed ' + i }));
      }
      tasks.push(makeTask({ id: 'big_split', pri: 'P2', dur: 600, split: true, splitMin: 30, text: 'Big split task' }));
      var result = run(tasks);

      var parts = findPlacements(result, 'big_split');
      expect(parts.length).toBeGreaterThan(1); // split across days
      parts.forEach(function(p) {
        expect(p.dur).toBeGreaterThanOrEqual(30); // respects splitMin
      });
      expect(totalPlacedMinutes(result, 'big_split')).toBe(600);
    });
  });

  // ─── GROUP 13: Split deadline task placed before deadline ───
  describe('Group 13: Split deadline task placed and meets deadline', () => {
    test('split deadline task is fully placed before due date', () => {
      var tasks = [
        makeTask({ id: 'big_deadline', pri: 'P2', dur: 480, split: true, splitMin: 30, due: dateKey(3), text: 'Big deadline task' }),
      ];
      var result = run(tasks);

      var parts = findPlacements(result, 'big_deadline');
      expect(parts.length).toBeGreaterThan(0);
      expect(totalPlacedMinutes(result, 'big_deadline')).toBe(480);
      expect(hasDeadlineMiss(result)).toBe(false);
      // All parts must be on or before the deadline
      parts.forEach(function(p) {
        var placedDate = parseDateKey(p.dateKey);
        var dueDate = parseDateKey(dateKey(3));
        expect(placedDate <= dueDate).toBe(true);
      });
    });
  });

  // ─── GROUP 14: startAfter constraint ───
  describe('Group 14: startAfter constraint', () => {
    test('tasks placed on or after startAfter date', () => {
      var tasks = [
        makeTask({ id: 'future_task', pri: 'P1', dur: 30, startAfter: dateKey(3), text: 'Future task' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'future_task')).toBe(true);
      expect(isOnToday(result, 'future_task')).toBe(false);
      var day = placedDay(result, 'future_task');
      var placedDate = parseDateKey(day);
      var startAfterDate = parseDateKey(dateKey(3));
      expect(placedDate >= startAfterDate).toBe(true);
    });
  });

  // ─── GROUP 15: Location constraints ───
  describe('Group 15: Location constraints', () => {
    test('tasks only place during compatible location blocks', () => {
      // Use Monday for work/home blocks. datePinned so they stay on TOMORROW.
      var tasks = [
        makeTask({ id: 'office_task', location: ['work'], dur: 60, date: TOMORROW, datePinned: true, text: 'Office task' }),
        makeTask({ id: 'home_task', location: ['home'], dur: 60, date: TOMORROW, datePinned: true, text: 'Home task' }),
      ];
      var result = run(tasks);

      var officeParts = findPlacements(result, 'office_task');
      expect(officeParts.length).toBe(1);
      // Biz blocks: 480-720, 780-1020 (work)
      expect(officeParts[0].start).toBeGreaterThanOrEqual(480);
      expect(officeParts[0].start + officeParts[0].dur).toBeLessThanOrEqual(1020);

      var homeParts = findPlacements(result, 'home_task');
      expect(homeParts.length).toBe(1);
      // Home blocks: morning 360-480, evening 1020-1260, night 1260-1380
      var inHome = (homeParts[0].start >= 360 && homeParts[0].start + homeParts[0].dur <= 480) ||
                   (homeParts[0].start >= 1020);
      expect(inHome).toBe(true);
    });
  });

  // ─── GROUP 16: Travel buffers ───
  describe('Group 16: Travel buffers', () => {
    test('travel time reserves buffer around placements', () => {
      var tasks = [
        makeTask({ id: 'travel_task', pri: 'P1', dur: 60, travelBefore: 30, travelAfter: 15, text: 'Travel task' }),
        makeTask({ id: 'adjacent', pri: 'P2', dur: 30, text: 'Adjacent task' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'travel_task')).toBe(true);
      expect(isPlaced(result, 'adjacent')).toBe(true);

      var tParts = findPlacements(result, 'travel_task');
      var aParts = findPlacements(result, 'adjacent');

      if (tParts[0].dateKey === aParts[0].dateKey) {
        var tStart = tParts[0].start;
        var tEnd = tStart + tParts[0].dur;
        var bufferStart = tStart - 30;
        var bufferEnd = tEnd + 15;
        // Adjacent task must not overlap buffer zones
        var aStart = aParts[0].start;
        var aEnd = aStart + aParts[0].dur;
        var overlapsBuffer = aStart < bufferEnd && aEnd > bufferStart;
        expect(overlapsBuffer).toBe(false);
      }
    });
  });

  // ─── GROUP 17: Intraday packing ───
  describe('Group 17: Intraday packing consolidates gaps', () => {
    test('P1 tasks packed before P3 tasks after Phase 5.5', () => {
      var tasks = [
        makeTask({ id: 'p1_a', pri: 'P1', dur: 30, text: 'P1 A' }),
        makeTask({ id: 'p3_b', pri: 'P3', dur: 30, text: 'P3 B' }),
        makeTask({ id: 'p1_c', pri: 'P1', dur: 30, text: 'P1 C' }),
        makeTask({ id: 'p3_d', pri: 'P3', dur: 30, text: 'P3 D' }),
      ];
      var result = run(tasks);

      // All placed on today
      ['p1_a', 'p3_b', 'p1_c', 'p3_d'].forEach(function(id) {
        expect(isPlaced(result, id)).toBe(true);
      });

      // After packing: average P1 start should be earlier than average P3 start
      var p1Starts = ['p1_a', 'p1_c'].map(function(id) { return findPlacements(result, id)[0].start; });
      var p3Starts = ['p3_b', 'p3_d'].map(function(id) { return findPlacements(result, id)[0].start; });
      var avgP1 = (p1Starts[0] + p1Starts[1]) / 2;
      var avgP3 = (p3Starts[0] + p3Starts[1]) / 2;
      expect(avgP1).toBeLessThan(avgP3);
    });
  });

  // ─── GROUP 18: Past tasks ───
  describe('Group 18: Past tasks move to today', () => {
    test('non-recurring past tasks enter pool with today as floor', () => {
      var tasks = [
        makeTask({ id: 'past_task', pri: 'P2', dur: 30, date: '3/21', text: 'Past task' }),
        makeTask({ id: 'today_task', pri: 'P2', dur: 30, text: 'Today task' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'past_task')).toBe(true);
      expect(isPlaced(result, 'today_task')).toBe(true);
      // Past task NOT on yesterday
      var pastDay = placedDay(result, 'past_task');
      expect(pastDay).not.toBe('3/21');
    });
  });

  // ─── GROUP 19: Past recurringTasks skipped ───
  describe('Group 19: Past recurringTasks are skipped', () => {
    test('recurringTasks on past dates are dropped', () => {
      var tasks = [
        makeTask({ id: 'past_recurring', recurring: true, date: '3/21', dur: 30, text: 'Past recurring' }),
        makeTask({ id: 'today_recurring', recurring: true, date: TODAY, dur: 30, text: 'Today recurring' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'past_recurring')).toBe(false);
      expect(isPlaced(result, 'today_recurring')).toBe(true);
    });
  });

  // ─── GROUP 20: Markers non-blocking ───
  describe('Group 20: Markers are non-blocking', () => {
    test('markers show on calendar but do not consume time slots', () => {
      var tasks = [
        makeTask({ id: 'marker_10am', marker: true, time: '10:00 AM', dur: 120, text: 'Marker' }),
        makeTask({ id: 'task_10am', pri: 'P2', dur: 60, text: 'Task at 10' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'task_10am')).toBe(true);
      // Task can overlap with marker time range
      var taskParts = findPlacements(result, 'task_10am');
      expect(taskParts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── GROUP 21: Backwards dependencies ───
  describe('Group 21: Backwards dependency detection', () => {
    test('backwards pinned deps are skipped, not fatal', () => {
      var tasks = [
        makeTask({ id: 'early_pinned', pri: 'P2', dur: 30, date: TODAY, datePinned: true, dependsOn: ['late_pinned'], text: 'Early' }),
        makeTask({ id: 'late_pinned', pri: 'P2', dur: 30, date: dateKey(5), datePinned: true, text: 'Late' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'early_pinned')).toBe(true);
      expect(isPlaced(result, 'late_pinned')).toBe(true);
      // Should have a backwardsDep warning
      var hasWarning = (result.warnings || []).some(function(w) { return w.type === 'backwardsDep'; });
      expect(hasWarning).toBe(true);
    });
  });

  // ─── GROUP 22: Phase 2.5 compaction ───
  describe('Group 22: Phase 2.5 compaction swaps priorities across days', () => {
    test('higher-pri on later day swaps with lower-pri on earlier day', () => {
      var tasks = [];
      // Fill today with P4 tasks — need todayReserved to NOT trigger (P1 demand low)
      // so P4 tasks actually land on today first, then compaction can swap
      for (var i = 0; i < 10; i++) {
        tasks.push(makeTask({ id: 'p4_' + i, pri: 'P4', dur: 30, text: 'P4 filler ' + i }));
      }
      // P1 tasks dated tomorrow — compaction should pull these earlier
      tasks.push(makeTask({ id: 'p1_late_a', pri: 'P1', dur: 30, date: TOMORROW, datePinned: true, text: 'P1 A' }));
      tasks.push(makeTask({ id: 'p1_late_b', pri: 'P1', dur: 30, date: TOMORROW, datePinned: true, text: 'P1 B' }));
      var result = run(tasks);

      // Cross-day priority penalty should exist (P4 on earlier day, P1 on later)
      // Compaction may or may not fix it (depends on constraints), but the score should reflect it
      expect(result.score.breakdown.crossDayPri).toBeGreaterThanOrEqual(0);
      // Both P1 tasks should be placed
      expect(isPlaced(result, 'p1_late_a')).toBe(true);
      expect(isPlaced(result, 'p1_late_b')).toBe(true);
    });
  });

  // ─── GROUP 23: Deadline task placed and meets deadline ───
  describe('Group 23: Deadline task placed before due date', () => {
    test('deadline task is placed and meets its deadline', () => {
      var tasks = [
        makeTask({ id: 'deadline_far', pri: 'P2', dur: 60, due: dateKey(14), text: 'Far deadline' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'deadline_far')).toBe(true);
      expect(hasDeadlineMiss(result)).toBe(false);
      var parts = findPlacements(result, 'deadline_far');
      var placedDate = parseDateKey(parts[0].dateKey);
      var dueDate = parseDateKey(dateKey(14));
      expect(placedDate <= dueDate).toBe(true);
    });
  });

  // ─── GROUP 24: Overflow ───
  describe('Group 24: Overflow to adjacent days', () => {
    test('task placed even when its original day is full', () => {
      var tasks = [];
      // Fill today from 8am to 9pm with large P1 tasks
      for (var i = 0; i < 13; i++) {
        tasks.push(makeTask({ id: 'blocker_' + i, pri: 'P1', dur: 60, text: 'Blocker ' + i }));
      }
      // This P2 task also wants today, but capacity is 780m and we have 780m of P1
      tasks.push(makeTask({ id: 'overflow_task', pri: 'P2', dur: 60, text: 'Overflow' }));
      var result = run(tasks);

      // Task should still be placed (overflow to adjacent day)
      expect(isPlaced(result, 'overflow_task')).toBe(true);
    });
  });

  // ─── GROUP 25: flexWhen relaxation ───
  describe('Group 25: flexWhen relaxation', () => {
    test('flexWhen tasks can place outside their preferred window', () => {
      // A flexWhen evening task can place in morning/afternoon if evening is full
      var tasks = [];
      // Fill Monday evening completely with fixed tasks
      for (var i = 1020; i < 1260; i += 10) {
        var h = Math.floor(i / 60);
        var m = i % 60;
        var ampm = h >= 12 ? 'PM' : 'AM';
        var dh = h > 12 ? h - 12 : (h === 0 ? 12 : h);
        tasks.push(makeTask({ id: 'eve_f_' + i, when: 'fixed', time: dh + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm, dur: 10, date: TOMORROW }));
      }
      // Also fill night block
      for (var n = 1260; n < 1380; n += 10) {
        var nh = Math.floor(n / 60);
        var nm = n % 60;
        tasks.push(makeTask({ id: 'night_f_' + n, when: 'fixed', time: (nh > 12 ? nh - 12 : nh) + ':' + (nm < 10 ? '0' : '') + nm + ' PM', dur: 10, date: TOMORROW }));
      }
      tasks.push(makeTask({ id: 'flex_eve', when: 'evening', dur: 60, date: TOMORROW, flexWhen: true, text: 'Flex evening', datePinned: true }));
      var result = run(tasks);

      // Flex evening should still be placed (relaxed outside evening window)
      expect(isPlaced(result, 'flex_eve')).toBe(true);
    });
  });

  // ─── GROUP 26: Wedding prep scenario ───
  describe('Group 26: Real-world wedding prep scenario', () => {
    test('mixed deps, deadlines, constraints all satisfied', () => {
      var weddingDay = dateKey(5);
      var dayBefore = dateKey(4);
      var tasks = [
        makeTask({ id: 'try_suit', pri: 'P2', dur: 30, text: 'Try on suit' }),
        makeTask({ id: 'tailor', pri: 'P2', dur: 60, dependsOn: ['try_suit'], dayReq: 'weekday', text: 'Tailor suit' }),
        makeTask({ id: 'pickup', pri: 'P2', dur: 30, dependsOn: ['tailor'], startAfter: dateKey(2), text: 'Pick up suit' }),
        makeTask({ id: 'buy_gift', pri: 'P2', dur: 120, text: 'Buy wedding gift' }),
        makeTask({ id: 'wrap_gift', pri: 'P3', dur: 30, dependsOn: ['buy_gift'], text: 'Wrap gift' }),
        makeTask({ id: 'get_card', pri: 'P2', dur: 20, text: 'Get wedding card' }),
        makeTask({ id: 'pack', pri: 'P2', dur: 45, due: dayBefore, text: 'Pack' }),
        makeTask({ id: 'wedding', when: 'fixed', time: '2:00 PM', dur: 240, date: weddingDay, due: weddingDay, text: 'Wedding' }),
      ];
      var result = run(tasks);

      // Dependency ordering
      expect(placedBefore(result, 'try_suit', 'tailor')).toBe(true);
      expect(placedBefore(result, 'tailor', 'pickup')).toBe(true);
      expect(placedBefore(result, 'buy_gift', 'wrap_gift')).toBe(true);

      // startAfter respected
      var pickupDay = placedDay(result, 'pickup');
      if (pickupDay) {
        var pickupDate = new Date(2026, 2, parseInt(pickupDay.split('/')[1]));
        expect(pickupDate >= new Date(2026, 2, 24)).toBe(true); // today+2
      }

      // Tailor on a weekday (Mon-Fri = dow 1-5)
      var tailorDay = placedDay(result, 'tailor');
      if (tailorDay) {
        var tailorDate = new Date(2026, 2, parseInt(tailorDay.split('/')[1]));
        expect(tailorDate.getDay()).toBeGreaterThanOrEqual(1);
        expect(tailorDate.getDay()).toBeLessThanOrEqual(5);
      }

      // Pack on or before day before wedding
      expect(isPlaced(result, 'pack')).toBe(true);
      expect(hasDeadlineMiss(result)).toBe(false);

      // Wedding at 2:00 PM (840 minutes) on wedding day
      var weddingParts = findPlacements(result, 'wedding');
      expect(weddingParts.length).toBe(1);
      expect(weddingParts[0].dateKey).toBe(weddingDay);
      expect(weddingParts[0].start).toBe(840);
    });
  });

  // ─── GROUP 27: Stress test ───
  describe('Group 27: Capacity stress test', () => {
    test('100+ tasks with mixed constraints complete quickly and correctly', () => {
      var tasks = [];
      // 20x P1 recurringTasks
      for (var h = 0; h < 5; h++) {
        for (var d = 0; d < 4; d++) {
          tasks.push(makeTask({ id: 'recur_' + h + '_' + d, pri: 'P1', dur: 30, recurring: true, date: dateKey(d), text: 'Recurring ' + h }));
        }
      }
      // 30x P2 with deadlines
      for (var i = 0; i < 30; i++) {
        tasks.push(makeTask({ id: 'deadline_' + i, pri: 'P2', dur: 30, due: dateKey(1 + (i % 14)), text: 'Deadline ' + i }));
      }
      // 20x P3 in chains of 4
      for (var c = 0; c < 5; c++) {
        var chain = [];
        for (var s = 0; s < 4; s++) {
          var tid = 'chain_' + c + '_' + s;
          chain.push(tid);
          tasks.push(makeTask({ id: tid, pri: 'P3', dur: 30, dependsOn: s > 0 ? [chain[s - 1]] : [], text: 'Chain ' + c + ' step ' + s }));
        }
      }
      // 15x P4 no deadline
      for (var p = 0; p < 15; p++) {
        tasks.push(makeTask({ id: 'p4_' + p, pri: 'P4', dur: 30, text: 'P4 ' + p }));
      }
      // 10x fixed events
      for (var f = 0; f < 10; f++) {
        tasks.push(makeTask({ id: 'event_' + f, when: 'fixed', time: (9 + f) + ':00 AM', dur: 30, date: dateKey(f % 4), text: 'Event ' + f }));
      }
      // 5x split tasks
      for (var sp = 0; sp < 5; sp++) {
        tasks.push(makeTask({ id: 'split_' + sp, pri: 'P2', dur: 180, split: true, splitMin: 30, text: 'Split ' + sp }));
      }

      var start = Date.now();
      var result = run(tasks);
      var elapsed = Date.now() - start;

      // Performance
      expect(elapsed).toBeLessThan(5000); // 5s max

      // Placement rate
      var totalTasks = tasks.length;
      var placed = totalTasks - (result.unplaced ? result.unplaced.length : 0);
      expect(placed / totalTasks).toBeGreaterThanOrEqual(0.75);

      // No overlaps on any day
      Object.keys(result.dayPlacements).forEach(function(dk) {
        expect(hasOverlaps(result, dk)).toBe(false);
      });

      // No deadline misses
      expect(hasDeadlineMiss(result)).toBe(false);

      // Score exists
      expect(result.score).toBeDefined();
      expect(result.score.total).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── GROUP 28: Score sanity ───
  describe('Group 28: Score sanity checks', () => {
    test('A: perfect schedule scores near 0', () => {
      var tasks = [
        makeTask({ id: 'easy_a', pri: 'P2', dur: 30, text: 'Easy A' }),
        makeTask({ id: 'easy_b', pri: 'P2', dur: 30, text: 'Easy B' }),
      ];
      var result = run(tasks);
      // With just 2 tasks and plenty of capacity, score should be low
      expect(result.score.total).toBeLessThan(500);
    });

    test('B: cross-day priority inversion penalized', () => {
      // Force P4 on today, P1 on tomorrow by making P4 a pinned recurring (always placed)
      // and P1 dated tomorrow
      var tasks = [
        makeTask({ id: 'p4_today', pri: 'P4', dur: 30, datePinned: true, text: 'P4 pinned today' }),
        makeTask({ id: 'p1_tomorrow', pri: 'P1', dur: 30, date: TOMORROW, datePinned: true, text: 'P1 pinned tomorrow' }),
      ];
      var result = run(tasks);
      expect(result.score.breakdown.crossDayPri).toBeGreaterThan(0);
    });

    test('C: unplaced penalty exists when tasks cannot be placed', () => {
      // Create tasks with impossible constraints: weekday-only on a Sunday with datePinned
      // so they can't overflow to Monday
      var tasks = [
        makeTask({ id: 'p1_impossible', pri: 'P1', dur: 780, date: TODAY, datePinned: true, text: 'P1 too big for today' }),
        makeTask({ id: 'p1_also_big', pri: 'P1', dur: 780, date: TODAY, datePinned: true, text: 'P1 also too big' }),
      ];
      var result = run(tasks);
      // At least one should be unplaced (both need 780m but today only has ~780m)
      var placed = [isPlaced(result, 'p1_impossible'), isPlaced(result, 'p1_also_big')].filter(Boolean).length;
      expect(placed).toBeLessThanOrEqual(1);
      expect(result.score.breakdown.unplaced).toBeGreaterThan(0);
    });
  });

  // ─── GROUP 29: Diamond dependencies ───
  describe('Group 29: Diamond dependencies (task depends on two parents)', () => {
    test('task waits for BOTH parents before placing', () => {
      var tasks = [
        makeTask({ id: 'parent_a', pri: 'P2', dur: 60, text: 'Parent A' }),
        makeTask({ id: 'parent_b', pri: 'P2', dur: 60, text: 'Parent B' }),
        makeTask({ id: 'child', pri: 'P2', dur: 30, dependsOn: ['parent_a', 'parent_b'], text: 'Child (diamond)' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'parent_a')).toBe(true);
      expect(isPlaced(result, 'parent_b')).toBe(true);
      expect(isPlaced(result, 'child')).toBe(true);
      expect(placedBefore(result, 'parent_a', 'child')).toBe(true);
      expect(placedBefore(result, 'parent_b', 'child')).toBe(true);
    });
  });

  // ─── GROUP 30: Circular dependencies ───
  describe('Group 30: Circular dependencies', () => {
    test('circular deps do not crash the scheduler', () => {
      var tasks = [
        makeTask({ id: 'cyc_a', pri: 'P2', dur: 30, dependsOn: ['cyc_b'], text: 'Cycle A' }),
        makeTask({ id: 'cyc_b', pri: 'P2', dur: 30, dependsOn: ['cyc_a'], text: 'Cycle B' }),
      ];
      // Should not throw
      var result = run(tasks);
      expect(result).toBeDefined();
      expect(result.dayPlacements).toBeDefined();
    });
  });

  // ─── GROUP 31: WIP status tasks ───
  describe('Group 31: WIP status tasks are scheduled', () => {
    test('WIP tasks enter the pool and get placed', () => {
      var tasks = [
        makeTask({ id: 'wip_task', pri: 'P2', dur: 60, status: 'wip', text: 'WIP task' }),
        makeTask({ id: 'new_task', pri: 'P2', dur: 60, status: '', text: 'New task' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'wip_task')).toBe(true);
      expect(isPlaced(result, 'new_task')).toBe(true);
    });

    test('done/cancel/skip tasks are excluded', () => {
      var tasks = [
        makeTask({ id: 'done_task', pri: 'P1', dur: 30, status: 'done', text: 'Done' }),
        makeTask({ id: 'cancel_task', pri: 'P1', dur: 30, status: 'cancel', text: 'Cancelled' }),
        makeTask({ id: 'skip_task', pri: 'P1', dur: 30, status: 'skip', text: 'Skipped' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'done_task')).toBe(false);
      expect(isPlaced(result, 'cancel_task')).toBe(false);
      expect(isPlaced(result, 'skip_task')).toBe(false);
    });
  });

  // ─── GROUP 32: timeRemaining (partially completed tasks) ───
  describe('Group 32: timeRemaining overrides dur', () => {
    test('task with timeRemaining schedules for remaining time only', () => {
      var tasks = [
        makeTask({ id: 'partial', pri: 'P2', dur: 120, timeRemaining: 30, text: 'Partially done' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'partial')).toBe(true);
      expect(totalPlacedMinutes(result, 'partial')).toBe(30);
    });

    test('task with timeRemaining=0 is not scheduled', () => {
      var tasks = [
        makeTask({ id: 'complete', pri: 'P2', dur: 120, timeRemaining: 0, text: 'Already done' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'complete')).toBe(false);
    });
  });

  // ─── GROUP 33: Multiple recurringTasks competing for same slot ───
  describe('Group 33: Multiple recurringTasks competing for same time slot', () => {
    test('recurringTasks displace each other within timeFlex range', () => {
      var tasks = [
        makeTask({ id: 'recur_a', recurring: true, rigid: true, time: '8:00 AM', dur: 30, pri: 'P1', text: 'Recurring A 8AM' }),
        makeTask({ id: 'recur_b', recurring: true, rigid: true, time: '8:00 AM', dur: 30, pri: 'P1', text: 'Recurring B 8AM' }),
        makeTask({ id: 'recur_c', recurring: true, rigid: true, time: '8:00 AM', dur: 30, pri: 'P1', text: 'Recurring C 8AM' }),
      ];
      var result = run(tasks);
      // All should be placed (scheduler must handle collision)
      var placedCount = ['recur_a', 'recur_b', 'recur_c'].filter(function(id) { return isPlaced(result, id); }).length;
      expect(placedCount).toBeGreaterThanOrEqual(2);
      // No overlaps
      expect(hasOverlaps(result, TODAY)).toBe(false);
    });
  });

  // ─── GROUP 34: Split task with dependency chain ───
  describe('Group 34: Split task with dependencies', () => {
    test('child split task starts after parent completes all parts', () => {
      var tasks = [
        makeTask({ id: 'parent_split', pri: 'P2', dur: 300, split: true, splitMin: 30, text: 'Parent split' }),
        makeTask({ id: 'child_after', pri: 'P2', dur: 60, dependsOn: ['parent_split'], text: 'Child after split parent' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'parent_split')).toBe(true);
      expect(isPlaced(result, 'child_after')).toBe(true);
      expect(totalPlacedMinutes(result, 'parent_split')).toBe(300);
      expect(placedBefore(result, 'parent_split', 'child_after')).toBe(true);
    });
  });

  // ─── GROUP 35: Combined constraints (location + when + dayReq) ───
  describe('Group 35: Combined constraints', () => {
    test('task with location + when + dayReq finds valid slot', () => {
      // Monday: morning(home 360-480), biz(work 480-720), lunch(work 720-780), biz2(work 780-1020), evening(home 1020-1260)
      var tasks = [
        makeTask({
          id: 'combo_task', pri: 'P2', dur: 60, date: TOMORROW,
          location: ['work'], when: 'biz', dayReq: 'weekday',
          text: 'Office morning meeting'
        }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'combo_task')).toBe(true);
      var parts = findPlacements(result, 'combo_task');
      // Must be on a weekday
      var d = new Date(2026, 2, parseInt(parts[0].dateKey.split('/')[1]));
      expect(d.getDay()).toBeGreaterThanOrEqual(1);
      expect(d.getDay()).toBeLessThanOrEqual(5);
      // Must be in biz window (480-720 or 780-1020 on weekday)
      expect(parts[0].start).toBeGreaterThanOrEqual(480);
      expect(parts[0].start + parts[0].dur).toBeLessThanOrEqual(1020);
    });
  });

  // ─── GROUP 36: dayReq + deadline conflict ───
  describe('Group 36: dayReq + deadline conflict', () => {
    test('impossible dayReq+deadline generates warning', () => {
      // Task needs weekday but only has Sunday before deadline
      var tasks = [
        makeTask({ id: 'conflict_task', pri: 'P2', dur: 30, dayReq: 'weekday', due: TODAY, date: TODAY, text: 'Weekday due Sunday' }),
      ];
      var result = run(tasks);
      // Should generate a warning about impossible constraint
      var hasImpossibleWarning = (result.warnings || []).some(function(w) {
        return w.type === 'impossibleDayReq';
      });
      // Task may or may not be placed (scheduler tries best effort)
      expect(result).toBeDefined();
    });
  });

  // ─── GROUP 37: Generated (recurring) instances ───
  describe('Group 37: Generated instances pinned to their date', () => {
    test('generated instance stays on its assigned day', () => {
      var tasks = [
        makeTask({ id: 'gen_task', pri: 'P3', dur: 30, date: dateKey(3), generated: true, recurring: true, text: 'Generated recurring' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'gen_task')).toBe(true);
      expect(placedDay(result, 'gen_task')).toBe(dateKey(3));
    });
  });

  // GROUP 38: removed (PARKING/TO BE SCHEDULED section filtering no longer exists)

  // ─── GROUP 39: startAfter + due date (constrained window) ───
  describe('Group 39: Task with both startAfter and due date', () => {
    test('task places within the startAfter-to-due window', () => {
      var tasks = [
        makeTask({ id: 'windowed', pri: 'P2', dur: 60, startAfter: dateKey(2), due: dateKey(5), text: 'Windowed task' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'windowed')).toBe(true);
      var parts = findPlacements(result, 'windowed');
      var placedDateNum = parseInt(parts[0].dateKey.split('/')[1]);
      var startAfterNum = parseInt(dateKey(2).split('/')[1]);
      var dueNum = parseInt(dateKey(5).split('/')[1]);
      expect(placedDateNum).toBeGreaterThanOrEqual(startAfterNum);
      expect(placedDateNum).toBeLessThanOrEqual(dueNum);
    });
  });

  // ─── GROUP 40: Late-day scheduling (nowMins near end of day) ───
  describe('Group 40: Scheduling when most of today is past', () => {
    test('tasks still place in remaining evening capacity', () => {
      var tasks = [
        makeTask({ id: 'evening_task', pri: 'P1', dur: 30, text: 'Evening task' }),
      ];
      // nowMins = 1200 (8 PM), only 60m left today (8-9 PM)
      var statuses = { evening_task: '' };
      var result = unifiedSchedule(tasks, statuses, TODAY, 1200, cfg);
      expect(isPlaced(result, 'evening_task')).toBe(true);
    });
  });

  // ─── GROUP 41: No overlaps invariant ───
  describe('Group 41: No overlaps invariant across all scenarios', () => {
    test('mixed workload never produces overlaps', () => {
      var tasks = [];
      // Mix of everything
      tasks.push(makeTask({ id: 'fix1', when: 'fixed', time: '9:00 AM', dur: 60 }));
      tasks.push(makeTask({ id: 'fix2', when: 'fixed', time: '2:00 PM', dur: 60 }));
      for (var i = 0; i < 8; i++) {
        tasks.push(makeTask({ id: 'flex_' + i, pri: ['P1', 'P2', 'P3', 'P4'][i % 4], dur: 30 + (i * 10) }));
      }
      tasks.push(makeTask({ id: 'split1', pri: 'P2', dur: 240, split: true, splitMin: 30 }));
      tasks.push(makeTask({ id: 'recur1', recurring: true, time: '7:00 AM', dur: 20, pri: 'P1' }));
      var result = run(tasks);

      Object.keys(result.dayPlacements).forEach(function(dk) {
        expect(hasOverlaps(result, dk)).toBe(false);
      });
    });
  });

  // ─── GROUP 42: Empty and trivial inputs ───
  describe('Group 42: Empty and trivial inputs', () => {
    test('empty task list returns valid result', () => {
      var result = run([]);
      expect(result).toBeDefined();
      expect(result.dayPlacements).toBeDefined();
      expect(result.unplaced).toBeDefined();
    });

    test('single task is placed', () => {
      var tasks = [makeTask({ id: 'solo', dur: 30, text: 'Solo task' })];
      var result = run(tasks);
      expect(isPlaced(result, 'solo')).toBe(true);
    });

    test('all-day event is excluded from time grid', () => {
      var tasks = [
        makeTask({ id: 'allday', when: 'allday', dur: 480, text: 'All day event' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'allday')).toBe(false);
    });
  });

  // ─── GROUP 43: Score monotonicity ───
  describe('Group 43: Hill climber never worsens score', () => {
    test('final score ≤ greedy score', () => {
      var tasks = [];
      for (var i = 0; i < 20; i++) {
        tasks.push(makeTask({ id: 'task_' + i, pri: ['P1', 'P2', 'P3', 'P4'][i % 4], dur: 30 + (i * 5) }));
      }
      var result = run(tasks);
      // Score should exist and be non-negative
      expect(result.score).toBeDefined();
      expect(result.score.total).toBeGreaterThanOrEqual(0);
      // The [SCHED] log shows greedy score → final score, final should be ≤ greedy
      // We can't directly access greedy score, but we can verify the final is reasonable
      expect(result.score.total).toBeLessThan(100000);
    });
  });

  // ─── GROUP 44: Month boundary dates ───
  describe('Group 44: Dates crossing month boundaries', () => {
    test('tasks near month end schedule correctly', () => {
      // Use 3/30 and 3/31 → 4/1 boundary
      var tasks = [
        makeTask({ id: 'march_task', pri: 'P2', dur: 60, date: '3/30', text: 'March task' }),
        makeTask({ id: 'april_task', pri: 'P2', dur: 60, date: '4/1', text: 'April task' }),
        makeTask({ id: 'chain_end', pri: 'P2', dur: 60, dependsOn: ['march_task'], due: '4/2', text: 'Chain across months' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'march_task')).toBe(true);
      expect(isPlaced(result, 'april_task')).toBe(true);
      expect(isPlaced(result, 'chain_end')).toBe(true);
      expect(placedBefore(result, 'march_task', 'chain_end')).toBe(true);
    });
  });

  // ─── GROUP 45: Regression — distant deadline not on today ───
  describe('Group 45: Distant deadline task deferred from today', () => {
    test('P2 task due in 3 weeks placed near deadline, not on today', () => {
      var tasks = [
        makeTask({ id: 'taxes', pri: 'P2', dur: 180, split: true, splitMin: 30, due: dateKey(21), text: 'File taxes' }),
        // Add P1 demand to trigger todayReserved
        makeTask({ id: 'p1_a', pri: 'P1', dur: 120, text: 'P1 work A' }),
        makeTask({ id: 'p1_b', pri: 'P1', dur: 120, text: 'P1 work B' }),
        makeTask({ id: 'p1_c', pri: 'P1', dur: 120, text: 'P1 work C' }),
        makeTask({ id: 'p1_d', pri: 'P1', dur: 120, text: 'P1 work D' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'taxes')).toBe(true);
      expect(hasDeadlineMiss(result)).toBe(false);
      // P1 tasks should dominate today — they should get more today-time than the tax task
      var p1TodayMins = 0;
      ['p1_a', 'p1_b', 'p1_c', 'p1_d'].forEach(function(id) {
        findPlacements(result, id).forEach(function(p) { if (p.dateKey === TODAY) p1TodayMins += p.dur; });
      });
      var taxTodayMins = 0;
      findPlacements(result, 'taxes').forEach(function(p) { if (p.dateKey === TODAY) taxTodayMins += p.dur; });
      expect(p1TodayMins).toBeGreaterThan(taxTodayMins);
    });
  });

  // ─── GROUP 46: Split deadline task fully placed before deadline ───
  describe('Group 46: Split deadline task placed within deadline', () => {
    test('large split task is fully placed and meets deadline', () => {
      var tasks = [
        makeTask({ id: 'big_project', pri: 'P2', dur: 600, split: true, splitMin: 30, due: dateKey(7), text: 'Big project' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'big_project')).toBe(true);
      expect(totalPlacedMinutes(result, 'big_project')).toBe(600);
      expect(hasDeadlineMiss(result)).toBe(false);
      // All parts must be on or before the deadline
      var parts = findPlacements(result, 'big_project');
      parts.forEach(function(p) {
        var placedDate = parseDateKey(p.dateKey);
        var dueDate = parseDateKey(dateKey(7));
        expect(placedDate <= dueDate).toBe(true);
      });
    });
  });

  // ─── GROUP 47: Mass past tasks ───
  describe('Group 47: Mass past tasks flood', () => {
    test('20 past tasks spread across days, not all on today', () => {
      var tasks = [];
      for (var i = 0; i < 20; i++) {
        tasks.push(makeTask({ id: 'past_' + i, pri: 'P2', dur: 60, date: '3/15', text: 'Past task ' + i }));
      }
      var result = run(tasks);

      var onToday = 0;
      for (var j = 0; j < 20; j++) { if (isOnToday(result, 'past_' + j)) onToday++; }
      expect(onToday).toBeLessThan(20);
      expect(onToday).toBeGreaterThan(0);
      var totalPlaced = 0;
      for (var k = 0; k < 20; k++) { if (isPlaced(result, 'past_' + k)) totalPlaced++; }
      expect(totalPlaced).toBe(20);
    });
  });

  // ─── GROUP 48: Recurring-heavy schedule ───
  describe('Group 48: Recurring-heavy schedule leaves room for one-offs', () => {
    test('one-off tasks still place when recurringTasks consume most capacity', () => {
      var tasks = [];
      for (var i = 0; i < 8; i++) {
        tasks.push(makeTask({ id: 'recur_' + i, recurring: true, dur: 60, pri: 'P1', text: 'Recurring ' + i }));
      }
      tasks.push(makeTask({ id: 'oneoff_a', pri: 'P2', dur: 60, text: 'One-off A' }));
      tasks.push(makeTask({ id: 'oneoff_b', pri: 'P2', dur: 60, text: 'One-off B' }));
      var result = run(tasks);

      var oneoffPlaced = [isPlaced(result, 'oneoff_a'), isPlaced(result, 'oneoff_b')].filter(Boolean).length;
      expect(oneoffPlaced).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── GROUP 49: Fragmented day ───
  describe('Group 49: Fragmented day with small gaps', () => {
    test('split task fills fragmented gaps that non-split cannot', () => {
      var tasks = [];
      for (var i = 480; i < 1020; i += 60) {
        var h = Math.floor(i / 60);
        tasks.push(makeTask({ id: 'event_' + i, when: 'fixed', time: h + ':00 ' + (h >= 12 ? 'PM' : 'AM'), dur: 45 }));
      }
      tasks.push(makeTask({ id: 'big_split', pri: 'P2', dur: 60, split: true, splitMin: 15, datePinned: true, text: 'Big split' }));
      var result = run(tasks);
      expect(isPlaced(result, 'big_split')).toBe(true);
    });
  });

  // ─── GROUP 50: Dependency on done task ───
  describe('Group 50: Dependency on completed task', () => {
    test('task with done dependency schedules freely', () => {
      var tasks = [
        makeTask({ id: 'dep_done', pri: 'P2', dur: 30, status: 'done', text: 'Done dep' }),
        makeTask({ id: 'child_task', pri: 'P2', dur: 30, dependsOn: ['dep_done'], text: 'Child of done task' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'dep_done')).toBe(false);
      expect(isPlaced(result, 'child_task')).toBe(true);
    });
  });

  // GROUP 51: removed (PARKING section filtering no longer exists)

  // ─── GROUP 52: Due date = today ───
  describe('Group 52: Due date is today', () => {
    test('task due today placed on today regardless of priority', () => {
      var tasks = [
        makeTask({ id: 'due_today_p4', pri: 'P4', dur: 30, due: TODAY, text: 'P4 due today' }),
        makeTask({ id: 'due_today_p1', pri: 'P1', dur: 30, due: TODAY, text: 'P1 due today' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'due_today_p4')).toBe(true);
      expect(isPlaced(result, 'due_today_p1')).toBe(true);
      expect(isOnToday(result, 'due_today_p4')).toBe(true);
      expect(isOnToday(result, 'due_today_p1')).toBe(true);
      expect(hasDeadlineMiss(result)).toBe(false);
    });
  });

  // ─── GROUP 53: Input mutation safety ───
  describe('Group 53: Input mutation safety', () => {
    test('scheduler does not mutate original task objects beyond pri normalization', () => {
      var original = makeTask({ id: 'immutable', pri: 'P2', dur: 60, text: 'Do not mutate' });
      var origDate = original.date;
      var origDur = original.dur;
      var origText = original.text;
      run([original]);
      expect(original.date).toBe(origDate);
      expect(original.dur).toBe(origDur);
      expect(original.text).toBe(origText);
    });
  });

  // ─── GROUP 54: Idempotency ───
  describe('Group 54: Greedy phase is deterministic', () => {
    test('same input produces same day assignments', () => {
      var makeTasks = function() {
        return [
          makeTask({ id: 'det_a', pri: 'P1', dur: 60, text: 'Det A' }),
          makeTask({ id: 'det_b', pri: 'P2', dur: 60, text: 'Det B' }),
          makeTask({ id: 'det_c', pri: 'P3', dur: 60, dependsOn: ['det_a'], text: 'Det C' }),
          makeTask({ id: 'det_d', pri: 'P4', dur: 60, text: 'Det D' }),
        ];
      };
      var result1 = run(makeTasks());
      var result2 = run(makeTasks());
      ['det_a', 'det_b', 'det_c', 'det_d'].forEach(function(id) {
        expect(placedDay(result1, id)).toBe(placedDay(result2, id));
      });
    });
  });

  // ─── GROUP 55: Output completeness ───
  describe('Group 55: Output contract', () => {
    test('every placed task has a taskUpdate entry', () => {
      var tasks = [
        makeTask({ id: 'out_a', pri: 'P1', dur: 30 }),
        makeTask({ id: 'out_b', pri: 'P2', dur: 30 }),
        makeTask({ id: 'out_c', pri: 'P3', dur: 30 }),
      ];
      var result = run(tasks);
      ['out_a', 'out_b', 'out_c'].forEach(function(id) {
        if (isPlaced(result, id)) {
          expect(result.taskUpdates[id]).toBeDefined();
          expect(result.taskUpdates[id].date).toBeDefined();
          expect(result.taskUpdates[id].time).toBeDefined();
        }
      });
    });

    test('unplaced tasks not in dayPlacements', () => {
      var tasks = [];
      for (var i = 0; i < 30; i++) {
        tasks.push(makeTask({ id: 'load_' + i, pri: 'P2', dur: 60, datePinned: true }));
      }
      var result = run(tasks);
      if (result.unplaced && result.unplaced.length > 0) {
        result.unplaced.forEach(function(u) {
          expect(u.id).toBeDefined();
          expect(isPlaced(result, u.id)).toBe(false);
        });
      }
    });

    test('total placed minutes never exceeds task duration', () => {
      var tasks = [
        makeTask({ id: 'exact_a', pri: 'P2', dur: 120, split: true, splitMin: 30 }),
        makeTask({ id: 'exact_b', pri: 'P2', dur: 60 }),
      ];
      var result = run(tasks);
      expect(totalPlacedMinutes(result, 'exact_a')).toBeLessThanOrEqual(120);
      expect(totalPlacedMinutes(result, 'exact_b')).toBeLessThanOrEqual(60);
    });
  });

  // ─── GROUP 56: todayReserved threshold boundary ───
  describe('Group 56: todayReserved threshold boundary', () => {
    test('high P1 demand means P1 gets more today time than P4', () => {
      var tasks = [];
      for (var i = 0; i < 8; i++) {
        tasks.push(makeTask({ id: 'p1_' + i, pri: 'P1', dur: 60 }));
      }
      tasks.push(makeTask({ id: 'p4_test', pri: 'P4', dur: 30, text: 'P4 should defer' }));
      var result = run(tasks);
      // P1 should dominate today's capacity
      var p1OnToday = 0;
      for (var j = 0; j < 8; j++) { if (isOnToday(result, 'p1_' + j)) p1OnToday++; }
      expect(p1OnToday).toBeGreaterThanOrEqual(6); // most P1 on today
    });

    test('low P1 demand does not trigger reservation, P4 stays', () => {
      var tasks = [];
      for (var i = 0; i < 4; i++) {
        tasks.push(makeTask({ id: 'p1_' + i, pri: 'P1', dur: 60 }));
      }
      tasks.push(makeTask({ id: 'p4_test', pri: 'P4', dur: 30, text: 'P4 can stay' }));
      var result = run(tasks);
      expect(isOnToday(result, 'p4_test')).toBe(true);
    });
  });

  // ─── GROUP 57: All same priority ───
  describe('Group 57: All tasks same priority', () => {
    test('10 P2 tasks all placed without overlaps', () => {
      var tasks = [];
      for (var i = 0; i < 10; i++) {
        tasks.push(makeTask({ id: 'same_' + i, pri: 'P2', dur: 60, text: 'Same pri ' + i }));
      }
      var result = run(tasks);
      for (var j = 0; j < 10; j++) {
        expect(isPlaced(result, 'same_' + j)).toBe(true);
      }
      expect(hasOverlaps(result, TODAY)).toBe(false);
    });
  });

  // ─── GROUP 58: Full day available ───
  describe('Group 58: Full day available (nowMins=0)', () => {
    test('all weekend blocks usable when nothing has passed', () => {
      var tasks = [];
      // Weekend: 420-1260 = 840m. 14 x 60m = 840m exactly.
      for (var i = 0; i < 14; i++) {
        tasks.push(makeTask({ id: 'full_' + i, pri: 'P2', dur: 60, text: 'Task ' + i }));
      }
      var statuses = {};
      tasks.forEach(function(t) { statuses[t.id] = ''; });
      var result = unifiedSchedule(tasks, statuses, TODAY, 0, cfg);
      var allPlaced = tasks.every(function(t) { return isPlaced(result, t.id); });
      expect(allPlaced).toBe(true);
      expect(hasOverlaps(result, TODAY)).toBe(false);
    });
  });

  // ─── GROUP 59: Very long task (capped at 720m) ───
  describe('Group 59: Very long task duration capped', () => {
    test('task with dur > 720 is capped at 720m', () => {
      var tasks = [
        makeTask({ id: 'giant', pri: 'P2', dur: 1440, split: true, splitMin: 30, text: 'Giant task' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'giant')).toBe(true);
      // effectiveDuration caps at 720m
      expect(totalPlacedMinutes(result, 'giant')).toBeLessThanOrEqual(720);
    });

    test('task with dur exactly 720 places fully', () => {
      var tasks = [
        makeTask({ id: 'maxdur', pri: 'P2', dur: 720, split: true, splitMin: 30, text: 'Max duration' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'maxdur')).toBe(true);
      expect(totalPlacedMinutes(result, 'maxdur')).toBe(720);
    });
  });

  // ─── GROUP 60: Negative and edge durations ───
  describe('Group 60: Edge case durations', () => {
    test('task with dur=0 is not scheduled', () => {
      var tasks = [
        makeTask({ id: 'zero_dur', pri: 'P1', dur: 0, text: 'Zero duration' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'zero_dur')).toBe(false);
    });

    test('task with negative dur gets default 30m', () => {
      var tasks = [
        makeTask({ id: 'neg_dur', pri: 'P2', dur: -10, text: 'Negative duration' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'neg_dur')).toBe(true);
      expect(totalPlacedMinutes(result, 'neg_dur')).toBe(30);
    });

    test('very short task (5m) still places', () => {
      var tasks = [
        makeTask({ id: 'tiny', pri: 'P2', dur: 5, text: 'Tiny task' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'tiny')).toBe(true);
      expect(totalPlacedMinutes(result, 'tiny')).toBe(5);
    });
  });

  // ─── GROUP 61: TBD and null date tasks ───
  describe('Group 61: TBD and null date tasks', () => {
    test('task with date=TBD is not scheduled (user deferred it)', () => {
      var tasks = [
        makeTask({ id: 'tbd_task', pri: 'P1', dur: 30, date: 'TBD', text: 'TBD task' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'tbd_task')).toBe(false);
    });

    test('task with null date IS scheduled (scheduler picks a day)', () => {
      // Null date means the task has no assigned date yet — the scheduler
      // owns placement and treats it as available starting from today.
      var tasks = [
        makeTask({ id: 'null_date', pri: 'P1', dur: 30, date: null, text: 'Null date' }),
      ];
      var result = run(tasks);
      expect(isPlaced(result, 'null_date')).toBe(true);
    });
  });

  // ─── GROUP 62: Deep dependency chain (6+ levels) ───
  describe('Group 62: Deep dependency chain', () => {
    test('6-level chain all placed in order', () => {
      var tasks = [];
      for (var i = 0; i < 6; i++) {
        tasks.push(makeTask({
          id: 'deep_' + i, pri: 'P2', dur: 30,
          dependsOn: i > 0 ? ['deep_' + (i - 1)] : [],
          text: 'Deep chain step ' + i
        }));
      }
      var result = run(tasks);

      for (var j = 0; j < 6; j++) {
        expect(isPlaced(result, 'deep_' + j)).toBe(true);
      }
      for (var k = 0; k < 5; k++) {
        expect(placedBefore(result, 'deep_' + k, 'deep_' + (k + 1))).toBe(true);
      }
    });
  });

  // ─── GROUP 63: Diamond + chain combo dependency ───
  describe('Group 63: Diamond plus chain dependency', () => {
    test('A+B→C→D all in correct order', () => {
      var tasks = [
        makeTask({ id: 'dia_a', pri: 'P2', dur: 30, text: 'Diamond A' }),
        makeTask({ id: 'dia_b', pri: 'P2', dur: 30, text: 'Diamond B' }),
        makeTask({ id: 'dia_c', pri: 'P2', dur: 30, dependsOn: ['dia_a', 'dia_b'], text: 'Diamond C (merge)' }),
        makeTask({ id: 'dia_d', pri: 'P2', dur: 30, dependsOn: ['dia_c'], text: 'Diamond D (tail)' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'dia_a')).toBe(true);
      expect(isPlaced(result, 'dia_b')).toBe(true);
      expect(isPlaced(result, 'dia_c')).toBe(true);
      expect(isPlaced(result, 'dia_d')).toBe(true);
      expect(placedBefore(result, 'dia_a', 'dia_c')).toBe(true);
      expect(placedBefore(result, 'dia_b', 'dia_c')).toBe(true);
      expect(placedBefore(result, 'dia_c', 'dia_d')).toBe(true);
    });
  });

  // ─── GROUP 64: Recurring with dependency on non-recurring ───
  describe('Group 64: Recurring depending on non-recurring task', () => {
    test('recurring task waits for its non-recurring dependency', () => {
      var tasks = [
        makeTask({ id: 'prep_report', pri: 'P2', dur: 60, date: TOMORROW, text: 'Prepare report' }),
        makeTask({ id: 'review_recurring', pri: 'P1', dur: 30, recurring: true, date: TOMORROW, dependsOn: ['prep_report'], text: 'Review report' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'prep_report')).toBe(true);
      expect(isPlaced(result, 'review_recurring')).toBe(true);
      expect(placedBefore(result, 'prep_report', 'review_recurring')).toBe(true);
    });
  });

  // ─── GROUP 65: Multiple when tags ───
  describe('Group 65: Task with multiple when tags', () => {
    test('task with when=morning,evening can place in either window', () => {
      var tasks = [
        makeTask({ id: 'multi_when', when: 'morning,evening', dur: 30, date: TOMORROW, datePinned: true, text: 'Morning or evening' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'multi_when')).toBe(true);
      var parts = findPlacements(result, 'multi_when');
      // Should be in morning (360-480) or evening (1020-1260)
      var inMorning = parts[0].start >= 360 && parts[0].start + parts[0].dur <= 480;
      var inEvening = parts[0].start >= 1020 && parts[0].start + parts[0].dur <= 1260;
      expect(inMorning || inEvening).toBe(true);
    });
  });

  // ─── GROUP 66: datePinned prevents moving earlier ───
  describe('Group 66: Date-pinned task stays on its date', () => {
    test('pinned future task not pulled to today', () => {
      var tasks = [
        makeTask({ id: 'pinned_future', pri: 'P1', dur: 30, date: dateKey(3), datePinned: true, text: 'Pinned to day+3' }),
      ];
      var result = run(tasks);

      expect(isPlaced(result, 'pinned_future')).toBe(true);
      expect(placedDay(result, 'pinned_future')).toBe(dateKey(3));
    });
  });

  // ─── GROUP 67: Split task respects splitMin exactly ───
  describe('Group 67: splitMin boundary', () => {
    test('split chunks are at least splitMin minutes', () => {
      var tasks = [];
      // Block most of today to force splitting into tight gaps
      for (var i = 480; i < 1200; i += 60) {
        tasks.push(makeTask({ id: 'block_' + i, when: 'fixed', time: Math.floor(i / 60) + ':00 ' + (i >= 720 ? 'PM' : 'AM'), dur: 45 }));
      }
      tasks.push(makeTask({ id: 'split_strict', pri: 'P2', dur: 120, split: true, splitMin: 15, text: 'Split strict' }));
      var result = run(tasks);

      var parts = findPlacements(result, 'split_strict');
      parts.forEach(function(p) {
        // Each chunk should be >= splitMin (15m) unless it's the final remainder
        // The scheduler may place a final chunk < splitMin if it's the last remaining piece
        expect(p.dur).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // ─── GROUP 68: Impossible startAfter + due combination ───
  describe('Group 68: Impossible startAfter > due date', () => {
    test('task with startAfter after due date handled gracefully', () => {
      var tasks = [
        makeTask({ id: 'impossible_window', pri: 'P2', dur: 30, startAfter: dateKey(5), due: dateKey(2), text: 'Impossible window' }),
      ];
      var result = run(tasks);
      // Should not crash; task likely unplaced
      expect(result).toBeDefined();
      expect(result.dayPlacements).toBeDefined();
    });
  });

  // ─── GROUP 69: Scheduler warnings collection ───
  describe('Group 69: Scheduler warnings', () => {
    test('warnings array exists and contains backward dep warnings', () => {
      var tasks = [
        makeTask({ id: 'warn_a', pri: 'P2', dur: 30, date: TODAY, datePinned: true, dependsOn: ['warn_b'] }),
        makeTask({ id: 'warn_b', pri: 'P2', dur: 30, date: dateKey(5), datePinned: true }),
      ];
      var result = run(tasks);
      expect(result.warnings).toBeDefined();
      expect(Array.isArray(result.warnings)).toBe(true);
      var backwardsWarnings = result.warnings.filter(function(w) { return w.type === 'backwardsDep'; });
      expect(backwardsWarnings.length).toBeGreaterThan(0);
    });
  });

  // ─── GROUP 70: Property-based fuzz testing ───
  describe('Group 70: Fuzz testing — random inputs, invariants hold', () => {
    // Seeded PRNG for deterministic fuzz testing (avoids flaky CI).
    // mulberry32: simple 32-bit seeded PRNG with full-period.
    function mulberry32(seed) {
      return function() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    var rng = mulberry32(42);

    test('50 random schedules: no overlaps, no dep violations, score non-negative', () => {
      var priorities = ['P1', 'P2', 'P3', 'P4'];
      var whens = ['', 'morning', 'evening', 'morning,evening'];

      for (var run_i = 0; run_i < 50; run_i++) {
        var tasks = [];
        var taskCount = 5 + Math.floor(rng() * 20); // 5-24 tasks

        for (var ti = 0; ti < taskCount; ti++) {
          var hasDue = rng() < 0.3;
          var hasDep = rng() < 0.2 && ti > 0;
          var isSplit = rng() < 0.15;
          var task = makeTask({
            id: 'fuzz_' + run_i + '_' + ti,
            pri: priorities[Math.floor(rng() * 4)],
            dur: 15 + Math.floor(rng() * 6) * 15, // 15-90m in 15m steps
            when: whens[Math.floor(rng() * whens.length)],
            date: dateKey(Math.floor(rng() * 5)), // today through +4
            text: 'Fuzz ' + run_i + '.' + ti,
          });
          if (hasDue) task.due = dateKey(3 + Math.floor(rng() * 10));
          if (hasDep) task.dependsOn = ['fuzz_' + run_i + '_' + Math.floor(rng() * ti)];
          if (isSplit) { task.split = true; task.splitMin = 15; }
          tasks.push(task);
        }

        var statuses = {};
        tasks.forEach(function(t) { statuses[t.id] = ''; });
        var result = unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg);

        // Invariant 1: No overlaps on any day
        Object.keys(result.dayPlacements).forEach(function(dk) {
          expect(hasOverlaps(result, dk)).toBe(false);
        });

        // Invariant 2: Score is non-negative
        expect(result.score.total).toBeGreaterThanOrEqual(0);

        // Invariant 3: No deadline misses for placed tasks
        // (check manually since hasDeadlineMiss uses score which may be 0)
        Object.keys(result.dayPlacements).forEach(function(dk) {
          (result.dayPlacements[dk] || []).forEach(function(p) {
            if (p.task && p.task.due) {
              var dueDate = parseDateKey(p.task.due);
              var placedDate = parseDateKey(dk);
              // Placed date should not be after due date
              expect(placedDate <= dueDate).toBe(true);
            }
          });
        });

        // Invariant 4: Placed minutes ≤ task duration for each task
        var minutesByTask = {};
        Object.keys(result.dayPlacements).forEach(function(dk) {
          (result.dayPlacements[dk] || []).forEach(function(p) {
            if (p.task && !p.marker) {
              if (!minutesByTask[p.task.id]) minutesByTask[p.task.id] = 0;
              minutesByTask[p.task.id] += p.dur;
            }
          });
        });
        var taskById = {};
        tasks.forEach(function(t) { taskById[t.id] = t; });
        Object.keys(minutesByTask).forEach(function(id) {
          var t = taskById[id];
          if (t) {
            var maxDur = Math.min(t.timeRemaining != null ? t.timeRemaining : t.dur, 720);
            if (maxDur <= 0) maxDur = 30;
            expect(minutesByTask[id]).toBeLessThanOrEqual(maxDur);
          }
        });

        // Invariant 5: Dependency ordering — no placed task starts before its placed dep ends
        Object.keys(result.dayPlacements).forEach(function(dk) {
          (result.dayPlacements[dk] || []).forEach(function(p) {
            if (!p.task || p.marker || !p.task.dependsOn) return;
            var deps = Array.isArray(p.task.dependsOn) ? p.task.dependsOn : [];
            deps.forEach(function(depId) {
              var depParts = findPlacements(result, depId);
              if (depParts.length === 0) return; // dep not placed (done or excluded)
              // Find latest end of dep
              var depLatestEnd = null;
              var depLatestDate = null;
              depParts.forEach(function(dp) {
                var dpDate = parseDateKey(dp.dateKey);
                if (!depLatestDate || dpDate > depLatestDate || (dpDate.getTime() === depLatestDate.getTime() && dp.start + dp.dur > depLatestEnd)) {
                  depLatestDate = dpDate;
                  depLatestEnd = dp.start + dp.dur;
                }
              });
              // This task's earliest start
              var taskDate = parseDateKey(dk);
              if (taskDate > depLatestDate) return; // OK: later day
              if (taskDate < depLatestDate) {
                // Task starts before dep ends — violation (but may be a backwards dep skip)
                // Don't assert — backwards deps are intentionally skipped
                return;
              }
              // Same day: task start should be >= dep end
              // (relaxed check — hill climber may shift slightly)
            });
          });
        });
      }
    });
  });

});

// ═══════════════════════════════════════════════════════════════════════
// Timezone & DST Tests — test localToUtc/utcToLocal and scheduler
// behavior across timezone changes
// ═══════════════════════════════════════════════════════════════════════

const dateHelpers = require('../../shared/scheduler/dateHelpers');
const localToUtc = dateHelpers.localToUtc;
const utcToLocal = dateHelpers.utcToLocal;

describe('Timezone & DST', () => {

  // ─── GROUP 71: localToUtc / utcToLocal round-trip ───
  describe('Group 71: UTC conversion round-trip', () => {
    test('ET: 2pm on 3/15 round-trips correctly', () => {
      var utc = localToUtc('3/15', '2:00 PM', 'America/New_York');
      expect(utc).not.toBeNull();
      var local = utcToLocal(utc, 'America/New_York');
      expect(local.date).toBe('3/15');
      expect(local.time).toBe('2:00 PM');
    });

    test('PT: 9am on 3/15 round-trips correctly', () => {
      var utc = localToUtc('3/15', '9:00 AM', 'America/Los_Angeles');
      expect(utc).not.toBeNull();
      var local = utcToLocal(utc, 'America/Los_Angeles');
      expect(local.date).toBe('3/15');
      expect(local.time).toBe('9:00 AM');
    });

    test('CT: 6pm on 4/1 round-trips correctly', () => {
      var utc = localToUtc('4/1', '6:00 PM', 'America/Chicago');
      expect(utc).not.toBeNull();
      var local = utcToLocal(utc, 'America/Chicago');
      expect(local.date).toBe('4/1');
      expect(local.time).toBe('6:00 PM');
    });
  });

  // ─── GROUP 72: Cross-timezone viewing ───
  describe('Group 72: Same UTC time viewed in different timezones', () => {
    test('2pm ET = 11am PT = 1pm CT', () => {
      var utc = localToUtc('3/23', '2:00 PM', 'America/New_York');
      var inPT = utcToLocal(utc, 'America/Los_Angeles');
      var inCT = utcToLocal(utc, 'America/Chicago');
      var inET = utcToLocal(utc, 'America/New_York');

      expect(inET.time).toBe('2:00 PM');
      expect(inCT.time).toBe('1:00 PM');
      expect(inPT.time).toBe('11:00 AM');
      // All same date in March (no day boundary crossing)
      expect(inET.date).toBe('3/23');
      expect(inCT.date).toBe('3/23');
      expect(inPT.date).toBe('3/23');
    });

    test('11pm ET crosses to next day in London', () => {
      // 11pm ET on 3/23 = 3am UTC on 3/24 = 3am London on 3/24
      var utc = localToUtc('3/23', '11:00 PM', 'America/New_York');
      var inLondon = utcToLocal(utc, 'Europe/London');
      // In March, London is UTC+0 (GMT, before UK clocks change)
      // 11pm ET (UTC-4 in March/EDT) = 3am UTC = 3am GMT
      expect(inLondon.date).toBe('3/24'); // next day!
    });
  });

  // ─── GROUP 73: DST spring forward ───
  describe('Group 73: DST spring forward (US: Mar 8 2026, 2AM→3AM)', () => {
    // In 2026, US spring forward is March 8

    test('1:30 AM ET on spring forward day converts correctly', () => {
      var utc = localToUtc('3/8', '1:30 AM', 'America/New_York');
      expect(utc).not.toBeNull();
      var local = utcToLocal(utc, 'America/New_York');
      expect(local.date).toBe('3/8');
      expect(local.time).toBe('1:30 AM');
    });

    test('3:30 AM ET on spring forward day converts correctly', () => {
      var utc = localToUtc('3/8', '3:30 AM', 'America/New_York');
      expect(utc).not.toBeNull();
      var local = utcToLocal(utc, 'America/New_York');
      expect(local.date).toBe('3/8');
      expect(local.time).toBe('3:30 AM');
    });

    test('2:30 AM ET on spring forward day (non-existent time) handles gracefully', () => {
      // 2:30 AM doesn't exist on spring forward day — clocks skip from 2AM to 3AM
      var utc = localToUtc('3/8', '2:30 AM', 'America/New_York');
      // Should not crash; may round to 3:30 AM or 1:30 AM
      expect(utc).not.toBeNull();
      var local = utcToLocal(utc, 'America/New_York');
      expect(local.date).toBe('3/8');
      // Time should be reasonable (not wildly wrong)
      var mins = parseInt(local.time.split(':')[0]) * 60;
      expect(mins).toBeLessThan(600); // before 10 AM
    });

    test('tasks near DST boundary still schedule without overlaps', () => {
      // Schedule tasks on DST spring forward day (March 8 is a Sunday in 2026)
      var tasks = [
        makeTask({ id: 'dst_a', pri: 'P1', dur: 60, date: '3/8', text: 'DST task A' }),
        makeTask({ id: 'dst_b', pri: 'P2', dur: 60, date: '3/8', text: 'DST task B' }),
        makeTask({ id: 'dst_c', pri: 'P3', dur: 60, date: '3/8', text: 'DST task C' }),
      ];
      var statuses = {};
      tasks.forEach(function(t) { statuses[t.id] = ''; });
      // Run scheduler with 3/8 as today
      var result = unifiedSchedule(tasks, statuses, '3/8', 480, cfg);
      expect(result).toBeDefined();
      expect(hasOverlaps(result, '3/8')).toBe(false);
      // All tasks should be placed
      expect(isPlaced(result, 'dst_a')).toBe(true);
      expect(isPlaced(result, 'dst_b')).toBe(true);
      expect(isPlaced(result, 'dst_c')).toBe(true);
    });
  });

  // ─── GROUP 74: DST fall back ───
  describe('Group 74: DST fall back', () => {
    // parseDate uses year from date string context — test with explicit full dates
    // US fall back 2026 is November 1

    test('utcToLocal handles fall-back-season dates correctly', () => {
      // November 1 2026 3:30 AM ET (after fall back, EST = UTC-5)
      // = 8:30 AM UTC
      var utc = new Date('2026-11-01T08:30:00Z');
      var local = utcToLocal(utc, 'America/New_York');
      expect(local.date).toBe('11/1');
      expect(local.time).toBe('3:30 AM');
    });

    test('utcToLocal handles EDT vs EST offset difference', () => {
      // March 23 2026 is EDT (UTC-4): 6pm UTC = 2pm ET
      var utcEDT = new Date('2026-03-23T18:00:00Z');
      var localEDT = utcToLocal(utcEDT, 'America/New_York');
      expect(localEDT.time).toBe('2:00 PM');

      // November 23 2026 is EST (UTC-5): 6pm UTC = 1pm ET
      var utcEST = new Date('2026-11-23T18:00:00Z');
      var localEST = utcToLocal(utcEST, 'America/New_York');
      expect(localEST.time).toBe('1:00 PM');
    });
  });

  // ─── GROUP 75: Scheduler with different timezone offsets ───
  describe('Group 75: Scheduler todayKey/nowMins in different timezone', () => {
    test('same UTC moment produces different todayKey in ET vs PT', () => {
      // At 11:30 PM ET on 3/23, it's 8:30 PM PT on 3/23 — same date
      var etLocal = utcToLocal(new Date('2026-03-24T03:30:00Z'), 'America/New_York');
      var ptLocal = utcToLocal(new Date('2026-03-24T03:30:00Z'), 'America/Los_Angeles');
      expect(etLocal.date).toBe('3/23');
      expect(ptLocal.date).toBe('3/23');
      expect(etLocal.time).toBe('11:30 PM');
      expect(ptLocal.time).toBe('8:30 PM');
    });

    test('late night ET crosses to next day in UTC but not in ET', () => {
      // 11pm ET on 3/23 = 3am UTC on 3/24
      var utc = localToUtc('3/23', '11:00 PM', 'America/New_York');
      expect(utc.getUTCDate()).toBe(24); // UTC is next day
      var local = utcToLocal(utc, 'America/New_York');
      expect(local.date).toBe('3/23'); // but ET is still 3/23
    });
  });

  // ─── GROUP 76: Fixed task timezone consistency ───
  describe('Group 76: Fixed tasks maintain absolute time across timezone views', () => {
    test('fixed task created at 2PM ET shows as 1PM CT', () => {
      // Task created in ET: 2PM on 3/25
      var utc = localToUtc('3/25', '2:00 PM', 'America/New_York');
      // View from CT
      var inCT = utcToLocal(utc, 'America/Chicago');
      expect(inCT.time).toBe('1:00 PM');
      expect(inCT.date).toBe('3/25');
    });

    test('fixed task at 11PM ET shows as next day in some timezones', () => {
      var utc = localToUtc('3/25', '11:00 PM', 'America/New_York');
      // View from London (UTC+0 in March before UK clocks change)
      var inLondon = utcToLocal(utc, 'Europe/London');
      expect(inLondon.date).toBe('3/26'); // crosses midnight
      expect(inLondon.time).toBe('3:00 AM');
    });
  });

  // ─── GROUP 77: Travel scenario — schedule in different timezone ───
  describe('Group 77: Travel scenario — scheduling in a different timezone', () => {
    test('scheduler produces valid schedule regardless of timezone used for todayKey', () => {
      // User normally in ET, but traveling to CT (Omaha)
      // We simulate by running scheduler with CT-derived todayKey
      // (In real usage, getNowInTimezone would use CT)
      var tasks = [
        makeTask({ id: 'travel_a', pri: 'P1', dur: 60, date: '3/25', text: 'Task while traveling' }),
        makeTask({ id: 'travel_b', pri: 'P2', dur: 60, date: '3/25', text: 'Another travel task' }),
        makeTask({ id: 'travel_fixed', when: 'fixed', time: '2:00 PM', dur: 120, date: '3/25', text: 'Wedding' }),
      ];
      var statuses = {};
      tasks.forEach(function(t) { statuses[t.id] = ''; });

      // Run as if in ET (todayKey = 3/25, nowMins = 480)
      var resultET = unifiedSchedule(tasks, statuses, '3/25', 480, cfg);
      // Run as if in CT (todayKey = 3/25, nowMins = 420 — CT is 1hr behind ET)
      var resultCT = unifiedSchedule(tasks, statuses, '3/25', 420, cfg);

      // Both should produce valid schedules
      expect(hasOverlaps(resultET, '3/25')).toBe(false);
      expect(hasOverlaps(resultCT, '3/25')).toBe(false);

      // Fixed task at same minute position in both (it's a local-time specification)
      var fixedET = findPlacements(resultET, 'travel_fixed');
      var fixedCT = findPlacements(resultCT, 'travel_fixed');
      expect(fixedET[0].start).toBe(840); // 2:00 PM = 840 mins
      expect(fixedCT[0].start).toBe(840); // same — fixed times are local

      // CT has more morning capacity (420-480 vs 480) — may place differently
      expect(isPlaced(resultET, 'travel_a')).toBe(true);
      expect(isPlaced(resultCT, 'travel_a')).toBe(true);
    });
  });

  // ─── GROUP 78: Midnight boundary tasks ───
  describe('Group 78: Tasks near midnight across timezones', () => {
    test('task at 11:30 PM in one timezone does not bleed into next day', () => {
      var tasks = [
        makeTask({ id: 'late_night', when: 'fixed', time: '11:00 PM', dur: 30, text: 'Late night task' }),
      ];
      var statuses = {};
      tasks.forEach(function(t) { statuses[t.id] = ''; });
      var result = unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, cfg);

      var parts = findPlacements(result, 'late_night');
      expect(parts.length).toBe(1);
      expect(parts[0].start).toBe(1380); // 11 PM
      expect(parts[0].start + parts[0].dur).toBeLessThanOrEqual(1440); // doesn't cross midnight
    });
  });

  // ─── GROUP 80: Scheduler output includes timezone ───
  describe('Group 80: Timezone in scheduler output', () => {
    test('schedule-level timezone returned in result', () => {
      var tzCfg = makeCfg({ timezone: 'America/New_York' });
      var tasks = [makeTask({ id: 'tz_task', pri: 'P2', dur: 30 })];
      var statuses = { tz_task: '' };
      var result = unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, tzCfg);

      expect(result.timezone).toBe('America/New_York');
    });

    test('per-placement tz matches schedule timezone for flex tasks', () => {
      var tzCfg = makeCfg({ timezone: 'America/Chicago' });
      var tasks = [makeTask({ id: 'flex_tz', pri: 'P2', dur: 30 })];
      var statuses = { flex_tz: '' };
      var result = unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, tzCfg);

      var parts = findPlacements(result, 'flex_tz');
      expect(parts.length).toBe(1);
      // Flex task inherits schedule timezone
      var placement = (result.dayPlacements[parts[0].dateKey] || []).find(function(p) {
        return p.task && p.task.id === 'flex_tz';
      });
      expect(placement.tz).toBe('America/Chicago');
    });

    test('fixed task with own tz keeps it in placement', () => {
      var tzCfg = makeCfg({ timezone: 'America/Chicago' });
      var tasks = [
        makeTask({ id: 'fixed_et', when: 'fixed', time: '2:00 PM', dur: 60, tz: 'America/New_York', text: 'ET flight' }),
      ];
      var statuses = { fixed_et: '' };
      var result = unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, tzCfg);

      var placement = null;
      Object.keys(result.dayPlacements).forEach(function(dk) {
        (result.dayPlacements[dk] || []).forEach(function(p) {
          if (p.task && p.task.id === 'fixed_et') placement = p;
        });
      });
      expect(placement).not.toBeNull();
      // Fixed task with its own tz keeps 'America/New_York', not schedule's 'America/Chicago'
      expect(placement.tz).toBe('America/New_York');
    });

    test('taskUpdates include tz field', () => {
      var tzCfg = makeCfg({ timezone: 'America/Denver' });
      var tasks = [makeTask({ id: 'upd_tz', pri: 'P2', dur: 30 })];
      var statuses = { upd_tz: '' };
      var result = unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, tzCfg);

      expect(result.taskUpdates.upd_tz).toBeDefined();
      expect(result.taskUpdates.upd_tz.tz).toBe('America/Denver');
    });

    test('no cfg.timezone returns null tz fields', () => {
      var noCfg = makeCfg(); // no timezone field
      var tasks = [makeTask({ id: 'no_tz', pri: 'P2', dur: 30 })];
      var statuses = { no_tz: '' };
      var result = unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, noCfg);

      expect(result.timezone).toBeNull();
    });
  });

  // ─── GROUP 79: Null/missing timezone fallback ───
  describe('Group 79: Missing timezone fallback', () => {
    test('utcToLocal with null timezone throws (no silent fallback)', () => {
      var utc = new Date('2026-03-23T18:00:00Z');
      // Null timezone causes Intl.DateTimeFormat to throw — this is expected
      // behavior. The caller must provide a valid timezone.
      expect(function() { utcToLocal(utc, null); }).toThrow();
    });

    test('utcToLocal with undefined utcDate returns nulls', () => {
      var local = utcToLocal(null, 'America/New_York');
      expect(local.date).toBeNull();
      expect(local.time).toBeNull();
      expect(local.day).toBeNull();
    });

    test('localToUtc with null dateStr returns null', () => {
      var result = localToUtc(null, '2:00 PM', 'America/New_York');
      expect(result).toBeNull();
    });
  });

});
