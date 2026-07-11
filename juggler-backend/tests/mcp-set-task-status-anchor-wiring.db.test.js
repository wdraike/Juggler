/**
 * mcp-set-task-status-anchor-wiring.db.test.js
 *
 * Real-DB coverage for the MCP set_task_status anchor-write path
 * (src/mcp/tools/tasks.js L436-456) — mirrors the facade sibling
 * facade-next-occurrence-anchor-wiring.db.test.js but drives through
 * registerTaskTools + a fake MCP server object instead of the controller.
 *
 * The facade path (applyRollingAnchor) is already real-DB-tested for the
 * isPatternRecurMaster branch; this file closes the residual WARN from
 * TEST-CATALOG.md (999.1100) by pinning the identical branch in the MCP
 * path with actual persisted-value assertions.
 *
 * Cases (mirroring the facade test's 3 terminal statuses × 2 master types):
 *   Rolling master:
 *     done   → next_start = today (completion date in user tz)
 *     skip   → next_start = instance date
 *     cancel → next_start stays null (no write)
 *   Pattern-recur (weekly) master:
 *     done   → next_start = next Wednesday
 *     skip   → next_start = next Wednesday
 *     cancel → next_start stays null (no write)
 *
 * REWRITTEN (juggler-anchor-column-cleanup W5, 2026-07-11): `rolling_anchor` /
 * `next_occurrence_anchor` dropped from task_masters; both branches now write
 * the single unified `next_start` column. Seed/assertions retargeted; the
 * former "other branch must NOT have fired" cross-checks are dropped — with
 * one shared write column there is no longer a separate field to prove didn't
 * fire (each test's exact expected value already proves which branch computed
 * the write).
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'mcp-anchor-wiring-001';

// Mock the non-DB infra so only the real DB read/write path is exercised.
jest.mock('../src/scheduler/scheduleQueue', function () {
  return { enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn() };
});
jest.mock('../src/lib/sse-emitter', function () {
  return { emit: jest.fn(), addClient: jest.fn(), emitTasksChanged: jest.fn() };
});

var { registerTaskTools } = require('../src/mcp/tools/tasks');
var { getNowInTimezone } = require('../../shared/scheduler/getNowInTimezone');

function captureHandlers(userId) {
  var handlers = {};
  var fakeServer = {
    tool: function (name, _desc, _schema, handler) { handlers[name] = handler; }
  };
  registerTaskTools(fakeServer, userId);
  return handlers;
}

async function seedRollingMasterAndInstance(tmplId, instId, instanceDate, scheduledAt) {
  var now = new Date();
  await db('task_masters').insert({
    id: tmplId,
    user_id: USER_ID,
    text: 'rolling master — MCP anchor wiring test',
    dur: 30,
    pri: 'P3',
    recurring: 1,
    status: '',
    recur: JSON.stringify({ type: 'rolling', window: 7 }),
    recur_start: '2026-01-01',
    next_start: null,
    tz: 'America/New_York',
    created_at: now,
    updated_at: now
  });
  await db('task_instances').insert({
    id: instId,
    master_id: tmplId,
    user_id: USER_ID,
    status: '',
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 1,
    dur: 30,
    date: instanceDate,
    scheduled_at: scheduledAt,
    created_at: now,
    updated_at: now
  });
}

async function seedWeeklyMasterAndInstance(tmplId, instId, instanceDate, scheduledAt) {
  var now = new Date();
  await db('task_masters').insert({
    id: tmplId,
    user_id: USER_ID,
    text: 'weekly (non-rolling) master — MCP anchor wiring test',
    dur: 30,
    pri: 'P3',
    recurring: 1,
    status: '',
    recur: JSON.stringify({ type: 'weekly', days: 'W' }),
    recur_start: '2026-01-01',
    next_start: null,
    tz: 'America/New_York',
    created_at: now,
    updated_at: now
  });
  await db('task_instances').insert({
    id: instId,
    master_id: tmplId,
    user_id: USER_ID,
    status: '',
    occurrence_ordinal: 1,
    split_ordinal: 1,
    split_total: 1,
    dur: 30,
    date: instanceDate,
    scheduled_at: scheduledAt,
    created_at: now,
    updated_at: now
  });
}

describe('MCP set_task_status anchor wiring (999.1100)', function () {

  beforeAll(async function () {
    await assertDbAvailable();
    var existing = await db('users').where('id', USER_ID).first();
    if (!existing) {
      await db('users').insert({
        id: USER_ID,
        email: 'mcp-anchor-wiring@test.invalid',
        name: 'mcp anchor wiring test',
        timezone: 'America/New_York',
        created_at: new Date(),
        updated_at: new Date()
      });
    }
  });

  afterEach(async function () {
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
  });

  afterAll(async function () {
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
  });

  // ── Rolling master ──────────────────────────────────────────────────

  test('rolling master: done writes next_start = today (completion date)', async function () {
    var tmplId = 'mcp-roll-tmpl-' + Date.now();
    var instId = tmplId + '-ri1';
    var instanceDate = '2026-07-08';
    var scheduledAt = new Date('2026-07-08T10:00:00Z');

    await seedRollingMasterAndInstance(tmplId, instId, instanceDate, scheduledAt);

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.set_task_status({ id: instId, status: 'done' });

    expect(result.isError).toBeFalsy();
    var master = await db('task_masters').where('id', tmplId).first();
    expect(master).toBeTruthy();
    // done → computeRollingAnchor anchors to completionDate (today in user tz)
    var expectedToday = getNowInTimezone('America/New_York').todayKey;
    expect(String(master.next_start).slice(0, 10)).toBe(expectedToday);
  });

  test('rolling master: skip writes next_start = instance date', async function () {
    var tmplId = 'mcp-roll-tmpl2-' + Date.now();
    var instId = tmplId + '-ri1';
    var instanceDate = '2026-07-08';
    var scheduledAt = new Date('2026-07-08T10:00:00Z');

    await seedRollingMasterAndInstance(tmplId, instId, instanceDate, scheduledAt);

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.set_task_status({ id: instId, status: 'skip' });

    expect(result.isError).toBeFalsy();
    var master = await db('task_masters').where('id', tmplId).first();
    // skip → computeRollingAnchor anchors to instanceDate
    expect(String(master.next_start).slice(0, 10)).toBe('2026-07-08');
  });

  test('rolling master: cancel does NOT write next_start', async function () {
    var tmplId = 'mcp-roll-tmpl3-' + Date.now();
    var instId = tmplId + '-ri1';
    var instanceDate = '2026-07-08';
    var scheduledAt = new Date('2026-07-08T10:00:00Z');

    await seedRollingMasterAndInstance(tmplId, instId, instanceDate, scheduledAt);

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.set_task_status({ id: instId, status: 'cancel' });

    expect(result.isError).toBeFalsy();
    var master = await db('task_masters').where('id', tmplId).first();
    expect(master.next_start).toBeNull();
  });

  // ── Pattern-recur (weekly) master ───────────────────────────────────

  test('pattern-recur master: done writes next_start = next Wednesday', async function () {
    var tmplId = 'mcp-wk-tmpl-' + Date.now();
    var instId = tmplId + '-ri1';
    var instanceDate = '2026-07-08'; // Wednesday
    var scheduledAt = new Date('2026-07-08T10:00:00Z');

    await seedWeeklyMasterAndInstance(tmplId, instId, instanceDate, scheduledAt);

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.set_task_status({ id: instId, status: 'done' });

    expect(result.isError).toBeFalsy();
    var master = await db('task_masters').where('id', tmplId).first();
    expect(master).toBeTruthy();
    // next_start must advance to the next Wednesday (2026-07-15)
    expect(String(master.next_start).slice(0, 10)).toBe('2026-07-15');
  });

  test('pattern-recur master: skip advances next_start the same as done', async function () {
    var tmplId = 'mcp-wk-tmpl2-' + Date.now();
    var instId = tmplId + '-ri1';
    var instanceDate = '2026-07-08';
    var scheduledAt = new Date('2026-07-08T10:00:00Z');

    await seedWeeklyMasterAndInstance(tmplId, instId, instanceDate, scheduledAt);

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.set_task_status({ id: instId, status: 'skip' });

    expect(result.isError).toBeFalsy();
    var master = await db('task_masters').where('id', tmplId).first();
    expect(String(master.next_start).slice(0, 10)).toBe('2026-07-15');
  });

  test('pattern-recur master: cancel does NOT write next_start', async function () {
    var tmplId = 'mcp-wk-tmpl3-' + Date.now();
    var instId = tmplId + '-ri1';
    var instanceDate = '2026-07-08';
    var scheduledAt = new Date('2026-07-08T10:00:00Z');

    await seedWeeklyMasterAndInstance(tmplId, instId, instanceDate, scheduledAt);

    var handlers = captureHandlers(USER_ID);
    var result = await handlers.set_task_status({ id: instId, status: 'cancel' });

    expect(result.isError).toBeFalsy();
    var master = await db('task_masters').where('id', tmplId).first();
    expect(master.next_start).toBeNull();
  });
});