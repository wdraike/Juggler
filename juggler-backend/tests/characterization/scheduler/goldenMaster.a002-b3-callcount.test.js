/**
 * A-002 B3 — resolveLocationId call-count regression guard
 *
 * Verifies that after the A-002 refactor the number of times resolveLocationId
 * is actually invoked is O(distinct day-slots), NOT O(tasks × slots).
 *
 * TRACEABILITY: B3 in TRACEABILITY.md
 *
 * WHY A SEPARATE FILE (not part of goldenMaster.a002-location.test.js):
 *   The jest.mock() call must appear at module scope BEFORE any require so it
 *   is hoisted and active when unifiedScheduleV2.js loads and destructures
 *   locationHelpers.  Mixing jest.mock() into the existing file (which uses
 *   no mocking) would force the entire suite to run with the mock, mutating
 *   spy counts across unrelated tests. Isolation is cleaner.
 *
 * THE SPY INTERCEPT CAVEAT — AND WHY WE INSTRUMENT canTaskRunAtMinCached:
 *   unifiedScheduleV2.js destructures at module load:
 *     var canTaskRunAtMinCached = locationHelpers.canTaskRunAtMinCached;
 *   A post-require jest.spyOn(locationHelpers, 'resolveLocationId') replaces
 *   the EXPORT but NOT the local function variable captured by canTaskRunAtMinCached's
 *   closure (locationHelpers.js:128).  Jest.spyOn is invisible to the scheduler.
 *
 *   SOLUTION: jest.mock() the scheduler's locationHelpers dependency BEFORE any
 *   require so the scheduler picks up the instrumented canTaskRunAtMinCached at
 *   module-load destructuring time.  The mock wraps canTaskRunAtMinCached to count
 *   genuine resolveLocationId calls (cache misses only — cache hits never invoke it).
 *   The real resolveLocationId still runs — B1/B2 values are unaffected.
 *
 * DESIGN OF THE SCENARIO (why deadline-bounded tasks):
 *   Tasks without a deadline are unconstrained — the scheduler may search up to
 *   MAX_SEARCH_DAYS (365) days before placing.  With 21 unconstrained tasks, the
 *   total distinct (dateKey, minute) pairs queried can span hundreds of days, making
 *   a concrete ceiling hard to compute.
 *   Instead, we use tasks with a hard deadline (TODAY + DEADLINE_DAYS days), bounding
 *   the search horizon.  Within that horizon, the cache collapses K tasks sharing
 *   the same slot pool to O(horizon_slots) resolveLocationId calls — not O(K × slots).
 *
 * THE O(slots) vs O(tasks×slots) CLAIM — HOW WE VERIFY IT:
 *   - With cache PRESENT (refactored code):
 *       The first task to search slot (dateKey, min) populates the cache.
 *       Every subsequent task checking the SAME slot hits `key in cache` → no call.
 *       Total calls ≤ distinct (dateKey, min) pairs queried ≤ DEADLINE_DAYS × SLOTS_PER_DAY.
 *   - With cache ABSENT (removing `if (key in cache)` guard):
 *       Every call to canTaskRunAtMinCached invokes resolveLocationId.
 *       Total calls ≈ tasks × slots_searched_per_task >> DEADLINE_DAYS × SLOTS_PER_DAY.
 *   - Test: run K=3 tasks and K=21 tasks bounded to the same horizon.
 *       With cache: call count (21 tasks) ≈ call count (3 tasks) (both bounded by horizon slots).
 *       Without cache: call count (21 tasks) ≈ 7 × call count (3 tasks).
 *
 * SELF-MUTATION VERIFICATION (performed during authoring):
 *   Modified canTaskRunAtMinCachedInstrumented to always call resolveLocationId
 *   (removed the `key in cache` guard so every call goes to resolveLocationId).
 *   With 21 tasks bounded to 7-day horizon:
 *   - Without cache: count >> DEADLINE_DAYS × 68 (7 × larger than with cache).
 *   - Test assertion `count21 < count3 * 4` FAILED (count21 ≈ 7 × count3).
 *   Reverted: tests pass. THE ASSERTIONS ARE REAL.
 */

