/**
 * RED repro test — recurring split timebox bug (split-sched-750 / 999.750)
 *
 * Bug: timeBoxRecurringSplits() computes ONE cycle boundary PER MASTER from the
 * globally-earliest chunk date. For a daily split (cycleLen=1) the boundary is
 * firstOccurrence+1 day, so every occurrence after the first is wrongly flagged
 * recurring_split_overflow and stripped — even the primary (ordinal-1) chunk of
 * each occurrence.
 *
 * Fix direction: boundary must be PER OCCURRENCE — each occurrence's chunks must
 * finish within cycleLen days of THAT occurrence's own anchor date.
 *
 * Suite structure:
 *   RED test  — fails on current code, must pass after fix
 *   GUARD test — passes on current AND fixed code (protects legit time-boxing)
 *
 * Run: cd juggler/juggler-backend && npx jest tests/recurringSplitTimebox.test.js
 * (pure unit — no DB)
 */

// Mock DB so require('../src/db') inside unifiedScheduleV2's transitive deps doesn't
// try to connect during a unit test.
jest.mock('../src/db', () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = () => mock;
  mock.fn = fn;
  return mock;
});

const unifiedSchedule = require('../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');

// ── Date helpers ─────────────────────────────────────────────────────────────

// Base date: 2026-06-20 (Saturday) — first occurrence day for the fixture.
// Using this as todayKey so all 5 occurrence days (06-20..06-24) are today/future.
const TODAY = '2026-06-20';

function addDays(dateKey, n) {
  var d = new Date(dateKey + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

// ── Scheduler config ─────────────────────────────────────────────────────────

const cfg = {
  timeBlocks: DEFAULT_TIME_BLOCKS,
  toolMatrix: DEFAULT_TOOL_MATRIX,
  splitMinDefault: 15,
  locSchedules: {},
  locScheduleDefaults: {},
  locScheduleOverrides: {},
  hourLocationOverrides: {},
  scheduleTemplates: null,
  preferences: { pullForwardDampening: true },
};

// nowMins = 300 (5:00 AM) — well before any schedulable block so today's slots
// are not "past" from the scheduler's perspective.
const NOW_MINS = 300;

function schedule(tasks, todayKey) {
  var statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = t.status || ''; });
  return unifiedSchedule(tasks, statuses, todayKey || TODAY, NOW_MINS, cfg);
}

// ── Fixture builders ─────────────────────────────────────────────────────────

// The real "Apply for Jobs" pattern: master expands to one set of chunks per day.
// Each chunk: dur=60, splitTotal=4, splitOrdinal=1..4, recurring=true, split=true,
//             splitMin=60, placementMode='anytime', dayReq='any'.
// This mirrors what reconcileSplits produces for a daily recurring task.
const MASTER_ID = 'master-afj-750';
const DAILY_RECUR = { type: 'daily', every: 1, days: 'MTWRFSU' };

function makeChunk(day, ordinal) {
  return {
    id: 'afj-' + day + '-ord' + ordinal,
    text: 'Apply for Jobs',
    date: day,
    dur: 60,
    pri: 'P2',
    when: '',
    dayReq: 'any',
    status: '',
    recurring: true,
    split: true,
    splitMin: 60,
    splitOrdinal: ordinal,
    splitTotal: 4,
    // sourceId is the masterId key that timeBoxRecurringSplits reads:
    //   var mid = p.task.sourceId || p.task.master_id || null;
    sourceId: MASTER_ID,
    placementMode: 'anytime',
    dependsOn: [],
    location: [],
    tools: [],
    datePinned: false,
    generated: false,
    section: '',
    flexWhen: false,
    recur: DAILY_RECUR,
  };
}

// Build 5 consecutive days of 4 chunks each = 20 chunks total (days 0..4).
function buildDailyFixture(startDay, numDays) {
  var tasks = [];
  for (var d = 0; d < numDays; d++) {
    var day = addDays(startDay, d);
    for (var ord = 1; ord <= 4; ord++) {
      tasks.push(makeChunk(day, ord));
    }
  }
  return tasks;
}

// ── Helper: collect all placement days for a master ───────────────────────────

function chunksByDay(result) {
  var byDay = {};
  Object.keys(result.dayPlacements || {}).forEach(function(dk) {
    (result.dayPlacements[dk] || []).forEach(function(p) {
      if (!p.task) return;
      if ((p.task.sourceId || p.task.master_id) === MASTER_ID) {
        if (!byDay[dk]) byDay[dk] = 0;
        byDay[dk]++;
      }
    });
  });
  return byDay;
}

