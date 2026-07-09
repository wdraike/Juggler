/**
 * next_start_terminal_writepath_w2.regression.test.js
 *
 * Traceability: juggler-recur-lifecycle-redesign SPEC.md FR-1 (Unified anchor) /
 * AC1 / AC2. Completes tests/task_masters_next_start_unified_anchor.regression.
 * test.js's `test.todo` #9 (left pending for W2 by design — see that file's
 * header) now that the write-path shape is known: the REAL entry point is
 * `facade.updateTaskStatus` -> `applyRollingAnchor` (facade.js:558-597), the same
 * seam `tests/slices/task/facade-next-occurrence-anchor-wiring.db.test.js` already
 * exercises for the OLD `rolling_anchor`/`next_occurrence_anchor` columns. This
 * file pins the SAME seam writing the NEW unified `next_start` column instead.
 *
 * W2 scope under test here (WBS-juggler-recur-lifecycle-redesign.md row W2,
 * item (a)): `next-occurrence-anchor.js` / `applyRollingAnchor` / `expandRecurring
 * .getAnchor` read `next_start` as the canonical anchor, monotonically.
 *
 * CORRECTED 2026-07-09 (SPEC.md AC1, dual-write revision): `next_start` is the
 * new canonical READ path (`getAnchor()` reads it first), but the WRITE path
 * DUAL-WRITES for this leg — `applyRollingAnchor` keeps writing the legacy
 * `rolling_anchor`/`next_occurrence_anchor` columns too (their normal computed
 * value, unchanged), so the 34 pre-existing test files that pin those columns
 * are undisturbed. Ceasing the legacy writes is an explicit follow-on backlog
 * item, NOT this leg's AC1. Two assertions in this file previously asserted
 * legacy-column CESSATION (`toBeNull()`); corrected to assert dual-write
 * (legacy column gets its normal value, same as `next_start`).
 *
 * Written FIRST (telly step 0, mode=new) against code that does NOT exist yet —
 * every DB-backed test below is expected to RED for the SAME reason: the current
 * `applyRollingAnchor` (facade.js:558-597) still reads/writes the OLD
 * `rolling_anchor` / `next_occurrence_anchor` columns and never touches
 * `next_start` at all. The two pure-unit tests (getAnchor / rowToTask) RED for
 * their own, separately-confirmed reasons (see each test's comment).
 *
 * Mocking convention mirrors facade-next-occurrence-anchor-wiring.db.test.js
 * exactly (isolate scheduler-timer/redis/SSE; drive the REAL DB read/write path).
 *
 * Run: cd juggler/juggler-backend && npx jest --testPathPattern="next_start_terminal_writepath_w2" --runInBand
 * (requires test-bed MySQL @3407 — `cd test-bed && make up`)
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'w2-nextstart-writepath-001';

jest.mock('../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));
jest.mock('../src/lib/redis', () => ({
  getClient: jest.fn().mockReturnValue(null),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(true),
  invalidateTasks: jest.fn().mockResolvedValue(true),
  invalidateConfig: jest.fn().mockResolvedValue(true)
}));
jest.mock('../src/lib/sse-emitter', () => ({ emit: jest.fn(), addClient: jest.fn() }));

var controller = require('../src/controllers/task.controller');

function mockReq(overrides) {
  return Object.assign({
    user: { id: USER_ID },
    headers: { 'x-timezone': 'America/New_York' },
    params: {},
    query: {},
    body: {},
    planFeatures: {
      limits: { active_tasks: -1, recurring_templates: -1, projects: -1, locations: -1 },
      calendar: { max_providers: -1 },
      scheduling: { dependencies: true, travel_time: true },
      tasks: { rigid: true }
    },
    planId: 'enterprise'
  }, overrides);
}

function mockRes() {
  var res = {
    statusCode: 200,
    _json: null,
    status: function (code) { res.statusCode = code; return res; },
    json: function (data) { res._json = data; return res; }
  };
  return res;
}

async function seedMaster(tmplId, overrides) {
  var now = new Date();
  await db('task_masters').insert(Object.assign({
    id: tmplId,
    user_id: USER_ID,
    text: 'w2 next_start writepath test',
    dur: 30,
    pri: 'P3',
    recurring: 1,
    status: '',
    recur_start: '2026-01-01',
    rolling_anchor: null,
    next_occurrence_anchor: null,
    next_start: null,
    created_at: now,
    updated_at: now
  }, overrides));
}

async function seedInstance(instId, tmplId, date, overrides) {
  var now = new Date();
  await db('task_instances').insert(Object.assign({
    id: instId,
    master_id: tmplId,
    user_id: USER_ID,
    status: '',
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 1,
    dur: 30,
    date: date,
    scheduled_at: new Date(date + 'T10:00:00Z'),
    created_at: now,
    updated_at: now
  }, overrides));
}

async function markStatus(instId, status) {
  var req = mockReq({ params: { id: instId }, body: { status: status } });
  var res = mockRes();
  await controller.updateTaskStatus(req, res);
  return res;
}

describe('FR-1(a)/AC2 — terminal write advances task_masters.next_start (unified anchor)', () => {

  beforeAll(async () => {
    await assertDbAvailable();
    var existing = await db('users').where('id', USER_ID).first();
    if (!existing) {
      await db('users').insert({
        id: USER_ID,
        email: 'w2-nextstart-writepath@test.invalid',
        name: 'w2 next_start writepath test',
        timezone: 'America/New_York',
        created_at: new Date(),
        updated_at: new Date()
      });
    }
  });

  afterEach(async () => {
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
  });

  afterAll(async () => {
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
    await db.destroy();
  });

  test('rolling master: marking an instance done advances next_start to the ACTUAL completion date (today), not rolling_anchor', async () => {
    var tmplId = 'w2-ns-rolling-' + Date.now();
    var instId = tmplId + '-i1';
    await seedMaster(tmplId, { recur: JSON.stringify({ type: 'rolling', intervalDays: 7 }) });
    await seedInstance(instId, tmplId, '2026-06-01');

    var res = await markStatus(instId, 'done');
    expect(res.statusCode).toBe(200);

    var master = await db('task_masters').where('id', tmplId).first();
    var todayKey = new Date().toISOString().slice(0, 10);
    expect(master.next_start).not.toBeNull();
    expect(String(master.next_start).slice(0, 10)).toBe(todayKey);
    // AC1 (revised 2026-07-09): the write path DUAL-WRITES for this leg —
    // `next_start` is canonical for READS, but `rolling_anchor` keeps getting
    // its normal, pre-existing computed value too (ceasing the legacy write
    // is a follow-on backlog item, not this leg's AC1). On this first-ever
    // write (no prior anchor), both columns receive the SAME computed value.
    expect(master.rolling_anchor).not.toBeNull();
    expect(String(master.rolling_anchor).slice(0, 10)).toBe(todayKey);
  });

  test('non-rolling (weekly) master: marking an instance done advances next_start to the next pattern date, not next_occurrence_anchor', async () => {
    var tmplId = 'w2-ns-weekly-' + Date.now();
    var instId = tmplId + '-i1';
    // Wednesday-only weekly master; 2026-07-08 is a Wednesday.
    await seedMaster(tmplId, { recur: JSON.stringify({ type: 'weekly', days: 'W' }) });
    await seedInstance(instId, tmplId, '2026-07-08');

    var res = await markStatus(instId, 'done');
    expect(res.statusCode).toBe(200);

    var master = await db('task_masters').where('id', tmplId).first();
    expect(master.next_start).not.toBeNull();
    expect(String(master.next_start).slice(0, 10)).toBe('2026-07-15'); // next Wednesday
    // AC1 (revised 2026-07-09): dual-write — `next_occurrence_anchor` keeps
    // getting its normal, pre-existing computed value alongside `next_start`
    // (not nulled/ceased); on this first-ever write both columns match.
    expect(master.next_occurrence_anchor).not.toBeNull();
    expect(String(master.next_occurrence_anchor).slice(0, 10)).toBe('2026-07-15');
  });

  test('monotonic guard (FR-1a): next_start never regresses to an earlier computed date, but does advance to a later one', async () => {
    var tmplId = 'w2-ns-monotonic-' + Date.now();
    var i1 = tmplId + '-i1';
    var i2 = tmplId + '-i2';
    var i3 = tmplId + '-i3';
    // Rolling type: `skip` anchors to the instance's OWN scheduled date (not
    // "today"), giving full control over the candidate value per step —
    // isolates the monotonic guard from wall-clock "today" nondeterminism.
    await seedMaster(tmplId, { recur: JSON.stringify({ type: 'rolling', intervalDays: 7 }) });
    // Distinct occurrence_ordinal per instance — task_instances has a UNIQUE
    // constraint on (master_id, occurrence_ordinal, split_ordinal).
    await seedInstance(i1, tmplId, '2026-06-01', { occurrence_ordinal: 1 });
    await seedInstance(i2, tmplId, '2026-05-01', { occurrence_ordinal: 2 }); // EARLIER than i1
    await seedInstance(i3, tmplId, '2026-07-01', { occurrence_ordinal: 3 }); // LATER than i1

    // Step 1: establish next_start = 2026-06-01 (proves the write path exists —
    // RED under current code, which never touches next_start).
    await markStatus(i1, 'skip');
    var afterFirst = await db('task_masters').where('id', tmplId).first();
    expect(String(afterFirst.next_start).slice(0, 10)).toBe('2026-06-01');

    // Step 2: an EARLIER event (2026-05-01 < current 2026-06-01) must NOT regress
    // next_start. RED under current code for the SAME reason as step 1 (next_start
    // is never written at all, so this assertion also fails against a NULL value,
    // not merely "unchanged" — the specific value 2026-06-01 must be present).
    await markStatus(i2, 'skip');
    var afterEarlier = await db('task_masters').where('id', tmplId).first();
    expect(String(afterEarlier.next_start).slice(0, 10)).toBe('2026-06-01');

    // Step 3: a LATER event (2026-07-01 > current 2026-06-01) MUST advance.
    await markStatus(i3, 'skip');
    var afterLater = await db('task_masters').where('id', tmplId).first();
    expect(String(afterLater.next_start).slice(0, 10)).toBe('2026-07-01');
  });
});

describe('FR-1(a) — pure-unit seams getAnchor()/rowToTask() must read next_start', () => {
  var { rowToTask } = require('../src/slices/task/domain/mappers/taskMappers');
  var { getAnchor } = require('../../shared/scheduler/expandRecurring');

  test('rowToTask maps row.next_start -> task.nextStart', () => {
    var row = {
      id: 'unit-row-1', task_type: 'recurring_template', text: 't', dur: 30, pri: 'P3',
      recurring: 1, recur: JSON.stringify({ type: 'weekly', days: 'W' }),
      recur_start: '2026-01-01', next_start: '2026-07-15',
      rolling_anchor: null, next_occurrence_anchor: null,
      created_at: null, updated_at: null, status: '', disabled_at: null, disabled_reason: null
    };
    var task = rowToTask(row, 'America/New_York', null, null, { todayKey: '2026-07-09', nowMins: 600 });
    // RED (current code): taskMappers.js has no `next_start` mapping at all
    // (grep confirms zero hits) — task.nextStart comes back undefined.
    expect(task.nextStart).toBe('2026-07-15');
  });

  test('getAnchor() resolves src.nextStart when rollingAnchor/nextOccurrenceAnchor are both absent', () => {
    var src = {
      recur: { type: 'weekly', days: 'W' },
      recurStart: '2026-01-01',
      date: null,
      rollingAnchor: null,
      nextOccurrenceAnchor: null,
      nextStart: '2026-07-15'
    };
    var anchor = getAnchor(src, new Date('2026-07-01'));
    // RED (current code): getAnchor() (expandRecurring.js:33-52) only branches on
    // src.rollingAnchor / src.nextOccurrenceAnchor; src.nextStart is never read,
    // so this falls through to recurStart (2026-01-01) instead.
    expect(anchor.getFullYear()).toBe(2026);
    expect(anchor.getMonth()).toBe(6); // July (0-indexed)
    expect(anchor.getDate()).toBe(15);
  });
});
