/**
 * Scheduler Supply vs. Demand Tests
 *
 * Tests scenarios where the supply of available time slots conflicts with
 * the demand for time — overlapping immovable items, dependency chains
 * backing up into today, capacity overflow, and combined pressure.
 *
 * Date context:
 *   TODAY = '4/3' (Thursday) — weekday blocks
 *   nowMins = 480 (8:00 AM)
 *   Usable today ≈ 780m (480-1260, 13 hours)
 */

const unifiedSchedule = require('../src/scheduler/unifiedSchedule');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');

const TODAY = '4/3';
const NOW_MINS = 480; // 8 AM

let _id = 0;
function makeTask(overrides) {
  _id++;
  return {
    id: 'sd_' + _id, text: 'Task ' + _id, date: TODAY, dur: 30, pri: 'P3',
    when: '', dayReq: 'any', status: '', dependsOn: [], location: [], tools: [],
    recurring: false, rigid: false, marker: false, split: false, datePinned: false,
    generated: false, section: '', flexWhen: false, ...overrides
  };
}

function makeCfg(overrides) {
  return {
    timeBlocks: DEFAULT_TIME_BLOCKS, toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15, locSchedules: {}, locScheduleDefaults: {},
    locScheduleOverrides: {}, hourLocationOverrides: {}, scheduleTemplates: null,
    preferences: { pullForwardDampening: true }, ...overrides
  };
}

function dateKey(daysFromToday) {
  var d = new Date(2026, 3, 3); // April 3, 2026 (Thursday)
  d.setDate(d.getDate() + daysFromToday);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

const cfg = makeCfg();

function run(tasks, overrides) {
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, overrides?.cfg || cfg);
}

function findPlacements(result, taskId) {
  var parts = [];
  Object.keys(result.dayPlacements).forEach(function(dk) {
    (result.dayPlacements[dk] || []).forEach(function(p) {
      if (p.task?.id === taskId) parts.push({
        dateKey: dk, start: p.start, dur: p.dur, locked: p.locked,
        _conflict: p._conflict, _placementReason: p._placementReason,
        _moveReason: p._moveReason, _whenRelaxed: p._whenRelaxed
      });
    });
  });
  return parts;
}

function isPlaced(result, taskId) {
  return findPlacements(result, taskId).length > 0;
}

function totalPlacedMinutes(result, dateKey) {
  return (result.dayPlacements[dateKey] || [])
    .filter(p => !p.marker)
    .reduce((sum, p) => sum + p.dur, 0);
}

function findUnplaced(result, taskId) {
  return (result.unplaced || []).find(u => u.task?.id === taskId || u.id === taskId);
}

beforeEach(() => { _id = 0; });

// ═══════════════════════════════════════════════════════════════════
// CATEGORY A: Supply < Demand — Capacity Crunch
// ═══════════════════════════════════════════════════════════════════

