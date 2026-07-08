/**
 * mcp-create-task-recurstart-default-characterization.db.test.js
 *
 * jug-mcp-facade — cookie BLOCK-1 fix (RESOLVED, re-review iter1) AFTER-state pin.
 *
 * The WI-2 facade migration made create_task/create_tasks route through
 * facade.createTask/batchCreateTasks, whose CreateTask.js:102 unconditionally
 * sets body._requireRecurStartIfAnchor=true — but MCP's zod taskInputFields
 * schema has NO `recurStart` field at all, so a ClimbRS caller creating a
 * biweekly/interval/times-per-cycle recurring task via MCP with no way to
 * supply recurStart would newly 400 with 'Recurrence start date is required
 * for biweekly, interval, or times-per-cycle patterns' — a capability the OLD
 * MCP path supported (recur_start persisted null; the scheduler's getAnchor
 * fell back recur_start -> src.date -> startDate, expandRecurring.js:33-52).
 *
 * bert fixed this in the MCP ADAPTER (cookie's boundary-correct prescription,
 * NOT the shared CreateTask.js use-case — cookie's veto):
 * defaultRecurStartIfAnchorDependent(task, tz) (tasks.js:142-155) defaults
 * task.recurStart to toDateISO(task.date), else utcToLocal(task.scheduledAt,
 * tz).date, else today's local date — the SAME resolution order getAnchor's
 * own src.date fallback used pre-migration — wired into both create_task
 * (tasks.js:244) and create_tasks (tasks.js:304, consistency-only; batchCreateTasks
 * never set the flag so this leg was never broken there per cookie's INFO-2).
 *
 * This file pins: (1) create_task with a biweekly/interval recur and NO
 * recurStart now SUCCEEDS (was: 400 reject) with recur_start defaulted to the
 * task's derived local date; (2) the resulting recurrence is CORRECTLY PHASED
 * — matches the getAnchor fallback's own resolution (recur_start -> src.date),
 * i.e. the defaulted recur_start value equals the task's own `date`.
 *
 * Requires: test-bed MySQL @3407.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { assertDbAvailable } = require('./helpers/requireDB');
var USER_ID = 'mcp-recurstart-default-001';

jest.mock('../src/scheduler/scheduleQueue', function () {
  return { enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn() };
});
jest.mock('../src/lib/sse-emitter', function () {
  return { emit: jest.fn(), addClient: jest.fn(), emitTasksChanged: jest.fn() };
});

var { registerTaskTools } = require('../src/mcp/tools/tasks');

function captureHandlers(userId) {
  var handlers = {};
  var fakeServer = { tool: function (name, _desc, _schema, handler) { handlers[name] = handler; } };
  registerTaskTools(fakeServer, userId);
  return handlers;
}

async function seedUser() {
  var existing = await db('users').where('id', USER_ID).first();
  if (!existing) {
    await db('users').insert({
      id: USER_ID, email: 'mcp-recurstart-default@test.invalid', name: 'MCP recurStart default',
      timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
    });
  }
}

async function clearUserTasks() {
  await db('cal_sync_ledger').where('user_id', USER_ID).del();
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
}

describe('MCP create_task/create_tasks — recurStart default for anchor-dependent recur (AFTER state, cookie BLOCK-1 fix)', function () {

  beforeAll(async function () {
    await assertDbAvailable();
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
    await seedUser();
  }, 15000);

  afterEach(async function () {
    await clearUserTasks();
  });

  afterAll(async function () {
    await clearUserTasks();
    await db('users').where('id', USER_ID).del();
  }, 10000);

  test('create_task: biweekly recur + date, NO recurStart -> SUCCEEDS (was: 400 reject); recur_start defaults to the task\'s own date', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_task({
      text: 'Biweekly standup, no recurStart supplied',
      date: '2026-08-03',
      time: '9:00 AM',
      recurring: true,
      recur: { type: 'biweekly', days: 'M' }
    });

    // Was: isError:true, 'Recurrence start date is required for biweekly,
    // interval, or times-per-cycle patterns' pre-fix.
    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    expect(typeof body.id).toBe('string');

    var masterRow = await db('task_masters').where('id', body.id).first();
    expect(masterRow).toBeTruthy();
    expect(masterRow.recur_start).not.toBeNull();
    // Correctly-phased: defaulted recur_start === the task's own derived
    // local date (matching getAnchor's src.date fallback resolution).
    expect(String(masterRow.recur_start).slice(0, 10)).toBe('2026-08-03');
  });

  test('create_task interval recur + scheduledAt (no date), NO recurStart -> SUCCEEDS, recur_start correctly defaults from scheduledAt (FIXED — bert fix-loop iter2)', async function () {
    // FIX (bert fix-loop iter2, tasks.js:149): defaultRecurStartIfAnchorDependent's
    // scheduledAt branch previously called `dateHelpers.utcToLocal(task.scheduledAt, tz)`
    // with the RAW caller-supplied ISO string (e.g. '2026-08-04T14:00:00.000Z' —
    // the zod schema's own documented format: "UTC ISO timestamp"). utcToLocal
    // (dateHelpers.js:225) assumes a MYSQL-style "YYYY-MM-DD HH:MM:SS" string
    // (space separator, no 'Z') and does `utcDate.replace(' ', 'T') + 'Z'` — for
    // an ALREADY-ISO string with a trailing 'Z', this produced a DOUBLE 'Z'
    // ('...000ZZ'), an Invalid Date, so utcToLocal returned {date:null,...} and
    // the date-branch fell through to the FINAL fallback (today's date) instead
    // of the caller's actual scheduledAt-derived date — a mis-phased recurrence
    // for any ClimbRS caller using scheduledAt (not date) to create an
    // anchor-dependent recurring task.
    //
    // bert's fix: `dateHelpers.utcToLocal(new Date(task.scheduledAt), tz)` —
    // passing a real Date object routes utcToLocal through its `instanceof Date`
    // branch instead of the string-handling branch, avoiding the double-'Z'.
    // Confirmed via repro: previously received "2026-07-07" (today, the bug);
    // now correctly receives "2026-08-04" (2026-08-04T14:00:00.000Z ==
    // 2026-08-04T10:00:00 America/New_York — same local calendar day as the
    // caller's scheduledAt). Pinning the CORRECT, intended value.
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_task({
      text: 'Interval task via scheduledAt, no recurStart',
      scheduledAt: '2026-08-04T14:00:00.000Z',
      recurring: true,
      recur: { type: 'interval', every: 3 }
    });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    var masterRow = await db('task_masters').where('id', body.id).first();
    expect(masterRow.recur_start).not.toBeNull();
    // CORRECT value: the scheduledAt-derived local date, NOT today's date.
    expect(String(masterRow.recur_start).slice(0, 10)).toBe('2026-08-04');
  });

  test('create_task: biweekly recur + explicit recurStart supplied -> the SUPPLIED value wins (no-op default, not overwritten)', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_task({
      text: 'Biweekly with explicit recurStart',
      date: '2026-08-03',
      time: '9:00 AM',
      recurring: true,
      recur: { type: 'biweekly', days: 'M' },
      recurStart: '2026-08-17'
    });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    var masterRow = await db('task_masters').where('id', body.id).first();
    expect(String(masterRow.recur_start).slice(0, 10)).toBe('2026-08-17');
  });

  test('create_task: NON-anchor-dependent recur (weekly, no timesPerCycle) + NO recurStart -> unaffected (recur_start stays null, matching pre-migration behavior)', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_task({
      text: 'Plain weekly, no recurStart needed',
      date: '2026-08-03',
      time: '9:00 AM',
      recurring: true,
      recur: { type: 'weekly', days: 'M' }
    });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    var masterRow = await db('task_masters').where('id', body.id).first();
    // isAnchorDependentRecur('weekly', no timesPerCycle) === false -> the
    // default helper no-ops; recur_start is never set by MCP (matches the
    // pre-migration null-recur_start behavior for non-anchor-dependent types).
    expect(masterRow.recur_start).toBeNull();
  });

  test('create_tasks (batch): biweekly recur + date, NO recurStart -> SUCCEEDS for every item (consistency wiring, bert\'s no-op-safe addition)', async function () {
    var handlers = captureHandlers(USER_ID);
    var result = await handlers.create_tasks({
      tasks: [
        { text: 'Batch biweekly A', date: '2026-08-05', time: '9:00 AM', recurring: true, recur: { type: 'biweekly', days: 'W' } },
        { text: 'Batch biweekly B', date: '2026-08-06', time: '9:00 AM', recurring: true, recur: { type: 'biweekly', days: 'R' } }
      ]
    });

    expect(result.isError).toBeFalsy();
    var body = JSON.parse(result.content[0].text);
    expect(body.created).toBe(2);
    expect(body.ids.length).toBe(2);

    var masterRows = await db('task_masters').whereIn('id', body.ids).select();
    expect(masterRows.length).toBe(2);
    masterRows.forEach(function (row) {
      expect(row.recur_start).not.toBeNull();
    });
  });

});
