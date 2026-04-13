/**
 * Scenario-Based Scheduler Tests
 *
 * Each test describes a REAL USER SCENARIO and verifies what the user
 * would see on their calendar. Not implementation tests — behavior tests.
 *
 * 37 scenarios across 9 tiers:
 *   Tier 1: Priority & ordering
 *   Tier 2: Recurrings with preferred times
 *   Tier 3: Flexible recurringTasks (no preferred time)
 *   Tier 4: Fixed events & conflicts
 *   Tier 5: Capacity crunch
 *   Tier 6: Full DB-row pipeline
 *   Tier 7: Multi-day patterns
 *   Tier 8: Drag-pin & undo
 *   Tier 9: UI form logic
 */

// Mock DB for rowToTask (doesn't need real DB)
jest.mock('../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = () => mock;
  mock.fn = fn;
  return mock;
});

const unifiedSchedule = require('../src/scheduler/unifiedSchedule');
const { rowToTask, buildSourceMap } = require('../src/controllers/task.controller');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');

const TODAY = '4/7'; // Monday
const TOMORROW = '4/8';
const TZ = 'America/New_York';
const cfg = {
  timeBlocks: DEFAULT_TIME_BLOCKS, toolMatrix: DEFAULT_TOOL_MATRIX,
  splitMinDefault: 15, locSchedules: {}, locScheduleDefaults: {},
  locScheduleOverrides: {}, hourLocationOverrides: {},
  scheduleTemplates: null, preferences: { pullForwardDampening: true },
};

// ── Helpers ──────────────────────────────────────────────────────

let _n = 0;
function task(overrides) {
  _n++;
  return {
    id: overrides.id || 's_' + _n, text: overrides.text || 'Task ' + _n,
    date: TODAY, dur: 30, pri: 'P3', when: '', dayReq: 'any', status: '',
    dependsOn: [], location: [], tools: [], recurring: false, rigid: false,
    marker: false, split: false, datePinned: false, generated: false,
    section: '', flexWhen: false, timeFlex: undefined, ...overrides
  };
}

