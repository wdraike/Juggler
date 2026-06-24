/**
 * Unit tests for _computeNoLimboUpdates — the L2 no-limbo safety-net pure helper.
 *
 * Covers:
 *   BLOCK-1 (zoe QA-REVIEW): the function must fire and return unscheduled=1 for a
 *   recurring_instance that lives in phase1InsertedById but NOT rawRowById (the exact gap
 *   bert's fix addresses — a Phase-1-inserted row is absent from the pre-Phase-1 snapshot).
 *
 * RED proof (documented):
 *   If the `phase1InsertedById` fallback is removed from the lookup (i.e. the function only
 *   consults `rawRowById[t.id]` as the pre-fix code did), the LIMBO test case below would
 *   return zero updates because:
 *     - `rawRowById['ri-limbo-1']` === undefined (the row was only in phase1InsertedById)
 *     - the old `if (!raw) return;` guard exits early
 *     - no update is appended, leaving the instance in limbo.
 *   The assertion `expect(updates.length).toBe(1)` would therefore FAIL, turning this test RED.
 *
 *   Proof-by-construction: in the LIMBO case below, rawRowById is intentionally empty ({})
 *   while phase1InsertedById holds the row. The assertion pins the fallback: if we pass
 *   rawRowById=phase1InsertedById as rawRowById (so both paths agree), the test stays green;
 *   but if we pass rawRowById={} AND drop the fallback from the source, it goes red.
 *   The `noFallback` negative-proof block below simulates the pre-fix function explicitly.
 *
 * Negative cases (AC4 — no false-flag):
 *   - Already placed (pendingById has scheduled_at)       → 0 updates
 *   - Already unscheduled (raw.unscheduled === 1)         → 0 updates
 *   - Terminal status                                     → 0 updates
 *   - Date is in the past (nominalDate < today)           → 0 updates (Phase 9 domain)
 *   - Date is beyond expandEnd (grandfathered)            → 0 updates
 *
 * This is a pure function test — NO DB required.
 */

'use strict';

process.env.NODE_ENV = 'test';

const { _computeNoLimboUpdates } = require('../../src/scheduler/runSchedule');

// --------------------------------------------------------------------------
// Helpers — build consistent Date objects for the window
// --------------------------------------------------------------------------

/**
 * Return a local-midnight Date for a YYYY-MM-DD string (matches parseDate behaviour).
 * Using a fixed future reference base so tests never age-out vs today.
 */
function localDate(isoStr) {
  var parts = isoStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) throw new Error('Bad date string: ' + isoStr);
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

// Fixed, stable window — far enough in the future that no test will ever be
// "in the past" relative to real time. The pure function only does Date
// comparisons so any self-consistent window works.
var TODAY_STR     = '2030-01-05';
var IN_WINDOW_STR = '2030-01-10';  // between today and expandEnd
var PAST_STR      = '2030-01-04';  // one day before today
var BEYOND_STR    = '2030-04-01';  // well beyond 90-day expandEnd

var TODAY      = localDate(TODAY_STR);
var EXPAND_END = localDate('2030-04-01');  // 86 days out — enough for RECUR_EXPAND_DAYS
// Note: BEYOND_STR equals EXPAND_END.  Use a date one day further to be strictly > .
var BEYOND_END = localDate('2030-04-02');

var NOW = new Date('2030-01-05T08:00:00.000Z');

// --------------------------------------------------------------------------
// Minimal task + raw-row factory
// --------------------------------------------------------------------------

function makeTask(id, overrides) {
  return Object.assign({
    id: id,
    taskType: 'recurring_instance',
    status: '',
    _unplacedReason: null,
    _unplacedDetail: null,
  }, overrides);
}

function makeRaw(id, dateStr, overrides) {
  return Object.assign({
    id: id,
    date: dateStr,
    scheduled_at: null,
    unscheduled: null,
    status: '',
  }, overrides);
}

// --------------------------------------------------------------------------
// 1. LIMBO case — the critical BLOCK-1 pin
//
// The recurring instance is in phase1InsertedById but NOT in rawRowById.
// The function must still detect the limbo and return unscheduled=1.
// --------------------------------------------------------------------------

