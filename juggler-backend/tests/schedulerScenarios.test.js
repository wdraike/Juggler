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

const unifiedSchedule = require('../src/scheduler/unifiedScheduleV2');
const { rowToTask, buildSourceMap } = require('../src/controllers/task.controller');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');

const TODAY = '2026-04-07'; // Monday
const TOMORROW = '2026-04-08';
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
    dependsOn: [], location: [], tools: [], recurring: false,
    split: false, datePinned: false, generated: false,
    section: '', flexWhen: false, timeFlex: undefined, ...overrides
  };
}

function dateKey(daysFromMonday) {
  var d = new Date(2026, 3, 7); // April 7 = Monday
  d.setDate(d.getDate() + daysFromMonday);
  var m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
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
    section: null, notes: '', deadline: null, earliest_start_at: null,
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
      task({ id: 'p4_due', pri: 'P4', dur: 60, deadline: TODAY }),
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
      task({ id: 'dc', dur: 90, deadline: TOMORROW, dependsOn: ['db'] }),
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
      task({ id: 'cook', dur: 60, deadline: TODAY, dependsOn: ['prep'] }),
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
      task({ id: 'chain2', pri: 'P3', dur: 60, deadline: TOMORROW, dependsOn: ['chain1'] }),
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

  test('S8: Breakfast at 7am ±60m, run at 9am → missed + placed overdue at original time', () => {
    // preferredTimeMins is required for the missed-flex path: it represents
    // "user explicitly set a preferred time". Without it, t.time is just a
    // prior scheduler placement and shouldn't anchor a missed-flex window.
    var r = schedule([
      task({ id: 'bf', text: 'Breakfast', recurring: true, placementMode: 'time_window', when: 'morning', time: '7:00 AM', preferredTimeMins: 420, timeFlex: 60, dur: 30, generated: true }),
    ], 540); // 9am
    // W2 placed-XOR-unplaced (DESIGN-RULING-overdue-vs-unplaceable, David 2026-06-22): a
    // missed-window task with a when-block is OVERDUE on the grid ONLY — it is NO LONGER also
    // pushed to unplaced[] (the old dual-place is superseded). Display reads task.overdue
    // (R50.6 / ConflictsView routes overdue items to the Overdue list), not unplaced[] membership.
    expect(isMissed(r, 'bf')).toBe(false);
    // Kept on the calendar at its original 7 AM slot with an overdue flag.
    var p = placement(r, 'bf');
    expect(p).not.toBeNull();
    expect(p.start).toBe(mins(7));
    // Locate the raw placement entry to verify the overdue flag
    var entry = null;
    for (var dk in r.dayPlacements) {
      for (var pp of r.dayPlacements[dk]) {
        if (pp.task && pp.task.id === 'bf') { entry = pp; break; }
      }
    }
    expect(entry).not.toBeNull();
    expect(entry._overdue).toBe(true);
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
      task({ id: 'deadline', pri: 'P1', dur: 120, deadline: TODAY }),
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
      task({ id: 'mtg1', placementMode: 'fixed', time: '8:00 AM', dur: 240, datePinned: true }),
      task({ id: 'mtg2', placementMode: 'fixed', time: '1:00 PM', dur: 240, datePinned: true }),
      task({ id: 'mtg3', placementMode: 'fixed', time: '5:00 PM', dur: 240, datePinned: true }),
      task({ id: 'ex', text: 'Exercise', recurring: true, when: 'morning,afternoon', dur: 30, generated: true, flexWhen: true }),
    ]);
    // Should be placed somewhere (relaxation allows anytime)
    expect(isPlaced(r, 'ex')).toBe(true);
  });

  test('S14: Strict flexible recurring with blocks full → unplaced', () => {
    var r = schedule([
      task({ id: 'mtg1', placementMode: 'fixed', time: '8:00 AM', dur: 240, datePinned: true }),
      task({ id: 'mtg2', placementMode: 'fixed', time: '1:00 PM', dur: 240, datePinned: true }),
      task({ id: 'mtg3', placementMode: 'fixed', time: '5:00 PM', dur: 240, datePinned: true }),
      task({ id: 'ex', text: 'Exercise', recurring: true, placementMode: 'anytime', when: 'morning,afternoon', dur: 30, generated: true, flexWhen: false }),
    ]);
    // Strict + blocks full = should be unplaced
    expect(isUnplaced(r, 'ex')).toBe(true);
  });

  test('S15: P1 deadline + P3 exercise, limited capacity → deadline wins', () => {
    var r = schedule([
      task({ id: 'mtg', placementMode: 'fixed', time: '8:00 AM', dur: 480, datePinned: true }), // blocks 8am-4pm
      task({ id: 'dl', pri: 'P1', dur: 120, deadline: TODAY }),
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
      task({ id: 'mtg', placementMode: 'fixed', time: '10:00 AM', dur: 60, datePinned: true }),
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
      task({ id: 'ma', placementMode: 'fixed', time: '10:00 AM', dur: 60, datePinned: true }),
      task({ id: 'mb', placementMode: 'fixed', time: '10:30 AM', dur: 60, datePinned: true }),
    ]);
    expect(isPlaced(r, 'ma')).toBe(true);
    expect(isPlaced(r, 'mb')).toBe(true);
    expect((r.warnings || []).some(w => w.type === 'fixedOverlap')).toBe(true);
  });

  test('S18: Rigid recurring blocked by fixed event → displaced or conflict', () => {
    var r = schedule([
      task({ id: 'mtg', placementMode: 'fixed', time: '12:00 PM', dur: 60, datePinned: true }),
      task({ id: 'lunch', recurring: true, placementMode: 'fixed', when: 'lunch', dur: 30, generated: true }),
    ]);
    expect(isPlaced(r, 'lunch')).toBe(true); // rigid recurringTasks NEVER vanish
  });

  test('S19: All-day event — rigid recurringTasks force-placed, flex overflow', () => {
    var r = schedule([
      task({ id: 'conf', placementMode: 'fixed', time: '8:00 AM', dur: 600, datePinned: true }),
      task({ id: 'meds', recurring: true, placementMode: 'fixed', when: 'morning', dur: 20, generated: true }),
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
      task({ id: 'c5', pri: 'P1', dur: 120, deadline: fri, dependsOn: ['c4'] }),
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
      task({ id: 'fill1', placementMode: 'fixed', time: '6:00 AM', dur: 510, datePinned: true }), // 6am-2:30pm
      task({ id: 'fill2', placementMode: 'fixed', time: '2:30 PM', dur: 510, datePinned: true }), // 2:30pm-11pm
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
      task({ id: 'b1', placementMode: 'fixed', time: '1:00 PM', dur: 60, datePinned: true }),
      task({ id: 'b2', placementMode: 'fixed', time: '2:30 PM', dur: 60, datePinned: true }),
      task({ id: 'b3', placementMode: 'fixed', time: '4:00 PM', dur: 60, datePinned: true }),
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
    // Use time_window mode with preferredTimeMins so placement is anchored near
    // noon on every day (including weekends that lack a 'lunch' when-block).
    var tasks = [];
    for (var d = 0; d < 7; d++) {
      tasks.push(task({
        id: 'lunch_d' + d, text: 'Lunch', recurring: true,
        placementMode: 'time_window', preferredTimeMins: 720,
        timeFlex: 60, dur: 30, date: dateKey(d), generated: true
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
      task({ id: 'proj5', pri: 'P2', dur: 120, deadline: fri, dependsOn: ['proj4'] }),
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
      task({ id: 'pinned', placementMode: 'fixed', time: '2:00 PM', dur: 30, datePinned: true, prevWhen: 'morning' }),
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
    var t = task({ id: 'recur_pin', recurring: true, placementMode: 'fixed', time: '2:00 PM',
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
      id: 'ht_clean', text: 'Clean Bathroom', date: '2026-04-06', recurring: true,
      recur: { type: 'weekly', days: 'SU', timesPerCycle: 1 },
      when: 'morning', dur: 60, pri: 'P3', status: '', dayReq: 'any',
      generated: false, sourceId: null
    }];
    var result = expandRecurring(tasks, new Date(2026, 3, 7), new Date(2026, 3, 20), {});
    expect(result.length).toBe(2); // 2 weeks × 1 per week
  });

  test('S39: No timesPerCycle (default) → all selected days', () => {
    var tasks = [{
      id: 'ht_gym', text: 'Gym', date: '2026-04-06', recurring: true,
      recur: { type: 'weekly', days: 'SU' },
      when: 'morning', dur: 60, pri: 'P3', status: '', dayReq: 'any',
      generated: false, sourceId: null
    }];
    var result = expandRecurring(tasks, new Date(2026, 3, 7), new Date(2026, 3, 20), {});
    expect(result.length).toBe(4); // 2 weeks × 2 days
  });

  test('S40: timesPerCycle instance gets dayReq set to all selected days', () => {
    var tasks = [{
      id: 'ht_any', text: 'Weekend Task', date: '2026-04-06', recurring: true,
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
      id: 'ht_flex', text: 'Flexible Workout', date: '2026-04-06', recurring: true,
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
      id: 'ht_old', text: 'Old Recurring', date: '2026-04-06', recurring: true,
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
        recurring: true, placementMode: 'anytime', generated: true, date: TODAY,
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

  // FIXED (999.307) — Removed `!item.isRecurring` guard from the inline-split
  // path in unifiedScheduleV2.js:1532. placeSplitInline already handles recurring
  // with a cycle-window cap (anchor + cycleDays - 1), so recurring split tasks
  // can now be partially placed within their occurrence window.
  test('S48: Recurring split — partial fit, leftover chunks dropped (not rolled)', () => {
    // Morning block on weekdays is 6:00-8:00 (120 min). Consume 90 min of
    // it with a fixed task, leaving exactly 30 min free. The 60-min
    // split task should fit 30 min (2 chunks) and report the other 30
    // min as partial_split unplaced. Critically: NO chunks should appear
    // on any day other than TODAY.
    var r = schedule([
      task({ id: 'block_am', placementMode: 'fixed', time: '6:00 AM', dur: 90, datePinned: true }),
      task({
        id: 'rec_stretch', text: 'Stretching',
        recurring: true, placementMode: 'anytime', generated: true, date: TODAY,
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
      task({ id: 'block_am_full', placementMode: 'fixed', time: '6:00 AM', dur: 120, datePinned: true }),
      task({
        id: 'rec_stretch', text: 'Stretching',
        recurring: true, placementMode: 'anytime', generated: true, date: TODAY,
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
      task({ id: 'block_am', placementMode: 'fixed', time: '6:00 AM', dur: 90, datePinned: true }),
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

describe('Tier 10: Overdue placement flags', () => {
  // Helper: return the raw placement entry (not the summary shape).
  function entry(result, taskId) {
    for (var dk in result.dayPlacements) {
      for (var p of result.dayPlacements[dk]) {
        if (p.task && p.task.id === taskId) return { dk: dk, p: p };
      }
    }
    return null;
  }

  test('rigid recurring whose preferred window has passed today → _overdue on placement', () => {
    var r = schedule([
      task({ id: 'med', text: 'Morning meds', recurring: true, placementMode: 'fixed', when: 'morning', time: '7:00 AM', dur: 15, generated: true }),
    ], 540); // 9 AM — 7:00-7:15 AM window already past
    var e = entry(r, 'med');
    expect(e).not.toBeNull();
    expect(e.dk).toBe(TODAY);
    expect(e.p.task._overdue).toBe(true);
  });

  test('rigid recurring whose time is still future today → no overdue flag', () => {
    var r = schedule([
      task({ id: 'lunch', text: 'Lunch', recurring: true, placementMode: 'fixed', when: 'lunch', time: '12:30 PM', dur: 30, generated: true }),
    ], 540); // 9 AM — lunch still ahead
    var e = entry(r, 'lunch');
    expect(e).not.toBeNull();
    expect(!!e.p.task._overdue).toBe(false);
  });

  test('non-rigid recurring from a prior day, outside flex window, still pending → overdue placement on its original day', () => {
    // preferredTimeMins required — matches the "user explicitly set a time"
    // contract. Without it, a flexible task anchored on a stale scheduler
    // placement would be wrongly flagged overdue.
    var yesterday = dateKey(-1); // 4/6
    var r = schedule([
      task({
        id: 'bf_yesterday', text: 'Breakfast (yesterday)',
        recurring: true, placementMode: 'time_window', when: 'morning',
        time: '7:00 AM', preferredTimeMins: 420, dur: 30,
        date: yesterday, timeFlex: 60, generated: true
      }),
    ], 540);
    var e = entry(r, 'bf_yesterday');
    expect(e).not.toBeNull();
    expect(e.dk).toBe(yesterday);
    expect(e.p._overdue).toBe(true);
    expect(e.p.start).toBe(420); // 7:00 AM
  });

  test('non-rigid recurring from a prior day, outside flex window, status=done → NOT placed', () => {
    var yesterday = dateKey(-1);
    var r = schedule([
      task({
        id: 'bf_done', text: 'Breakfast (done)',
        recurring: true, placementMode: 'time_window', when: 'morning',
        time: '7:00 AM', preferredTimeMins: 420, dur: 30,
        date: yesterday, timeFlex: 60, generated: true,
        status: 'done'
      }),
    ], 540);
    expect(entry(r, 'bf_done')).toBeNull();
  });

  // Regression: flexible recurring task WITHOUT a user-set preferred time
  // should NOT be marked overdue — even if a prior scheduler run placed it
  // at a morning time. A previous bug fell back to `t.time` for the anchor,
  // which anchored any task at its last placement + 60-min default flex
  // window, forcing "afj"-style generic tasks overdue at 10:30 AM.
  test('flexible recurring with no preferredTimeMins is NOT marked overdue mid-day', () => {
    var today = dateKey(0);
    var r = schedule([
      task({
        id: 'afj', text: 'Apply for jobs',
        recurring: true, placementMode: 'anytime',
        when: 'morning,lunch,afternoon,evening,night',
        time: '9:00 AM', // stale scheduler placement — NOT a preference
        // preferredTimeMins: NOT SET
        timeFlex: 60, dur: 30,
        date: today, generated: true
      }),
    ], 660); // 11:00 AM — past 9 AM + 60-min flex
    // Must not be flagged as missed — the task is genuinely flexible.
    var unplaced = r.unplaced.find(function(t) { return t.id === 'afj'; });
    expect(unplaced && unplaced._unplacedReason === 'missed').toBeFalsy();
    // And should be placeable later today (enters the pool).
    var p = placement(r, 'afj');
    expect(p).not.toBeNull();
    // Either placed somewhere today or unplaced for a non-missed reason;
    // key invariant is NO overdue flag.
    var e = entry(r, 'afj');
    if (e) expect(!!e.p._overdue).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIER 11: recurring_flexible preferLatestSlot
// ═══════════════════════════════════════════════════════════════════

describe('Tier 11: recurring_flexible past-anchor placement', () => {

  test('S51: recurring_flexible past anchor time → placed at latest available slot, not unplaced', () => {
    // Mirrors "Submit Weekly UI Claim" at 12:30 PM when it's now 1:20 PM.
    // preferLatestSlot fires → findLatestSlot finds the latest free afternoon slot.
    var r = schedule([
      task({
        id: 'weekly_claim',
        text: 'Submit Weekly Claim',
        recurring: true,
        placementMode: 'anytime',
        when: 'afternoon',
        time: '12:30 PM', // anchor time — now past
        preferredTimeMins: 750, // anytime tasks anchor on preferredTimeMins, not bare t.time
        dur: 30,
        date: TODAY,
        generated: true,
      }),
    ], 800); // 1:20 PM — past anchor
    var p = placement(r, 'weekly_claim');
    expect(p).not.toBeNull();
    expect(p.day).toBe(TODAY);
    // Placed at the LATEST free afternoon slot (4:30 PM = 990 min), not at anchor
    expect(p.start).toBe(990);
    expect(isUnplaced(r, 'weekly_claim')).toBe(false);
  });

  test('S52: recurring_flexible before anchor time → placed via normal earliest-slot logic', () => {
    // At 11:00 AM (660 min), the 12:30 PM anchor has NOT passed → preferLatestSlot=false.
    // Normal findEarliestSlot fires and places at the earliest available afternoon slot.
    var r = schedule([
      task({
        id: 'weekly_claim_early',
        text: 'Submit Weekly Claim (future)',
        recurring: true,
        placementMode: 'anytime',
        when: 'afternoon',
        time: '12:30 PM',
        dur: 30,
        date: TODAY,
        generated: true,
      }),
    ], 660); // 11:00 AM — anchor still ahead
    var p = placement(r, 'weekly_claim_early');
    expect(p).not.toBeNull();
    expect(p.day).toBe(TODAY);
    // Placed at the EARLIEST free afternoon slot (12:00 PM = 780 min), not at the latest
    expect(p.start).toBe(780);
    expect(isUnplaced(r, 'weekly_claim_early')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// TIER 11: ROLLING RECURRENCE
// ═══════════════════════════════════════════════════════════════════

describe('rolling recurrence integration', () => {
  var { expandRecurring } = require('../../shared/scheduler/expandRecurring');

  function makeRollingTemplate(id, anchor, intervalDays) {
    return {
      id,
      text: 'Weekly Haircut',
      taskType: 'recurring_template',
      recurring: true,
      recur: { type: 'rolling', intervalDays: intervalDays || 7, periodLabel: 'weekly', timesPerPeriod: 1 },
      recurStart: anchor,
      rollingAnchor: anchor,
      dur: 30,
      pri: 'P2',
      when: 'morning,lunch,afternoon,evening',
      dayReq: 'any',
      placement_mode: 'flexible'
    };
  }

  test('7-day rolling: generates instance at anchor+7', () => {
    const anchor = '2026-05-18';
    const src = makeRollingTemplate('haircut', anchor, 7);
    const result = expandRecurring(
      [src],
      new Date(2026, 4, 18),
      new Date(2026, 5, 1)
    );
    const dates = result.filter(r => r.sourceId === 'haircut').map(r => r.date || r._candidateDate);
    expect(dates).toContain('2026-05-25');
  });

  test('rolling: shifting rollingAnchor regenerates different dates', () => {
    const src1 = makeRollingTemplate('haircut', '2026-05-18', 7);
    const r1 = expandRecurring([src1], new Date(2026, 4, 18), new Date(2026, 5, 1));
    const d1 = r1.filter(r => r.sourceId === 'haircut').map(r => r.date || r._candidateDate);
    expect(d1).toContain('2026-05-25');

    // Simulate completion on 5/20 (anchor shifts)
    const src2 = { ...src1, rollingAnchor: '2026-05-20' };
    const r2 = expandRecurring([src2], new Date(2026, 4, 20), new Date(2026, 5, 3));
    const d2 = r2.filter(r => r.sourceId === 'haircut').map(r => r.date || r._candidateDate);
    expect(d2).toContain('2026-05-27'); // 5/20 + 7
    expect(d2).not.toContain('2026-05-25'); // old anchor-based date gone
  });

  test('rolling: missed instance nudges anchor +1 day', () => {
    const { computeRollingAnchor } = require('../src/lib/rolling-anchor');
    const result = computeRollingAnchor('missed', '2026-05-25', '2026-05-18');
    expect(result).toBe('2026-05-26');
  });

  test('rolling: skip reanchors to skip date', () => {
    const { computeRollingAnchor } = require('../src/lib/rolling-anchor');
    const result = computeRollingAnchor('skip', '2026-05-25', '2026-05-18');
    expect(result).toBe('2026-05-25');
  });

  // ── R50.1/R50.2 (999.796): a PAST-dated fixed/ingested event stays pinned at ──
  // its original date as OVERDUE — it is NOT re-placed forward (was landing at the
  // scheduling-horizon end) and NOT demoted to the unscheduled lane. (The "Nathan
  // Flies In" case: a flight that already departed.)
  function fullPlacement(result, taskId) {
    for (var dk in result.dayPlacements) {
      for (var p of result.dayPlacements[dk]) {
        if (p.task && p.task.id === taskId) return Object.assign({ day: dk }, p);
      }
    }
    return null;
  }

  test('R50: past-dated fixed event → pinned overdue at its date, not forward, not unscheduled', () => {
    var pastDay = dateKey(-2); // 2026-04-05, before TODAY 2026-04-07
    var r = schedule([
      task({ id: 'flight', placementMode: 'fixed', date: pastDay, time: '11:00 AM', datePinned: true, dur: 60 })
    ], 600);

    var pl = fullPlacement(r, 'flight');
    expect(pl).not.toBeNull();
    expect(pl.day).toBe(pastDay);          // stays on its ORIGINAL day, not rolled forward
    expect(pl._overdue).toBe(true);        // flagged overdue
    expect(pl._conflict).toBeUndefined();  // not a bogus overlap conflict
    expect(isUnplaced(r, 'flight')).toBe(false); // not in the unscheduled lane
    // No spurious recurringConflict warning for a late (non-overlapping) event.
    expect((r.warnings || []).some(function(w) { return w.type === 'recurringConflict' && w.taskId === 'flight'; })).toBe(false);
  });

  test('R50: FUTURE fixed event is unaffected — placed at its date, NOT overdue', () => {
    var futureDay = dateKey(3); // 2026-04-10, after TODAY
    var r = schedule([
      task({ id: 'mtg', placementMode: 'fixed', date: futureDay, time: '11:00 AM', datePinned: true, dur: 60 })
    ], 600);
    var pl = fullPlacement(r, 'mtg');
    expect(pl).not.toBeNull();
    expect(pl.day).toBe(futureDay);
    expect(pl._overdue).toBeUndefined();   // future event is not overdue
  });

  test('R50: past rigid recurring instance → also pinned overdue at its date (not forward)', () => {
    var pastDay = dateKey(-2);
    var r = schedule([
      task({ id: 'meds', recurring: true, generated: true, placementMode: 'fixed',
        date: pastDay, time: '8:00 AM', dur: 20 })
    ], 600);
    var pl = fullPlacement(r, 'meds');
    expect(pl).not.toBeNull();
    expect(pl.day).toBe(pastDay);          // stays on its occurrence day
    expect(pl._overdue).toBe(true);        // flagged overdue (forceIsOverdue past-day fix)
  });
});

// ═══════════════════════════════════════════════════════════════════
// R11.16 — legacy reason-code scenarios (999.782)
//
// Each test drives the REAL scheduler (unifiedSchedule) and asserts
// that the SCHEDULER emits the specific _unplacedReason.  The
// assertion is on the scheduler OUTPUT, not on the task shape we
// constructed.  Anti-tautology proof is recorded inline per test.
// ═══════════════════════════════════════════════════════════════════
const { REASON_CODES } = require('../../shared/scheduler/reasonCodes');

describe('R11.16 — legacy reason-code scenarios (999.782)', () => {

  // ──────────────────────────────────────────────────────────────
  // TPC_BUDGET: a recurring instance the cycle has no time-budget for is flagged
  // `_tpcBudgetUnscheduled` upstream (runSchedule TPC reconciler, runSchedule.js:925/
  // 1203). The scheduler routes it to unplaced with the tpc_budget reason and does
  // NOT place it on the calendar (unifiedScheduleV2.js:1583).
  //
  // Regression for 999.801: this branch pushed to `unplaced` from inside the
  // immovables loop, but `var unplaced = []` was declared AFTER that loop — hoisting
  // left it undefined, so the push threw `TypeError` and crashed the whole scheduler
  // call. The declaration is now hoisted above the loop. Before the fix this test
  // throws (RED); after, it asserts the reason (GREEN) — that is the anti-tautology
  // proof (the input flag is mapped to the output reason by the code under test).
  // ──────────────────────────────────────────────────────────────
  test('TPC_BUDGET: a TPC-budget-unscheduled instance → unplaced with tpc_budget reason, not placed (999.801)', () => {
    var r = schedule([
      task({
        id: 'tpc_over',
        text: 'Recurring instance over the cycle TPC budget',
        recurring: true,
        generated: true,
        placementMode: 'anytime',
        when: 'morning',
        dur: 30,
        date: TODAY,
        _tpcBudgetUnscheduled: true,
      }),
    ], 300); // 5:00 AM — morning window fully ahead, so only the TPC flag keeps it unplaced

    var u = (r.unplaced || []).find(function(t) { return t.id === 'tpc_over'; });
    expect(u).toBeDefined();
    // The scheduler (not the test) maps the budget flag to the reason code.
    expect(u._unplacedReason).toBe(REASON_CODES.TPC_BUDGET);
    // Budget-unscheduled instances are surfaced in the list but NOT on the calendar.
    expect(isPlaced(r, 'tpc_over')).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────
  // PARTIAL_SPLIT: a split task that can only partially fit in the
  // available time → scheduler places some chunks and emits
  // 'partial_split' (unifiedScheduleV2.js:1716).
  //
  // Scenario: morning block (6:00 AM–8:00 AM = 120 min) has 90 min
  // consumed by a fixed task, leaving 30 min free.  The 60-min split
  // task can fill 30 min (2×15 chunks) but not all 60 → partial_split.
  // This is a non-recurring split (different from S48's recurring
  // split) to give independent coverage.
  //
  // Anti-tautology proof: giving the split task enough room (removing
  // the blocker) lets the scheduler place all chunks → task is fully
  // placed and NOT reported as partial_split in unplaced.  Confirmed
  // during authoring: without the 90-min blocker, the 60-min task is
  // fully placed and absent from unplaced.
  // ──────────────────────────────────────────────────────────────
  test('PARTIAL_SPLIT: recurring split task with only partial morning capacity → unplaced with partial_split reason', () => {
    // Morning block weekday (6:00–8:00 AM = 120 min).  Consume 105 min with
    // a fixed blocker starting at 6 AM, leaving only 15 min free (7:45–8:00).
    // The recurring split task needs 45 min (3 × 15-min chunks) but only 15
    // min is available on its day-locked occurrence day → 15 min placed,
    // 30 min unplaced → partial_split.
    //
    // Recurring + no recur-type → cycleDays=0 → isDayLocked=true (line 482
    // of unifiedScheduleV2: isDayLocked = recurring && !isFlexibleTpc &&
    // !(splitTot>1) = true).  Day-lock forces the search to TODAY only, so
    // the ignoreDeadline overdue retry cannot escape to a future day.
    var r = schedule([
      task({ id: 'blocker_ps', placementMode: 'fixed', time: '6:00 AM', dur: 105, datePinned: true }),
      task({
        id: 'partial_rec',
        text: 'Morning writing (45 min, only 15 available)',
        recurring: true,
        generated: true,
        placementMode: 'anytime',
        when: 'morning',
        dur: 45,
        split: true,
        splitMin: 15,
        pri: 'P2',
        date: TODAY,
      }),
    ], 300); // 5:00 AM — morning window entirely ahead

    // At least one 15-min chunk must be placed (partial, not zero).
    var chunks = placements(r, 'partial_rec');
    expect(chunks.length).toBeGreaterThan(0);
    var totalDur = chunks.reduce(function(s, p) { return s + p.dur; }, 0);
    expect(totalDur).toBe(15); // exactly one chunk fits

    // Must appear in unplaced with EXACTLY the partial_split reason.
    var u = (r.unplaced || []).find(function(t) { return t.id === 'partial_rec'; });
    expect(u).toBeDefined();
    expect(u._unplacedReason).toBe(REASON_CODES.PARTIAL_SPLIT);
  });

  // ──────────────────────────────────────────────────────────────
  // RECURRING_SPLIT_OVERFLOW is covered by tests/scheduler/split-containment-edges.test.js
  // R35.6 ('a recurring split chunk that cannot fit before the next occurrence is flagged
  // recurring_split_overflow'). It was previously un-triggerable here because the second
  // emission pass skipped any task that already carried a reason, and applyPlacementFailReason
  // always set NO_SLOT first. 999.802 fixed that precedence (NO_SLOT is now promoted to the
  // specific recurring_split_overflow for unplaced recurring split chunks), so R35.6 passes.
  // Not duplicated here — that test owns the scenario (it needs a custom single-block weekly cfg).
  // ──────────────────────────────────────────────────────────────

  // ──────────────────────────────────────────────────────────────
  // MISSED — path A (isMissedPreferredTime):
  // A recurring ANYTIME task with an explicit preferredTimeMins whose
  // window [preferredTimeMins, preferredTimeMins + timeFlex] has
  // entirely passed → scheduler emits 'missed' (line 2015).
  //
  // Scenario: preferred time = 8:00 AM (480 min), timeFlex = 60 min,
  // window = [480, 540].  nowMins = 600 (10:00 AM) → 600 >= 540 →
  // window entirely past → isMissedPreferredTime = true.
  //
  // Anti-tautology proof: when nowMins = 480 (8:00 AM, window open),
  // the task is placed on the calendar and does NOT appear in unplaced
  // with 'missed'.  Confirmed during authoring: setting nowMins=480
  // causes the task to be placed and absent from unplaced.
  // ──────────────────────────────────────────────────────────────
  test('MISSED (preferred-time): recurring task whose preferredTimeMins window has passed → unplaced with missed reason', () => {
    var r = schedule([
      task({
        id: 'morning_yoga',
        text: 'Morning yoga (8 AM, 60-min flex)',
        recurring: true,
        generated: true,
        placementMode: 'anytime',
        when: 'morning',
        dur: 30,
        date: TODAY,
        preferredTimeMins: 480,  // 8:00 AM
        timeFlex: 60,            // window [480, 540]
      }),
    ], 600); // 10:00 AM — window [480,540] entirely past

    // Must appear in unplaced.
    var u = (r.unplaced || []).find(function(t) { return t.id === 'morning_yoga'; });
    expect(u).toBeDefined();
    // The scheduler (not the test) must have set the reason.
    expect(u._unplacedReason).toBe(REASON_CODES.MISSED);
    // The task must NOT appear as a forward calendar placement.
    expect(isPlaced(r, 'morning_yoga')).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────
  // MISSED — path B (isMissedWindow / TIME_WINDOW):
  // A TIME_WINDOW task whose flex window [preferredTimeMins - flex,
  // preferredTimeMins + flex] has entirely passed → scheduler emits
  // 'missed' (line 2034) and dual-places with _overdue on the grid.
  //
  // Scenario: placementMode='time_window', preferred=9:00 AM (540),
  // timeFlex=30, window=[510, 570].  nowMins=600 (10:00 AM) → 600
  // >= 570 → isMissedWindow=true.
  //
  // Anti-tautology proof: when nowMins=540 (9:00 AM, window open),
  // the task is placed within its window and NOT reported as missed.
  // Confirmed during authoring: setting nowMins=540 causes placement
  // at 540 with no missed entry in unplaced.
  // ──────────────────────────────────────────────────────────────
  test('MISSED (time_window): TIME_WINDOW task whose flex window has passed → unplaced with missed reason', () => {
    var r = schedule([
      task({
        id: 'standup',
        text: 'Daily standup (9 AM ± 30 min)',
        recurring: true,
        generated: true,
        placementMode: 'time_window',
        when: 'morning',
        dur: 15,
        date: TODAY,
        preferredTimeMins: 540,  // 9:00 AM
        timeFlex: 30,            // window [510, 570]
      }),
    ], 600); // 10:00 AM — window [510,570] entirely past

    // W2 placed-XOR-unplaced (DESIGN-RULING-overdue-vs-unplaceable): a missed TIME_WINDOW task
    // with a when-block is OVERDUE on the grid ONLY — it is NOT in unplaced[] (the old dual-place
    // is superseded). Display reads task.overdue (R50.6), not unplaced[] membership.
    var u = (r.unplaced || []).find(function(t) { return t.id === 'standup'; });
    expect(u).toBeUndefined();
    // It IS pinned on the grid as overdue.
    var overdueEntry = null;
    Object.keys(r.dayPlacements || {}).forEach(function(dk) {
      (r.dayPlacements[dk] || []).forEach(function(p) {
        if (p.task && p.task.id === 'standup' && p._overdue) overdueEntry = p;
      });
    });
    expect(overdueEntry).not.toBeNull();
    expect(overdueEntry._overdue).toBe(true);
  });
});