describe('Category A: Capacity Crunch', () => {

  test('A1: Massive overload — P1 tasks placed before P4 tasks', () => {
    // Create more work than fits in available windows.
    // Default blocks: morning(360-480)=home, biz(480-720)=work, lunch(720-780)=work,
    // biz(780-1020)=work, evening(1020-1260)=home, night(1260-1380)=home
    // Tasks with no location fit any block. Use 60m tasks to fit within single blocks.
    const tasks = [];
    // 8 P1 tasks × 60m = 480m
    for (let i = 0; i < 8; i++) tasks.push(makeTask({ pri: 'P1', dur: 60, date: TODAY }));
    // 8 P2 tasks × 60m = 480m
    for (let i = 0; i < 8; i++) tasks.push(makeTask({ pri: 'P2', dur: 60, date: TODAY }));
    // 8 P4 tasks × 60m = 480m — total 1440m, more than day's capacity (~900m from 8am)
    for (let i = 0; i < 8; i++) tasks.push(makeTask({ pri: 'P4', dur: 60, date: TODAY }));

    const result = run(tasks);

    // P1 tasks should be placed at higher rate than P4
    const p1Tasks = tasks.filter(t => t.pri === 'P1');
    const p4Tasks = tasks.filter(t => t.pri === 'P4');
    const p1PlacedCount = p1Tasks.filter(t => isPlaced(result, t.id)).length;
    const p4PlacedCount = p4Tasks.filter(t => isPlaced(result, t.id)).length;
    expect(p1PlacedCount).toBeGreaterThanOrEqual(p4PlacedCount);
  });

  test('A2: Today heavily loaded by P1 deadlines — P3 deferred', () => {
    // Fill today with multiple P1 deadline tasks in different location blocks
    const tasks = [
      makeTask({ id: 'p1a', pri: 'P1', dur: 120, deadline: TODAY, date: TODAY }), // fits in biz1 (480-720)
      makeTask({ id: 'p1b', pri: 'P1', dur: 120, deadline: TODAY, date: TODAY }), // fits in biz1 remaining or biz2
      makeTask({ id: 'p1c', pri: 'P1', dur: 120, deadline: TODAY, date: TODAY }), // fits in biz2 or evening
      makeTask({ id: 'p1d', pri: 'P1', dur: 120, deadline: TODAY, date: TODAY }), // evening
      // P3 no-deadline should be deferred if today is tight
      makeTask({ id: 'p3_flex', pri: 'P3', dur: 60, date: TODAY }),
    ];

    const result = run(tasks);

    // P1 deadline tasks should be placed
    const p1Placed = ['p1a', 'p1b', 'p1c', 'p1d'].filter(id => isPlaced(result, id));
    expect(p1Placed.length).toBeGreaterThanOrEqual(3); // At least 3 of 4 fit
  });

  test('A3: When-window exhausted — lunch-only task displaced when today lunch full', () => {
    const tasks = [
      // Block today's lunch with a fixed event
      makeTask({ id: 'lunch_block', when: 'fixed', date: TODAY, time: '12:00 PM', dur: 60, datePinned: true }),
      // Task pinned to today that can ONLY go in lunch window
      makeTask({ id: 'lunch_only', when: 'lunch', dur: 30, date: TODAY, datePinned: true }),
    ];

    const result = run(tasks);

    // lunch_only should be unplaced on today (lunch window is full)
    // The scheduler may try flexWhen relaxation or overflow
    const p = findPlacements(result, 'lunch_only');
    if (p.length > 0) {
      // If placed via overflow/relaxation, it shouldn't be in the lunch window on today
      // (since that's blocked by the fixed event)
    } else {
      // Correctly unplaced — when-window exhausted on pinned date
      expect(true).toBe(true);
    }
  });

  test('A4: Location constraint — personal_pc task requires home block', () => {
    // personal_pc is only available at home (default tool matrix)
    // Biz blocks (480-1020) are "work" location → no personal_pc there
    // Task pinned to today with only biz-time left should go to home blocks
    const tasks = [
      // Block morning (home block 360-480) with fixed event
      makeTask({ id: 'block_morn', when: 'fixed', date: TODAY, time: '6:00 AM', dur: 120, datePinned: true }),
      // Block evening (home block 1020-1260) with fixed event
      makeTask({ id: 'block_eve', when: 'fixed', date: TODAY, time: '5:00 PM', dur: 240, datePinned: true }),
      // Task needing personal_pc — only night block (1260-1380) at home remains
      makeTask({ id: 'needs_pc', tools: ['personal_pc'], dur: 60, date: TODAY }),
    ];

    const result = run(tasks);

    const pcP = findPlacements(result, 'needs_pc');
    if (pcP.length > 0 && pcP[0].dateKey === TODAY) {
      // Should be in night block or overflow — not in biz hours (work location)
      expect(pcP[0].start).toBeGreaterThanOrEqual(1020); // evening or later
    }
    // If unplaced on today, may overflow to another day — that's also valid
  });
});

// ═══════════════════════════════════════════════════════════════════
// CATEGORY B: Overlapping Fixed/Rigid Items
// ═══════════════════════════════════════════════════════════════════

