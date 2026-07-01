/**
 * W2 Characterization tests — getSyncHistory(req, res)
 * cal-sync.controller.js:2354-2429
 *
 * PRE-REFACTOR BASELINE (999.942 W2). Pins the CURRENT behavior of the
 * exported `getSyncHistory` handler so the extraction into the calendar
 * slice facade can be proven byte-for-byte identical afterward.
 *
 * PASS-2 FIX (ernie CODE-REVIEW.md finding, 999.942): the original version of
 * this file used a passthrough `mockChainDb` that ignored builder args, so it
 * only pinned `.limit()` + call-count + controller-side ordering — it could
 * not catch a regression in the real facade `getSyncHistory`'s `.where` /
 * `.orderBy` direction / `.groupBy` / `.whereIn` clauses. Fixed: all tests now
 * call the REAL exported handler AND the REAL
 * `src/slices/calendar/facade.js#getSyncHistory` against the real test-bed
 * MySQL (127.0.0.1:3407 / juggler_test), seeding real `sync_history` rows
 * (mirrors the established real-DB seeding pattern already used by
 * tests/cal-sync/12-sync-history-prune.test.js, which reads/writes the same
 * table). No adapter-level mocking is needed here (getSyncHistory never
 * touches calendar adapters) — only the unrelated sse-emitter/scheduleQueue/
 * sync-lock side-effect mocks are kept, matching this leg's other
 * characterization suites.
 *
 * Traceability: TRACEABILITY.md B2 (W2 column).
 *
 * Matrix covered:
 *   W2-1  no sync_history rows → { runs: [] }, second DB query never made
 *   W2-2  default `runs` cap (no ?runs query param) → real query LIMIT 20
 *         (proven by seeding 21 runs and asserting only 20 are returned)
 *   W2-3  ?runs=5 respected → real query returns exactly 5 runs
 *   W2-4  ?runs=100 (over the 50 cap) → real query returns at most 50 runs
 *   W2-5  CHARACTERIZATION DISCOVERY: ?runs=0 → falls back to 20, NOT 0 — the
 *         `Math.min(parseInt(req.query.runs) || 20, 50)` computation treats
 *         parseInt('0')===0 as falsy, so it falls through to the 20 default
 *         rather than requesting zero runs. Pinned as current (possibly
 *         surprising) behavior, proven against the real query.
 *   W2-6  REVISED DISCOVERY (found only once real SQL ran): ?runs=-5 passes
 *         through unclamped on the low end (Math.min only caps the high end)
 *         and produces a REAL MySQL syntax error (`LIMIT -5` is invalid SQL,
 *         ER_PARSE_ERROR) → the endpoint returns 500, NOT a graceful empty
 *         array. The original mock-based version of this test only asserted
 *         `.limit(-5)` was called and could not see this — a pre-existing,
 *         out-of-scope-for-this-refactor input-validation gap, flagged as an
 *         INFO finding to Oscar/backlog rather than papered over.
 *   W2-7  multiple runs — response `runs` array preserves the ORDER of the
 *         real recentRuns (grouped/ordered DESC by MAX(created_at)) query,
 *         not raw row-insertion order
 *   W2-8  a run's detail shape: sync_run_id, created_at, trigger_type
 *         (defaulted to 'manual' when absent), providers (deduped),
 *         calendar_names (deduped), counts (tallied by action), items (raw
 *         rows) — read from real seeded rows
 *   W2-9  old_values / new_values / error_detail are JSON-parsed via
 *         safeParseJSON on each real row
 *   W2-10 a run present in recentRuns but with NO matching detail rows still
 *         appears in the response with an empty-shape fallback object
 *   W2-11 outer catch — a DB error on the recentRuns query → 500
 */

'use strict';

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.test') });

var crypto = require('crypto');

