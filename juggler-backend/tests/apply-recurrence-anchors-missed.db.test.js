// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * apply-recurrence-anchors-missed.db.test.js (999.1098)
 *
 * Characterization + regression suite for the CONSOLIDATED terminal-event
 * recurrence-anchor projection (facade applyRecurrenceAnchors — single shared
 * gate + master-id resolution over applyRollingAnchor, which covers BOTH
 * anchor fields: rolling_anchor and next_occurrence_anchor).
 *
 * Before 999.1098 the status gate was hand-copied at three call sites as
 * ['done','skip'] — drifted from the BINDING 2020-01-06 ruling (resolves
 * 999.844): cancelled AND missed are BOTH terminal, and 'missed' reanchors to
 * the instance date like skip (999.1411; pinned at the compute level by
 * rollingAnchor.test.js and schedulerScenarios.test.js). The compute functions
 * handled 'missed' correctly, but the stale caller gates never let a 'missed'
 * event reach them. The batch paths accept status='missed' (taskUpdateSchema /
 * taskPatchSchema, 999.1418), so this was a live gap on the batch write paths.
 *
 * Sibling of mcp-batch-update-tasks-anchor-gap-characterization.db.test.js
 * (same harness shape); this file pins the 'missed' branch plus the
 * LOAD-BEARING negative space of the gate ('cancel'/'pause' must not advance).
 *
 * REWRITTEN (juggler-anchor-column-cleanup W5, 2020-01-11): `rolling_anchor` /
 * `next_occurrence_anchor` dropped from task_masters; both branches now write
 * the single unified `next_start` column. Seed/assertions retargeted.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'recur-anchor-missed-001';

jest.mock('../src/scheduler/scheduleQueue', function () {
  return { enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn() };
});
jest.mock('../src/lib/sse-emitter', function () {
  return { emit: jest.fn(), addClient: jest.fn(), emitTasksChanged: jest.fn() };
});

var { registerTaskTools } = require('../src/mcp/tools/tasks');
var { ANCHOR_PROJECTION_STATUSES } = require('../src/lib/rolling-anchor');

function captureHandlers(userId) {
  var handlers = {};
  var fakeServer = { tool: function (name, _desc, _schema, handler) { handlers[name] = handler; } };
  registerTaskTools(fakeServer, userId);
  return handlers;
}

async function seedMasterAndInstance(recur, tmplId, instId, instanceDate, scheduledAt) {
  var now = new Date();
  await db('task_masters').insert(__stampFixture({
    id: tmplId, user_id: USER_ID, text: 'anchor gate test master', dur: 30, pri: 'P3',
    recurring: 1, status: '', recur: JSON.stringify(recur),
    recur_start: '2026-01-01', next_start: null,
    tz: 'America/New_York', created_at: now, updated_at: now
  }));
  await db('task_instances').insert(__stampFixture({
    id: instId, master_id: tmplId, user_id: USER_ID, status: '',
    occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
    date: instanceDate, scheduled_at: scheduledAt, created_at: now, updated_at: now
  }));
}

describe('ANCHOR_PROJECTION_STATUSES gate contract (999.1098 — single source)', function () {
  test('projects exactly done/skip/missed', function () {
    expect(Array.from(ANCHOR_PROJECTION_STATUSES).sort())
      .toEqual(['done', 'missed', 'skip']);
  });

  test('load-bearing negative space: terminal-but-non-advancing statuses are excluded', function () {
    // 'pause'/'cancelled' ARE in shared TERMINAL_STATUSES — the compute
    // functions' own isTerminalStatus() guard would advance on them if a
    // caller skipped this gate. 'cancel' is excluded here too (the compute
    // functions independently return null for it — ruled "doesn't count").
    ['cancel', 'cancelled', 'pause', '', 'wip', 'disabled'].forEach(function (s) {
      expect(ANCHOR_PROJECTION_STATUSES.indexOf(s)).toBe(-1);
    });
  });
});

describe('batch write path — missed reanchors (ruling 2020-01-06 / 999.844, wired by 999.1098)', function () {

  beforeAll(async function () {
    // Date-only fake timers (999.2157): Date frozen, every timer API real — no hangs
    installDateOnlyFakeTimers(new Date('2026-01-15T12:00:00Z'));
    await assertDbAvailable();
    var existing = await db('users').where('id', USER_ID).first();
    if (!existing) {
      await db('users').insert(__stampFixture({
        id: USER_ID, email: 'recur-anchor-missed@test.invalid', name: 'anchor gate test',
        timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
      }));
    }
  });

  afterEach(async function () {
    jest.useRealTimers();
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
  });

  afterAll(async function () {
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
  });

  test('missed on a rolling-master instance reanchors next_start to the INSTANCE date (not today)', async function () {
    var tmplId = 'anchor-miss-roll-' + Date.now();
    var instId = tmplId + '-ri1';
    var instanceDate = '2020-01-01';
    await seedMasterAndInstance({ type: 'rolling', window: 7 }, tmplId, instId,
      instanceDate, new Date('2020-01-01T10:00:00Z'));

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.batch_update_tasks({ updates: [{ id: instId, status: 'missed' }] });
    expect(result.isError).toBeFalsy();

    var inst = await db('task_instances').where('id', instId).first();
    expect(inst.status).toBe('missed'); // write path actually accepted 'missed'

    var master = await db('task_masters').where('id', tmplId).first();
    // missed reanchors like skip: instance date, NOT completion day
    // (rollingAnchor.test.js pin: computeRollingAnchor('missed', d, a) === d).
    expect(master.next_start).not.toBeNull();
    expect(String(master.next_start).slice(0, 10)).toBe(instanceDate);
  });

  test('missed on a weekly (pattern-recur) instance advances next_start to the next pattern date', async function () {
    var tmplId = 'anchor-miss-wk-' + Date.now();
    var instId = tmplId + '-ri1';
    var instanceDate = '2020-01-08'; // a Wednesday
    await seedMasterAndInstance({ type: 'weekly', days: 'W' }, tmplId, instId,
      instanceDate, new Date('2020-01-08T10:00:00Z'));

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.batch_update_tasks({ updates: [{ id: instId, status: 'missed' }] });
    expect(result.isError).toBeFalsy();

    var master = await db('task_masters').where('id', tmplId).first();
    // next Wednesday after 2020-01-08 is 2020-01-15 (same advance as done/skip —
    // computeNextOccurrenceAnchor treats any projecting terminal the same).
    expect(master.next_start).not.toBeNull();
    expect(String(master.next_start).slice(0, 10)).toBe('2020-01-15');
  });

  test('cancel on a rolling-master instance does NOT write any anchor (characterization — unchanged)', async function () {
    var tmplId = 'anchor-cancel-roll-' + Date.now();
    var instId = tmplId + '-ri1';
    await seedMasterAndInstance({ type: 'rolling', window: 7 }, tmplId, instId,
      '2020-01-01', new Date('2020-01-01T10:00:00Z'));

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.batch_update_tasks({ updates: [{ id: instId, status: 'cancel' }] });
    expect(result.isError).toBeFalsy();

    var master = await db('task_masters').where('id', tmplId).first();
    expect(master.next_start).toBeNull();
  });
});
