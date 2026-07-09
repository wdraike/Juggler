/**
 * next_start_scheduler_sweep_w2.regression.test.js
 *
 * Traceability: juggler-recur-lifecycle-redesign SPEC.md FR-1(b) (Unified anchor,
 * scheduler-run sweep) / AC2.
 *
 * "A scheduler run's first step, for every non-rolling master where
 * `next_start < today`, advance to the first pattern date `>= today`. Rolling-
 * type masters are EXEMPT from (b) — no anchor exists until first completion."
 *
 * No sweep mechanism exists in the codebase today (confirmed by direct read +
 * grep of src/scheduler/runSchedule.js: the ONLY existing anchor-adjacent sweep
 * is the rolling_anchor backfill at lines 705-730, which is a DIFFERENT
 * mechanism — "seed a null rolling_anchor from history," not "advance a stale
 * next_start forward through the pattern"). This test drives the REAL, already-
 * existing full-scheduler entry point (`runScheduleAndPersist`, the same one
 * `tests/runScheduleIntegration.test.js` uses) rather than guessing an unbuilt
 * internal function name/shape — the observable contract is "after a scheduler
 * run, task_masters.next_start reflects FR-1(b)'s rule," regardless of which
 * internal step implements it.
 *
 * Expected value is computed independently via the REAL exported
 * `nextMatchingDate` (shared/scheduler/expandRecurring.js) — not hand-picked —
 * so a future change to the pattern-walk algorithm itself doesn't silently
 * desync this test's expectation from the production code it pins.
 *
 * Mirrors tests/runScheduleIntegration.test.js's own house style exactly
 * (no scheduleQueue/redis/sse mocks — this is a REAL full-stack scheduler run
 * against test-bed infra, matching that file's documented convention).
 *
 * Run: cd juggler/juggler-backend && npx jest --testPathPattern="next_start_scheduler_sweep_w2" --runInBand
 * (requires test-bed MySQL @3407 + Redis @6479 — `cd test-bed && make up`)
 */

'use strict';

var db = require('../src/db');
var { runScheduleAndPersist } = require('../src/scheduler/runSchedule');
var { nextMatchingDate } = require('../../shared/scheduler/expandRecurring');
var { DEFAULT_TIME_BLOCKS, DEFAULT_TOOL_MATRIX } = require('../src/scheduler/constants');
var tasksWrite = require('../src/lib/tasks-write');
var { assertDbAvailable } = require('./helpers/requireDB');

var available = false;
var USER_ID = 'w2-nextstart-sweep-001';
var TZ = 'America/New_York';

beforeAll(async () => {
  await assertDbAvailable();
  try { await db.raw('SELECT 1'); available = true; } catch (e) {
    console.warn('Test DB not available:', e.message);
    return;
  }
  await cleanup();
  await db('users').insert({
    id: USER_ID, email: 'w2-nextstart-sweep@test.com', timezone: TZ,
    created_at: db.fn.now(), updated_at: db.fn.now()
  });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'time_blocks', config_value: JSON.stringify(DEFAULT_TIME_BLOCKS) });
  await db('user_config').insert({ user_id: USER_ID, config_key: 'tool_matrix', config_value: JSON.stringify(DEFAULT_TOOL_MATRIX) });
}, 15000);

afterAll(async () => {
  if (available) await cleanup();
  await db.destroy();
});

async function cleanup() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('user_config').where({ user_id: USER_ID, config_key: 'schedule_cache' }).del();
});