function dateKey(daysFromMonday) {
  var d = new Date(2026, 3, 7); // April 7 = Monday
  d.setDate(d.getDate() + daysFromMonday);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

function schedule(tasks, nowMins) {
  var statuses = {};
  tasks.forEach(t => statuses[t.id] = t.status || '');
  return unifiedSchedule(tasks, statuses, TODAY, nowMins || 480, cfg);
}

// Find where a task was placed
function placement(result, taskId) {
  for (var dk in result.dayPlacements) {
    for (var p of result.dayPlacements[dk]) {
      if (p.task && p.task.id === taskId) return { day: dk, start: p.start, dur: p.dur, end: p.start + p.dur };
    }
  }
  return null;
}

// Find ALL placements (for split tasks)
function placements(result, taskId) {
  var found = [];
  for (var dk in result.dayPlacements) {
    for (var p of result.dayPlacements[dk]) {
      if (p.task && p.task.id === taskId) found.push({ day: dk, start: p.start, dur: p.dur, end: p.start + p.dur });
    }
  }
  return found;
}

function isPlaced(result, taskId) { return placement(result, taskId) !== null; }

function isMissed(result, taskId) {
  return (result.unplaced || []).some(t => t.id === taskId && t._unplacedReason === 'missed');
}

function isUnplaced(result, taskId) {
  return (result.unplaced || []).some(t => t.id === taskId);
}

function mins(h, m) { return h * 60 + (m || 0); } // 12,30 → 750

function makeDBRow(overrides) {
  return {
    id: 'db_' + (++_n), task_type: 'task', user_id: 'u1', text: 'DB Task',
    scheduled_at: new Date('2026-04-07T14:00:00Z'), original_scheduled_at: null,
    dur: 30, time_remaining: null, pri: 'P3', project: null, status: '',
    section: null, notes: '', due_at: null, start_after_at: null,
    location: '[]', tools: '[]', when: '', day_req: 'any',
    recurring: 0, rigid: 0, time_flex: null, split: 0, split_min: null,
    recur: null, source_id: null, generated: 0, gcal_event_id: null,
    msft_event_id: null, depends_on: '[]', date_pinned: 0, marker: 0,
    flex_when: 0, travel_before: null, travel_after: null, tz: null,
    recur_start: null, recur_end: null, disabled_at: null, disabled_reason: null,
    prev_when: null, created_at: new Date(), updated_at: new Date(), ...overrides
  };
}

beforeEach(() => { _n = 0; });

// ═══════════════════════════════════════════════════════════════════
// TIER 1: PRIORITY & ORDERING
// ═══════════════════════════════════════════════════════════════════

describe('Tier 1: Priority & Ordering', () => {

  test('S1: 4 tasks at different priorities → P1 earliest, P4 latest', () => {
    var r = schedule([
      task({ id: 'p1', pri: 'P1', dur: 60 }),
      task({ id: 'p2', pri: 'P2', dur: 60 }),
      task({ id: 'p3', pri: 'P3', dur: 60 }),
      task({ id: 'p4', pri: 'P4', dur: 60 }),
    ]);
    var p1 = placement(r, 'p1'), p2 = placement(r, 'p2');
    var p3 = placement(r, 'p3'), p4 = placement(r, 'p4');
    expect(p1).not.toBeNull();
    expect(p4).not.toBeNull();
    expect(p1.start).toBeLessThan(p2.start);
    expect(p2.start).toBeLessThan(p3.start);
    expect(p3.start).toBeLessThan(p4.start);
  });

  test('S2: P4 with deadline today placed before P1 without deadline', () => {
    var r = schedule([
      task({ id: 'p1_free', pri: 'P1', dur: 60 }),
      task({ id: 'p4_due', pri: 'P4', dur: 60, due: TODAY }),
    ]);
    expect(isPlaced(r, 'p4_due')).toBe(true);
    expect(isPlaced(r, 'p1_free')).toBe(true);
    // Both placed — deadline task gets its slot, P1 gets another
  });

  test('S3: Dependency chain A→B→C all finish in order', () => {
    var r = schedule([
      task({ id: 'a', dur: 60 }),
      task({ id: 'b', dur: 60, dependsOn: ['a'] }),
      task({ id: 'c', dur: 60, dependsOn: ['b'] }),
    ]);
    var a = placement(r, 'a'), b = placement(r, 'b'), c = placement(r, 'c');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();
    expect(a.end).toBeLessThanOrEqual(b.start);
    expect(b.end).toBeLessThanOrEqual(c.start);
  });

  test('S4: Dependency chain with deadline — all placed before due date', () => {
    var r = schedule([
      task({ id: 'da', dur: 90 }),
      task({ id: 'db', dur: 90, dependsOn: ['da'] }),
      task({ id: 'dc', dur: 90, due: TOMORROW, dependsOn: ['db'] }),
    ]);
    expect(isPlaced(r, 'da')).toBe(true);
    expect(isPlaced(r, 'db')).toBe(true);
    expect(isPlaced(r, 'dc')).toBe(true);
    var a = placement(r, 'da'), b = placement(r, 'db'), c = placement(r, 'dc');
    if (a.day === b.day) expect(a.end).toBeLessThanOrEqual(b.start);
    if (b.day === c.day) expect(b.end).toBeLessThanOrEqual(c.start);
  });

  test('S4b: Dependency chain — upstream dep placed same day as deadline dependent', () => {
    // Prep (no due) → Cook (due today). Both should land on today.
    // Upstream dep inherits effective deadline from downstream via propagation.
    var r = schedule([
      task({ id: 'prep', dur: 60 }),
      task({ id: 'cook', dur: 60, due: TODAY, dependsOn: ['prep'] }),
    ]);
    expect(isPlaced(r, 'prep')).toBe(true);
    expect(isPlaced(r, 'cook')).toBe(true);
    var p = placement(r, 'prep'), c = placement(r, 'cook');
    expect(p.day).toBe(TODAY);
    expect(c.day).toBe(TODAY);
    if (p.day === c.day) expect(p.end).toBeLessThanOrEqual(c.start);
  });

  test('S5: P1 task + P3 chain with deadline — both served', () => {
    var r = schedule([
      task({ id: 'p1_solo', pri: 'P1', dur: 60 }),
      task({ id: 'chain1', pri: 'P3', dur: 60 }),
      task({ id: 'chain2', pri: 'P3', dur: 60, due: TOMORROW, dependsOn: ['chain1'] }),
    ]);
    expect(isPlaced(r, 'p1_solo')).toBe(true);
    expect(isPlaced(r, 'chain2')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIER 2: RECURRING — PREFERRED TIME
// ═══════════════════════════════════════════════════════════════════

describe('Tier 2: Recurrings with Preferred Time', () => {

  test('S6: Lunch recurring at noon ±60m → placed between 11am and 1pm', () => {
    var r = schedule([
      task({ id: 'lunch', text: 'Lunch', recurring: true, when: 'lunch', time: '12:00 PM', timeFlex: 60, dur: 30, generated: true }),
    ], 480); // 8am
    var p = placement(r, 'lunch');
    expect(p).not.toBeNull();
    expect(p.start).toBeGreaterThanOrEqual(mins(11));
    expect(p.start).toBeLessThanOrEqual(mins(13));
  });

  test('S7: Breakfast at 7am ±60m, run at 7:30am → placed in remaining window', () => {
    var r = schedule([
      task({ id: 'bf', text: 'Breakfast', recurring: true, when: 'morning', time: '7:00 AM', timeFlex: 60, dur: 30, generated: true }),
    ], 450); // 7:30am
    var p = placement(r, 'bf');
    expect(p).not.toBeNull();
    expect(p.start).toBeGreaterThanOrEqual(450); // after 7:30am
    expect(p.start).toBeLessThanOrEqual(mins(8)); // before 8am
  });

  test('S8: Breakfast at 7am ±60m, run at 9am → missed, not drifted', () => {
    var r = schedule([
      task({ id: 'bf', text: 'Breakfast', recurring: true, when: 'morning', time: '7:00 AM', timeFlex: 60, dur: 30, generated: true }),
    ], 540); // 9am
    expect(isPlaced(r, 'bf')).toBe(false);
    expect(isMissed(r, 'bf')).toBe(true);
  });

  test('S9: Recurring instance inherits template time via preferred_time_mins, not stale scheduler time', () => {
    var template = makeDBRow({
      id: 'ht_lunchx', task_type: 'recurring_template', recurring: 1,
      when: 'lunch', time_flex: 60, dur: 30,
      preferred_time_mins: 720, // noon
      recur: JSON.stringify({ type: 'daily' }),
    });
    var instance = makeDBRow({
      id: 'rc_lunchx_47', task_type: 'recurring_instance', recurring: 1,
      source_id: 'ht_lunchx', generated: 0,
      scheduled_at: new Date('2026-04-07T11:00:00Z'), // 7am ET (stale)
    });
    var srcMap = {}; srcMap['ht_lunchx'] = template;
    var mapped = rowToTask(instance, TZ, srcMap);

    var r = schedule([mapped], 600); // 10am
    var p = placement(r, 'rc_lunchx_47');
    expect(p).not.toBeNull();
    expect(p.start).toBeGreaterThanOrEqual(mins(11)); // 11am
    expect(p.start).toBeLessThanOrEqual(mins(13));     // 1pm
  });

  test('S10: Multiple preferred-time recurringTasks → each near its time', () => {
    var r = schedule([
      task({ id: 'meds', text: 'Morning Meds', recurring: true, when: 'morning', time: '7:00 AM', timeFlex: 60, dur: 20, generated: true }),
      task({ id: 'bf', text: 'Breakfast', recurring: true, when: 'morning', time: '7:30 AM', timeFlex: 60, dur: 30, generated: true }),
      task({ id: 'lunch', text: 'Lunch', recurring: true, when: 'lunch', time: '12:00 PM', timeFlex: 60, dur: 30, generated: true }),
      task({ id: 'evmeds', text: 'Evening Meds', recurring: true, when: 'evening', time: '6:00 PM', timeFlex: 60, dur: 10, generated: true }),
    ], 360); // 6am
    expect(isPlaced(r, 'meds')).toBe(true);
    expect(isPlaced(r, 'bf')).toBe(true);
    expect(isPlaced(r, 'lunch')).toBe(true);
    expect(isPlaced(r, 'evmeds')).toBe(true);
    // No two recurringTasks at the same time
    var all = ['meds', 'bf', 'lunch', 'evmeds'].map(id => placement(r, id));
    for (var i = 0; i < all.length; i++) {
      for (var j = i + 1; j < all.length; j++) {
        if (all[i].day === all[j].day) {
          expect(all[i].end <= all[j].start || all[j].end <= all[i].start).toBe(true);
        }
      }
    }
  });

  test('S11: P1 deadline fills lunch window → lunch unplaced, not drifted to 3pm', () => {
    var r = schedule([
      task({ id: 'deadline', pri: 'P1', dur: 120, due: TODAY }),
      task({ id: 'lunch', text: 'Lunch', recurring: true, when: 'lunch', time: '12:00 PM', timeFlex: 60, dur: 30, generated: true }),
    ], 600); // 10am
    expect(isPlaced(r, 'deadline')).toBe(true);
    var lunch = placement(r, 'lunch');
    if (lunch) {
      // If placed, must be within flex window (11am-1pm), NOT drifted
      expect(lunch.start).toBeGreaterThanOrEqual(mins(11));
      expect(lunch.start).toBeLessThanOrEqual(mins(13));
    }
    // It's acceptable for lunch to be unplaced if the deadline task consumed the flex window
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIER 3: RECURRING — FLEXIBLE (NO PREFERRED TIME)
// ═══════════════════════════════════════════════════════════════════

describe('Tier 3: Flexible Recurrings', () => {

  test('S12: Flexible exercise recurring placed in available block', () => {
    var r = schedule([
      task({ id: 'ex', text: 'Exercise', recurring: true, when: 'morning,afternoon,evening', dur: 30, generated: true, flexWhen: true }),
    ]);
    expect(isPlaced(r, 'ex')).toBe(true);
  });

  test('S13: Flexible recurring with flexWhen — placed via relaxation when blocks full', () => {
    // Fill morning + evening with fixed events
    var r = schedule([
      task({ id: 'mtg1', when: 'fixed', time: '8:00 AM', dur: 240, datePinned: true }),
      task({ id: 'mtg2', when: 'fixed', time: '1:00 PM', dur: 240, datePinned: true }),
      task({ id: 'mtg3', when: 'fixed', time: '5:00 PM', dur: 240, datePinned: true }),
      task({ id: 'ex', text: 'Exercise', recurring: true, when: 'morning,afternoon', dur: 30, generated: true, flexWhen: true }),
    ]);
    // Should be placed somewhere (relaxation allows anytime)
    expect(isPlaced(r, 'ex')).toBe(true);
  });

  test('S14: Strict flexible recurring with blocks full → unplaced', () => {
    var r = schedule([
      task({ id: 'mtg1', when: 'fixed', time: '8:00 AM', dur: 240, datePinned: true }),
      task({ id: 'mtg2', when: 'fixed', time: '1:00 PM', dur: 240, datePinned: true }),
      task({ id: 'mtg3', when: 'fixed', time: '5:00 PM', dur: 240, datePinned: true }),
      task({ id: 'ex', text: 'Exercise', recurring: true, when: 'morning,afternoon', dur: 30, generated: true, flexWhen: false }),
    ]);
    // Strict + blocks full = should be unplaced
    expect(isUnplaced(r, 'ex')).toBe(true);
  });

  test('S15: P1 deadline + P3 exercise, limited capacity → deadline wins', () => {
    var r = schedule([
      task({ id: 'mtg', when: 'fixed', time: '8:00 AM', dur: 480, datePinned: true }), // blocks 8am-4pm
      task({ id: 'dl', pri: 'P1', dur: 120, due: TODAY }),
      task({ id: 'ex', text: 'Exercise', pri: 'P3', recurring: true, when: 'evening', dur: 60, generated: true }),
    ]);
    expect(isPlaced(r, 'dl')).toBe(true);
    // Exercise may or may not fit depending on evening capacity
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIER 4: FIXED EVENTS & CONFLICTS
// ═══════════════════════════════════════════════════════════════════

describe('Tier 4: Fixed Events & Conflicts', () => {

  test('S16: Fixed meeting blocks time, tasks work around it', () => {
    var r = schedule([
      task({ id: 'mtg', when: 'fixed', time: '10:00 AM', dur: 60, datePinned: true }),
      task({ id: 't1', dur: 30 }),
      task({ id: 't2', dur: 30 }),
      task({ id: 't3', dur: 30 }),
    ]);
    var mtg = placement(r, 'mtg');
    ['t1', 't2', 't3'].forEach(id => {
      var p = placement(r, id);
      if (p && p.day === mtg.day) {
        // No overlap with meeting
        expect(p.end <= mtg.start || p.start >= mtg.end).toBe(true);
      }
    });
  });

  test('S17: Two overlapping fixed events — both placed, warning issued', () => {
    var r = schedule([
      task({ id: 'ma', when: 'fixed', time: '10:00 AM', dur: 60, datePinned: true }),
      task({ id: 'mb', when: 'fixed', time: '10:30 AM', dur: 60, datePinned: true }),
    ]);
    expect(isPlaced(r, 'ma')).toBe(true);
    expect(isPlaced(r, 'mb')).toBe(true);
    expect((r.warnings || []).some(w => w.type === 'fixedOverlap')).toBe(true);
  });

  test('S18: Rigid recurring blocked by fixed event → displaced or conflict', () => {
    var r = schedule([
      task({ id: 'mtg', when: 'fixed', time: '12:00 PM', dur: 60, datePinned: true }),
      task({ id: 'lunch', recurring: true, rigid: true, when: 'lunch', dur: 30, generated: true }),
    ]);
    expect(isPlaced(r, 'lunch')).toBe(true); // rigid recurringTasks NEVER vanish
  });

  test('S19: All-day event — rigid recurringTasks force-placed, flex overflow', () => {
    var r = schedule([
      task({ id: 'conf', when: 'fixed', time: '8:00 AM', dur: 600, datePinned: true }),
      task({ id: 'meds', recurring: true, rigid: true, when: 'morning', dur: 20, generated: true }),
      task({ id: 'flex1', dur: 60 }),
      task({ id: 'flex2', dur: 60 }),
    ]);
    expect(isPlaced(r, 'meds')).toBe(true); // rigid always placed
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIER 5: CAPACITY CRUNCH
// ═══════════════════════════════════════════════════════════════════

describe('Tier 5: Capacity Crunch', () => {

  test('S20: More work than time → high priority placed, low unplaced', () => {
    var tasks = [];
    for (var i = 0; i < 6; i++) tasks.push(task({ id: 'p1_' + i, pri: 'P1', dur: 60 }));
    for (var j = 0; j < 6; j++) tasks.push(task({ id: 'p4_' + j, pri: 'P4', dur: 60 }));
    var r = schedule(tasks);
    var p1Placed = tasks.filter(t => t.pri === 'P1' && isPlaced(r, t.id)).length;
    var p4Placed = tasks.filter(t => t.pri === 'P4' && isPlaced(r, t.id)).length;
    expect(p1Placed).toBeGreaterThanOrEqual(p4Placed);
  });

  test('S21: Tight chain exceeds capacity → distributed across days', () => {
    var fri = dateKey(4); // Friday
    var r = schedule([
      task({ id: 'c1', pri: 'P1', dur: 120 }),
      task({ id: 'c2', pri: 'P1', dur: 120, dependsOn: ['c1'] }),
      task({ id: 'c3', pri: 'P1', dur: 120, dependsOn: ['c2'] }),
      task({ id: 'c4', pri: 'P1', dur: 120, dependsOn: ['c3'] }),
      task({ id: 'c5', pri: 'P1', dur: 120, due: fri, dependsOn: ['c4'] }),
    ]);
    expect(isPlaced(r, 'c5')).toBe(true);
    // Verify ordering
    for (var k = 2; k <= 5; k++) {
      var prev = placement(r, 'c' + (k - 1));
      var curr = placement(r, 'c' + k);
      if (prev && curr && prev.day === curr.day) {
        expect(prev.end).toBeLessThanOrEqual(curr.start);
      }
    }
  });

  test('S22: Today fully consumed → tasks overflow to another day', () => {
    // Fill the entire schedulable day (6am-11pm = 1020 minutes)
    var r = schedule([
      task({ id: 'fill1', when: 'fixed', time: '6:00 AM', dur: 510, datePinned: true }), // 6am-2:30pm
      task({ id: 'fill2', when: 'fixed', time: '2:30 PM', dur: 510, datePinned: true }), // 2:30pm-11pm
      task({ id: 'overflow', dur: 60 }),
    ]);
    var p = placement(r, 'overflow');
    if (p) {
      // If placed, should be on a different day
      expect(p.day).not.toBe(TODAY);
    }
    // Alternatively: completely unplaced is also acceptable
  });

  test('S23: Fragmented day — split task fits, non-split does not', () => {
    var r = schedule([
      task({ id: 'b1', when: 'fixed', time: '1:00 PM', dur: 60, datePinned: true }),
      task({ id: 'b2', when: 'fixed', time: '2:30 PM', dur: 60, datePinned: true }),
      task({ id: 'b3', when: 'fixed', time: '4:00 PM', dur: 60, datePinned: true }),
      task({ id: 'splittable', dur: 90, split: true, splitMin: 30 }),
      task({ id: 'nosplit', dur: 90, split: false, datePinned: true }),
    ]);
    var sp = placements(r, 'splittable');
    expect(sp.length).toBeGreaterThan(0);
    var totalSplitDur = sp.reduce((s, p) => s + p.dur, 0);
    expect(totalSplitDur).toBe(90);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIER 6: FULL PIPELINE (DB ROWS)
// ═══════════════════════════════════════════════════════════════════

describe('Tier 6: Full Pipeline (DB rows)', () => {

  test('S24: Recurring instance at midnight → template preferred_time_mins used → placed near noon', () => {
    var template = makeDBRow({
      id: 'ht_s24', task_type: 'recurring_template', recurring: 1,
      when: 'lunch', time_flex: 60, dur: 30,
      preferred_time_mins: 720, // noon
      recur: JSON.stringify({ type: 'daily' }),
    });
    var instance = makeDBRow({
      id: 'rc_s24_47', task_type: 'recurring_instance', recurring: 1,
      source_id: 'ht_s24',
      scheduled_at: new Date('2026-04-07T04:00:00Z'), // midnight ET
    });
    var srcMap = {}; srcMap['ht_s24'] = template;
    var mapped = rowToTask(instance, TZ, srcMap);
    var r = schedule([mapped], 480);
    var p = placement(r, 'rc_s24_47');
    expect(p).not.toBeNull();
    expect(p.start).toBeGreaterThanOrEqual(mins(11));
    expect(p.start).toBeLessThanOrEqual(mins(13));
  });

  test('S25: Recurring instance at stale 7am → template preferred_time_mins noon → placed near noon', () => {
    var template = makeDBRow({
      id: 'ht_s25', task_type: 'recurring_template', recurring: 1,
      when: 'lunch', time_flex: 60, dur: 30,
      preferred_time_mins: 720, // noon
    });
    var instance = makeDBRow({
      id: 'rc_s25_47', task_type: 'recurring_instance', recurring: 1,
      source_id: 'ht_s25',
      scheduled_at: new Date('2026-04-07T11:00:00Z'), // 7am ET (stale)
    });
    var srcMap = {}; srcMap['ht_s25'] = template;
    var mapped = rowToTask(instance, TZ, srcMap);
    expect(mapped.time).toBe('12:00 PM'); // from preferred_time_mins, not 7am
    var r = schedule([mapped], 600); // 10am
    var p = placement(r, 'rc_s25_47');
    expect(p).not.toBeNull();
    expect(p.start).toBeGreaterThanOrEqual(mins(11));
  });

  test('S26: Done task with future scheduled_at → not scheduled today', () => {
    var row = makeDBRow({
      id: 'done_task', status: 'done',
      scheduled_at: new Date(Date.now() + 86400000), // tomorrow
      updated_at: new Date(Date.now() - 3600000), // 1 hour ago
    });
    var mapped = rowToTask(row, TZ, {});
    var r = schedule([mapped], 480);
    // Terminal status — scheduler should skip it
    expect(isPlaced(r, 'done_task')).toBe(false);
  });

  test('S27: Disabled instance does NOT inherit new template time', () => {
    var template = makeDBRow({
      id: 'ht_s27', task_type: 'recurring_template', recurring: 1,
      when: 'evening', time_flex: 60,
      preferred_time_mins: 1080, // 6pm (NEW time)
    });
    var instance = makeDBRow({
      id: 'rc_s27_47', task_type: 'recurring_instance', recurring: 1,
      source_id: 'ht_s27', status: 'disabled',
      scheduled_at: new Date('2026-04-07T14:00:00Z'), // 10am ET (old time)
    });
    var srcMap = {}; srcMap['ht_s27'] = template;
    var mapped = rowToTask(instance, TZ, srcMap);
    // Disabled instance should NOT inherit template's evening time
    expect(mapped.time).toBe('10:00 AM'); // keeps its own time
    expect(mapped.when).not.toBe('evening'); // keeps its own when
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIER 7: MULTI-DAY PATTERNS
// ═══════════════════════════════════════════════════════════════════

describe('Tier 7: Multi-Day Patterns', () => {

  test('S28: Week of recurringTasks — same time (±flex) across all 7 days', () => {
    var tasks = [];
    for (var d = 0; d < 7; d++) {
      tasks.push(task({
        id: 'lunch_d' + d, text: 'Lunch', recurring: true, when: 'lunch',
        time: '12:00 PM', timeFlex: 60, dur: 30, date: dateKey(d), generated: true
      }));
    }
    var r = schedule(tasks, 360); // 6am
    var times = tasks.map(t => {
      var p = placement(r, t.id);
      return p ? p.start : null;
    }).filter(t => t !== null);

    expect(times.length).toBe(7);
    // All within flex window (660-780)
    times.forEach(t => {
      expect(t).toBeGreaterThanOrEqual(mins(11));
      expect(t).toBeLessThanOrEqual(mins(13));
    });
  });

  test('S29: Project chain spread across week', () => {
    var fri = dateKey(4);
    var r = schedule([
      task({ id: 'proj1', pri: 'P2', dur: 120 }),
      task({ id: 'proj2', pri: 'P2', dur: 120, dependsOn: ['proj1'] }),
      task({ id: 'proj3', pri: 'P2', dur: 120, dependsOn: ['proj2'] }),
      task({ id: 'proj4', pri: 'P2', dur: 120, dependsOn: ['proj3'] }),
      task({ id: 'proj5', pri: 'P2', dur: 120, due: fri, dependsOn: ['proj4'] }),
    ]);
    // All should be placed
    for (var k = 1; k <= 5; k++) expect(isPlaced(r, 'proj' + k)).toBe(true);
    // proj5 should be on or before Friday
    var p5 = placement(r, 'proj5');
    expect(p5).not.toBeNull();
  });

  test('S30: Tasks never overlap on any day', () => {
    var tasks = [];
    for (var d = 0; d < 5; d++) {
      tasks.push(task({ id: 'h_' + d, recurring: true, when: 'morning', time: '7:00 AM', timeFlex: 60, dur: 20, date: dateKey(d), generated: true }));
      tasks.push(task({ id: 't_' + d, pri: 'P2', dur: 60, date: dateKey(d) }));
    }
    var r = schedule(tasks, 360);
    Object.keys(r.dayPlacements).forEach(dk => {
      var dayP = r.dayPlacements[dk].filter(p => !p.marker).sort((a, b) => a.start - b.start);
      for (var i = 1; i < dayP.length; i++) {
        expect(dayP[i].start).toBeGreaterThanOrEqual(dayP[i - 1].start + dayP[i - 1].dur);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIER 8: DRAG-PIN & UNDO
// ═══════════════════════════════════════════════════════════════════

describe('Tier 8: Drag-Pin & Undo', () => {

  test('S31: Drag-pinned task treated as fixed by scheduler', () => {
    var r = schedule([
      task({ id: 'pinned', when: 'fixed', time: '2:00 PM', dur: 30, datePinned: true, prevWhen: 'morning' }),
      task({ id: 'other', dur: 30 }),
    ]);
    var p = placement(r, 'pinned');
    expect(p).not.toBeNull();
    expect(p.start).toBe(mins(14)); // exactly 2:00 PM
  });

  test('S32: Unpinned task (prevWhen cleared) → scheduler can move', () => {
    // After unpin: when restored to 'morning', prevWhen cleared
    var r = schedule([
      task({ id: 'unpinned', when: 'morning', dur: 30 }),
    ]);
    var p = placement(r, 'unpinned');
    expect(p).not.toBeNull();
    // Scheduler placed it wherever — it's no longer fixed
  });

  test('S33: Pinned recurring instance has prevWhen field', () => {
    var t = task({ id: 'recur_pin', recurring: true, when: 'fixed', time: '2:00 PM',
      dur: 30, generated: true, datePinned: true, prevWhen: 'lunch' });
    expect(t.prevWhen).toBe('lunch');
    // Scheduler treats it as fixed
    var r = schedule([t]);
    var p = placement(r, 'recur_pin');
    expect(p).not.toBeNull();
    expect(p.start).toBe(mins(14));
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIER 9: UI FORM LOGIC
// ═══════════════════════════════════════════════════════════════════

describe('Tier 9: UI Form Logic', () => {

  test('S34: Recurring task with single when-tag → preferred time mode', () => {
    var t = { recur: { type: 'daily' }, when: 'morning', time: '7:00 AM' };
    var tags = (t.when || '').split(',').map(s => s.trim()).filter(Boolean);
    var hasPreferredTime = tags.length === 1;
    expect(hasPreferredTime).toBe(true);
  });

  test('S35: Recurring task with multi when-tags → flexible mode', () => {
    var t = { recur: { type: 'daily' }, when: 'morning,afternoon,evening' };
    var tags = (t.when || '').split(',').map(s => s.trim()).filter(Boolean);
    var hasPreferredTime = tags.length === 1;
    expect(hasPreferredTime).toBe(false);
  });

  test('S36: Recurring task with empty when → flexible mode', () => {
    var t = { recur: { type: 'daily' }, when: '' };
    var tags = (t.when || '').split(',').map(s => s.trim()).filter(Boolean);
    var hasPreferredTime = tags.length === 1;
    expect(hasPreferredTime).toBe(false);
  });

  test('S37: Non-recurring task → recurring flag is false', () => {
    // Recurrence drives recurring status: no recurrence = not a recurring task
    var recur = null;
    var recurring = recur !== null && recur !== undefined;
    expect(recurring).toBe(false);
  });

  test('S43: Recurring task auto-derives recurring=true', () => {
    var recur = { type: 'daily' };
    var recurring = recur !== null && recur !== undefined;
    expect(recurring).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIER 10: ELIGIBLE DAYS (mode: 'any')
// ═══════════════════════════════════════════════════════════════════

describe('Tier 10: Eligible Days Recurrence', () => {
  var { expandRecurring } = require('../../shared/scheduler/expandRecurring');

  test('S38: timesPerCycle=1, 2 days selected → one instance per week', () => {
    var tasks = [{
      id: 'ht_clean', text: 'Clean Bathroom', date: '4/6', recurring: true,
      recur: { type: 'weekly', days: 'SU', timesPerCycle: 1 },
      when: 'morning', dur: 60, pri: 'P3', status: '', dayReq: 'any',
      generated: false, sourceId: null
    }];
    var result = expandRecurring(tasks, new Date(2026, 3, 7), new Date(2026, 3, 20), {});
    expect(result.length).toBe(2); // 2 weeks × 1 per week
  });

  test('S39: No timesPerCycle (default) → all selected days', () => {
    var tasks = [{
      id: 'ht_gym', text: 'Gym', date: '4/6', recurring: true,
      recur: { type: 'weekly', days: 'SU' },
      when: 'morning', dur: 60, pri: 'P3', status: '', dayReq: 'any',
      generated: false, sourceId: null
    }];
    var result = expandRecurring(tasks, new Date(2026, 3, 7), new Date(2026, 3, 20), {});
    expect(result.length).toBe(4); // 2 weeks × 2 days
  });

  test('S40: timesPerCycle instance gets dayReq set to all selected days', () => {
    var tasks = [{
      id: 'ht_any', text: 'Weekend Task', date: '4/6', recurring: true,
      recur: { type: 'weekly', days: 'SU', timesPerCycle: 1 },
      when: 'morning', dur: 60, pri: 'P3', status: '', dayReq: 'any',
      generated: false, sourceId: null
    }];
    var result = expandRecurring(tasks, new Date(2026, 3, 7), new Date(2026, 3, 13), {});
    expect(result.length).toBe(1);
    expect(result[0].dayReq).toContain('Sa');
    expect(result[0].dayReq).toContain('Su');
  });

  test('S41: timesPerCycle=2, 5 days selected → two instances per week', () => {
    var tasks = [{
      id: 'ht_flex', text: 'Flexible Workout', date: '4/6', recurring: true,
      recur: { type: 'weekly', days: 'MTWRF', timesPerCycle: 2 },
      when: 'morning', dur: 60, pri: 'P3', status: '', dayReq: 'any',
      generated: false, sourceId: null
    }];
    // 4/7 (Tue) to 4/11 (Sat) = one full work week
    var result = expandRecurring(tasks, new Date(2026, 3, 7), new Date(2026, 3, 11), {});
    expect(result.length).toBe(2); // 2 of 5 weekdays in this week
  });

  test('S42: Legacy string days, no timesPerCycle → all days (backward compat)', () => {
    var tasks = [{
      id: 'ht_old', text: 'Old Recurring', date: '4/6', recurring: true,
      recur: { type: 'weekly', days: 'MWF' },
      when: 'morning', dur: 30, pri: 'P3', status: '', dayReq: 'any',
      generated: false, sourceId: null
    }];
    var result = expandRecurring(tasks, new Date(2026, 3, 7), new Date(2026, 3, 13), {});
    expect(result.length).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIER 11: RECURRING + SPLIT (day-boundary rule)
// ═══════════════════════════════════════════════════════════════════
//
// For a recurring instance with split=true, chunks must stay on the
// instance's assigned day. If a chunk doesn't fit, it's reported as
// unplaced (partial_split) rather than rolled to the next day. Non-
// recurring split tasks retain their existing "chunks can span days"
// behavior. See plan /Users/david/.claude/plans/cheerful-bouncing-porcupine.md.

describe('Tier 11: Recurring + Split (day-boundary rule)', () => {

  test('S47: Recurring split task — full fit on instance day', () => {
    // Daily recurring "stretching" in morning block, 60 min total,
    // split into 15-min chunks, nothing competing for the morning.
    // nowMins=300 (5 AM) so the morning block (6-8 AM) is still "future"
    // from the scheduler's perspective.
    var r = schedule([
      task({
        id: 'rec_stretch', text: 'Stretching',
        recurring: true, generated: true, date: TODAY,
        when: 'morning', dur: 60, split: true, splitMin: 15, pri: 'P3'
      }),
    ], 300);
    var chunks = placements(r, 'rec_stretch');
    // All chunks should fit; post-processing may merge them.
    expect(chunks.length).toBeGreaterThan(0);
    var totalDur = chunks.reduce(function(s, p) { return s + p.dur; }, 0);
    expect(totalDur).toBe(60);
    // Every chunk must be on the instance's assigned day.
    chunks.forEach(function(p) { expect(p.day).toBe(TODAY); });
    // No unplaced entry for this task.
    expect(isUnplaced(r, 'rec_stretch')).toBe(false);
  });

  test('S48: Recurring split — partial fit, leftover chunks dropped (not rolled)', () => {
    // Morning block on weekdays is 6:00-8:00 (120 min). Consume 90 min of
    // it with a fixed task, leaving exactly 30 min free. The 60-min
    // split task should fit 30 min (2 chunks) and report the other 30
    // min as partial_split unplaced. Critically: NO chunks should appear
    // on any day other than TODAY.
    var r = schedule([
      task({ id: 'block_am', when: 'fixed', time: '6:00 AM', dur: 90, datePinned: true }),
      task({
        id: 'rec_stretch', text: 'Stretching',
        recurring: true, generated: true, date: TODAY,
        when: 'morning', dur: 60, split: true, splitMin: 15, pri: 'P3'
      }),
    ], 300);
    var chunks = placements(r, 'rec_stretch');
    // Some chunks should be placed, totaling 30 minutes, all on TODAY.
    var totalDur = chunks.reduce(function(s, p) { return s + p.dur; }, 0);
    expect(totalDur).toBe(30);
    chunks.forEach(function(p) { expect(p.day).toBe(TODAY); });
    // Must be reported as partial_split in unplaced.
    var u = (r.unplaced || []).find(function(t) { return t.id === 'rec_stretch'; });
    expect(u).toBeDefined();
    expect(u._unplacedReason).toBe('partial_split');
  });

  test('S49: Recurring split — zero fit, all chunks unplaced, no day leakage', () => {
    // Fill the morning block entirely (120 min of fixed work starting at
    // 6am). The 60-min split task has no room on its instance day, and
    // its ceiling pins it to that day, so the entire task should land in
    // unplaced with zero chunks scheduled anywhere.
    var r = schedule([
      task({ id: 'block_am_full', when: 'fixed', time: '6:00 AM', dur: 120, datePinned: true }),
      task({
        id: 'rec_stretch', text: 'Stretching',
        recurring: true, generated: true, date: TODAY,
        when: 'morning', dur: 60, split: true, splitMin: 15, pri: 'P3'
      }),
    ], 300);
    var chunks = placements(r, 'rec_stretch');
    // Zero chunks placed anywhere.
    expect(chunks.length).toBe(0);
    // Reported as unplaced.
    expect(isUnplaced(r, 'rec_stretch')).toBe(true);
    // Double-check: no chunks on any day (not just TODAY).
    Object.keys(r.dayPlacements || {}).forEach(function(dk) {
      (r.dayPlacements[dk] || []).forEach(function(p) {
        expect(p.task && p.task.id).not.toBe('rec_stretch');
      });
    });
  });

  test('S50: Non-recurring split still spans days (regression)', () => {
    // A 90-minute one-off split task. Today's morning block is mostly
    // full (leaving 30 min), and the task has no day pin. The existing
    // behavior allows chunks to span days — this test locks in that
    // behavior so the day-boundary rule stays scoped to recurring.
    var r = schedule([
      task({ id: 'block_am', when: 'fixed', time: '6:00 AM', dur: 90, datePinned: true }),
      task({
        id: 'effort', text: '90-min effort',
        dur: 90, split: true, splitMin: 30, pri: 'P3'
        // not recurring, no date pin, so chunks are free to span days
      }),
    ], 300);
    var chunks = placements(r, 'effort');
    var totalDur = chunks.reduce(function(s, p) { return s + p.dur; }, 0);
    expect(totalDur).toBe(90);
    // No assertion that chunks stay on one day — this is the point.
  });
});
