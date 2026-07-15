/**
 * mcp-getusertimezone-dedup-characterization.db.test.js
 *
 * jug-mcp-facade — characterization_target #3 (Intake Brief).
 *
 * behavior_contract: "getUserTimezone is verified BYTE-IDENTICAL across
 * tasks.js:91-94, data.js:14-17, and schedule.js:13-16 (same
 * `db('users').where('id',userId).select('timezone').first()` +
 * `safeTimezone(user ? user.timezone : null, 'America/New_York')` body in
 * all three) — the dedup is a pure, safe extraction with no behavior risk."
 *
 * This is a REAL-DB regression test proving the 3 current copies resolve
 * IDENTICALLY for the SAME user, via TWO independent proofs (not a
 * source-grep pin — TEST-AUTHORING.md §Golden-master forbids that):
 *
 *   (A) Execution-level: spy on the SHARED `safeTimezone` module function
 *       (mocked with a passthrough jest.fn wrapping the real implementation,
 *       so behavior is unaffected but calls are observable) and assert all
 *       3 tools' getUserTimezone closures call it with the EXACT SAME
 *       (rawTimezoneArg, 'America/New_York') pair for the SAME user —
 *       covering both an explicit-timezone user AND a user row that does
 *       not exist (the `user ? user.timezone : null` -> null branch;
 *       `timezone` is a NOT-NULL DB column with a schema default, so a real
 *       row can never carry a null value — the null branch is only
 *       reachable via a missing `.first()` result).
 *   (B) Observable-output-level: a seeded task's tz-DERIVED local date/time
 *       field, read back identically through tasks.js (list_tasks) and
 *       data.js (export_data), for an explicit non-UTC-aligned timezone —
 *       proving the resolved tz string was not just call-identical but
 *       PRODUCT-identical.
 *
 * Each tool file's copy is exercised through its real registration function
 * (registerTaskTools / registerDataTools / registerScheduleTools) — never a
 * hand-copied stand-in.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'mcp-tz-dedup-001';
var GHOST_USER_ID = 'mcp-tz-dedup-ghost-001'; // never inserted — proves the missing-user-row branch

jest.mock('../src/scheduler/scheduleQueue', function () {
  return { enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn() };
});
jest.mock('../src/lib/sse-emitter', function () {
  return { emit: jest.fn(), addClient: jest.fn(), emitTasksChanged: jest.fn() };
});
jest.mock('../src/lib/sync-lock', function () {
  return { withLock: function (userId, fn) { return fn(); } };
});
// Passthrough spy: real behavior preserved, calls observable. MUST be declared
// before requiring the 3 tool files below — they destructure `safeTimezone`
// out of this module at require-time, so the spy has to be in place first for
// their closures to capture the jest.fn() reference (destructuring after a
// post-hoc spyOn would still point at the original function).
// 999.1981: the MCP tool files now call getUserTimezone (src/mcp/getUserTimezone.js)
// instead of safeTimezone directly (jug-mcp-facade WI-1 dedup). getUserTimezone
// requires 'juggler-shared/scheduler/dateHelpers' (module alias), not the
// relative path — so BOTH paths must be mocked for the spy to intercept.
jest.mock('../../shared/scheduler/dateHelpers', function () {
  var actual = jest.requireActual('../../shared/scheduler/dateHelpers');
  return Object.assign({}, actual, { safeTimezone: jest.fn(actual.safeTimezone) });
});
jest.mock('juggler-shared/scheduler/dateHelpers', function () {
  var actual = jest.requireActual('juggler-shared/scheduler/dateHelpers');
  return Object.assign({}, actual, { safeTimezone: jest.fn(actual.safeTimezone) });
});

var { registerTaskTools } = require('../src/mcp/tools/tasks');
var { registerDataTools } = require('../src/mcp/tools/data');
var { registerScheduleTools } = require('../src/mcp/tools/schedule');
// 999.1981: use the juggler-shared alias path — getUserTimezone.js requires
// via this alias, so the mock that intercepts its safeTimezone calls is the
// one registered for 'juggler-shared/scheduler/dateHelpers'.
var dateHelpers = require('juggler-shared/scheduler/dateHelpers');

function captureHandlers(registerFn, userId) {
  var handlers = {};
  var fakeServer = { tool: function (name, _desc, _schema, handler) { handlers[name] = handler; } };
  registerFn(fakeServer, userId);
  return handlers;
}

async function clearUserTasks(userId) {
  await db('task_instances').where('user_id', userId).del();
  await db('task_masters').where('user_id', userId).del();
}

describe('getUserTimezone — 3 copies (tasks.js/data.js/schedule.js) resolve IDENTICALLY (BEFORE dedup)', function () {

  beforeEach(function () {
    dateHelpers.safeTimezone.mockClear();
  });

  afterEach(async function () {
    await clearUserTasks(USER_ID);
    await db('users').where('id', USER_ID).del();
  });

  test('(A) explicit-timezone user: all 3 tools call the shared safeTimezone with the IDENTICAL (rawTz, default) pair', async function () {
    await db('users').insert({
      id: USER_ID, email: 'mcp-tz-dedup@test.invalid', name: 'tz dedup test',
      timezone: 'America/Los_Angeles', created_at: new Date(), updated_at: new Date()
    });

    await captureHandlers(registerTaskTools, USER_ID).list_tasks({});
    await captureHandlers(registerDataTools, USER_ID).export_data({});
    await captureHandlers(registerScheduleTools, USER_ID).get_schedule();

    var calls = dateHelpers.safeTimezone.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(3);
    calls.forEach(function (args) {
      expect(args[0]).toBe('America/Los_Angeles');
      expect(args[1]).toBe('America/New_York');
    });
  });

  test('(A) missing user row (`user ? user.timezone : null` -> null branch): all 3 tools call safeTimezone with the IDENTICAL (null-ish, default) pair', async function () {
    await captureHandlers(registerTaskTools, GHOST_USER_ID).list_tasks({});
    await captureHandlers(registerDataTools, GHOST_USER_ID).export_data({});
    await captureHandlers(registerScheduleTools, GHOST_USER_ID).get_schedule();

    var calls = dateHelpers.safeTimezone.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(3);
    calls.forEach(function (args) {
      // `user` resolves undefined (no row) -> `user ? user.timezone : null` -> null in all 3.
      expect(args[0]).toBeFalsy();
      expect(args[1]).toBe('America/New_York');
    });
  });

  test('(B) explicit non-UTC-aligned timezone: list_tasks (tasks.js) and export_data (data.js) derive the IDENTICAL local date/time for the same task', async function () {
    await db('users').insert({
      id: USER_ID, email: 'mcp-tz-dedup2@test.invalid', name: 'tz dedup test 2',
      timezone: 'America/Los_Angeles', created_at: new Date(), updated_at: new Date()
    });

    var taskId = 'tz-dedup-task-' + Date.now();
    var now = new Date();
    // 2026-07-08T05:30:00Z is 2026-07-07 22:30 in America/Los_Angeles (UTC-7,
    // July DST) — differs from the naive UTC calendar date, so a wrong/
    // divergent timezone resolution would produce a visibly different date.
    var scheduledAt = new Date('2026-07-08T05:30:00Z');
    await db('task_masters').insert({
      id: taskId, user_id: USER_ID, text: 'tz probe task', dur: 30, pri: 'P3',
      recurring: 0, status: '', created_at: now, updated_at: now
    });
    await db('task_instances').insert({
      id: taskId, master_id: taskId, user_id: USER_ID, status: '',
      occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30,
      scheduled_at: scheduledAt, date: '2026-07-08', created_at: now, updated_at: now
    });

    var listResult = await captureHandlers(registerTaskTools, USER_ID).list_tasks({});
    var listedTasks = JSON.parse(listResult.content[0].text);
    var probeFromTasks = listedTasks.find(function (t) { return t.id === taskId; });
    expect(probeFromTasks).toBeTruthy();

    var exportResult = await captureHandlers(registerDataTools, USER_ID).export_data({});
    var exported = JSON.parse(exportResult.content[0].text);
    var probeFromData = exported.tasks.find(function (t) { return t.id === taskId; });
    expect(probeFromData).toBeTruthy();

    expect(probeFromData.date).toBe(probeFromTasks.date);
    expect(probeFromData.time).toBe(probeFromTasks.time);
    // Sanity: actually resolved to LA local time, not a UTC/default passthrough
    // (would be '2026-07-08' if the wrong tz were used) — proves the pin is real.
    expect(probeFromTasks.date).toBe('2026-07-07');
  });
});
