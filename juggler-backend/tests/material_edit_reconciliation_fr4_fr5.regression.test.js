// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * material_edit_reconciliation_fr4_fr5.regression.test.js
 *
 * Traceability: juggler-recur-lifecycle-redesign SPEC.md FR-4 (Material schedule-edit
 * reconciliation) / FR-5 (Material field list) / AC5 / AC6. WBS W5.
 *
 * ── Prior-art check performed BEFORE writing these tests (per dispatch instructions —
 * this leg has already needed two mid-build corrections from skipping this step) ──
 *
 * 1. Entry point for a recurring-master edit: `UpdateTask.js` (application command),
 *    routed to `facade.js`'s `recurCleanup()` (facade.js:243-412) inside a transaction
 *    when `needsComplexPath` is true. VERIFIED BY DIRECT READ:
 *      - `needsComplexPath` (UpdateTask.js:187-197) is true for `body.recur`,
 *        `body.recurStart`, `body.recurEnd`, `body.when`, `body.anchorDate`,
 *        `body._allowUnfix`, `body.allDay`, `recurring:false`, a split/splitMin edit
 *        ON A RECURRING ROW (`splitNeedsComplex`), or a bare time-only edit. **`dur` and
 *        `placementMode` are ABSENT from this list** — a `dur`-only or
 *        `placementMode`-only edit currently takes the FAST PATH
 *        (UpdateTask.js:199-201, `_fastPath`), which never calls `recurCleanup` at all.
 *        FR-5 names `dur` and `placement_mode` as material fields — today neither one
 *        triggers ANY reconciliation. This is the clearest "mechanism doesn't exist yet"
 *        signal for those two fields.
 *      - Inside `recurCleanup`'s `recurring_template` branch (facade.js:291-408), the
 *        CURRENT material-change classifier is `recurChanged` (facade.js:346-354): it
 *        only compares `recur.type`, `recur.days` (via JSON.stringify), and
 *        `recur.timesPerCycle`. **`recur.every`, `recur.intervalDays`, and
 *        `recur.monthDays` are NOT compared** — FR-5 lists all six `recur.*` keys as
 *        material; three of them are invisible to the current classifier.
 *      - The reconciliation mechanism the current classifier drives
 *        (`resetRecurringInstances`, src/lib/tasks-write.js:439-459) HARD-DELETES ALL
 *        future not-started (`status=''`) instances unconditionally and lets the next
 *        scheduler expand pass regenerate them — it does NOT compute
 *        `remaining_needed = new_timesPerCycle - done_this_cycle`, does NOT prune
 *        furthest-date-first, does NOT fabricate a deficit immediately (that's deferred
 *        to whenever the scheduler next runs `expandRecurring`), and — critically —
 *        never touches `status='skip'`/`status='cancel'` rows at all (it filters on
 *        `status=''` only). FR-4/AC5 require skip/cancel rows to be REMOVED as part of
 *        the same reconciliation pass. This mechanism does not exist today.
 *
 * 2. Existing cycle-fulfillment-accounting prior art (999.1372,
 *    `ccddafe fix(scheduler): flexible-TPC recurring cycle-fulfillment accounting`):
 *    `shared/scheduler/expandRecurring.js` — `getStableEpoch()` (recur_start-anchored,
 *    decoupled from the mutable `next_start`/`next_occurrence_anchor`, precisely so a
 *    terminal event doesn't redefine the cycle boundary mid-cycle — the same hazard
 *    FR-4's "advance anchor to today -> prune/reconcile -> refabricate" ordering must
 *    avoid) and `enumerateBookedDatesInCycle()` (widened, ACTUAL-date fulfillment count,
 *    not a pattern-day walk) are the established cycle-boundary + fulfillment-counting
 *    primitives for `timesPerCycle` recurrence in this codebase. Cycle boundaries are
 *    `stableEpoch + k*cycleDays` (stableEpoch = recur_start, falling back to
 *    src.date/startDate) — the fixtures below anchor `recur_start` to the Monday of the
 *    CURRENT week so "the in-progress cycle" always contains "today" regardless of which
 *    day this suite runs on, matching FR-4's explicit "immediate effect... including the
 *    in-progress cycle" ruling. The existing TPC picker's surplus-handling
 *    (expandRecurring.js:513-530, "earliest pending kept first... Object.keys sort
 *    order") keeps the EARLIEST dates and drops the rest when over budget — i.e. the
 *    LATEST/furthest dates are the ones that don't make the cut. This is the SAME
 *    tie-break FR-4 states explicitly ("surplus pruned, furthest-date-first"), so the
 *    fixtures below assert furthest-date-first pruning consistent with this established
 *    convention rather than inventing a new one.
 *    IMPORTANT: this scheduler-run mechanism is NOT what these tests exercise — FR-4's
 *    reconciliation must fire IMMEDIATELY on the material edit itself (inside
 *    `facade.updateTask`), not deferred to the next scheduler sweep. No call to
 *    `runSchedule`/`expandRecurring` is made anywhere in this file; every assertion
 *    reads `task_instances` directly, synchronously after `await facade.updateTask(...)`
 *    resolves.
 *
 * 3. Test-seam decision (why these tests call `facade.updateTask` rather than a new
 *    pure `classifyMaterialEdit(...)`-shaped function): FR-4/FR-5 describe an engine
 *    that does not exist as a named unit anywhere in the codebase yet — inventing an
 *    internal function signature for it would be exactly the speculative-API risk this
 *    leg has already been burned by twice. `facade.updateTask` (backed by
 *    `UpdateTask.execute`) is the one seam Kermit's own WBS names as this leg's entry
 *    point ("W5 ... wires the FR-4 removal warning through W4's modal" implies the
 *    reconciliation itself lives behind the existing update path), and it is the exact
 *    seam FR-2/FR-6's own W2 regression tests in this leg already use
 *    (`reopen_date_gate_fr2.regression.test.js`, `softdelete_master_fr6.regression.test.js`).
 *    Testing black-box DB-state before/after `facade.updateTask` keeps these tests
 *    correct regardless of whatever internal shape grover gives the new engine.
 *
 * 4. "Skip/cancel rows are removed" (AC5) vs R55/999.844 ("no hard delete... done/skip
 *    past rows... kept above"): checked whether this is a real SPEC contradiction before
 *    writing test (c). It is NOT: R55/999.844's no-hard-delete guarantee is SCOPED to
 *    the series-DELETE cascade specifically (`tests/scheduler/lifecycle-guards-844.test.js`
 *    Guard 1 describe block: "series-delete keeps history... verbatim" — it exercises
 *    `cascadeRecurringDelete`, a different operation/WBS item (W2/FR-6), not the
 *    material-edit reconciliation this leg's W5 builds). AC5's own wording is explicit
 *    and unambiguous for THIS operation: "skip/cancel rows are removed" — so these tests
 *    assert a hard DELETE (row absent from `task_instances`) for skip/cancel, matching
 *    AC5's literal wording, and do not extend R55's series-delete-scoped guarantee to a
 *    different code path it was never tested against.
 *
 * Run: cd juggler/juggler-backend && npx jest --testPathPattern="material_edit_reconciliation_fr4_fr5" --runInBand
 * (requires test-bed MySQL @3407)
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var facade = require('../src/slices/task/facade');

jest.mock('../src/scheduler/scheduleQueue', function () {
  return { enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn() };
});
jest.mock('../src/lib/redis', function () {
  return {
    getClient: jest.fn().mockReturnValue(null),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    invalidateTasks: jest.fn().mockResolvedValue(true),
    invalidateConfig: jest.fn().mockResolvedValue(true)
  };
});
jest.mock('../src/lib/sse-emitter', function () {
  return { emit: jest.fn(), addClient: jest.fn() };
});

var USER_ID = 'fr4-material-edit-001';
var TZ = 'America/New_York';

// ── date helpers (local-midnight, no UTC-shift risk from toISOString) ──────────
function fmt(d) {
  var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}
function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }
function thisWeekMonday() {
  var d = new Date(); d.setHours(0, 0, 0, 0);
  var day = d.getDay(); // 0=Sun..6=Sat
  var diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d;
}

var MONDAY = thisWeekMonday();
var TUESDAY = addDays(MONDAY, 1);
var WEDNESDAY = addDays(MONDAY, 2);
var THURSDAY = addDays(MONDAY, 3);
var FRIDAY = addDays(MONDAY, 4);

// Base recur config carrying ALL SIX FR-5 recur.* keys (even ones semantically inert
// for 'weekly', e.g. `every`/`intervalDays`/`monthDays`) so each can be diffed
// independently as its OWN sub-test — FR-5 lists these as material FIELDS, not as
// type-conditional fields.
var BASE_RECUR = { type: 'weekly', days: 'MTWRF', timesPerCycle: 2, every: 1, intervalDays: 1, monthDays: [1] };

// ── Group 3/4 (worked-example) fixtures — DETERMINISM NOTE ──────────────────────
// Group 1/2 (classifier) fixtures above use "this calendar week's Mon-Fri" — safe
// there because the skip/cancel-pruning + byte-identical-instance-set signals those
// groups assert do NOT depend on whether an instance's date is before/after "now"
// (the CURRENT `resetRecurringInstances` mechanism only ever touches `status=''`
// rows, so a `skip`/`cancel` row's survival never depends on past-vs-future timing).
//
// Group 3/4 DO care about past-vs-future (they assert the survival/pruning of
// `status=''` rows, which is exactly the axis `resetRecurringInstances`
// discriminates on: "future not-started" rows get hard-deleted, past ones don't —
// tasks-write.js:420-437). A "this calendar week Mon-Fri" fixture would make which
// rows happen to already be past-dated (and thus accidentally survive the CURRENT
// blunt mechanism) depend on which day of the week this suite runs on — exactly the
// un-mocked-`Date`/non-determinism hazard BASE-TESTING §4 warns about. Anchored
// instead to TODAY with fixed day-offsets (`recur.type: 'daily'`, so every calendar
// day is a valid pattern day — no MTWRF weekday-availability constraint), so the
// past/future status of every seeded instance is IDENTICAL no matter which day this
// suite executes.
var TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
var CYCLE_START = addDays(TODAY, -3); // safely in the past, always
var CYCLE_END = addDays(CYCLE_START, 7); // exclusive; today (offset 0) is always inside [start, end)
var FUTURE_NEAR = addDays(TODAY, 1); // tomorrow — always in the future regardless of run-day
var FUTURE_FAR = addDays(TODAY, 3); // always in the future, always the LATER of the two, always inside the cycle

var DAILY_RECUR = { type: 'daily', timesPerCycle: 2, every: 1, intervalDays: 1, monthDays: [1] };
function cloneDailyRecur(overrideField, overrideValue) {
  var r = Object.assign({}, DAILY_RECUR);
  r[overrideField] = overrideValue;
  return r;
}

async function cleanupUserData() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del().catch(function () {});
  await db('cal_history').where('user_id', USER_ID).del().catch(function () {});
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

beforeAll(async function () {
  await assertDbAvailable();
  await cleanupUserData();
  await db('users').where('id', USER_ID).del();
  await db('users').insert(__stampFixture({
    id: USER_ID,
    email: 'fr4-material-edit@test.invalid',
    name: 'FR-4 material edit reconciliation test',
    timezone: TZ,
    created_at: new Date(),
    updated_at: new Date()
  }));
}, 20000);

afterEach(async function () {
  await cleanupUserData();
});

afterAll(async function () {
  await cleanupUserData();
  await db('users').where('id', USER_ID).del();
  await db.destroy();
}, 15000);

var idSeq = 0;
function nextId(prefix) { idSeq++; return prefix + '-' + Date.now() + '-' + idSeq; }

async function seedMaster(recur, overrides) {
  var id = nextId('fr4-master');
  await db('task_masters').insert(__stampFixture(Object.assign({
    id: id,
    user_id: USER_ID,
    text: 'FR-4 material edit test master',
    dur: 30,
    pri: 'P3',
    status: '',
    recurring: 1,
    recur: JSON.stringify(recur),
    recur_start: fmt(MONDAY),
    split: false,
    split_min: null,
    placement_mode: 'anytime',
    created_at: new Date(),
    updated_at: new Date()
  }, overrides || {})));
  return id;
}

async function seedInstance(masterId, ordinal, dateObj, status) {
  var id = nextId('fr4-inst');
  await db('task_instances').insert(__stampFixture({
    id: id,
    master_id: masterId,
    user_id: USER_ID,
    occurrence_ordinal: ordinal,
    split_ordinal: 1,
    split_total: 1,
    scheduled_at: new Date(fmt(dateObj) + 'T09:00:00'),
    dur: 30,
    date: fmt(dateObj),
    status: status,
    generated: 0,
    created_at: new Date(),
    updated_at: new Date()
  }));
  return id;
}

async function instancesFor(masterId) {
  return db('task_instances').where({ master_id: masterId, user_id: USER_ID }).orderBy('scheduled_at', 'asc');
}

function cloneRecur(overrideField, overrideValue) {
  var r = Object.assign({}, BASE_RECUR);
  r[overrideField] = overrideValue;
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1 — FR-5 classifier: EVERY material field, edited alone, triggers
// reconciliation. Diagnostic signal used: skip/cancel rows (in-cycle) are
// REMOVED (AC5's own wording) and the done row is untouched. Fixture is built
// so the OPEN-instance count already matches the (unchanged, for most fields)
// cycle target, isolating the skip/cancel-pruning signal from the
// surplus/deficit math (covered separately in Group 3/4).
//
// EXPECTED RED (current code): for every one of these ten sub-cases, the
// skip/cancel rows survive untouched — either because the edit never reaches
// `recurCleanup` at all (dur, placementMode: fast path, per prior-art note #1),
// or because it does reach `recurCleanup` but neither code path there
// (`resetRecurringInstances` nor the pattern-window delete branch) ever
// touches a `status IN ('skip','cancel')` row.
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-5 classifier — every material field triggers reconciliation (skip/cancel removed)', function () {
  var materialCases = [
    { name: 'recur.type', body: function () { return { recur: cloneRecur('type', 'biweekly') }; } },
    { name: 'recur.days', body: function () { return { recur: cloneRecur('days', 'MTWRFS') }; } },
    { name: 'recur.every', body: function () { return { recur: cloneRecur('every', 2) }; } },
    { name: 'recur.intervalDays', body: function () { return { recur: cloneRecur('intervalDays', 2) }; } },
    { name: 'recur.monthDays', body: function () { return { recur: cloneRecur('monthDays', [1, 15]) }; } },
    { name: 'recur.timesPerCycle', body: function () { return { recur: cloneRecur('timesPerCycle', 3) }; } },
    { name: 'split', body: function () { return { split: true }; } },
    { name: 'split_min', body: function () { return { splitMin: 20 }; } },
    { name: 'dur', body: function () { return { dur: 45 }; } },
    { name: 'placement_mode', body: function () { return { placementMode: 'reminder' }; } }
  ];

  materialCases.forEach(function (c) {
    test('material field "' + c.name + '" -> skip+cancel rows removed, done row untouched', async function () {
      var masterId = await seedMaster(BASE_RECUR);
      var doneId = await seedInstance(masterId, 1, MONDAY, 'done');
      var skipId = await seedInstance(masterId, 2, WEDNESDAY, 'skip');
      var cancelId = await seedInstance(masterId, 3, THURSDAY, 'cancel');
      var openId = await seedInstance(masterId, 4, FRIDAY, ''); // matches tpc=2 - 1 done = 1 remaining

      var result = await facade.updateTask({
        id: masterId, userId: USER_ID, body: c.body(), timezoneHeader: TZ
      });
      expect(result.status).toBeLessThan(400);

      var doneRow = await db('task_instances').where('id', doneId).first();
      var skipRow = await db('task_instances').where('id', skipId).first();
      var cancelRow = await db('task_instances').where('id', cancelId).first();

      // done: NEVER touched (FR-4).
      expect(doneRow).toBeDefined();
      expect(doneRow.status).toBe('done');

      // skip/cancel: REMOVED (AC5's explicit wording — see prior-art note #4).
      expect(skipRow).toBeUndefined();
      expect(cancelRow).toBeUndefined();

      // Silence unused-var lint on openId — asserted in the dedicated
      // surplus/deficit tests (Group 3/4), not here.
      void openId;
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2 — FR-5 classifier / AC6: non-material fields trigger NO
// reconciliation at all. These are regression GUARDS — on today's code they
// should already PASS (none of these fields route through recurCleanup's
// reconciliation branches even when a future engine is added, they must
// continue to pass unchanged) — proving the classifier's negative space stays
// correct once the positive (Group 1) side is built.
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-5 classifier / AC6 — non-material fields trigger NO reconciliation', function () {
  var nonMaterialCases = [
    { name: 'weather_precip', body: { weatherPrecip: 'dry_only' } },
    { name: 'weather_cloud', body: { weatherCloud: 'clear' } },
    { name: 'weather_temp_min', body: { weatherTempMin: 40 } },
    { name: 'weather_temp_max', body: { weatherTempMax: 80 } },
    { name: 'pri', body: { pri: 'P1' } },
    { name: 'notes', body: { notes: 'updated notes' } },
    { name: 'project', body: { project: 'some-project' } },
    { name: 'section', body: { section: 'some-section' } },
    { name: 'url', body: { url: 'https://example.test/x' } },
    { name: 'tools', body: { tools: [] } },
    { name: 'location', body: { location: [] } }
  ];

  nonMaterialCases.forEach(function (c) {
    test('non-material field "' + c.name + '" -> instance set is byte-identical (no pruning/fabrication)', async function () {
      var masterId = await seedMaster(BASE_RECUR);
      var doneId = await seedInstance(masterId, 1, MONDAY, 'done');
      var skipId = await seedInstance(masterId, 2, WEDNESDAY, 'skip');
      var cancelId = await seedInstance(masterId, 3, THURSDAY, 'cancel');
      var openId = await seedInstance(masterId, 4, FRIDAY, '');

      var before = await instancesFor(masterId);
      expect(before.length).toBe(4);

      var result = await facade.updateTask({
        id: masterId, userId: USER_ID, body: c.body, timezoneHeader: TZ
      });
      expect(result.status).toBeLessThan(400);

      var after = await instancesFor(masterId);
      expect(after.length).toBe(4);
      var afterIds = after.map(function (r) { return r.id; }).sort();
      var expectedIds = [doneId, skipId, cancelId, openId].sort();
      expect(afterIds).toEqual(expectedIds);

      var byId = {};
      after.forEach(function (r) { byId[r.id] = r; });
      expect(byId[doneId].status).toBe('done');
      expect(byId[skipId].status).toBe('skip');
      expect(byId[cancelId].status).toBe('cancel');
      expect(byId[openId].status).toBe('');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3 — AC5 worked example: recur.timesPerCycle 3 -> 2, 1 done this cycle.
// remaining_needed = 2 - 1 = 1. Two OPEN instances exist (both in the future,
// today+1 and today+3) -> surplus of 1 -> the FURTHEST-DATE (today+3) is
// pruned; the nearer one (today+1) survives. done (3 days ago) is untouched.
// Effect is IMMEDIATE: asserted directly after the single `facade.updateTask`
// call, no scheduler run involved anywhere in this file. `recur.type: 'daily'`
// + today-relative offsets (see fixture determinism note above `DAILY_RECUR`)
// keep this test's outcome identical regardless of which day of the week the
// suite runs on.
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-4/AC5 — material recur.timesPerCycle edit reconciles OPEN instances (surplus prune, furthest-date-first)', function () {
  test('3x/cycle -> 2x/cycle with 1 done: surplus open instance pruned furthest-date-first; done untouched; immediate effect', async function () {
    var recur3x = cloneDailyRecur('timesPerCycle', 3);
    var masterId = await seedMaster(recur3x, { recur_start: fmt(CYCLE_START) });
    var doneId = await seedInstance(masterId, 1, CYCLE_START, 'done');
    var openNearId = await seedInstance(masterId, 2, FUTURE_NEAR, '');
    var openFarId = await seedInstance(masterId, 3, FUTURE_FAR, '');

    var before = await instancesFor(masterId);
    expect(before.length).toBe(3); // 1 done + 2 open === current tpc target of 3

    var result = await facade.updateTask({
      id: masterId,
      userId: USER_ID,
      body: { recur: cloneDailyRecur('timesPerCycle', 2) },
      timezoneHeader: TZ
    });
    expect(result.status).toBeLessThan(400);

    // Immediate, in-progress-cycle effect — read DIRECTLY after the update
    // call resolves. No expandRecurring/runSchedule call anywhere in this file.
    var after = await instancesFor(masterId);

    var doneRow = await db('task_instances').where('id', doneId).first();
    expect(doneRow).toBeDefined();
    expect(doneRow.status).toBe('done'); // FR-4: done NEVER touched

    var nearRow = await db('task_instances').where('id', openNearId).first();
    expect(nearRow).toBeDefined(); // the NEARER open instance (today+1) survives
    expect(nearRow.status).toBe('');

    var farRow = await db('task_instances').where('id', openFarId).first();
    expect(farRow).toBeUndefined(); // the FURTHEST-DATE open instance (today+3) is pruned (surplus)

    // remaining_needed = new_timesPerCycle(2) - done_this_cycle(1) = 1 remaining
    // open slot -> total instances for the cycle = 1 done + 1 open = 2.
    expect(after.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4 — AC5 reverse direction: recur.timesPerCycle 2 -> 3, 1 done this
// cycle. remaining_needed = 3 - 1 = 2. Only 1 OPEN instance exists (today+1) ->
// deficit of 1 -> a NEW instance must be FABRICATED immediately, in-cycle, on a
// date that doesn't collide with an already-booked date.
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-4/AC5 — material recur.timesPerCycle edit reconciles OPEN instances (deficit fabrication)', function () {
  test('2x/cycle -> 3x/cycle with 1 done: deficit open instance is FABRICATED immediately, in-cycle', async function () {
    var recur2x = cloneDailyRecur('timesPerCycle', 2);
    // dur deliberately overridden to a value (55) DISTINCT from the fabrication
    // code's own fallback default (facade.js:666, `updatedTmpl.dur != null ?
    // updatedTmpl.dur : 30`) and from seedInstance's hardcoded 30 — so
    // `expect(fab.dur).toBe(55)` below can only pass if the fabricated row
    // genuinely INHERITS the master's dur, not by coincidentally matching the
    // fallback default (zoe-w5-fab-dur-unpinned: a `dur: 30` master would leave
    // "inherited" and "defaulted" indistinguishable).
    var masterId = await seedMaster(recur2x, { recur_start: fmt(CYCLE_START), dur: 55 });
    var doneId = await seedInstance(masterId, 1, CYCLE_START, 'done');
    var openId = await seedInstance(masterId, 2, FUTURE_NEAR, '');

    var before = await instancesFor(masterId);
    expect(before.length).toBe(2); // 1 done + 1 open === current tpc target of 2

    var result = await facade.updateTask({
      id: masterId,
      userId: USER_ID,
      body: { recur: cloneDailyRecur('timesPerCycle', 3) },
      timezoneHeader: TZ
    });
    expect(result.status).toBeLessThan(400);

    var after = await instancesFor(masterId);

    var doneRow = await db('task_instances').where('id', doneId).first();
    expect(doneRow).toBeDefined();
    expect(doneRow.status).toBe('done'); // untouched

    var openRow = await db('task_instances').where('id', openId).first();
    expect(openRow).toBeDefined();
    expect(openRow.status).toBe(''); // untouched — it's within the new (higher) budget

    // remaining_needed = new_timesPerCycle(3) - done_this_cycle(1) = 2 remaining
    // slots; 1 already open (today+1) -> deficit of 1 -> total instances after
    // reconciliation = 1 done + 2 open = 3.
    expect(after.length).toBe(3);

    var fabricated = after.filter(function (r) {
      return r.id !== doneId && r.id !== openId;
    });
    expect(fabricated.length).toBe(1);

    var fab = fabricated[0];
    expect(fab.status).toBe(''); // open, not terminal
    // Fabricated date must fall within the in-progress cycle window and must
    // not collide with an already-booked date (CYCLE_START/FUTURE_NEAR). With
    // `recur.type: 'daily'` any non-colliding calendar day in-cycle is a valid
    // pattern day, so no weekday restriction applies here.
    var fabDate = new Date(fab.date + 'T00:00:00');
    expect(fabDate.getTime()).toBeGreaterThanOrEqual(CYCLE_START.getTime());
    expect(fabDate.getTime()).toBeLessThan(CYCLE_END.getTime());
    expect(fab.date).not.toBe(fmt(CYCLE_START));
    expect(fab.date).not.toBe(fmt(FUTURE_NEAR));

    // zoe-w5-fab-dur-unpinned (WARN-1): the fabricated row must INHERIT the
    // master's dur (55, deliberately distinct from the fabrication fallback's
    // own default of 30 above) — not be defaulted/blank/hardcoded to some
    // other value. Mutation-proven: facade.js:666 hardcoded to `dur: 999`
    // left this test suite green before this assertion existed.
    expect(fab.dur).toBe(55);
    // split_ordinal/split_total: fabrication always births the canonical
    // primary chunk (1/1) — pin the actual inserted values, not a blank/
    // undefined default.
    expect(fab.split_ordinal).toBe(1);
    expect(fab.split_total).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bert fix-pass regression coverage (juggler-recur-lifecycle-redesign W5
// findings: cookie W5-ARCH-1/W5-ARCH-2, ernie ernie-w5-skipcancel-breadth /
// ernie-w5-datecol-exclusive). Group 1's skip/cancel fixtures never seeded an
// OUT-OF-CYCLE (historical) skip/cancel row, so the all-cycles-vs-in-cycle
// scope bug was untested — these groups close that gap. WARN-1
// (ernie-w5-tznaive-today) is NOT independently repro'd here: ernie's own
// review notes a deterministic repro needs a clock+TZ injection harness this
// suite does not have (the fix is verified indirectly — Groups 1-4 above and
// the groups below all still pass with the tz-aware `today` computation, and
// this machine's local tz is America/New_York, matching TZ, so no drift is
// exercised). REFER->telly: add a clock-injectable fixture that forces
// server-tz != user-tz to independently characterize WARN-1's day-boundary
// fix if deeper coverage is wanted.
// ─────────────────────────────────────────────────────────────────────────────
describe('cookie W5-ARCH-1 / ernie ernie-w5-skipcancel-breadth — TPC-path skip/cancel prune is CYCLE-SCOPED, not master-wide', function () {
  test('a dur-only edit prunes an IN-CYCLE skip row but preserves a PRIOR-CYCLE (historical) skip row', async function () {
    var masterId = await seedMaster(BASE_RECUR, { recur_start: fmt(MONDAY) });
    var doneId = await seedInstance(masterId, 1, MONDAY, 'done');
    var inCycleSkipId = await seedInstance(masterId, 2, WEDNESDAY, 'skip');
    var openId = await seedInstance(masterId, 3, FRIDAY, '');
    // Two cycles (14 days) before this cycle's Monday — clearly out-of-cycle
    // acted-on history that the prior unscoped delete would have destroyed.
    var priorCycleDate = addDays(MONDAY, -14);
    var historicalSkipId = await seedInstance(masterId, 4, priorCycleDate, 'skip');

    var result = await facade.updateTask({
      id: masterId, userId: USER_ID, body: { dur: 45 }, timezoneHeader: TZ
    });
    expect(result.status).toBeLessThan(400);

    var inCycleRow = await db('task_instances').where('id', inCycleSkipId).first();
    expect(inCycleRow).toBeUndefined(); // in-cycle skip still pruned (AC5)

    var historicalRow = await db('task_instances').where('id', historicalSkipId).first();
    expect(historicalRow).toBeDefined(); // out-of-cycle history now PRESERVED (scope fix)
    expect(historicalRow.status).toBe('skip');

    var doneRow = await db('task_instances').where('id', doneId).first();
    expect(doneRow.status).toBe('done');
    void openId;
  });
});

describe('cookie W5-ARCH-2 / ernie ernie-w5-skipcancel-breadth — non-TPC fallback ALSO prunes in-cycle skip/cancel', function () {
  var NON_TPC_RECUR = { type: 'weekly', days: 'MTWRF' }; // no timesPerCycle -> non-TPC fallback branch

  test('a dur-only edit on a non-TPC recurring master prunes an in-cycle skip row but preserves a prior-cycle cancel row', async function () {
    var masterId = await seedMaster(NON_TPC_RECUR, { recur_start: fmt(MONDAY) });
    var inCycleSkipId = await seedInstance(masterId, 1, WEDNESDAY, 'skip');
    var priorCycleDate = addDays(MONDAY, -14);
    var historicalCancelId = await seedInstance(masterId, 2, priorCycleDate, 'cancel');

    var result = await facade.updateTask({
      id: masterId, userId: USER_ID, body: { dur: 45 }, timezoneHeader: TZ
    });
    expect(result.status).toBeLessThan(400);

    var inCycleRow = await db('task_instances').where('id', inCycleSkipId).first();
    // FR-4's unconditional prune rule now honored by the non-TPC path too.
    expect(inCycleRow).toBeUndefined();

    var historicalRow = await db('task_instances').where('id', historicalCancelId).first();
    expect(historicalRow).toBeDefined(); // cycle-scoped — prior-cycle history preserved
    expect(historicalRow.status).toBe('cancel');
  });
});

describe('ernie ernie-w5-datecol-exclusive WARN-2 — NULL-date open instance is counted via scheduled_at (no over-fabrication)', function () {
  test('a NULL-date, scheduled_at-carrying open instance counts toward remaining_needed instead of being invisible', async function () {
    var recur3x = cloneDailyRecur('timesPerCycle', 3);
    var masterId = await seedMaster(recur3x, { recur_start: fmt(CYCLE_START) });
    var doneId = await seedInstance(masterId, 1, CYCLE_START, 'done');

    // NULL `date`, but `scheduled_at` carries the in-cycle signal (e.g. an
    // on-demand-materialized row — ernie's reachability note).
    var nullDateOpenId = nextId('fr4-inst');
    await db('task_instances').insert(__stampFixture({
      id: nullDateOpenId,
      master_id: masterId,
      user_id: USER_ID,
      occurrence_ordinal: 2,
      split_ordinal: 1,
      split_total: 1,
      scheduled_at: new Date(fmt(FUTURE_NEAR) + 'T09:00:00'),
      dur: 30,
      date: null,
      status: '',
      generated: 0,
      created_at: new Date(),
      updated_at: new Date()
    }));

    var before = await instancesFor(masterId);
    expect(before.length).toBe(2);

    // dur-only edit: durChanged fires materialChanged with the SAME
    // timesPerCycle(3), isolating the counting fix from the surplus/deficit
    // math already covered by Groups 3/4.
    var result = await facade.updateTask({
      id: masterId, userId: USER_ID, body: { dur: 45 }, timezoneHeader: TZ
    });
    expect(result.status).toBeLessThan(400);

    var doneRow = await db('task_instances').where('id', doneId).first();
    expect(doneRow.status).toBe('done');

    var nullDateRow = await db('task_instances').where('id', nullDateOpenId).first();
    expect(nullDateRow).toBeDefined(); // counted as in-budget open — not pruned
    expect(nullDateRow.status).toBe('');

    // remaining_needed = tpc(3) - done(1) = 2; the NULL-date row now counts as
    // 1 of those 2 (fix) -> deficit = 1 -> exactly ONE fabricated row. Before
    // the fix the NULL-date row was invisible -> deficit = 2 -> TWO fabricated
    // rows (over-fabrication) -> total would be 4, not 3.
    var after = await instancesFor(masterId);
    expect(after.length).toBe(3);

    var fabricated = after.filter(function (r) {
      return r.id !== doneId && r.id !== nullDateOpenId;
    });
    expect(fabricated.length).toBe(1);

    // zoe-w5-fab-dur-unpinned (WARN-1): the edit itself changed dur 30->45,
    // so the fabricated row must carry the POST-EDIT master dur (45) — a
    // fallback-to-original-30 or hardcoded-to-anything-else bug would flip
    // this RED, distinguishing genuine inheritance from a coincidental
    // fallback-default match.
    expect(fabricated[0].dur).toBe(45);
  });
});
