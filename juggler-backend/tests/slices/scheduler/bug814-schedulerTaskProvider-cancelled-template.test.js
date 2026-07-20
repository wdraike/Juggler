// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../../src/lib/audit-context').stampInsert(rows);
/**
 * BUG-814 regression — SchedulerTaskProvider.loadSchedulableRows loads
 * cancelled/disabled recurring_template rows (should exclude them).
 *
 * Covers: BUG-814 (fixy-cancelled leg)
 * Layer: integration (DB-backed — requires test-bed MySQL @3407)
 * Traceability: .planning/kermit/fixy-cancelled/TRACEABILITY.md BUG-814
 *
 * Root cause: loadSchedulableRows query is:
 *   WHERE status IN ('','wip') OR status IS NULL OR task_type='recurring_template'
 * The recurring_template branch is a bare OR — it includes ALL recurring_template
 * rows regardless of status. A cancelled (status='cancelled') or disabled
 * (status='disabled') recurring_template is returned, allowing the scheduler to
 * resume fabrication of a cancelled series.
 *
 * Fix: the recurring_template branch must also exclude status IN ('cancelled','disabled').
 *
 * These tests MUST BE RED on pre-fix code and GREEN after the fix.
 *
 * Run command:
 *   DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass DB_NAME=juggler_fixy_test \
 *   NODE_ENV=test npx jest --testPathPattern="bug814-schedulerTaskProvider" --forceExit
 *
 * Requires: test-bed MySQL on 3407 with juggler_fixy_test already migrated (155 migrations).
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../../../src/db');
var SchedulerTaskProvider = require('../../../src/slices/scheduler/adapters/SchedulerTaskProvider');
var tasksWrite = require('../../../src/lib/tasks-write');
var { assertDbAvailable } = require('../../helpers/requireDB');

var USER_ID = 'bug814-test-' + Date.now().toString(36);

// ── Setup / Teardown ─────────────────────────────────────────────────────────

async function cleanup() {
  await db('task_instances').where('user_id', USER_ID).del().catch(() => {});
  await db('task_masters').where('user_id', USER_ID).del().catch(() => {});
  await db('user_config').where('user_id', USER_ID).del().catch(() => {});
  await db('users').where('id', USER_ID).del().catch(() => {});
}

beforeAll(async () => {
  await assertDbAvailable();
  await cleanup();
  await db('users').insert(__stampFixture({
    id: USER_ID,
    email: 'bug814@test.invalid',
    timezone: 'America/New_York',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  }));
}, 15000);

afterAll(async () => {
  await cleanup();
  await db.destroy();
}, 10000);

beforeEach(async () => {
  // Clear tasks between each test for isolation
  await db('task_instances').where('user_id', USER_ID).del().catch(() => {});
  await db('task_masters').where('user_id', USER_ID).del().catch(() => {});
});

// ── Seed helper ──────────────────────────────────────────────────────────────

function seedMaster(overrides) {
  var row = Object.assign({
    id: 'bug814-' + Math.random().toString(36).slice(2, 10),
    user_id: USER_ID,
    task_type: 'recurring_template',
    text: 'Daily template',
    dur: 30,
    pri: 'P3',
    status: '',
    recurring: 1,
    recur: JSON.stringify({ type: 'daily', days: 'MTWRFSU' }),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  }, overrides);
  return tasksWrite.insertTask(db, row).then(function() { return row; });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BUG-814: SchedulerTaskProvider.loadSchedulableRows — cancelled/disabled templates excluded', () => {
  var provider;
  beforeEach(() => {
    provider = new SchedulerTaskProvider();
  });

  test('active recurring_template (status="") IS returned by loadSchedulableRows', async () => {
    // Baseline: active template must still be included (golden-master non-cancelled unchanged).
    var template = await seedMaster({ status: '' });

    var rows = await provider.loadSchedulableRows(db, USER_ID);
    var ids = rows.map(function(r) { return r.id; });

    expect(ids).toContain(template.id);
  });

  test('BUG-814-RED: cancelled recurring_template (status="cancelled") is returned by loadSchedulableRows — MUST BE RED pre-fix', async () => {
    // PRE-FIX: the bare `OR task_type='recurring_template'` includes this row.
    // POST-FIX: the fix excludes status='cancelled' from the recurring_template branch.
    var template = await seedMaster({ status: 'cancelled' });

    var rows = await provider.loadSchedulableRows(db, USER_ID);
    var ids = rows.map(function(r) { return r.id; });

    // POST-FIX assertion: cancelled template must NOT be in the result.
    // PRE-FIX: ids CONTAINS template.id → this expect FAILS → RED.
    expect(ids).not.toContain(template.id);
  });

  test('BUG-814-RED: disabled recurring_template (status="disabled") is returned by loadSchedulableRows — MUST BE RED pre-fix', async () => {
    // PRE-FIX: the bare `OR task_type='recurring_template'` includes disabled too.
    // POST-FIX: the fix excludes status='disabled' from the recurring_template branch.
    var template = await seedMaster({ status: 'disabled' });

    var rows = await provider.loadSchedulableRows(db, USER_ID);
    var ids = rows.map(function(r) { return r.id; });

    // POST-FIX assertion: disabled template must NOT be in the result.
    // PRE-FIX: ids CONTAINS template.id → this expect FAILS → RED.
    expect(ids).not.toContain(template.id);
  });

  test('cancelled template excluded but active template from same user is still included', async () => {
    // Ensures the fix is scoped — only excludes cancelled/disabled, not all templates.
    var cancelled = await seedMaster({ id: 'bug814-can-' + Math.random().toString(36).slice(2,8), status: 'cancelled' });
    var active    = await seedMaster({ id: 'bug814-act-' + Math.random().toString(36).slice(2,8), status: '' });

    var rows = await provider.loadSchedulableRows(db, USER_ID);
    var ids = rows.map(function(r) { return r.id; });

    // Active template must be included.
    expect(ids).toContain(active.id);

    // Cancelled template must NOT be included.
    // PRE-FIX: ids CONTAINS cancelled.id → FAILS → RED.
    expect(ids).not.toContain(cancelled.id);
  });

  test('non-template task with status="cancelled" is also excluded (existing filter path)', async () => {
    // Golden-master: a plain task (task_type='task') with status='cancelled' is
    // already excluded by the status IN ('','wip',NULL) filter — not a new requirement,
    // but good to confirm the filter paths are consistent.
    var plainTask = await seedMaster({
      id: 'bug814-plain-' + Math.random().toString(36).slice(2,8),
      task_type: 'task',
      task_type_override: 'task',
      recurring: 0,
      recur: null,
      status: 'cancelled',
    });

    var rows = await provider.loadSchedulableRows(db, USER_ID);
    var ids = rows.map(function(r) { return r.id; });

    expect(ids).not.toContain(plainTask.id);
  });
});