function seedTemplate(overrides) {
  // `next_start` is NOT in tasks-write.js's MASTER_FIELDS whitelist (same as its
  // rolling_anchor/next_occurrence_anchor siblings — those columns are written
  // via raw UPDATE elsewhere, never through insertTask's pickMaster()), so it
  // silently gets dropped by insertTask. Insert normally, then raw-UPDATE
  // next_start directly (mirrors the sibling anchor tests' convention of
  // raw db('task_masters') writes for these three anchor columns).
  var id = overrides.id || ('w2-sweep-tmpl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  var nextStart = overrides.next_start;
  var rest = Object.assign({}, overrides);
  delete rest.next_start;
  return tasksWrite.insertTask(db, Object.assign({
    id: id,
    user_id: USER_ID, task_type: 'recurring_template', recurring: 1, text: 'Sweep test',
    dur: 30, pri: 'P3', status: '', recur_start: '2026-01-01',
    created_at: db.fn.now(), updated_at: db.fn.now()
  }, rest)).then(function () {
    if (nextStart !== undefined) {
      return db('task_masters').where('id', id).update({ next_start: nextStart });
    }
  }).then(function () { return id; });
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayKey() {
  var d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
function daysAgoKey(n) {
  var d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

describe('FR-1(b)/AC2 — scheduler-run sweep advances a stale non-rolling next_start; rolling is exempt', () => {

  test('non-rolling (weekly, Wednesday-only) master with next_start in the past advances to the first Wednesday >= today', async () => {
    if (!available) return;
    var tmplId = 'w2-sweep-weekly-' + Date.now();
    var recur = { type: 'weekly', days: 'W' };
    var staleAnchor = daysAgoKey(30); // deliberately stale
    await seedTemplate({ id: tmplId, recur: JSON.stringify(recur), next_start: staleAnchor });

    await runScheduleAndPersist(USER_ID);

    var master = await db('task_masters').where('id', tmplId).first();
    var expected = nextMatchingDate(recur, yesterdayKey(), staleAnchor);
    // RED (current code): no sweep step exists at all — next_start stays at the
    // stale seeded value instead of advancing to `expected`.
    expect(String(master.next_start).slice(0, 10)).toBe(expected);
    // Sanity: the swept value must actually be >= today (FR-1(b)'s literal rule),
    // not merely "different from the stale seed."
    expect(String(master.next_start).slice(0, 10) >= todayKey()).toBe(true);
  });

  test('rolling master with a stale next_start is EXEMPT from the sweep — left untouched', async () => {
    if (!available) return;
    var tmplId = 'w2-sweep-rolling-' + Date.now();
    var staleAnchor = daysAgoKey(30);
    await seedTemplate({
      id: tmplId,
      recur: JSON.stringify({ type: 'rolling', intervalDays: 7 }),
      next_start: staleAnchor
    });

    await runScheduleAndPersist(USER_ID);

    var master = await db('task_masters').where('id', tmplId).first();
    // This assertion should already hold today (no sweep exists yet, so nothing
    // touches it) — kept as a REGRESSION GUARD so that once W2's sweep ships, a
    // careless implementation that fails to exempt rolling masters is caught.
    expect(String(master.next_start).slice(0, 10)).toBe(staleAnchor);
  });

  test('non-rolling master with next_start already >= today is left untouched by the sweep (no unnecessary advance)', async () => {
    if (!available) return;
    var tmplId = 'w2-sweep-notstale-' + Date.now();
    var recur = { type: 'weekly', days: 'W' };
    // Pick a future Wednesday far enough out that it is not "today" or stale.
    var future = new Date(); future.setDate(future.getDate() + 60);
    var futureKey = nextMatchingDate(recur, future.toISOString().slice(0, 10), future.toISOString().slice(0, 10));
    await seedTemplate({ id: tmplId, recur: JSON.stringify(recur), next_start: futureKey });

    await runScheduleAndPersist(USER_ID);

    var master = await db('task_masters').where('id', tmplId).first();
    // Also already holds today for the same "no sweep exists yet" reason as the
    // rolling-exempt test above — kept as a regression guard against a future
    // sweep implementation that rewrites next_start unconditionally on every
    // run instead of only when it is actually stale (`< today`).
    expect(String(master.next_start).slice(0, 10)).toBe(futureKey);
  });
});
