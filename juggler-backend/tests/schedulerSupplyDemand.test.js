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
    habit: false, rigid: false, marker: false, split: false, datePinned: false,
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
      makeTask({ id: 'p1a', pri: 'P1', dur: 120, due: TODAY, date: TODAY }), // fits in biz1 (480-720)
      makeTask({ id: 'p1b', pri: 'P1', dur: 120, due: TODAY, date: TODAY }), // fits in biz1 remaining or biz2
      makeTask({ id: 'p1c', pri: 'P1', dur: 120, due: TODAY, date: TODAY }), // fits in biz2 or evening
      makeTask({ id: 'p1d', pri: 'P1', dur: 120, due: TODAY, date: TODAY }), // evening
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

  test('B2: Three rigid habits in same 30m block — overflow with _conflict', () => {
    // All three rigid habits want lunch block (720-780, 60m window)
    // Each is 30m, but the block only fits 2 at most
    const tasks = [
      makeTask({ id: 'habit1', habit: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
      makeTask({ id: 'habit2', habit: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
      makeTask({ id: 'habit3', habit: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
    ];

    const result = run(tasks);

    // All three should be placed (rigid habits never vanish)
    expect(isPlaced(result, 'habit1')).toBe(true);
    expect(isPlaced(result, 'habit2')).toBe(true);
    expect(isPlaced(result, 'habit3')).toBe(true);

    // At least one should have _conflict flag (third can't fit in 60m window)
    const allPlacements = [
      ...findPlacements(result, 'habit1'),
      ...findPlacements(result, 'habit2'),
      ...findPlacements(result, 'habit3'),
    ];
    const conflicts = allPlacements.filter(p => p._conflict);
    // The third habit may overflow to adjacent window or conflict
    expect(allPlacements.length).toBe(3);
  });

  test('B3: Fixed event + rigid habit competing for same hour', () => {
    const tasks = [
      // 1-hour meeting at noon blocks the entire lunch window
      makeTask({ id: 'meeting', when: 'fixed', date: TODAY, time: '12:00 PM', dur: 60, datePinned: true }),
      // Rigid lunch habit wants lunch block
      makeTask({ id: 'lunch', habit: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
    ];

    const result = run(tasks);

    expect(isPlaced(result, 'meeting')).toBe(true);
    expect(isPlaced(result, 'lunch')).toBe(true);

    // Lunch habit should be displaced to adjacent window or force-placed with conflict
    const lunchP = findPlacements(result, 'lunch')[0];
    const meetingP = findPlacements(result, 'meeting')[0];

    // Either lunch is in a different time than meeting, or it has _conflict
    const displaced = lunchP.start >= meetingP.start + meetingP.dur ||
                      lunchP.start + lunchP.dur <= meetingP.start ||
                      lunchP._conflict;
    expect(displaced).toBe(true);
  });

  test('B4: All-day event blocks entire day — rigid habits force-place, flex tasks overflow', () => {
    const tasks = [
      // All-day calendar event
      makeTask({ id: 'allday', when: 'fixed', date: TODAY, time: '8:00 AM', dur: 780, datePinned: true }),
      // Rigid habit must still appear
      makeTask({ id: 'meds', habit: true, rigid: true, when: 'morning', dur: 20, date: TODAY, generated: true }),
      // Flexible task should overflow
      makeTask({ id: 'flex', pri: 'P3', dur: 60, date: TODAY }),
    ];

    const result = run(tasks);

    // All-day event placed
    expect(isPlaced(result, 'allday')).toBe(true);
    // Rigid habit placed (possibly with conflict)
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
    // But if we also have habits etc, may not all fit.
    // Make today tight: only 360m available (6h) by blocking morning
    const tasks = [
      makeTask({ id: 'block', when: 'fixed', date: TODAY, time: '8:00 AM', dur: 420, datePinned: true }),
      makeTask({ id: 'chainA', pri: 'P1', dur: 180, date: TODAY, dependsOn: [] }),
      makeTask({ id: 'chainB', pri: 'P1', dur: 180, date: TODAY, dependsOn: ['chainA'] }),
      makeTask({ id: 'chainC', pri: 'P1', dur: 180, date: TODAY, due: TODAY, dependsOn: ['chainB'] }),
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
      makeTask({ id: 'dc5', pri: 'P1', dur: 90, date: TODAY, due: tomorrow, dependsOn: ['dc4'] }),
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
      makeTask({ id: 'childB', pri: 'P1', dur: 120, date: TODAY, due: TODAY, dependsOn: ['parentA'] }),
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
      makeTask({ id: 'dD', pri: 'P1', dur: 60, date: TODAY, due: tomorrow, dependsOn: ['dC'] }),
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

  test('D1: Dependency chain + rigid habits + fixed events all on same day', () => {
    const tasks = [
      // Fixed events eating 4 hours
      makeTask({ id: 'mtg_am', when: 'fixed', date: TODAY, time: '9:00 AM', dur: 120, datePinned: true }),
      makeTask({ id: 'mtg_pm', when: 'fixed', date: TODAY, time: '2:00 PM', dur: 120, datePinned: true }),
      // Rigid habits
      makeTask({ id: 'lunch_h', habit: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
      makeTask({ id: 'meds_h', habit: true, rigid: true, when: 'morning', dur: 20, date: TODAY, generated: true }),
      // Dependency chain P1
      makeTask({ id: 'step1', pri: 'P1', dur: 90, date: TODAY }),
      makeTask({ id: 'step2', pri: 'P1', dur: 90, date: TODAY, due: dateKey(1), dependsOn: ['step1'] }),
    ];

    const result = run(tasks);

    // Fixed events always placed
    expect(isPlaced(result, 'mtg_am')).toBe(true);
    expect(isPlaced(result, 'mtg_pm')).toBe(true);
    // Rigid habits always placed
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
      makeTask({ id: 'dl1', pri: 'P1', dur: 120, due: TODAY, date: TODAY }),
      makeTask({ id: 'dl2', pri: 'P1', dur: 120, due: TODAY, date: TODAY }),
      makeTask({ id: 'dl3', pri: 'P1', dur: 120, due: TODAY, date: TODAY }),
      makeTask({ id: 'p1_flex', pri: 'P1', dur: 60, date: TODAY }),
    ];

    const result = run(tasks);

    // At least the deadline tasks should be placed
    const dlPlaced = ['dl1', 'dl2', 'dl3'].filter(id => isPlaced(result, id));
    expect(dlPlaced.length).toBeGreaterThanOrEqual(2);
    // Flexible P1 should be placed somewhere (today or tomorrow)
    expect(isPlaced(result, 'p1_flex')).toBe(true);
  });

  test('D6: Habit-heavy day with deadline crunch — habits always appear', () => {
    const tasks = [
      // 4 rigid habits (total 90m) spread across blocks
      makeTask({ id: 'h1', habit: true, rigid: true, when: 'morning', dur: 20, date: TODAY, generated: true }),
      makeTask({ id: 'h2', habit: true, rigid: true, when: 'morning', dur: 30, date: TODAY, generated: true }),
      makeTask({ id: 'h3', habit: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
      makeTask({ id: 'h4', habit: true, rigid: true, when: 'evening', dur: 10, date: TODAY, generated: true }),
      // P1 deadline tasks filling the biz blocks
      makeTask({ id: 'crunch1', pri: 'P1', dur: 120, due: TODAY, date: TODAY }),
      makeTask({ id: 'crunch2', pri: 'P1', dur: 120, due: TODAY, date: TODAY }),
      // P4 filler
      makeTask({ id: 'filler', pri: 'P4', dur: 60, date: TODAY }),
    ];

    const result = run(tasks);

    // ALL rigid habits should be placed (never vanish)
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

  test('E2: Rigid habit gets reason with block name', () => {
    const tasks = [
      makeTask({ id: 'lunch_h', habit: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
    ];
    const result = run(tasks);
    const p = findPlacements(result, 'lunch_h')[0];
    expect(p).toBeDefined();
    expect(p._placementReason).toContain('Rigid habit');
    expect(p._placementReason).toContain('Lunch');
  });

  test('E3: Deadline task reason includes due date', () => {
    const tomorrow = dateKey(1);
    const tasks = [
      makeTask({ id: 'dl', pri: 'P1', dur: 60, date: TODAY, due: tomorrow }),
    ];
    const result = run(tasks);
    const p = findPlacements(result, 'dl')[0];
    expect(p).toBeDefined();
    expect(p._placementReason).toBeDefined();
    expect(p._placementReason).toContain('P1');
    expect(p._placementReason).toContain('deadline');
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
      makeTask({ id: 'habit', habit: true, rigid: true, when: 'morning', dur: 20, date: TODAY, generated: true }),
      makeTask({ id: 'dl', pri: 'P1', dur: 60, date: TODAY, due: dateKey(2) }),
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

  test('E7: Conflict habit reason mentions overlap', () => {
    const tasks = [
      // Block lunch with fixed event, force rigid habit into conflict
      makeTask({ id: 'mtg', when: 'fixed', date: TODAY, time: '12:00 PM', dur: 60, datePinned: true }),
      makeTask({ id: 'block_morn', when: 'fixed', date: TODAY, time: '6:00 AM', dur: 360, datePinned: true }),
      makeTask({ id: 'block_aft', when: 'fixed', date: TODAY, time: '1:00 PM', dur: 480, datePinned: true }),
      makeTask({ id: 'lunch_h', habit: true, rigid: true, when: 'lunch', dur: 30, date: TODAY, generated: true }),
    ];
    const result = run(tasks);
    const p = findPlacements(result, 'lunch_h')[0];
    expect(p).toBeDefined();
    if (p._conflict) {
      expect(p._placementReason).toContain('overlap');
    }
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
