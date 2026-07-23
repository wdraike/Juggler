const __stampFixture = (rows) => require('../../../src/lib/audit-context').stampInsert(rows);

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../../../src/db');
var SchedulerTaskProvider = require('../../../src/slices/scheduler/adapters/SchedulerTaskProvider');
var tasksWrite = require('../../../src/lib/tasks-write');
var { assertDbAvailable } = require('../../helpers/requireDB');

var USER_ID = 'rolling-backfill-test-' + Date.now().toString(36);

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
    email: 'rolling-backfill@test.invalid',
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
  await db('task_instances').where('user_id', USER_ID).del().catch(() => {});
  await db('task_masters').where('user_id', USER_ID).del().catch(() => {});
});

describe('SchedulerTaskProvider.getRecurringDoneHistory — completion-date semantic support', () => {
  var provider;
  beforeEach(() => {
    provider = new SchedulerTaskProvider();
  });

  test('correctly uses completed_at when it is later than nominal date', async () => {
    var masterId = 'master-' + Math.random().toString(36).slice(2, 10);
    
    // Use tasksWrite.insertTask to insert master
    await tasksWrite.insertTask(db, {
      id: masterId,
      user_id: USER_ID,
      task_type: 'recurring_template',
      text: 'Cut Grass',
      dur: 30,
      pri: 'P3',
      status: '',
      recurring: 1,
      recur: JSON.stringify({ type: 'rolling', intervalDays: 7 }),
      created_at: '2026-07-01 10:00:00',
      updated_at: '2026-07-01 10:00:00',
    });

    // Use tasksWrite.insertTask to insert instance
    await tasksWrite.insertTask(db, {
      id: 'inst-1-' + Math.random().toString(36).slice(2, 8),
      user_id: USER_ID,
      master_id: masterId,
      source_id: masterId, // REQUIRED BY TASKSWRITE
      task_type: 'recurring_instance',
      text: 'Cut Grass Instance 1',
      dur: 30,
      pri: 'P3',
      status: 'done',
      date: '2026-07-16',
      scheduled_at: '2026-07-16 10:00:00',
      completed_at: '2026-07-15 14:00:00',
      created_at: '2026-07-15 14:00:00',
      updated_at: '2026-07-15 14:00:00',
    });

    var results = await provider.getRecurringDoneHistory(db, USER_ID);
    expect(results).toHaveLength(1);
    expect(results[0].master_id).toBe(masterId);
    
    var dateString = results[0].latest_date instanceof Date 
      ? results[0].latest_date.toISOString().slice(0, 10)
      : String(results[0].latest_date).slice(0, 10);

    expect(dateString).toBe('2026-07-15');
  });

  test('falls back to nominal date when completed_at is null', async () => {
    var masterId = 'master-' + Math.random().toString(36).slice(2, 10);
    
    await tasksWrite.insertTask(db, {
      id: masterId,
      user_id: USER_ID,
      task_type: 'recurring_template',
      text: 'Cut Grass',
      dur: 30,
      pri: 'P3',
      status: '',
      recurring: 1,
      recur: JSON.stringify({ type: 'rolling', intervalDays: 7 }),
      created_at: '2026-07-01 10:00:00',
      updated_at: '2026-07-01 10:00:00',
    });

    await tasksWrite.insertTask(db, {
      id: 'inst-1-' + Math.random().toString(36).slice(2, 8),
      user_id: USER_ID,
      master_id: masterId,
      source_id: masterId, // REQUIRED BY TASKSWRITE
      task_type: 'recurring_instance',
      text: 'Cut Grass Instance 1',
      dur: 30,
      pri: 'P3',
      status: 'done',
      date: '2026-07-10',
      scheduled_at: '2026-07-10 10:00:00',
      completed_at: null,
      created_at: '2026-07-10 14:00:00',
      updated_at: '2026-07-10 14:00:00',
    });

    var results = await provider.getRecurringDoneHistory(db, USER_ID);
    expect(results).toHaveLength(1);
    
    var dateString = results[0].latest_date instanceof Date 
      ? results[0].latest_date.toISOString().slice(0, 10)
      : String(results[0].latest_date).slice(0, 10);

    expect(dateString).toBe('2026-07-10');
  });
});
