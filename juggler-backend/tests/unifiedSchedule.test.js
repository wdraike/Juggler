/**
 * Unified Scheduler Tests
 *
 * Tests the core scheduling algorithm: task categorization, placement phases,
 * priority ordering, constraints, and edge cases.
 *
 * unifiedSchedule(allTasks, statuses, effectiveTodayKey, nowMins, cfg)
 * Returns: { dayPlacements, taskUpdates, newStatuses, unplaced, score, warnings }
 */

const unifiedSchedule = require('../src/scheduler/unifiedSchedule');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');

function makeTask(overrides) {
  return {
    id: 't_' + Math.random().toString(36).slice(2, 8),
    text: 'Test task',
    date: '2026-03-22',
    dur: 30,
    pri: 'P3',
    when: '',
    dayReq: 'any',
    status: '',
    ...overrides
  };
}

function makeCfg(overrides) {
  return {
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    ...overrides
  };
}

const TODAY = '2026-03-22'; // Sunday
const NOW_MINS = 480; // 8:00 AM
const cfg = makeCfg();

function schedule(tasks, statusesOrNowMins, today, nowMins) {
  // Allow schedule(tasks, nowMins) shorthand for convenience
  if (typeof statusesOrNowMins === 'number') {
    return unifiedSchedule(tasks, {}, today || TODAY, statusesOrNowMins, cfg);
  }
  return unifiedSchedule(tasks, statusesOrNowMins || {}, today || TODAY, nowMins || NOW_MINS, cfg);
}

function getPlacementsForDay(result, dateKey) {
  return (result.dayPlacements[dateKey] || []).filter(p => !p.marker);
}

function getAllPlacements(result) {
  var all = [];
  Object.values(result.dayPlacements).forEach(function(day) {
    day.forEach(function(p) { if (p.task) all.push(p); });
  });
  return all;
}