function overflowUnplaced(result) {
  return (result.unplaced || []).filter(function(u) {
    var task = u.task || u;
    return (task.sourceId || task.master_id) === MASTER_ID &&
           task._unplacedReason === 'recurring_split_overflow';
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RED TEST — fails on current code, must pass after fix
// ─────────────────────────────────────────────────────────────────────────────

describe('recurringSplitTimebox — RED repro (split-sched-750)', () => {
  test(
    'RED: daily recurring split across 5 days — all 20 chunks placed, zero recurring_split_overflow',
    () => {
      // 5 consecutive occurrence days: 2026-06-20..2026-06-24.
      // Each day has 4 x 60-min chunks. The calendar is near-empty (only the
      // chunks themselves compete for slots). Each chunk fits easily within a
      // 15-hour schedulable day.
      //
      // BUG (current code): earliestAnchor=2026-06-20, boundaryKey=2026-06-21
      // (cycleLen=1). Every chunk dated 2026-06-21..2026-06-24 is stripped as
      // recurring_split_overflow — 16 out of 20 chunks wrongly unplaced.
      //
      // CORRECT (after fix): each occurrence's boundary is anchor+1 day.
      // A chunk on 2026-06-21 is within the 2026-06-21 occurrence's own
      // 1-day window (boundary=2026-06-22). Zero overflow.
      //
      // Why >=5 days? 5 days spans 5 distinct daily occurrences, exercising the
      // per-occurrence boundary logic across the full realistic "Apply for Jobs"
      // pattern (multi-occurrence stress). 5 days is preferred over fewer because
      // it makes the secondary per-day placement assertions (byDay[day]===4 × 5,
      // totalPlaced===20) meaningful across multiple occurrences rather than just
      // one pair. A 2-day fixture also fails pre-fix (the _unplacedReason tag is
      // set directly in the unplaced array and is not cleared by the retry pass —
      // the retry re-places capacity-freed slots but cannot clear a reason tag
      // already stamped on the task object), so the failure mode is real in both
      // cases; 5 days simply provides a more comprehensive multi-occurrence signal.

      var tasks = buildDailyFixture(TODAY, 5);
      expect(tasks).toHaveLength(20); // sanity: fixture is correct

      var result = schedule(tasks, TODAY);

      // Primary assertion: zero recurring_split_overflow entries.
      var overflow = overflowUnplaced(result);
      expect(overflow).toHaveLength(0);

      // Secondary: every one of the 5 occurrence days has all 4 of its
      // chunks placed in dayPlacements.
      var byDay = chunksByDay(result);
      for (var d = 0; d < 5; d++) {
        var day = addDays(TODAY, d);
        expect(byDay[day]).toBe(4);
      }

      // Tertiary: total placed AFJ chunks == 20.
      var totalPlaced = Object.values(byDay).reduce(function(s, n) { return s + n; }, 0);
      expect(totalPlaced).toBe(20);
    }
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION GUARD — must stay GREEN on both current and fixed code.
// Verifies that timeBoxRecurringSplits correctly flags a PLACED chunk that
// overflows past its OWN occurrence's cycle boundary (first-section path), and
// does NOT flag a PLACED chunk from a different occurrence that is within its
// own cycle window (positive assertion — the per-master regression the fix owns).
//
// Design (mutation-verified):
//
//   A WEEKLY split (cycleLen=7) with two registered occurrences:
//     - Occurrence-1: anchor=TODAY (2026-06-20), boundary=TODAY+7 (2026-06-27)
//     - Occurrence-2: anchor=TODAY+7 (2026-06-27), boundary=TODAY+14 (2026-07-04)
//
//   Days TODAY through TODAY+6 are heavily blocked (920 min each, leaving only
//   40 free minutes — not enough for a 60-min chunk).
//
//   Fixture tasks:
//     occ1AnchorChunk — date=TODAY, registers TODAY in knownOccurrenceAnchors.
//       Cannot be placed (TODAY fully blocked). Goes to unplaced via second-section
//       fallback. Irrelevant to the key assertions.
//     occ2Chunk — date=TODAY+7. Placed on TODAY+7 (first open day).
//       resolveOccurrenceAnchor: TODAY+7 IS a registered anchor → anchor=TODAY+7,
//       boundary=TODAY+14. dateKey=TODAY+7 < TODAY+14 → NOT overflow (correct).
//     overflowChunk — NO task.date (null/undefined); _candidateDate=TODAY+3.
//       The scheduler has no anchor/deadline cap for this chunk → it searches the
//       full date horizon and places on TODAY+7 (first day with capacity).
//       resolveOccurrenceAnchor uses _candidateDate=TODAY+3; TODAY+3 is NOT a
//       registered occurrence anchor (only TODAY and TODAY+7 are) → walk-back:
//       latest anchor <= TODAY+3 = TODAY → anchor=TODAY, boundary=TODAY+7.
//       dateKey=TODAY+7 >= TODAY+7 → OVERFLOW — first section removes it from
//       dayPlacements and flags it recurring_split_overflow.
//
//   Mutation proof — disabling the FIRST section (`if (false && c.dateKey >= boundaryKey)`):
//     overflowChunk is NOT pushed to overflowEntries → stays in dayPlacements →
//     NOT in unplaced → NOT flagged as recurring_split_overflow.
//     The `occ1Overflowed` assertion (expect(occ1Overflowed).toBeDefined()) FAILS → RED.
//     (The second-section fallback cannot save it: the second section only tags chunks
//     already in unplaced before timeBoxRecurringSplits runs; overflowChunk was placed,
//     not unplaced, so the second section never sees it.)
//
//   Positive assertion (per-master regression guard):
//     occ2Chunk placed on TODAY+7 MUST NOT be flagged. The old per-master code would
//     wrongly flag it: global anchor=TODAY, boundary=TODAY+7, dateKey=TODAY+7 >= boundary.
//     The fix protects it via per-occurrence resolution: anchor=TODAY+7, boundary=TODAY+14,
//     dateKey=TODAY+7 < TODAY+14 → not overflow.
// ─────────────────────────────────────────────────────────────────────────────

describe('recurringSplitTimebox — regression guard (999.098 / 999.547)', () => {
  test(
    'GUARD: weekly 2-occurrence split — placed overflow chunk IS flagged by per-occurrence first section; occ-2 chunk within its own week is NOT flagged',
    () => {
      const WEEKLY_MASTER = 'master-weekly-guard2-750';
      const WEEKLY_RECUR = { type: 'weekly', every: 1, days: 'MTWRFSU' };
      const OCC2_DAY = addDays(TODAY, 7); // 2026-06-27

      // Days TODAY through TODAY+6: two FIXED immovable blockers per day that
      // together cover the full 1020-minute schedulable window (GRID_START=6AM–GRID_END=11PM).
      //   Blocker-A: 6:00 AM, dur=720 → 360–1080 (6AM to 6PM, max effective dur)
      //   Blocker-B: 6:00 PM, dur=300 → 1080–1380 (6PM to 11PM)
      // FIXED immovable tasks (placementMode='fixed', time set with AM/PM format) go
      // through tryPlaceAtTime and claim their slots BEFORE the main queue runs.
      // effectiveDuration caps at 720 min, so two blockers are required per day.
      // Together they leave 0 free minutes on days 0–6 for a 60-min chunk.
      var blockers = [];
      for (var bi = 0; bi < 7; bi++) {
        var bDay = addDays(TODAY, bi);
        blockers.push({
          id: 'blocker-wg2-day' + bi + '-a',
          text: 'Blocker WG2 day' + bi + ' A',
          date: bDay,
          dur: 720,       // effective 720 (max); covers 6AM–6PM (360–1080)
          time: '6:00 AM',
          pri: 'P1',
          when: '',
          dayReq: 'any',
          status: '',
          recurring: false,
          split: false,
          datePinned: false,
          placementMode: 'fixed',
          dependsOn: [],
          location: [],
          tools: [],
          generated: false,
          section: '',
          flexWhen: false,
          recur: null,
        });
        blockers.push({
          id: 'blocker-wg2-day' + bi + '-b',
          text: 'Blocker WG2 day' + bi + ' B',
          date: bDay,
          dur: 300,       // covers 6PM–11PM (1080–1380)
          time: '6:00 PM',
          pri: 'P1',
          when: '',
          dayReq: 'any',
          status: '',
          recurring: false,
          split: false,
          datePinned: false,
          placementMode: 'fixed',
          dependsOn: [],
          location: [],
          tools: [],
          generated: false,
          section: '',
          flexWhen: false,
          recur: null,
        });
      }

      // occ1AnchorChunk: date=TODAY, registers TODAY in knownOccurrenceAnchors.
      // Cannot be placed (TODAY is fully blocked). Its only role is to ensure
      // TODAY is a known occurrence anchor for the walk-back in resolveOccurrenceAnchor.
      var occ1AnchorChunk = {
        id: 'wg2-occ1-anchor',
        text: 'Weekly Guard Occ1',
        date: TODAY,
        dur: 60,
        pri: 'P2',
        when: '',
        dayReq: 'any',
        status: '',
        recurring: true,
        split: true,
        splitMin: 60,
        splitOrdinal: 1,
        splitTotal: 2,
        sourceId: WEEKLY_MASTER,
        placementMode: 'anytime',
        dependsOn: [],
        location: [],
        tools: [],
        datePinned: false,
        generated: false,
        section: '',
        flexWhen: false,
        recur: WEEKLY_RECUR,
      };

      // occ2Chunk: date=TODAY+7 (registered as occurrence-2 anchor).
      // Placed on TODAY+7 (first open day). Per-occurrence: anchor=TODAY+7,
      // boundary=TODAY+14 → dateKey=TODAY+7 < TODAY+14 → NOT overflow.
      // Old per-master code would wrongly flag it: global anchor=TODAY, boundary=TODAY+7,
      // dateKey=TODAY+7 >= TODAY+7 → overflow (incorrect).
      var occ2Chunk = {
        id: 'wg2-occ2-chunk',
        text: 'Weekly Guard Occ2',
        date: OCC2_DAY,
        dur: 60,
        pri: 'P2',
        when: '',
        dayReq: 'any',
        status: '',
        recurring: true,
        split: true,
        splitMin: 60,
        splitOrdinal: 1,
        splitTotal: 2,
        sourceId: WEEKLY_MASTER,
        placementMode: 'anytime',
        dependsOn: [],
        location: [],
        tools: [],
        datePinned: false,
        generated: false,
        section: '',
        flexWhen: false,
        recur: WEEKLY_RECUR,
      };

      // overflowChunk: NO task.date (undefined) so anchorDate=null in buildItems
      // and the chunk is NOT registered as a known occurrence anchor. The scheduler
      // places it freely (no cycle/deadline cap). Days 0-6 are blocked → it lands
      // on TODAY+7. resolveOccurrenceAnchor uses _candidateDate=TODAY+3; TODAY+3
      // is not a registered anchor → walk-back gives TODAY as anchor → boundary=TODAY+7.
      // dateKey=TODAY+7 >= boundary=TODAY+7 → OVERFLOW. The first section removes
      // it from dayPlacements and pushes it to unplaced with recurring_split_overflow.
      //
      // Mutation check (if(false&&c.dateKey>=boundaryKey)): this chunk stays in
      // dayPlacements (never evaluated) → NOT in unplaced → occ1Overflowed=undefined
      // → the expect(occ1Overflowed).toBeDefined() assertion FAILS → guard goes RED.
      var overflowChunk = {
        id: 'wg2-overflow-chunk',
        text: 'Weekly Guard Overflow',
        // date intentionally omitted (undefined) so anchorDate=null in buildItems
        // and this chunk is NOT added to knownOccurrenceAnchors. Without a cycle cap
        // the scheduler can place it on any day; days 0-6 are blocked so it lands
        // on TODAY+7, which is >= the occurrence-1 boundary (TODAY+7).
        _candidateDate: addDays(TODAY, 3), // TODAY+3 — used by resolveOccurrenceAnchor
                                            // to walk back to occurrence-1 anchor (TODAY).
        dur: 60,
        pri: 'P3',
        when: '',
        dayReq: 'any',
        status: '',
        recurring: true,
        split: true,
        splitMin: 60,
        splitOrdinal: 2,
        splitTotal: 2,
        sourceId: WEEKLY_MASTER,
        placementMode: 'anytime',
        dependsOn: [],
        location: [],
        tools: [],
        datePinned: false,
        generated: false,
        section: '',
        flexWhen: false,
        recur: WEEKLY_RECUR,
      };

      var tasks = blockers.concat([occ1AnchorChunk, occ2Chunk, overflowChunk]);
      var result = schedule(tasks, TODAY);

      // Helper: filter overflow entries for WEEKLY_MASTER.
      var weeklyOverflow2 = (result.unplaced || []).filter(function(u) {
        var task = u.task || u;
        return (task.sourceId || task.master_id) === WEEKLY_MASTER &&
               task._unplacedReason === 'recurring_split_overflow';
      });

      // Negative assertion (mutation-driver): the overflow chunk that was PLACED on
      // TODAY+7 (past occurrence-1's boundary TODAY+7) MUST be flagged as
      // recurring_split_overflow. This assertion targets the per-occurrence FIRST-SECTION
      // boundary comparator (c.dateKey >= boundaryKey). Disabling that section leaves
      // overflowChunk in dayPlacements (not in unplaced) → this assertion FAILS → RED.
      var occ1Overflowed = weeklyOverflow2.find(function(u) {
        var task = u.task || u;
        return task.id === 'wg2-overflow-chunk';
      });
      expect(occ1Overflowed).toBeDefined();

      // Positive assertion (per-master regression guard): the occurrence-2 chunk
      // placed on TODAY+7 MUST NOT be flagged. The old per-master code would wrongly
      // flag it (global anchor=TODAY, boundary=TODAY+7, occ-2 chunk at TODAY+7
      // >= boundary). The fix protects it: per-occurrence anchor=TODAY+7,
      // boundary=TODAY+14, dateKey=TODAY+7 < TODAY+14 → not overflow.
      var occ2Overflowed = weeklyOverflow2.find(function(u) {
        var task = u.task || u;
        return task.id === 'wg2-occ2-chunk';
      });
      expect(occ2Overflowed).toBeUndefined();
    }
  );
});