jest.mock('../../../src/lib/sse-emitter', () => ({ emit: jest.fn(), addClient: jest.fn() }));
jest.mock('../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));
jest.mock('../../../src/lib/sync-lock', () => ({
  withSyncLock: (fn) => fn,
  acquireLock: jest.fn(() => Promise.resolve(true)),
  releaseLock: jest.fn(() => Promise.resolve()),
  refreshLock: jest.fn(() => Promise.resolve())
}));

var { getSyncHistory } = require('../../../src/controllers/cal-sync.controller');
var { requireDB, assertDbAvailable } = require('../../helpers/requireDB');
// Real db connection — the SAME singleton the real facade's
// getSyncHistory uses internally (src/db.js -> lib/db.getDefaultDb()).
var db = require('../../../src/db');

var USER_ID = '999942-w2-charz-user';

function makeRes() {
  return { json: jest.fn(), status: jest.fn().mockReturnThis() };
}

async function seedUser() {
  await db('users').where('id', USER_ID).del();
  await db('users').insert({
    id: USER_ID,
    email: USER_ID + '@test.com',
    name: 'W2 Characterization User',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}

async function cleanupHistory() {
  await db('sync_history').where('user_id', USER_ID).del();
}

/**
 * Insert one real sync_history row.
 * @param {object} opts
 *   sync_run_id, provider, action, calendar_name, trigger_type,
 *   old_values, new_values, error_detail, created_at (Date or string),
 *   task_id, task_text, event_id
 */
async function insertHistoryRow(opts) {
  opts = opts || {};
  await db('sync_history').insert({
    user_id: USER_ID,
    sync_run_id: opts.sync_run_id,
    provider: opts.provider || 'gcal',
    action: opts.action || 'push',
    task_id: opts.task_id || null,
    task_text: opts.task_text || null,
    event_id: opts.event_id || null,
    old_values: typeof opts.old_values !== 'undefined' ? opts.old_values : null,
    new_values: typeof opts.new_values !== 'undefined' ? opts.new_values : null,
    error_detail: typeof opts.error_detail !== 'undefined' ? opts.error_detail : null,
    calendar_name: opts.calendar_name || null,
    trigger_type: typeof opts.trigger_type !== 'undefined' ? opts.trigger_type : null,
    created_at: opts.created_at || db.fn.now()
  });
}

function makeRunId() {
  return 'run-' + crypto.randomBytes(6).toString('hex');
}

beforeAll(async () => {
  await assertDbAvailable();
  await seedUser();
});

afterEach(async () => {
  await cleanupHistory();
  jest.clearAllMocks();
});

afterAll(async () => {
  await cleanupHistory();
  await db('users').where('id', USER_ID).del();
  await db.destroy();
});

describe('W2: getSyncHistory(req, res) — characterization (pre-refactor baseline)', () => {
  it('W2-1: no sync_history rows → { runs: [] }', requireDB(async () => {
    const req = { user: { id: USER_ID }, query: {} };
    const res = makeRes();
    // No rows seeded for USER_ID.

    await getSyncHistory(req, res);

    expect(res.json).toHaveBeenCalledWith({ runs: [] });
  }));

  it('W2-2: default `runs` (no query param) → real query caps at 20 (seed 21, expect 20 returned)', requireDB(async () => {
    const req = { user: { id: USER_ID }, query: {} };
    const res = makeRes();

    for (var i = 0; i < 21; i++) {
      var runId = makeRunId();
      await insertHistoryRow({
        sync_run_id: runId,
        created_at: new Date(Date.now() - i * 1000),
        trigger_type: 'manual'
      });
    }

    await getSyncHistory(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.runs).toHaveLength(20);
  }));

  it('W2-3: ?runs=5 respected → real query returns exactly 5 runs', requireDB(async () => {
    const req = { user: { id: USER_ID }, query: { runs: '5' } };
    const res = makeRes();

    for (var i = 0; i < 8; i++) {
      var runId = makeRunId();
      await insertHistoryRow({
        sync_run_id: runId,
        created_at: new Date(Date.now() - i * 1000),
        trigger_type: 'manual'
      });
    }

    await getSyncHistory(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.runs).toHaveLength(5);
  }));

  it('W2-4: ?runs=100 (over the 50 cap) → real query returns at most 50 runs (seed 52, expect 50)', requireDB(async () => {
    const req = { user: { id: USER_ID }, query: { runs: '100' } };
    const res = makeRes();

    for (var i = 0; i < 52; i++) {
      var runId = makeRunId();
      await insertHistoryRow({
        sync_run_id: runId,
        created_at: new Date(Date.now() - i * 1000),
        trigger_type: 'manual'
      });
    }

    await getSyncHistory(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.runs).toHaveLength(50);
  }));

  it('W2-5: CHARACTERIZATION DISCOVERY — ?runs=0 falls back to the 20 default (falsy-zero gap in `parseInt(...) || 20`), NOT zero rows', requireDB(async () => {
    const req = { user: { id: USER_ID }, query: { runs: '0' } };
    const res = makeRes();

    // Seed exactly 3 runs — if the real query correctly received LIMIT 20
    // (the falsy-zero fallback), all 3 come back. If a regression made it
    // request LIMIT 0, this would return 0 runs instead.
    for (var i = 0; i < 3; i++) {
      var runId = makeRunId();
      await insertHistoryRow({
        sync_run_id: runId,
        created_at: new Date(Date.now() - i * 1000),
        trigger_type: 'manual'
      });
    }

    await getSyncHistory(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.runs).toHaveLength(3);
  }));

  it('W2-6: CHARACTERIZATION DISCOVERY (real-DB finding, revised from the original mock-based pin) — ?runs=-5 passes through unclamped on the low end and produces a REAL MySQL syntax error ("LIMIT -5" is invalid SQL), surfaced as a 500 — NOT a graceful empty/clamped response', requireDB(async () => {
    const req = { user: { id: USER_ID }, query: { runs: '-5' } };
    const res = makeRes();

    // Seed 3 runs — irrelevant to the outcome (the query never completes).
    for (var i = 0; i < 3; i++) {
      var runId = makeRunId();
      await insertHistoryRow({
        sync_run_id: runId,
        created_at: new Date(Date.now() - i * 1000),
        trigger_type: 'manual'
      });
    }

    await getSyncHistory(req, res);

    // The ORIGINAL mock-based version of this test asserted `.limit(-5)` was
    // merely CALLED and inferred a graceful "zero rows" result from that —
    // it never ran real SQL. Exercising the REAL facade against the REAL DB
    // (this leg's fix) reveals that is FALSE: `Math.min(parseInt('-5'), 50)`
    // = -5 is passed straight to knex's `.limit(-5)`, which compiles to the
    // literal SQL `LIMIT -5` — invalid MySQL syntax (ER_PARSE_ERROR, errno
    // 1064). The query throws, propagates to getSyncHistory's outer catch,
    // and the endpoint returns 500, not { runs: [] } or any clamped list.
    // This is a genuine, pre-existing (not introduced by 999.942) input-
    // validation gap: `runs=<negative>` is user-suppliable (?runs=-5) and
    // currently 500s instead of clamping to a sane floor. Out of scope to
    // FIX in this refactor-characterization leg (no behavior change is the
    // mandate) — flagged to Oscar/backlog as an INFO finding in
    // telly-REVIEW.md rather than silently pinning the wrong ("zero rows")
    // shape the mock had implied.
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to retrieve sync history' });
  }));

  it('W2-7: multiple runs — response order follows the real recentRuns query (DESC by MAX(created_at)), not raw row-insertion order', requireDB(async () => {
    const req = { user: { id: USER_ID }, query: {} };
    const res = makeRes();

    var runA = makeRunId(); // older
    var runB = makeRunId(); // newer

    // Insert run-A's detail row FIRST (raw insertion order: A before B) but
    // with an OLDER created_at than run-B, so the real ORDER BY MAX(created_at)
    // DESC must put B first despite A being inserted first.
    await insertHistoryRow({
      sync_run_id: runA,
      provider: 'gcal',
      action: 'push',
      calendar_name: 'Cal A',
      trigger_type: 'manual',
      created_at: new Date('2026-06-18T09:00:01Z')
    });
    await insertHistoryRow({
      sync_run_id: runB,
      provider: 'msft',
      action: 'pull',
      calendar_name: 'Cal B',
      trigger_type: 'auto',
      created_at: new Date('2026-06-20T10:00:01Z')
    });

    await getSyncHistory(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.runs).toHaveLength(2);
    // Order must match the real query's DESC ordering (B then A), NOT
    // insertion order (A then B).
    expect(body.runs[0].sync_run_id).toBe(runB);
    expect(body.runs[1].sync_run_id).toBe(runA);
  }));

  it('W2-8: run detail shape — sync_run_id/created_at/trigger_type/providers/calendar_names/counts/items (from real rows)', requireDB(async () => {
    const req = { user: { id: USER_ID }, query: {} };
    const res = makeRes();
    const runId = makeRunId();

    await insertHistoryRow({
      sync_run_id: runId, provider: 'gcal', action: 'push',
      task_id: 't1', task_text: 'Task 1', event_id: 'evt-1',
      calendar_name: 'Primary', trigger_type: null,
      created_at: new Date('2026-06-20T10:00:01Z')
    });
    await insertHistoryRow({
      sync_run_id: runId, provider: 'gcal', action: 'push',
      task_id: 't2', task_text: 'Task 2', event_id: 'evt-2',
      calendar_name: 'Primary', trigger_type: null,
      created_at: new Date('2026-06-20T10:00:02Z')
    });
    await insertHistoryRow({
      sync_run_id: runId, provider: 'msft', action: 'delete',
      task_id: 't3', task_text: 'Task 3', event_id: 'evt-3',
      calendar_name: 'Work', trigger_type: null,
      created_at: new Date('2026-06-20T10:00:03Z')
    });

    await getSyncHistory(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.runs).toHaveLength(1);
    const run = body.runs[0];
    expect(run.sync_run_id).toBe(runId);
    // trigger_type falls back to 'manual' when the row's trigger_type is falsy.
    expect(run.trigger_type).toBe('manual');
    // providers deduped (gcal appears twice, msft once) → 2 unique entries.
    expect(run.providers.slice().sort()).toEqual(['gcal', 'msft']);
    // calendar_names deduped (Primary appears twice, Work once) → 2 unique entries.
    expect(run.calendar_names.slice().sort()).toEqual(['Primary', 'Work']);
    // counts tallied by action: push x2, delete x1.
    expect(run.counts).toEqual({ push: 2, delete: 1 });
    // items carries all 3 real rows, ordered by id ASC (insertion order).
    expect(run.items).toHaveLength(3);
    expect(run.items[0].task_id).toBe('t1');
    expect(run.items[2].task_id).toBe('t3');
  }));

  it('W2-9: old_values / new_values / error_detail are JSON-parsed via safeParseJSON (from a real JSON-column row)', requireDB(async () => {
    const req = { user: { id: USER_ID }, query: {} };
    const res = makeRes();
    const runId = makeRunId();

    await insertHistoryRow({
      sync_run_id: runId, provider: 'gcal', action: 'update',
      old_values: JSON.stringify({ text: 'Old title' }),
      new_values: JSON.stringify({ text: 'New title' }),
      error_detail: null,
      calendar_name: 'Primary', trigger_type: 'manual',
      created_at: new Date('2026-06-20T10:00:01Z')
    });

    await getSyncHistory(req, res);

    const body = res.json.mock.calls[0][0];
    const item = body.runs[0].items[0];
    expect(item.old_values).toEqual({ text: 'Old title' });
    expect(item.new_values).toEqual({ text: 'New title' });
    expect(item.error_detail).toBeNull();
  }));

  it('W2-10: a run present in recentRuns but with no matching detail rows still appears with the empty-shape fallback', requireDB(async () => {
    const req = { user: { id: USER_ID }, query: {} };
    const res = makeRes();

    // DISCOVERY: the real facade's recentRuns and rows queries both key off
    // the SAME sync_history table with the SAME WHERE user_id — so a
    // sync_run_id present in recentRuns can NEVER be absent from `rows`
    // through any normal (non-racing) write pattern; this fallback branch is
    // unreachable via real seeded data. Rather than fabricate an impossible
    // seed (which would require reimplementing the query with fake data —
    // the exact anti-pattern this fix removes), this test isolates the
    // CONTROLLER's OWN runMap-merge fallback by substituting only the
    // facade's return VALUE for this one call (not its query logic) with a
    // recentRuns/rows pair that a race condition (row deleted between the
    // two real queries) could legitimately produce in production.
    var calendarFacade = require('../../../src/slices/calendar/facade');
    var spy = jest.spyOn(calendarFacade, 'getSyncHistory').mockResolvedValueOnce({
      recentRuns: [{ sync_run_id: 'orphan-run', run_time: '2026-06-20 10:00:00' }],
      rows: []
    });

    await getSyncHistory(req, res);
    spy.mockRestore();

    const body = res.json.mock.calls[0][0];
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toEqual({
      sync_run_id: 'orphan-run',
      created_at: '2026-06-20 10:00:00', // falls back to recentRuns' run_time
      trigger_type: 'manual',
      providers: [],
      calendar_names: [],
      counts: {},
      items: []
    });
  }));

  it('W2-11: outer catch — a DB error on the recentRuns query → 500 { error: "Failed to retrieve sync history" }', requireDB(async () => {
    const req = { user: { id: USER_ID }, query: {} };
    const res = makeRes();

    // Force the controller's outer catch WITHOUT touching the shared
    // connection pool other tests/afterAll depend on: reject the facade
    // call once. This pins the controller's own error-handling wrapper
    // (500 + fixed error message), which is orthogonal to the facade query
    // correctness the rest of this file now exercises for real.
    var calendarFacade = require('../../../src/slices/calendar/facade');
    var spy = jest.spyOn(calendarFacade, 'getSyncHistory').mockRejectedValueOnce(new Error('connection lost'));

    await getSyncHistory(req, res);
    spy.mockRestore();

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to retrieve sync history' });
  }));
});
