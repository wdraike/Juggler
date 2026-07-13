/**
 * JUG-FACADE-DB-VIOLATIONS stage 1 — db-backed pin for the scheduler slice's
 * admin/debug reads, moved verbatim from scheduler/facade.js (L87-94) into
 * adapters/KnexDebugReads.js so the facade carries zero direct db access.
 *
 * Pins the EXACT semantics the facade relied on:
 *  - loadDebugTasks: tasks_v rows for the user, EXCLUDING status='disabled'
 *    but INCLUDING every other status (deliberately NOT
 *    SchedulerTaskProvider.loadSchedulableRows — different filter).
 *  - findStepperSessionOwner: single scheduler_sessions row by session_id,
 *    undefined when absent.
 *
 * Requires: test-bed DB at 127.0.0.1:3407 (make test-juggler[-pool]).
 */

'use strict';

var db = require('../../../src/db');
var tasksWrite = require('../../../src/lib/tasks-write');
var { assertDbAvailable } = require('../../helpers/requireDB');
var debugReads = require('../../../src/slices/scheduler/adapters/KnexDebugReads');

jest.mock('../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

var USER_ID = 'knex-debug-reads-user-001';
var OTHER_USER = 'knex-debug-reads-user-002';
var available = false;

async function cleanup() {
  await db('task_instances').whereIn('user_id', [USER_ID, OTHER_USER]).del();
  await db('task_masters').whereIn('user_id', [USER_ID, OTHER_USER]).del();
  await db('scheduler_sessions').where('session_id', 'like', 'kdr-sess-%').del();
  await db('users').whereIn('id', [USER_ID, OTHER_USER]).del();
}

beforeAll(async () => {
  await assertDbAvailable();
  available = true;
  await cleanup();
  for (const id of [USER_ID, OTHER_USER]) {
    await db('users').insert({
      id: id, email: id + '@test.com', name: id,
      timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
    });
  }
  await tasksWrite.insertTask(db, { id: 'kdr-active', user_id: USER_ID, text: 'active task', dur: 30, pri: 'P3' });
  await tasksWrite.insertTask(db, { id: 'kdr-done', user_id: USER_ID, text: 'done task', dur: 30, pri: 'P3' });
  // chk_task_instances_terminal_scheduled: terminal rows must carry scheduled_at
  await db('task_instances').where('id', 'kdr-done').update({ status: 'done', completed_at: db.fn.now(), scheduled_at: '2026-07-13 10:00:00' });
  await tasksWrite.insertTask(db, { id: 'kdr-disabled', user_id: USER_ID, text: 'disabled task', dur: 30, pri: 'P3' });
  await db('task_instances').where('id', 'kdr-disabled').update({ status: 'disabled' });
  await tasksWrite.insertTask(db, { id: 'kdr-other', user_id: OTHER_USER, text: 'other user task', dur: 30, pri: 'P3' });
}, 30000);

afterAll(async () => {
  if (available) await cleanup();
  await db.destroy();
});

describe('KnexDebugReads.loadDebugTasks', () => {
  test('returns user rows excluding disabled, including non-schedulable statuses', async () => {
    var rows = await debugReads.loadDebugTasks(USER_ID);
    var ids = rows.map(function (r) { return r.id; });
    expect(ids).toContain('kdr-active');
    expect(ids).toContain('kdr-done'); // deliberately broader than loadSchedulableRows
    expect(ids).not.toContain('kdr-disabled');
    expect(ids).not.toContain('kdr-other'); // user-scoped
  });
});

describe('KnexDebugReads.findStepperSessionOwner', () => {
  test('returns the row for an existing session and undefined when absent', async () => {
    await db('scheduler_sessions').insert({
      session_id: 'kdr-sess-1', user_id: USER_ID,
      today_key: '2026-07-13', now_mins: 600, timezone: 'America/New_York',
      snapshots: JSON.stringify([]), tasks_by_id: JSON.stringify({}),
      unplaced: JSON.stringify([]), score: JSON.stringify({}),
      warnings: JSON.stringify([]), slack_by_task_id: JSON.stringify({}),
      expires_at: db.raw('DATE_ADD(NOW(), INTERVAL 1 HOUR)')
    });
    var row = await debugReads.findStepperSessionOwner('kdr-sess-1');
    expect(row).toBeTruthy();
    expect(row.user_id).toBe(USER_ID);

    var missing = await debugReads.findStepperSessionOwner('kdr-sess-nope');
    expect(missing).toBeUndefined();
  });
});