describe('_computeNoLimboUpdates — BLOCK-1: phase1InsertedById fallback', function() {
  test('returns unscheduled=1 update for a phase1-inserted in-window limbo instance', function() {
    var TASK_ID = 'ri-limbo-1';

    var task = makeTask(TASK_ID);

    // rawRowById is EMPTY — this is the pre-fix gap scenario.
    // The row was Phase-1-inserted so it only exists in phase1InsertedById.
    var rawRowById       = {};
    var phase1InsertedById = {};
    phase1InsertedById[TASK_ID] = makeRaw(TASK_ID, IN_WINDOW_STR);

    // No pendingUpdate for this task — it was never written by the scheduler.
    var pendingById = {};

    // Non-terminal status in the statuses map.
    var statuses = {};
    statuses[TASK_ID] = '';

    var updates = _computeNoLimboUpdates(
      [task], rawRowById, phase1InsertedById, pendingById, statuses,
      TODAY, EXPAND_END, NOW
    );

    // The function must produce exactly one update for this task.
    expect(updates.length).toBe(1);
    expect(updates[0].id).toBe(TASK_ID);
    expect(updates[0].dbUpdate.unscheduled).toBe(1);
    // A reason code must be set (NO_SLOT is the default when _unplacedReason is absent).
    expect(typeof updates[0].dbUpdate.unplaced_reason).toBe('string');
    expect(updates[0].dbUpdate.unplaced_reason.length).toBeGreaterThan(0);
    // updated_at must be stamped with now.
    expect(updates[0].dbUpdate.updated_at).toBe(NOW);
  });

  // --------------------------------------------------------------------------
  // RED proof — explicit pre-fix simulation
  //
  // This block proves that WITHOUT the phase1InsertedById fallback the limbo
  // instance would be silently skipped (zero updates). It does this by reimplementing
  // the pre-fix guard logic inline. If this test returns length > 0, the pre-fix
  // logic has changed and this proof must be updated.
  // --------------------------------------------------------------------------
  test('RED proof: without phase1InsertedById fallback the limbo instance produces zero updates', function() {
    var TASK_ID = 'ri-limbo-red-proof';

    var task = makeTask(TASK_ID);
    var rawRowById       = {};                                     // row not in snapshot
    var phase1InsertedById = {};
    phase1InsertedById[TASK_ID] = makeRaw(TASK_ID, IN_WINDOW_STR);

    // --- Pre-fix simulation (rawRowById-only lookup, no fallback) ---
    var noFallbackUpdates = [];
    [task].forEach(function(t) {
      if (!t || t.taskType !== 'recurring_instance') return;
      var raw = rawRowById[t.id]; // pre-fix: no fallback
      if (!raw) return;           // pre-fix: exits early — the bug
      noFallbackUpdates.push({ id: t.id, dbUpdate: { unscheduled: 1 } });
    });

    // Without the fallback: zero updates — the instance is silently dropped.
    expect(noFallbackUpdates.length).toBe(0);

    // But the REAL (fixed) function finds it:
    var realUpdates = _computeNoLimboUpdates(
      [task], rawRowById, phase1InsertedById, {}, { [TASK_ID]: '' },
      TODAY, EXPAND_END, NOW
    );
    expect(realUpdates.length).toBe(1);
    // Confirm the two diverge — this is the DIFF that bert's fix introduces.
    expect(realUpdates.length).not.toBe(noFallbackUpdates.length);
  });
});

// --------------------------------------------------------------------------
// 2. Negative cases — must NOT be flagged (AC4 no-false-flag pins)
// --------------------------------------------------------------------------