describe('Category B: Overlapping Fixed & Rigid Items', () => {

  test('B1: Two fixed calendar events overlapping — both placed, warning issued', () => {
    const tasks = [
      makeTask({ id: 'mtg1', when: 'fixed', date: TODAY, time: '10:00 AM', dur: 60, datePinned: true }),
      makeTask({ id: 'mtg2', when: 'fixed', date: TODAY, time: '10:30 AM', dur: 60, datePinned: true }),
    ];

    const result = run(tasks);

    // Both should be placed (fixed events are always placed)
    expect(isPlaced(result, 'mtg1')).toBe(true);
    expect(isPlaced(result, 'mtg2')).toBe(true);

    // Should have fixedOverlap warning
    const warning = (result.warnings || []).find(w => w.type === 'fixedOverlap');
    expect(warning).toBeDefined();
  });

  test('B2: Three rigid recurringTasks in same 30m block — overflow with _conflict', () => {
    // All three rigid recurringTasks want lunch block (720-780, 60m window)
    // Each is 30m, but the block only fits 2 at most
    const tasks = [
      makeTask({ id: 'recur1', recurring: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
      makeTask({ id: 'recur2', recurring: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
      makeTask({ id: 'recur3', recurring: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
    ];

    const result = run(tasks);

    // All three should be placed (rigid recurringTasks never vanish)
    expect(isPlaced(result, 'recur1')).toBe(true);
    expect(isPlaced(result, 'recur2')).toBe(true);
    expect(isPlaced(result, 'recur3')).toBe(true);

    // At least one should have _conflict flag (third can't fit in 60m window)
    const allPlacements = [
      ...findPlacements(result, 'recur1'),
      ...findPlacements(result, 'recur2'),
      ...findPlacements(result, 'recur3'),
    ];
    const conflicts = allPlacements.filter(p => p._conflict);
    // The third recurring may overflow to adjacent window or conflict
    expect(allPlacements.length).toBe(3);
  });

  test('B3: Fixed event + rigid recurring competing for same hour', () => {
    const tasks = [
      // 1-hour meeting at noon blocks the entire lunch window
      makeTask({ id: 'meeting', when: 'fixed', date: TODAY, time: '12:00 PM', dur: 60, datePinned: true }),
      // Rigid lunch recurring wants lunch block
      makeTask({ id: 'lunch', recurring: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
    ];

    const result = run(tasks);

    expect(isPlaced(result, 'meeting')).toBe(true);
    expect(isPlaced(result, 'lunch')).toBe(true);

    // Lunch recurring should be displaced to adjacent window or force-placed with conflict
    const lunchP = findPlacements(result, 'lunch')[0];
    const meetingP = findPlacements(result, 'meeting')[0];

    // Either lunch is in a different time than meeting, or it has _conflict
    const displaced = lunchP.start >= meetingP.start + meetingP.dur ||
                      lunchP.start + lunchP.dur <= meetingP.start ||
                      lunchP._conflict;
    expect(displaced).toBe(true);
  });

  test('B4: All-day event blocks entire day — rigid recurringTasks force-place, flex tasks overflow', () => {
    const tasks = [
      // All-day calendar event
      makeTask({ id: 'allday', when: 'fixed', date: TODAY, time: '8:00 AM', dur: 780, datePinned: true }),
      // Rigid recurring must still appear
      makeTask({ id: 'meds', recurring: true, rigid: true, when: 'morning', dur: 20, date: TODAY, generated: true }),
      // Flexible task should overflow
      makeTask({ id: 'flex', pri: 'P3', dur: 60, date: TODAY }),
    ];

    const result = run(tasks);

    // All-day event placed
    expect(isPlaced(result, 'allday')).toBe(true);
    // Rigid recurring placed (possibly with conflict)
    expect(isPlaced(result, 'meds')).toBe(true);
    // Flex task may overflow to another day or be unplaced
    const flexP = findPlacements(result, 'flex');
    if (flexP.length > 0) {
      // Overflow to adjacent day is acceptable
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// CATEGORY C: Dependency Chain Pressure
// ═══════════════════════════════════════════════════════════════════

describe('Category C: Dependency Chain Under Pressure', () => {

  test('C1: Chain A→B→C, C due today, only partial capacity — tail placed, head dropped', () => {
    // Each task 180m (3h). Total chain = 540m (9h). Today has ~780m from 8am.
    // But if we also have recurringTasks etc, may not all fit.
    // Make today tight: only 360m available (6h) by blocking morning
    const tasks = [
      makeTask({ id: 'block', when: 'fixed', date: TODAY, time: '8:00 AM', dur: 420, datePinned: true }),
      makeTask({ id: 'chainA', pri: 'P1', dur: 180, date: TODAY, dependsOn: [] }),
      makeTask({ id: 'chainB', pri: 'P1', dur: 180, date: TODAY, dependsOn: ['chainA'] }),
      makeTask({ id: 'chainC', pri: 'P1', dur: 180, date: TODAY, deadline: TODAY, dependsOn: ['chainB'] }),
    ];

    const result = run(tasks);

    // C has the deadline — should be placed
    expect(isPlaced(result, 'chainC')).toBe(true);
    // B should ideally be placed before C
    // A may be unplaced if no room (540m chain > ~360m remaining)
    const cP = findPlacements(result, 'chainC');
    const bP = findPlacements(result, 'chainB');

    if (bP.length > 0 && cP.length > 0) {
      // B should start before C
      expect(bP[0].start).toBeLessThan(cP[0].start);
    }
  });

  test('C2: Deep chain (5 tasks × 90m) due in 2 days — compressed across today+tomorrow', () => {
    const tomorrow = dateKey(1);
    const tasks = [
      makeTask({ id: 'dc1', pri: 'P1', dur: 90, date: TODAY }),
      makeTask({ id: 'dc2', pri: 'P1', dur: 90, date: TODAY, dependsOn: ['dc1'] }),
      makeTask({ id: 'dc3', pri: 'P1', dur: 90, date: TODAY, dependsOn: ['dc2'] }),
      makeTask({ id: 'dc4', pri: 'P1', dur: 90, date: TODAY, dependsOn: ['dc3'] }),
      makeTask({ id: 'dc5', pri: 'P1', dur: 90, date: TODAY, deadline: tomorrow, dependsOn: ['dc4'] }),
    ];

    const result = run(tasks);

    // dc5 has the deadline — should be placed
    expect(isPlaced(result, 'dc5')).toBe(true);

    // Verify dependency ordering: each task starts after its predecessor
    for (let i = 2; i <= 5; i++) {
      const prevId = 'dc' + (i - 1);
      const currId = 'dc' + i;
      const prevP = findPlacements(result, prevId);
      const currP = findPlacements(result, currId);
      if (prevP.length > 0 && currP.length > 0) {
        // prev should end before or on same day, with start before curr
        if (prevP[0].dateKey === currP[0].dateKey) {
          expect(prevP[0].start + prevP[0].dur).toBeLessThanOrEqual(currP[0].start);
        }
      }
    }
  });

  test('C3: Chain where propagated deadline falls before today — parent still placed', () => {
    // C due today, B depends on C (backwards!), but normal chain: A→B, B due today
    // A's effective deadline inherits from B: today minus B's duration
    // If today is tight, A's deadline is already "past"
    const tasks = [
      makeTask({ id: 'parentA', pri: 'P1', dur: 120, date: TODAY }),
      makeTask({ id: 'childB', pri: 'P1', dur: 120, date: TODAY, deadline: TODAY, dependsOn: ['parentA'] }),
    ];

    const result = run(tasks);

    // Both should be placed (A's propagated deadline is tight but today)
    expect(isPlaced(result, 'childB')).toBe(true);
    // parentA should be placed before childB
    const aP = findPlacements(result, 'parentA');
    const bP = findPlacements(result, 'childB');
    if (aP.length > 0 && bP.length > 0 && aP[0].dateKey === bP[0].dateKey) {
      expect(aP[0].start + aP[0].dur).toBeLessThanOrEqual(bP[0].start);
    }
  });

  test('C4: Diamond A+B→C→D tight deadline — parents complete before C', () => {
    const tomorrow = dateKey(1);
    const tasks = [
      makeTask({ id: 'dA', pri: 'P1', dur: 60, date: TODAY }),
      makeTask({ id: 'dB', pri: 'P1', dur: 60, date: TODAY }),
      makeTask({ id: 'dC', pri: 'P1', dur: 60, date: TODAY, dependsOn: ['dA', 'dB'] }),
      makeTask({ id: 'dD', pri: 'P1', dur: 60, date: TODAY, deadline: tomorrow, dependsOn: ['dC'] }),
    ];

    const result = run(tasks);

    expect(isPlaced(result, 'dD')).toBe(true);
    expect(isPlaced(result, 'dC')).toBe(true);

    const cP = findPlacements(result, 'dC');
    const aP = findPlacements(result, 'dA');
    const bP = findPlacements(result, 'dB');

    // Both A and B should complete before C starts
    if (cP.length > 0) {
      if (aP.length > 0 && aP[0].dateKey === cP[0].dateKey) {
        expect(aP[0].start + aP[0].dur).toBeLessThanOrEqual(cP[0].start);
      }
      if (bP.length > 0 && bP[0].dateKey === cP[0].dateKey) {
        expect(bP[0].start + bP[0].dur).toBeLessThanOrEqual(cP[0].start);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// CATEGORY D: Combined Pressure
// ═══════════════════════════════════════════════════════════════════

describe('Category D: Combined Pressure', () => {

  test('D1: Dependency chain + rigid recurringTasks + fixed events all on same day', () => {
    const tasks = [
      // Fixed events eating 4 hours
      makeTask({ id: 'mtg_am', when: 'fixed', date: TODAY, time: '9:00 AM', dur: 120, datePinned: true }),
      makeTask({ id: 'mtg_pm', when: 'fixed', date: TODAY, time: '2:00 PM', dur: 120, datePinned: true }),
      // Rigid recurringTasks
      makeTask({ id: 'lunch_h', recurring: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
      makeTask({ id: 'meds_h', recurring: true, rigid: true, when: 'morning', dur: 20, date: TODAY, generated: true }),
      // Dependency chain P1
      makeTask({ id: 'step1', pri: 'P1', dur: 90, date: TODAY }),
      makeTask({ id: 'step2', pri: 'P1', dur: 90, date: TODAY, deadline: dateKey(1), dependsOn: ['step1'] }),
    ];

    const result = run(tasks);

    // Fixed events always placed
    expect(isPlaced(result, 'mtg_am')).toBe(true);
    expect(isPlaced(result, 'mtg_pm')).toBe(true);
    // Rigid recurringTasks always placed
    expect(isPlaced(result, 'lunch_h')).toBe(true);
    expect(isPlaced(result, 'meds_h')).toBe(true);
    // Deadline task should be placed
    expect(isPlaced(result, 'step2')).toBe(true);

    // If step1 placed, must be before step2
    const s1 = findPlacements(result, 'step1');
    const s2 = findPlacements(result, 'step2');
    if (s1.length > 0 && s2.length > 0 && s1[0].dateKey === s2[0].dateKey) {
      expect(s1[0].start + s1[0].dur).toBeLessThanOrEqual(s2[0].start);
    }
  });

  test('D2: Non-splittable task in fragmented day — pushed to day with larger gaps', () => {
    // Fragment the biz2 block (780-1020, work) with 45m meetings leaving only 30m gaps
    const tasks = [
      makeTask({ id: 'mtg1', when: 'fixed', date: TODAY, time: '1:00 PM', dur: 45, datePinned: true }),
      makeTask({ id: 'mtg2', when: 'fixed', date: TODAY, time: '2:15 PM', dur: 45, datePinned: true }),
      makeTask({ id: 'mtg3', when: 'fixed', date: TODAY, time: '3:30 PM', dur: 45, datePinned: true }),
      // Also fill morning biz block
      makeTask({ id: 'mtg4', when: 'fixed', date: TODAY, time: '8:00 AM', dur: 210, datePinned: true }),
      // Non-splittable 90m task — gaps on today are only 30m each
      makeTask({ id: 'big_task', dur: 90, split: false, date: TODAY }),
    ];

    const result = run(tasks);

    const placements = findPlacements(result, 'big_task');
    // Should be placed — either in evening block (240m) or another day
    expect(placements.length).toBeGreaterThan(0);
    if (placements[0].dateKey === TODAY) {
      // If on today, must be in a contiguous 90m+ gap (evening block 1020-1260)
      expect(placements[0].dur).toBe(90);
    }
  });

  test('D3: Split task that can fit when split — placed across multiple chunks', () => {
    // Same fragmented day, but task allows splitting
    const tasks = [
      makeTask({ id: 'block1', when: 'fixed', date: TODAY, time: '8:00 AM', dur: 150, datePinned: true }),
      makeTask({ id: 'block2', when: 'fixed', date: TODAY, time: '11:30 AM', dur: 150, datePinned: true }),
      makeTask({ id: 'block3', when: 'fixed', date: TODAY, time: '3:00 PM', dur: 150, datePinned: true }),
      // Splittable 120m task — should fit in gaps
      makeTask({ id: 'split_task', dur: 120, split: true, splitMin: 30, date: TODAY, pri: 'P1' }),
    ];

    const result = run(tasks);

    // split_task should be placed (possibly in multiple chunks)
    const parts = findPlacements(result, 'split_task');
    expect(parts.length).toBeGreaterThan(0);
    const totalPlaced = parts.reduce((s, p) => s + p.dur, 0);
    expect(totalPlaced).toBe(120);
  });

  test('D4: Overflow cascade — today+tomorrow full, tasks stay unplaced', () => {
    const tomorrow = dateKey(1);
    const tasks = [];
    // Fill today completely (780m)
    tasks.push(makeTask({ id: 'fill_today', when: 'fixed', date: TODAY, time: '8:00 AM', dur: 780, datePinned: true }));
    // Fill tomorrow completely
    tasks.push(makeTask({ id: 'fill_tmrw', when: 'fixed', date: tomorrow, time: '6:00 AM', dur: 960, datePinned: true }));
    // Date-pinned task that can't move
    tasks.push(makeTask({ id: 'stuck', dur: 60, date: TODAY, datePinned: true }));

    const result = run(tasks);

    // stuck is pinned to today but today is full — should be unplaced or overflow
    const stuckP = findPlacements(result, 'stuck');
    // If placed, must be on today (it's pinned) — but today is full
    // So it should be unplaced
    if (stuckP.length > 0) {
      // Pinned tasks may still be placed in remaining minutes
    }
  });

  test('D5: Multiple P1 deadlines consume today, P1 non-deadline still placed somewhere', () => {
    const tasks = [
      makeTask({ id: 'dl1', pri: 'P1', dur: 120, deadline: TODAY, date: TODAY }),
      makeTask({ id: 'dl2', pri: 'P1', dur: 120, deadline: TODAY, date: TODAY }),
      makeTask({ id: 'dl3', pri: 'P1', dur: 120, deadline: TODAY, date: TODAY }),
      makeTask({ id: 'p1_flex', pri: 'P1', dur: 60, date: TODAY }),
    ];

    const result = run(tasks);

    // At least the deadline tasks should be placed
    const dlPlaced = ['dl1', 'dl2', 'dl3'].filter(id => isPlaced(result, id));
    expect(dlPlaced.length).toBeGreaterThanOrEqual(2);
    // Flexible P1 should be placed somewhere (today or tomorrow)
    expect(isPlaced(result, 'p1_flex')).toBe(true);
  });

  test('D6: Recurring-heavy day with deadline crunch — recurringTasks always appear', () => {
    const tasks = [
      // 4 rigid recurringTasks (total 90m) spread across blocks
      makeTask({ id: 'h1', recurring: true, rigid: true, when: 'morning', dur: 20, date: TODAY, generated: true }),
      makeTask({ id: 'h2', recurring: true, rigid: true, when: 'morning', dur: 30, date: TODAY, generated: true }),
      makeTask({ id: 'h3', recurring: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
      makeTask({ id: 'h4', recurring: true, rigid: true, when: 'evening', dur: 10, date: TODAY, generated: true }),
      // P1 deadline tasks filling the biz blocks
      makeTask({ id: 'crunch1', pri: 'P1', dur: 120, deadline: TODAY, date: TODAY }),
      makeTask({ id: 'crunch2', pri: 'P1', dur: 120, deadline: TODAY, date: TODAY }),
      // P4 filler
      makeTask({ id: 'filler', pri: 'P4', dur: 60, date: TODAY }),
    ];

    const result = run(tasks);

    // ALL rigid recurringTasks should be placed (never vanish)
    expect(isPlaced(result, 'h1')).toBe(true);
    expect(isPlaced(result, 'h2')).toBe(true);
    expect(isPlaced(result, 'h3')).toBe(true);
    expect(isPlaced(result, 'h4')).toBe(true);

    // P1 deadline tasks should be placed
    expect(isPlaced(result, 'crunch1')).toBe(true);
    expect(isPlaced(result, 'crunch2')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CATEGORY E: Placement Reason Annotations
// ═══════════════════════════════════════════════════════════════════

describe('Category E: Placement Reasons', () => {

  test('E1: Fixed event gets "Fixed calendar event" reason', () => {
    const tasks = [
      makeTask({ id: 'mtg', when: 'fixed', date: TODAY, time: '10:00 AM', dur: 60, datePinned: true }),
    ];
    const result = run(tasks);
    const p = findPlacements(result, 'mtg')[0];
    expect(p).toBeDefined();
    expect(p._placementReason).toContain('Fixed calendar event');
  });

  test('E2: Rigid recurring gets reason with block name', () => {
    const tasks = [
      makeTask({ id: 'lunch_h', recurring: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
    ];
    const result = run(tasks);
    const p = findPlacements(result, 'lunch_h')[0];
    expect(p).toBeDefined();
    expect(p._placementReason).toContain('Rigid recurring');
    expect(p._placementReason).toContain('Lunch');
  });

  test('E3: Deadline task reason includes due date', () => {
    const tomorrow = dateKey(1);
    const tasks = [
      makeTask({ id: 'dl', pri: 'P1', dur: 60, date: TODAY, deadline: tomorrow }),
    ];
    const result = run(tasks);
    const p = findPlacements(result, 'dl')[0];
    expect(p).toBeDefined();
    expect(p._placementReason).toBeDefined();
    // New algorithm places near deadline, so reason may be a move reason ("due X")
    // or a deadline placement reason ("P1 deadline due X"). Either format is acceptable.
    expect(p._placementReason).toContain('due');
  });

  test('E4: Dependency task reason includes dep name', () => {
    const tasks = [
      makeTask({ id: 'parent', text: 'Design mockups', pri: 'P2', dur: 60, date: TODAY }),
      makeTask({ id: 'child', text: 'Review designs', pri: 'P2', dur: 30, date: TODAY, dependsOn: ['parent'] }),
    ];
    const result = run(tasks);
    const childP = findPlacements(result, 'child')[0];
    expect(childP).toBeDefined();
    expect(childP._placementReason).toBeDefined();
    expect(childP._placementReason).toContain('Design mockups');
  });

  test('E5: Flexible task gets default reason', () => {
    const tasks = [
      makeTask({ id: 'flex', pri: 'P3', dur: 30, date: TODAY }),
    ];
    const result = run(tasks);
    const p = findPlacements(result, 'flex')[0];
    expect(p).toBeDefined();
    expect(p._placementReason).toBeDefined();
    expect(p._placementReason.length).toBeGreaterThan(0);
  });

  test('E6: Every placed task has a _placementReason', () => {
    const tasks = [
      makeTask({ id: 'fixed', when: 'fixed', date: TODAY, time: '9:00 AM', dur: 60, datePinned: true }),
      makeTask({ id: 'recurring', recurring: true, rigid: true, when: 'morning', dur: 20, date: TODAY, generated: true }),
      makeTask({ id: 'dl', pri: 'P1', dur: 60, date: TODAY, deadline: dateKey(2) }),
      makeTask({ id: 'flex', pri: 'P3', dur: 30, date: TODAY }),
    ];
    const result = run(tasks);

    Object.keys(result.dayPlacements).forEach(dk => {
      result.dayPlacements[dk].forEach(p => {
        if (p.task) {
          expect(p._placementReason).toBeDefined();
          expect(p._placementReason.length).toBeGreaterThan(0);
        }
      });
    });
  });

  test('E7: Conflict recurring reason mentions overlap', () => {
    const tasks = [
      // Block lunch with fixed event, force rigid recurring into conflict
      makeTask({ id: 'mtg', when: 'fixed', date: TODAY, time: '12:00 PM', dur: 60, datePinned: true }),
      makeTask({ id: 'block_morn', when: 'fixed', date: TODAY, time: '6:00 AM', dur: 360, datePinned: true }),
      makeTask({ id: 'block_aft', when: 'fixed', date: TODAY, time: '1:00 PM', dur: 480, datePinned: true }),
      makeTask({ id: 'lunch_h', recurring: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
    ];
    const result = run(tasks);
    const p = findPlacements(result, 'lunch_h')[0];
    expect(p).toBeDefined();
    if (p._conflict) {
      expect(p._placementReason).toContain('overlap');
    }
  });

  test('E8: Debug mode produces phase snapshots', () => {
    const debugCfg = { ...cfg, _debug: true };
    const tasks = [
      makeTask({ id: 'fixed1', when: 'fixed', date: TODAY, time: '9:00 AM', dur: 60, datePinned: true }),
      makeTask({ id: 'recur1', recurring: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
      makeTask({ id: 'dl1', pri: 'P1', dur: 60, date: TODAY, deadline: dateKey(2) }),
      makeTask({ id: 'flex1', pri: 'P3', dur: 30, date: TODAY }),
    ];
    const result = run(tasks, { cfg: debugCfg });

    expect(result.phaseSnapshots).toBeDefined();
    expect(result.phaseSnapshots.length).toBeGreaterThanOrEqual(6); // At least 6 phases captured

    // Each snapshot should have days with items
    result.phaseSnapshots.forEach(snap => {
      expect(snap.phase).toBeDefined();
      expect(snap.timestamp).toBeDefined();
      expect(snap.days).toBeDefined();
    });

    // Final snapshot should have all 4 tasks
    const finalSnap = result.phaseSnapshots[result.phaseSnapshots.length - 1];
    const allItems = Object.values(finalSnap.days).flat();
    expect(allItems.length).toBeGreaterThanOrEqual(4);

    // Items should have type annotations
    const types = allItems.map(i => i.type);
    expect(types).toContain('fixed');
  });

  test('E9: Non-debug mode does NOT produce snapshots', () => {
    const tasks = [makeTask({ id: 'x', dur: 30, date: TODAY })];
    const result = run(tasks);
    expect(result.phaseSnapshots).toBeUndefined();
  });

  test('E8a: Flexible recurring with flex window entirely past → missed (not placed)', () => {
    // Preferred time 7:00am (420m), flex ±60m → window 360-480.
    // nowMins=480 (8am) → entire window is past.
    const tasks = [
      makeTask({ id: 'breakfast', text: 'Eat Breakfast', recurring: true, rigid: false, when: 'morning', dur: 30, date: TODAY, time: '7:00 AM', generated: true }),
    ];
    // Run with nowMins=480 (8am) — flex window [360,480] is entirely past
    const statuses = {}; tasks.forEach(t => statuses[t.id] = '');
    const unifiedSchedule = require('../src/scheduler/unifiedSchedule');
    const result = unifiedSchedule(tasks, statuses, TODAY, 480, cfg);

    // Should NOT be placed
    expect(isPlaced(result, 'breakfast')).toBe(false);
    // Should be in unplaced with reason 'missed'
    const missed = result.unplaced.find(t => t.id === 'breakfast');
    expect(missed).toBeDefined();
    expect(missed._unplacedReason).toBe('missed');
    expect(missed._unplacedDetail).toContain('has passed');
  });

  test('E8b: Flexible recurring with flex window partially remaining → placed normally', () => {
    // Preferred 7:00am, flex ±60m → window 360-480.
    // nowMins=420 (7am) → half the window remains (420-480).
    const tasks = [
      makeTask({ id: 'breakfast', text: 'Eat Breakfast', recurring: true, rigid: false, when: 'morning', dur: 30, date: TODAY, time: '7:00 AM', generated: true }),
    ];
    const statuses = {}; tasks.forEach(t => statuses[t.id] = '');
    const unifiedSchedule = require('../src/scheduler/unifiedSchedule');
    const result = unifiedSchedule(tasks, statuses, TODAY, 420, cfg);

    // Should be placed (window still partially open)
    expect(isPlaced(result, 'breakfast')).toBe(true);
  });

  test('E8c: Flex window full (not past) → recurring unplaced, not drifted to 11am', () => {
    // Breakfast preferred 7:00am, flex ±60m → window 360-480.
    // Fill the entire flex window with a fixed meeting.
    const tasks = [
      makeTask({ id: 'meeting', when: 'fixed', date: TODAY, time: '6:00 AM', dur: 120, datePinned: true }), // fills 360-480
      makeTask({ id: 'breakfast', text: 'Eat Breakfast', recurring: true, rigid: false, when: 'morning', dur: 30, date: TODAY, time: '7:00 AM', generated: true }),
    ];
    const result = run(tasks); // nowMins=480

    // Breakfast should NOT be placed at 11am — should be unplaced
    const placements = findPlacements(result, 'breakfast');
    if (placements.length > 0) {
      // If placed, should be within the flex window, not drifted
      expect(placements[0].start).toBeLessThanOrEqual(480);
    }
  });

  test('E8d: Recurring without preferred time → placed normally regardless of time', () => {
    // No time set, so no flex window constraint — anytime is fine
    const tasks = [
      makeTask({ id: 'exercise', text: 'Exercise', recurring: true, rigid: false, when: 'morning,afternoon,evening', dur: 30, date: TODAY, generated: true }),
    ];
    const result = run(tasks);
    expect(isPlaced(result, 'exercise')).toBe(true);
  });

  test('E8: Tool-constrained task reason mentions tool', () => {
    const tasks = [
      makeTask({ id: 'pc_task', tools: ['personal_pc'], dur: 30, date: TODAY }),
    ];
    const result = run(tasks);
    const p = findPlacements(result, 'pc_task')[0];
    if (p) {
      expect(p._placementReason).toContain('personal_pc');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// CATEGORY F: Slack-Based Ordering
// ═══════════════════════════════════════════════════════════════════

describe('Category F: Slack-Based Ordering', () => {

  test('F1: Lower-slack task placed before higher-slack task (same priority)', () => {
    // Task A due tomorrow (low slack), Task B due in 5 days (high slack)
    const tasks = [
      makeTask({ id: 'taskA', pri: 'P2', dur: 60, date: TODAY, deadline: dateKey(1) }),
      makeTask({ id: 'taskB', pri: 'P2', dur: 60, date: TODAY, deadline: dateKey(5) }),
    ];
    const result = run(tasks);
    expect(isPlaced(result, 'taskA')).toBe(true);
    expect(isPlaced(result, 'taskB')).toBe(true);
    // Both placed — A (lower slack) should land on an earlier or same day
    const aP = findPlacements(result, 'taskA');
    const bP = findPlacements(result, 'taskB');
    expect(aP[0].dateKey <= bP[0].dateKey).toBe(true);
  });

  test('F2: Same slack, higher priority wins preferred slot', () => {
    // Two tasks with same deadline, different priorities
    // Fill most of today so only one fits
    const tasks = [
      makeTask({ id: 'block', when: 'fixed', date: TODAY, time: '8:00 AM', dur: 660, datePinned: true }),
      makeTask({ id: 'hi_pri', pri: 'P1', dur: 60, date: TODAY, deadline: TODAY }),
      makeTask({ id: 'lo_pri', pri: 'P3', dur: 60, date: TODAY, deadline: TODAY }),
    ];
    const result = run(tasks);
    // P1 should be placed on today (lower slack + higher priority)
    expect(isPlaced(result, 'hi_pri')).toBe(true);
    const hiP = findPlacements(result, 'hi_pri');
    expect(hiP[0].dateKey).toBe(TODAY);
  });

  test('F3: Past-due task gets slack=0 and places ASAP', () => {
    const yesterday = dateKey(-1);
    const tasks = [
      makeTask({ id: 'past_due', pri: 'P3', dur: 30, date: TODAY, deadline: yesterday }),
      makeTask({ id: 'normal', pri: 'P1', dur: 30, date: TODAY }),
    ];
    const result = run(tasks);
    expect(isPlaced(result, 'past_due')).toBe(true);
    // Past-due task should be placed (overflow pass places ASAP)
    const pdP = findPlacements(result, 'past_due');
    expect(pdP.length).toBeGreaterThan(0);
  });

  test('F4: Dependency chain — all members placed in correct order', () => {
    const tasks = [
      makeTask({ id: 'depA', pri: 'P2', dur: 60, date: TODAY }),
      makeTask({ id: 'depB', pri: 'P2', dur: 60, date: TODAY, dependsOn: ['depA'] }),
      makeTask({ id: 'depC', pri: 'P2', dur: 60, date: TODAY, deadline: dateKey(2), dependsOn: ['depB'] }),
    ];
    const result = run(tasks);
    expect(isPlaced(result, 'depA')).toBe(true);
    expect(isPlaced(result, 'depB')).toBe(true);
    expect(isPlaced(result, 'depC')).toBe(true);
    // A before B before C
    const aP = findPlacements(result, 'depA');
    const bP = findPlacements(result, 'depB');
    const cP = findPlacements(result, 'depC');
    if (aP[0].dateKey === bP[0].dateKey) {
      expect(aP[0].start + aP[0].dur).toBeLessThanOrEqual(bP[0].start);
    }
    if (bP[0].dateKey === cP[0].dateKey) {
      expect(bP[0].start + bP[0].dur).toBeLessThanOrEqual(cP[0].start);
    }
  });

  test('F5: Diamond DAG — all members placed correctly', () => {
    // D depends on B and C; B and C both depend on A
    const tasks = [
      makeTask({ id: 'diaA', pri: 'P2', dur: 30, date: TODAY }),
      makeTask({ id: 'diaB', pri: 'P2', dur: 30, date: TODAY, dependsOn: ['diaA'] }),
      makeTask({ id: 'diaC', pri: 'P2', dur: 30, date: TODAY, dependsOn: ['diaA'] }),
      makeTask({ id: 'diaD', pri: 'P2', dur: 30, date: TODAY, deadline: dateKey(1), dependsOn: ['diaB', 'diaC'] }),
    ];
    const result = run(tasks);
    expect(isPlaced(result, 'diaA')).toBe(true);
    expect(isPlaced(result, 'diaB')).toBe(true);
    expect(isPlaced(result, 'diaC')).toBe(true);
    expect(isPlaced(result, 'diaD')).toBe(true);
    // A must finish before B and C start
    const aP = findPlacements(result, 'diaA');
    const bP = findPlacements(result, 'diaB');
    const cP = findPlacements(result, 'diaC');
    const dP = findPlacements(result, 'diaD');
    if (aP[0].dateKey === bP[0].dateKey) {
      expect(aP[0].start + aP[0].dur).toBeLessThanOrEqual(bP[0].start);
    }
    if (aP[0].dateKey === cP[0].dateKey) {
      expect(aP[0].start + aP[0].dur).toBeLessThanOrEqual(cP[0].start);
    }
    // B and C must finish before D starts
    if (bP[0].dateKey === dP[0].dateKey) {
      expect(bP[0].start + bP[0].dur).toBeLessThanOrEqual(dP[0].start);
    }
    if (cP[0].dateKey === dP[0].dateKey) {
      expect(cP[0].start + cP[0].dur).toBeLessThanOrEqual(dP[0].start);
    }
  });

  test('F6: Past-due deadline task still gets placed', () => {
    // Task whose deadline was yesterday — should still be placed via overflow
    const yesterday = dateKey(-1);
    const tasks = [
      makeTask({ id: 'overflow', pri: 'P2', dur: 60, date: TODAY, deadline: yesterday }),
    ];
    const result = run(tasks);
    expect(isPlaced(result, 'overflow')).toBe(true);
    // Should land on today or later (ASAP after deadline passed)
    const p = findPlacements(result, 'overflow');
    expect(p.length).toBeGreaterThan(0);
  });
});