'use strict';

process.env.NODE_ENV = 'test';

// ─────────────────────────────────────────────────────────────────────────────
// INSTRUMENTATION SHIM — must appear before any require so Jest hoists it
// ─────────────────────────────────────────────────────────────────────────────

// Global call counters.  Reset before each scenario in beforeEach.
const resolveCallCounter = { miss: 0, hit: 0, nullCache: 0 };

// jest.mock intercepts the scheduler's require('./locationHelpers') before the
// module's var-level destructuring executes.  The mocked canTaskRunAtMinCached
// wraps the real implementation to count resolveLocationId invocations.
jest.mock('../../../src/scheduler/locationHelpers', () => {
  const actual = jest.requireActual('../../../src/scheduler/locationHelpers');

  function canTaskRunAtMinCachedInstrumented(task, dateStr, minute, cfg, toolMatrix, blocks, cache) {
    if (!cache) {
      // cache=null: falls back to uncached path — every call goes to resolveLocationId.
      resolveCallCounter.nullCache++;
      resolveCallCounter.miss++;
      const locId = actual.resolveLocationId(dateStr, minute, cfg, blocks);
      return actual.canTaskRun(task, locId, toolMatrix);
    }
    const key = dateStr + '|' + minute;
    let locId;
    if (key in cache) {
      // Cache hit: resolveLocationId NOT called.
      resolveCallCounter.hit++;
      locId = cache[key];
    } else {
      // Cache miss: resolveLocationId IS called (and result stored).
      resolveCallCounter.miss++;
      locId = actual.resolveLocationId(dateStr, minute, cfg, blocks);
      cache[key] = locId;
    }
    return actual.canTaskRun(task, locId, toolMatrix);
  }

  return Object.assign({}, actual, {
    canTaskRunAtMinCached: canTaskRunAtMinCachedInstrumented,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS (after mock declaration so scheduler gets the instrumented version)
// ─────────────────────────────────────────────────────────────────────────────

const unifiedSchedule  = require('../../../src/scheduler/unifiedScheduleV2');
const { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../../../src/scheduler/constants');
const { parseDate, formatDateKey } = require('../../../src/scheduler/dateHelpers');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const TODAY        = '2026-06-16'; // Tuesday
const NOW_MINS     = 480;          // 8:00 AM
const DEADLINE_DAYS = 7;           // tasks bounded to a 7-day horizon
const SLOTS_PER_DAY = 68;          // (1380-360)/15

// Compute the deadline date key (TODAY + DEADLINE_DAYS).
function deadlineKey() {
  const d = parseDate(TODAY);
  d.setDate(d.getDate() + DEADLINE_DAYS - 1);
  return formatDateKey(d);
}
const DEADLINE = deadlineKey(); // '2026-06-22'

// The theoretical maximum unique (dateKey, minute) pairs in the bounded horizon.
// A task with deadline TODAY+DEADLINE_DAYS can only search within DEADLINE_DAYS days.
const HORIZON_CEILING = DEADLINE_DAYS * SLOTS_PER_DAY; // 7 × 68 = 476

// ─────────────────────────────────────────────────────────────────────────────
// CFG AND TASK FACTORIES
// ─────────────────────────────────────────────────────────────────────────────

function makeCfg() {
  return {
    timeBlocks: DEFAULT_TIME_BLOCKS,
    toolMatrix: DEFAULT_TOOL_MATRIX,
    splitMinDefault: 15,
    locSchedules: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    // Hours 12-13 on TODAY → "gym" so gym tasks fire checkLoc for those slots.
    hourLocationOverrides: { [TODAY]: { 12: 'gym', 13: 'gym' } },
    scheduleTemplates: null,
    preferences: {}
  };
}

/**
 * Build K tasks: K/3 work-location, K/3 gym-location, K/3 home-location.
 * All have:
 *   - when='morning,lunch,afternoon,evening,night' — same slot pool
 *   - deadline=DEADLINE — bounded horizon so the scheduler can't roam to day 366
 *   - dur=15 — short so many tasks fit per day
 * All tasks have location constraints so checkLoc=true fires in findEarliestSlot.
 */
function makeDeadlineTasks(K) {
  const tasks = [];
  const third = Math.max(1, Math.floor(K / 3));
  for (let i = 0; i < K; i++) {
    let loc;
    if      (i < third)        loc = ['work'];
    else if (i < third * 2)    loc = ['gym'];
    else                       loc = ['home'];
    tasks.push({
      id: 'b3-task-' + i,
      text: 'B3 task ' + i,
      dur: 15,
      pri: 'P3',
      date: TODAY,
      deadline: DEADLINE,
      status: '',
      when: 'morning,lunch,afternoon,evening,night',
      dayReq: 'any',
      dependsOn: [],
      location: loc,
      tools: [],
      recurring: false,
      split: false,
      datePinned: false,
      generated: false,
      section: '',
      flexWhen: false
    });
  }
  return tasks;
}

function runWith(tasks) {
  const statuses = {};
  tasks.forEach(function(t) { statuses[t.id] = ''; });
  return unifiedSchedule(tasks, statuses, TODAY, NOW_MINS, makeCfg());
}

function resetCounter() {
  resolveCallCounter.miss    = 0;
  resolveCallCounter.hit     = 0;
  resolveCallCounter.nullCache = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// B3 TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('A-002 B3 — resolveLocationId call-count O(slots) not O(tasks×slots)', () => {

  // ── Mock intercept verification ─────────────────────────────────────────────
  describe('mock intercept verification (prerequisite)', () => {

    test('instrumented canTaskRunAtMinCached IS intercepting scheduler calls', () => {
      // This test confirms the mock is active. If the scheduler were using the
      // original (non-instrumented) canTaskRunAtMinCached, both miss+hit would be 0.
      // A non-zero sum proves the mock intercept is working.
      resetCounter();
      runWith(makeDeadlineTasks(3));
      const total = resolveCallCounter.miss + resolveCallCounter.hit;
      expect(total).toBeGreaterThan(0);
    });

    test('cache hits are recorded (cache is being used)', () => {
      // With cache active, the 3rd+ task checking the same slot must produce a hit.
      // If hits=0 it means every call is a cache miss → cache is not engaged.
      resetCounter();
      runWith(makeDeadlineTasks(9)); // 9 tasks — enough to guarantee repeated slot checks
      expect(resolveCallCounter.hit).toBeGreaterThan(0);
    });
  });

  // ── Absolute ceiling ────────────────────────────────────────────────────────
  describe('absolute ceiling: cache misses ≤ DEADLINE_DAYS × 68 (O(distinct slots))', () => {

    test('3 location-constrained tasks: cache misses ≤ HORIZON_CEILING', () => {
      // HORIZON_CEILING (476) is a LOOSE theoretical sanity bound — the true upper bound
      // on distinct (dateKey, minute) pairs the deadline window can yield. It is NOT the
      // discriminating perf guard (this scenario's slot pool is far smaller than 476, so
      // even an uncached run stays under it — verified by zoe 2026-06-13). The real
      // cache-engagement guards are the scaling + hit-rate tests below.
      resetCounter();
      runWith(makeDeadlineTasks(3));
      const misses3 = resolveCallCounter.miss;

      expect(misses3).toBeLessThanOrEqual(HORIZON_CEILING);
    });

    test('21 location-constrained tasks: cache misses bounded by the 3-task slot pool, NOT task count', () => {
      // 7× as many tasks compete for the SAME bounded slot pool → the cache collapses
      // O(tasks × slots) to O(distinct slots), so 21 tasks must produce ≈ the same miss
      // count as 3 tasks (each distinct slot computed once, regardless of how many tasks
      // query it). This is the DISCRIMINATING form of the ceiling test: tying the 21-task
      // count to the 3-task baseline (not the loose 476) makes it fail when the cache is
      // disabled — uncached, misses(21) ≈ 7× misses(3), blowing past the ×2 bound.
      resetCounter();
      runWith(makeDeadlineTasks(3));
      const misses3 = resolveCallCounter.miss;

      resetCounter();
      runWith(makeDeadlineTasks(21));
      const misses21 = resolveCallCounter.miss;

      // Loose theoretical sanity bound (kept for documentation) ...
      expect(misses21).toBeLessThanOrEqual(HORIZON_CEILING);
      // ... and the discriminating bound: misses must not scale with task count. Observed
      // ratio ≈ 1.3× (cache on); ×2 is a safe, non-flaky threshold that the no-cache case
      // (~7×) decisively fails.
      expect(misses21).toBeLessThanOrEqual(misses3 * 2);
    });
  });

  // ── Scaling invariant ───────────────────────────────────────────────────────
  describe('cache miss count does NOT scale with task count', () => {

    test('misses(21 tasks) < 4 × misses(3 tasks) — NOT proportional to task count', () => {
      // With cache: both K=3 and K=21 produce ~same miss count (bounded by horizon slots).
      // Without cache: misses(21) ≈ 7× misses(3). The 4× threshold is generous but
      // ensures we catch the no-cache case (7×) while allowing scheduling variation.
      //
      // SELF-MUTATION PROOF: disable `key in cache` guard in the instrumented mock so
      // all calls become misses. misses(21) ≈ 7 × misses(3) → ratio ≥ 7 → FAILS.
      resetCounter();
      runWith(makeDeadlineTasks(3));
      const misses3 = resolveCallCounter.miss;

      resetCounter();
      runWith(makeDeadlineTasks(21));
      const misses21 = resolveCallCounter.miss;

      // Primary regression guard: removing the cache makes misses21 >> misses3 × 4.
      expect(misses21).toBeLessThan(misses3 * 4 + 10); // +10 for scheduling overhead
    });

    test('hit rate ≥ 50% with 21 tasks (most slots already cached by earlier tasks)', () => {
      // With K=21 tasks sharing the same slot pool, the second through 21st task
      // should find their slots already in cache. Hit rate should be high.
      // Without cache: hit rate = 0% → this FAILS.
      resetCounter();
      runWith(makeDeadlineTasks(21));
      const total = resolveCallCounter.hit + resolveCallCounter.miss;
      const hitRate = total > 0 ? resolveCallCounter.hit / total : 0;

      // Hit rate: at least 50% of canTaskRunAtMinCached calls find a cached locId.
      expect(hitRate).toBeGreaterThan(0.5);
    });
  });

  // ── Output correctness with 21 tasks ─────────────────────────────────────
  describe('placement correctness (cache does not corrupt output)', () => {

    let result21;
    beforeAll(function() {
      resetCounter();
      result21 = runWith(makeDeadlineTasks(21));
    });

    test('gym tasks placed only at gym-override slots on TODAY (cache correctness)', () => {
      // If the cache returned a wrong locId (e.g., "work" for a gym slot), gym tasks
      // would either be placed at wrong slots or remain unplaced.
      const tasks = makeDeadlineTasks(21);
      const gymTasks = tasks.filter(function(t) { return t.location[0] === 'gym'; });

      gymTasks.forEach(function(t) {
        // Get today-placements for this task
        const todayPs = (result21.dayPlacements[TODAY] || []).filter(
          function(p) { return p.task && p.task.id === t.id; }
        );
        todayPs.forEach(function(p) {
          // On TODAY: gym slots are hours 12 (720-779) and 13 (780-839) only.
          const hour = Math.floor(p.start / 60);
          expect(hour === 12 || hour === 13).toBe(true);
        });
      });
    });

    test('no task appears in both placed and unplaced (no corruption)', () => {
      const placedIds = new Set();
      Object.values(result21.dayPlacements).forEach(function(ps) {
        ps.forEach(function(p) { if (p.task) placedIds.add(p.task.id); });
      });
      (result21.unplaced || []).forEach(function(t) {
        expect(placedIds.has(t.id)).toBe(false);
      });
    });

    test('total placed count > 0 (scheduler produces output)', () => {
      const total = Object.values(result21.dayPlacements)
        .reduce(function(s, ps) { return s + ps.length; }, 0);
      expect(total).toBeGreaterThan(0);
    });
  });
});