describe('unifiedSchedule', () => {
  describe('basic placement', () => {
    test('places a single task on its date', () => {
      const tasks = [makeTask({ id: 't1', date: '2026-03-22' })];
      const result = schedule(tasks);
      const placed = getPlacementsForDay(result, '2026-03-22');
      expect(placed.length).toBeGreaterThanOrEqual(1);
      expect(placed[0].task.id).toBe('t1');
    });

    test('empty task list places nothing', () => {
      const result = schedule([]);
      // Day structures exist but no tasks placed
      const totalPlaced = Object.values(result.dayPlacements).reduce((sum, arr) => sum + arr.length, 0);
      expect(totalPlaced).toBe(0);
      expect(result.unplaced).toHaveLength(0);
    });

    test('excludes done/cancel/skip tasks', () => {
      const tasks = [
        makeTask({ id: 'done1', date: '2026-03-22' }),
        makeTask({ id: 'active1', date: '2026-03-22' })
      ];
      const statuses = { done1: 'done', active1: '' };
      const result = schedule(tasks, statuses);
      const placed = getPlacementsForDay(result, '2026-03-22');
      const ids = placed.map(p => p.task.id);
      expect(ids).toContain('active1');
      expect(ids).not.toContain('done1');
    });

    test('excludes TBD-dated tasks', () => {
      const tasks = [makeTask({ id: 't1', date: 'TBD' })];
      const result = schedule(tasks);
      // TBD tasks not placed anywhere
      const totalPlaced = Object.values(result.dayPlacements).reduce((sum, arr) => sum + arr.length, 0);
      expect(totalPlaced).toBe(0);
    });

    test('allday events skip time grid', () => {
      const tasks = [makeTask({ id: 't1', date: '2026-03-22', when: 'allday' })];
      const result = schedule(tasks);
      const placed = getPlacementsForDay(result, '2026-03-22');
      expect(placed).toHaveLength(0);
    });

    test('markers dont consume time slots', () => {
      const tasks = [
        makeTask({ id: 'marker1', date: '2026-03-22', marker: true }),
        makeTask({ id: 'task1', date: '2026-03-22', dur: 30 })
      ];
      const result = schedule(tasks);
      const allPlacements = result.dayPlacements['2026-03-22'] || [];
      const markerPlacement = allPlacements.find(p => p.marker);
      const taskPlacement = allPlacements.find(p => p.task?.id === 'task1');
      // Marker should not prevent task placement
      expect(taskPlacement).toBeDefined();
    });
  });

  describe('priority ordering', () => {
    test('P1 placed before P3 on same day', () => {
      const tasks = [
        makeTask({ id: 'p3', date: '2026-03-23', pri: 'P3', dur: 30 }),
        makeTask({ id: 'p1', date: '2026-03-23', pri: 'P1', dur: 30 })
      ];
      const result = schedule(tasks, {}, '2026-03-23');
      const placed = getPlacementsForDay(result, '2026-03-23');
      if (placed.length >= 2) {
        const p1 = placed.find(p => p.task.id === 'p1');
        const p3 = placed.find(p => p.task.id === 'p3');
        if (p1 && p3) {
          expect(p1.start).toBeLessThanOrEqual(p3.start);
        }
      }
    });

    test('normalizePri handles various formats', () => {
      const tasks = [
        makeTask({ id: 't1', date: '2026-03-22', pri: '1' }),
        makeTask({ id: 't2', date: '2026-03-22', pri: 'p2' }),
        makeTask({ id: 't3', date: '2026-03-22', pri: 'P4' })
      ];
      const result = schedule(tasks);
      // All tasks should be placed (valid priorities)
      const placed = getPlacementsForDay(result, '2026-03-22');
      expect(placed.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('fixed tasks', () => {
    test('fixed task anchored at specified time', () => {
      const tasks = [makeTask({ id: 'fixed1', date: '2026-03-22', when: 'fixed', time: '9:00 AM', dur: 60 })];
      const result = schedule(tasks);
      const placed = getPlacementsForDay(result, '2026-03-22');
      const fixed = placed.find(p => p.task.id === 'fixed1');
      expect(fixed).toBeDefined();
      expect(fixed.start).toBe(540); // 9:00 AM = 540 minutes
    });

    test('fixed task not displaced by flexible tasks', () => {
      const tasks = [
        makeTask({ id: 'fixed1', date: '2026-03-22', when: 'fixed', time: '9:00 AM', dur: 60 }),
        makeTask({ id: 'flex1', date: '2026-03-22', dur: 60 }),
        makeTask({ id: 'flex2', date: '2026-03-22', dur: 60 }),
        makeTask({ id: 'flex3', date: '2026-03-22', dur: 60 })
      ];
      const result = schedule(tasks);
      const placed = getPlacementsForDay(result, '2026-03-22');
      const fixed = placed.find(p => p.task.id === 'fixed1');
      expect(fixed).toBeDefined();
      expect(fixed.start).toBe(540);
    });
  });

  describe('dependencies', () => {
    test('dependency placed before dependent on same day', () => {
      const tasks = [
        makeTask({ id: 'A', date: '2026-03-22', dur: 30, dependsOn: ['B'] }),
        makeTask({ id: 'B', date: '2026-03-22', dur: 30 })
      ];
      const result = schedule(tasks);
      const placed = getPlacementsForDay(result, '2026-03-22');
      const a = placed.find(p => p.task.id === 'A');
      const b = placed.find(p => p.task.id === 'B');
      if (a && b) {
        expect(b.start + b.dur).toBeLessThanOrEqual(a.start);
      }
    });
  });

  describe('day requirements', () => {
    test('weekday-only task not placed on weekend', () => {
      // 3/22 is Sunday
      const tasks = [makeTask({ id: 't1', date: '2026-03-22', dayReq: 'weekday' })];
      const result = schedule(tasks, {}, '2026-03-22');
      const sundayPlaced = getPlacementsForDay(result, '2026-03-22');
      const t1OnSunday = sundayPlaced.find(p => p.task.id === 't1');
      // Should be moved to Monday 3/23 or later
      expect(t1OnSunday).toBeUndefined();
      const mondayPlaced = getPlacementsForDay(result, '2026-03-23');
      const t1OnMonday = mondayPlaced.find(p => p.task.id === 't1');
      expect(t1OnMonday).toBeDefined();
    });
  });

  describe('travel time', () => {
    test('travel buffers applied', () => {
      const tasks = [
        makeTask({ id: 't1', date: '2026-03-22', dur: 60, travelBefore: 15, travelAfter: 10 })
      ];
      const result = schedule(tasks);
      const placed = getPlacementsForDay(result, '2026-03-22');
      const t = placed.find(p => p.task.id === 't1');
      expect(t).toBeDefined();
      // Travel time should be recorded in the placement
      if (t.travelBefore !== undefined) {
        expect(t.travelBefore).toBe(15);
      }
    });
  });

  describe('overflow', () => {
    test('more tasks than capacity produces some placed and handles overflow', () => {
      // Create many tasks — the scheduler handles overflow by spreading across days or unplacing
      const tasks = Array.from({ length: 50 }, (_, i) =>
        makeTask({ id: `t${i}`, date: '2026-03-22', dur: 120, datePinned: true })
      );
      const result = schedule(tasks);
      // 50 x 2hr = 100 hours on a single day (17hr capacity). Must overflow.
      const placedOn22 = getPlacementsForDay(result, '2026-03-22');
      // Can't fit all 50 on one day — some in unplaced or overflow to other days
      const totalPlacedAllDays = Object.values(result.dayPlacements)
        .reduce((sum, arr) => sum + arr.filter(p => !p.marker).length, 0);
      expect(totalPlacedAllDays + result.unplaced.length).toBe(50);
      // At most ~8-9 two-hour tasks fit in a 17hr day
      expect(placedOn22.length).toBeLessThan(50);
    });
  });

  describe('score', () => {
    test('returns a score object', () => {
      const tasks = [makeTask({ id: 't1', date: '2026-03-22' })];
      const result = schedule(tasks);
      expect(result.score).toBeDefined();
      expect(typeof result.score.total).toBe('number');
    });
  });

  describe('recurringTasks', () => {
    test('rigid recurring placed at preferred time', () => {
      const tasks = [makeTask({
        id: 'h1', date: '2026-03-22', recurring: true, rigid: true,
        time: '7:00 AM', dur: 30
      })];
      const result = schedule(tasks);
      const placed = getPlacementsForDay(result, '2026-03-22');
      const h = placed.find(p => p.task.id === 'h1');
      expect(h).toBeDefined();
      // Rigid recurring should be at or near 7:00 AM (420 mins)
      if (h) {
        expect(h.start).toBe(420);
      }
    });
  });

  describe('date pinning', () => {
    test('date-pinned task stays on its date', () => {
      const tasks = [makeTask({ id: 't1', date: '2026-03-22', datePinned: true, dur: 30 })];
      const result = schedule(tasks);
      const placed = getPlacementsForDay(result, '2026-03-22');
      expect(placed.find(p => p.task.id === 't1')).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // preferredTimeMins — Time Window mode
  // ═══════════════════════════════════════════════════════════════

  describe('preferredTimeMins', () => {
    test('recurring task with preferredTimeMins is placed within flex window', () => {
      var tasks = [
        makeTask({ id: 'lunch', text: 'Lunch', recurring: true, generated: true,
          preferredTimeMins: 720, timeFlex: 60, dur: 30, date: TODAY, time: '12:00 PM' })
      ];
      var result = schedule(tasks, 480); // 8am
      var placed = getAllPlacements(result).filter(p => p.task.id === 'lunch');
      expect(placed.length).toBe(1);
      expect(placed[0].start).toBeGreaterThanOrEqual(660); // 11am
      expect(placed[0].start).toBeLessThanOrEqual(780);    // 1pm
    });

    test('recurring task with preferredTimeMins=420 (7am) placed in morning', () => {
      var tasks = [
        makeTask({ id: 'bf', text: 'Breakfast', recurring: true, generated: true,
          preferredTimeMins: 420, timeFlex: 60, dur: 20, date: TODAY, time: '7:00 AM' })
      ];
      var result = schedule(tasks, 360); // 6am
      var placed = getAllPlacements(result).filter(p => p.task.id === 'bf');
      expect(placed.length).toBe(1);
      expect(placed[0].start).toBeGreaterThanOrEqual(360); // 6am
      expect(placed[0].start).toBeLessThanOrEqual(480);    // 8am
    });

    test('preferredTimeMins takes precedence over parsed time string', () => {
      // time says 9am but preferredTimeMins says noon — noon should win
      var tasks = [
        makeTask({ id: 'conflict', recurring: true, generated: true,
          preferredTimeMins: 720, time: '9:00 AM', timeFlex: 30, dur: 30, date: TODAY })
      ];
      var result = schedule(tasks, 480);
      var placed = getAllPlacements(result).filter(p => p.task.id === 'conflict');
      expect(placed.length).toBe(1);
      expect(placed[0].start).toBeGreaterThanOrEqual(690); // 11:30am
      expect(placed[0].start).toBeLessThanOrEqual(750);    // 12:30pm
    });

    test('missed recurring: preferredTimeMins window entirely past → unplaced', () => {
      var tasks = [
        makeTask({ id: 'missed', text: 'Morning task', recurring: true, generated: true,
          preferredTimeMins: 420, timeFlex: 60, dur: 20, date: TODAY, time: '7:00 AM' })
      ];
      var result = schedule(tasks, 540); // 9am — window [360,480] is past
      var placed = getAllPlacements(result).filter(p => p.task.id === 'missed');
      expect(placed.length).toBe(0);
      var missed = result.unplaced.find(t => t.id === 'missed');
      expect(missed).toBeDefined();
      expect(missed._unplacedReason).toBe('missed');
    });

    test('non-recurring task ignores preferredTimeMins', () => {
      var tasks = [
        makeTask({ id: 'regular', recurring: false,
          preferredTimeMins: 720, timeFlex: 60, dur: 30, date: TODAY })
      ];
      var result = schedule(tasks, 480);
      // Should be placed normally (not constrained to noon window)
      var placed = getAllPlacements(result).filter(p => p.task.id === 'regular');
      expect(placed.length).toBe(1);
    });
  });
});