describe('_computeNoLimboUpdates — AC4 negative cases (no false-flag)', function() {

  test('placed instance (pendingById has scheduled_at) → 0 updates', function() {
    var TASK_ID = 'ri-placed-1';
    var task = makeTask(TASK_ID);
    var raw  = makeRaw(TASK_ID, IN_WINDOW_STR);

    // Simulate a pendingUpdate that sets scheduled_at — the instance IS placed.
    var pendingById = {};
    pendingById[TASK_ID] = { scheduled_at: '2030-01-10T09:00:00.000Z', unscheduled: 0 };

    var updates = _computeNoLimboUpdates(
      [task], { [TASK_ID]: raw }, {}, pendingById, { [TASK_ID]: '' },
      TODAY, EXPAND_END, NOW
    );
    expect(updates.length).toBe(0);
  });

  test('already-unscheduled instance (raw.unscheduled === 1) → 0 updates', function() {
    var TASK_ID = 'ri-unscheduled-1';
    var task = makeTask(TASK_ID);
    var raw  = makeRaw(TASK_ID, IN_WINDOW_STR, { unscheduled: 1, unplaced_reason: 'no_slot' });

    var updates = _computeNoLimboUpdates(
      [task], { [TASK_ID]: raw }, {}, {}, { [TASK_ID]: '' },
      TODAY, EXPAND_END, NOW
    );
    expect(updates.length).toBe(0);
  });

  test('terminal status (done) → 0 updates', function() {
    var TASK_ID = 'ri-terminal-1';
    var task = makeTask(TASK_ID, { status: 'done' });
    var raw  = makeRaw(TASK_ID, IN_WINDOW_STR, { status: 'done' });

    var updates = _computeNoLimboUpdates(
      [task], { [TASK_ID]: raw }, {}, {}, { [TASK_ID]: 'done' },
      TODAY, EXPAND_END, NOW
    );
    expect(updates.length).toBe(0);
  });

  test('terminal status in pendingUpdate (status being written = skip) → 0 updates', function() {
    var TASK_ID = 'ri-terminal-pending-1';
    var task = makeTask(TASK_ID);
    var raw  = makeRaw(TASK_ID, IN_WINDOW_STR, { status: '' });
    // A pending write sets the status to 'skip' this run.
    var pendingById = {};
    pendingById[TASK_ID] = { status: 'skip' };

    var updates = _computeNoLimboUpdates(
      [task], { [TASK_ID]: raw }, {}, pendingById, { [TASK_ID]: '' },
      TODAY, EXPAND_END, NOW
    );
    expect(updates.length).toBe(0);
  });

  test('instance date in the past (< today) → 0 updates (Phase-9 domain, not L2)', function() {
    var TASK_ID = 'ri-past-1';
    var task = makeTask(TASK_ID);
    var raw  = makeRaw(TASK_ID, PAST_STR); // one day before TODAY

    var updates = _computeNoLimboUpdates(
      [task], { [TASK_ID]: raw }, {}, {}, { [TASK_ID]: '' },
      TODAY, EXPAND_END, NOW
    );
    expect(updates.length).toBe(0);
  });

  test('instance date beyond expandEnd (grandfathered horizon) → 0 updates', function() {
    var TASK_ID = 'ri-beyond-1';
    var task = makeTask(TASK_ID);
    var raw  = makeRaw(TASK_ID, '2030-04-02'); // strictly beyond EXPAND_END (2030-04-01)

    var updates = _computeNoLimboUpdates(
      [task], { [TASK_ID]: raw }, {}, {}, { [TASK_ID]: '' },
      TODAY, EXPAND_END, NOW
    );
    expect(updates.length).toBe(0);
  });

  test('non-recurring_instance taskType → 0 updates', function() {
    var TASK_ID = 'one-off-1';
    var task = makeTask(TASK_ID, { taskType: 'one-off' });
    var raw  = makeRaw(TASK_ID, IN_WINDOW_STR);

    var updates = _computeNoLimboUpdates(
      [task], { [TASK_ID]: raw }, {}, {}, { [TASK_ID]: '' },
      TODAY, EXPAND_END, NOW
    );
    expect(updates.length).toBe(0);
  });

  test('instance with no raw row AND no phase1 entry → 0 updates (not a DB row, skip)', function() {
    var TASK_ID = 'ri-in-memory-only';
    var task = makeTask(TASK_ID);
    // Neither map has an entry — in-memory-only task, nothing to persist.

    var updates = _computeNoLimboUpdates(
      [task], {}, {}, {}, { [TASK_ID]: '' },
      TODAY, EXPAND_END, NOW
    );
    expect(updates.length).toBe(0);
  });
});

