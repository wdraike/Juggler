/**
 * Tests for the bulk write helpers that were previously uncovered:
 *   - updateTasksWhere       (master + instance with field routing)
 *   - deleteTasksWhere       (both tables)
 *   - updateInstancesWhere   (instance-only with instance-only filter columns)
 *   - deleteInstancesWhere   (instance-only)
 *
 * Also pins the userId guard added in P0: helper must throw without a userId.
 */
var db = require('../src/db');
var { v7: uuidv7 } = require('uuid');
var tw = require('../src/lib/tasks-write');

var available = false;
var USER_A = 'bulk-test-user-A';
var USER_B = 'bulk-test-user-B';

beforeAll(async () => {
  try { await db.raw('SELECT 1'); available = true; } catch (e) {
    console.warn('Test DB not available:', e.message); return;
  }
  for (var u of [USER_A, USER_B]) {
    await db('task_instances').where('user_id', u).del();
    await db('task_masters').where('user_id', u).del();
    await db('users').where('id', u).del();
    await db('users').insert({
      id: u, email: u + '@test.com', name: u,
      timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
    });
  }
}, 15000);

afterAll(async () => {
  if (available) {
    for (var u of [USER_A, USER_B]) {
      await db('task_instances').where('user_id', u).del();
      await db('task_masters').where('user_id', u).del();
      await db('users').where('id', u).del();
    }
  }
  await db.destroy();
});

beforeEach(async () => {
  if (!available) return;
  for (var u of [USER_A, USER_B]) {
    await db('task_instances').where('user_id', u).del();
    await db('task_masters').where('user_id', u).del();
  }
});

describe('userId guard', () => {
  test('updateTasksWhere throws without userId', async () => {
    await expect(tw.updateTasksWhere(db, null, q => q, { text: 'x' })).rejects.toThrow(/userId is required/);
  });
  test('deleteTasksWhere throws without userId', async () => {
    await expect(tw.deleteTasksWhere(db, undefined, q => q)).rejects.toThrow(/userId is required/);
  });
  test('deleteInstancesWhere throws without userId', async () => {
    await expect(tw.deleteInstancesWhere(db, '', q => q)).rejects.toThrow(/userId is required/);
  });
  test('updateInstancesWhere throws without userId', async () => {
    await expect(tw.updateInstancesWhere(db, 0, q => q, { status: 'done' })).rejects.toThrow(/userId is required/);
  });
});

describe('cross-tenant isolation', () => {
  test('user A bulk delete cannot touch user B rows', async () => {
    if (!available) return;
    var aId = uuidv7(), bId = uuidv7();
    await tw.insertTask(db, {
      id: aId, user_id: USER_A, text: 'a-task', task_type: 'task',
      dur: 30, pri: 'P3', created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await tw.insertTask(db, {
      id: bId, user_id: USER_B, text: 'b-task', task_type: 'task',
      dur: 30, pri: 'P3', created_at: db.fn.now(), updated_at: db.fn.now()
    });

    // User A attempts a "delete by id" that includes user B's id
    await tw.deleteTasksWhere(db, USER_A, function(q) {
      return q.whereIn('id', [aId, bId]);
    });

    expect(await db('task_masters').where('id', aId).first()).toBeUndefined();
    expect(await db('task_instances').where('id', aId).first()).toBeUndefined();
    // User B's row survives — helper enforced user_id=USER_A on the delete
    expect(await db('task_masters').where('id', bId).first()).toBeTruthy();
    expect(await db('task_instances').where('id', bId).first()).toBeTruthy();
  });

  test('user A bulk update cannot touch user B rows', async () => {
    if (!available) return;
    var aId = uuidv7(), bId = uuidv7();
    await tw.insertTask(db, {
      id: aId, user_id: USER_A, text: 'a', task_type: 'task',
      dur: 30, pri: 'P3', project: 'shared', created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await tw.insertTask(db, {
      id: bId, user_id: USER_B, text: 'b', task_type: 'task',
      dur: 30, pri: 'P3', project: 'shared', created_at: db.fn.now(), updated_at: db.fn.now()
    });

    await tw.updateTasksWhere(db, USER_A, function(q) {
      return q.where('project', 'shared');
    }, { project: 'renamed', updated_at: db.fn.now() });

    expect((await db('task_masters').where('id', aId).first()).project).toBe('renamed');
    expect((await db('task_masters').where('id', bId).first()).project).toBe('shared');
  });
});

describe('updateTasksWhere — field routing', () => {
  test('mixed fields land on correct table', async () => {
    if (!available) return;
    var id = uuidv7();
    await tw.insertTask(db, {
      id: id, user_id: USER_A, text: 'orig', task_type: 'task',
      dur: 30, pri: 'P3', status: '',
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    // text is master-only, status is instance-only, dur is both
    await tw.updateTasksWhere(db, USER_A, function(q) {
      return q.where('id', id);
    }, { text: 'new', status: 'wip', dur: 60, updated_at: db.fn.now() });

    var m = await db('task_masters').where('id', id).first();
    var i = await db('task_instances').where('id', id).first();
    expect(m.text).toBe('new');
    expect(m.dur).toBe(60);
    expect(i.status).toBe('wip');
    expect(i.dur).toBe(60);
  });
});

describe('updateInstancesWhere — instance-only filters', () => {
  test('filter on master_id targets only task_instances (no task_masters error)', async () => {
    if (!available) return;
    var tid = uuidv7();
    await tw.insertTask(db, {
      id: tid, user_id: USER_A, text: 't', task_type: 'recurring_template',
      recurring: 1, dur: 30, pri: 'P3', recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var iid1 = uuidv7(), iid2 = uuidv7();
    await tw.insertTask(db, {
      id: iid1, user_id: USER_A, task_type: 'recurring_instance', source_id: tid,
      recurring: 1, dur: 30, pri: 'P3', status: '',
      scheduled_at: new Date('2026-07-10T10:00:00Z'),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await tw.insertTask(db, {
      id: iid2, user_id: USER_A, task_type: 'recurring_instance', source_id: tid,
      recurring: 1, dur: 30, pri: 'P3', status: '',
      scheduled_at: new Date('2026-07-11T10:00:00Z'),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });

    var n = await tw.updateInstancesWhere(db, USER_A, function(q) {
      return q.where({ master_id: tid, status: '' });
    }, { status: 'wip', updated_at: db.fn.now() });
    expect(n).toBe(2);
    expect((await db('task_instances').where('id', iid1).first()).status).toBe('wip');
    expect((await db('task_instances').where('id', iid2).first()).status).toBe('wip');
  });
});

describe('deleteInstancesWhere — instance-only deletes', () => {
  test('removes only matching instances; master untouched', async () => {
    if (!available) return;
    var tid = uuidv7();
    await tw.insertTask(db, {
      id: tid, user_id: USER_A, text: 't', task_type: 'recurring_template',
      recurring: 1, dur: 30, pri: 'P3', recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    var iid = uuidv7();
    await tw.insertTask(db, {
      id: iid, user_id: USER_A, task_type: 'recurring_instance', source_id: tid,
      recurring: 1, dur: 30, pri: 'P3', status: '',
      scheduled_at: new Date('2026-07-12T10:00:00Z'),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await tw.deleteInstancesWhere(db, USER_A, function(q) {
      return q.where('master_id', tid);
    });
    expect(await db('task_instances').where('id', iid).first()).toBeUndefined();
    expect(await db('task_masters').where('id', tid).first()).toBeTruthy();
  });
});