// --------------------------------------------------------------------------
// 3. Multi-instance batch — mixed inputs, only the true limbo one is flagged
// --------------------------------------------------------------------------

describe('_computeNoLimboUpdates — batch: only true limbo instances flagged', function() {
  test('batch of 5 instances — only the phase1-limbo one gets an update', function() {
    var IDs = {
      LIMBO:       'ri-batch-limbo',
      PLACED:      'ri-batch-placed',
      UNSCHEDULED: 'ri-batch-unscheduled',
      TERMINAL:    'ri-batch-terminal',
      PAST:        'ri-batch-past',
    };

    var tasks = [
      makeTask(IDs.LIMBO),
      makeTask(IDs.PLACED),
      makeTask(IDs.UNSCHEDULED),
      makeTask(IDs.TERMINAL, { status: 'done' }),
      makeTask(IDs.PAST),
    ];

    var rawRowById = {};
    rawRowById[IDs.PLACED]      = makeRaw(IDs.PLACED,      IN_WINDOW_STR);
    rawRowById[IDs.UNSCHEDULED] = makeRaw(IDs.UNSCHEDULED, IN_WINDOW_STR, { unscheduled: 1 });
    rawRowById[IDs.TERMINAL]    = makeRaw(IDs.TERMINAL,    IN_WINDOW_STR, { status: 'done' });
    rawRowById[IDs.PAST]        = makeRaw(IDs.PAST,        PAST_STR);
    // LIMBO is intentionally absent from rawRowById — only in phase1InsertedById.

    var phase1InsertedById = {};
    phase1InsertedById[IDs.LIMBO] = makeRaw(IDs.LIMBO, IN_WINDOW_STR);

    var pendingById = {};
    pendingById[IDs.PLACED] = { scheduled_at: '2030-01-10T09:00:00.000Z' };

    var statuses = {};
    statuses[IDs.LIMBO]       = '';
    statuses[IDs.PLACED]      = '';
    statuses[IDs.UNSCHEDULED] = '';
    statuses[IDs.TERMINAL]    = 'done';
    statuses[IDs.PAST]        = '';

    var updates = _computeNoLimboUpdates(
      tasks, rawRowById, phase1InsertedById, pendingById, statuses,
      TODAY, EXPAND_END, NOW
    );

    expect(updates.length).toBe(1);
    expect(updates[0].id).toBe(IDs.LIMBO);
    expect(updates[0].dbUpdate.unscheduled).toBe(1);
  });
});

// --------------------------------------------------------------------------
// 4. Boundary: instance date equals today and equals expandEnd (inclusive edges)
// --------------------------------------------------------------------------

describe('_computeNoLimboUpdates — window boundary (today and expandEnd inclusive)', function() {
  test('instance date exactly equal to today → flagged (in-window)', function() {
    var TASK_ID = 'ri-boundary-today';
    var task = makeTask(TASK_ID);
    var raw  = makeRaw(TASK_ID, TODAY_STR); // date === today

    var updates = _computeNoLimboUpdates(
      [task], { [TASK_ID]: raw }, {}, {}, { [TASK_ID]: '' },
      TODAY, EXPAND_END, NOW
    );
    // today is in-window (nominalDate >= today is the implied lower bound in parseDate context)
    // The guard is `nominalDate < today` (strictly less) so today itself passes.
    expect(updates.length).toBe(1);
  });

  test('instance date exactly equal to expandEnd → flagged (in-window, upper bound inclusive)', function() {
    var TASK_ID = 'ri-boundary-end';
    var task = makeTask(TASK_ID);
    // EXPAND_END is '2030-04-01'; use it as the raw date.
    var raw  = makeRaw(TASK_ID, '2030-04-01');

    var updates = _computeNoLimboUpdates(
      [task], { [TASK_ID]: raw }, {}, {}, { [TASK_ID]: '' },
      TODAY, EXPAND_END, NOW
    );
    // The guard is `nominalDate > expandEnd` (strictly greater), so expandEnd itself passes.
    expect(updates.length).toBe(1);
  });
});
