/**
 * Unit tests for src/lib/tasks-write.js — the write-path helper that will
 * replace `db('tasks').insert/update/del` calls once all sites are flipped.
 *
 * These tests validate the helper against the live DB but clean up after
 * themselves. They confirm the helper's behavior matches the trigger-based
 * mirror (session 2) so the two can be swapped without regressions.
 */
var db = require('../src/db');
var { v7: uuidv7 } = require('uuid');
var {
  insertTask, updateTaskById, deleteTaskById,
  splitUpdateFields, isTemplate, isInstance
} = require('../src/lib/tasks-write');

var available = false;
var USER_ID = 'write-helper-test-user';

beforeAll(async () => {
  try {
    await db.raw('SELECT 1');
    available = true;
  } catch (e) {
    console.warn('Test DB not available:', e.message);
    return;
  }
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
  await db('users').insert({
    id: USER_ID, email: 'write-helper@test.com', name: 'Write Helper Test',
    timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
  });
}, 15000);

afterAll(async () => {
  if (available) {
    await db('task_instances').where('user_id', USER_ID).del();
    await db('task_masters').where('user_id', USER_ID).del();
    await db('users').where('id', USER_ID).del();
  }
  await db.destroy();
});

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
});

describe('tasks-write helper', () => {
  describe('classification', () => {
    test('isTemplate: recurring_template task_type', () => {
      expect(isTemplate({ task_type: 'recurring_template' })).toBe(true);
    });
    test('isTemplate: legacy recurring=1 task_type=task', () => {
      expect(isTemplate({ task_type: 'task', recurring: 1 })).toBe(true);
    });
    test('isTemplate: recurring_instance is NOT a template', () => {
      expect(isTemplate({ task_type: 'recurring_instance', recurring: 1 })).toBe(false);
    });
    test('isTemplate: plain task is not a template', () => {
      expect(isTemplate({ task_type: 'task' })).toBe(false);
    });
    test('isInstance', () => {
      expect(isInstance({ task_type: 'recurring_instance' })).toBe(true);
      expect(isInstance({ task_type: 'task' })).toBe(false);
    });
  });

  describe('splitUpdateFields', () => {
    test('routes template fields to master, placement to instance', () => {
      var { master, instance } = splitUpdateFields({
        text: 'new title', pri: 'P1',     // master only
        scheduled_at: '2026-05-01',        // instance only
        status: 'wip',                     // both — template can be 'pause', instance carries done/wip
        updated_at: '2026-04-15'           // both
      });
      expect(master).toEqual({ text: 'new title', pri: 'P1', status: 'wip', updated_at: '2026-04-15' });
      expect(instance).toEqual({ scheduled_at: '2026-05-01', status: 'wip', updated_at: '2026-04-15' });
    });
    test('dur goes to both (it lives on both tables)', () => {
      var { master, instance } = splitUpdateFields({ dur: 60 });
      expect(master).toEqual({ dur: 60 });
      expect(instance).toEqual({ dur: 60 });
    });
    test('unknown fields are dropped', () => {
      var { master, instance } = splitUpdateFields({ id: 'x', task_type: 'task', garbage: true });
      expect(master).toEqual({});
      expect(instance).toEqual({});
    });
  });

  describe('insertTask — one-shot', () => {
    test('creates master + instance rows with shared id, ordinal 1', async () => {
      if (!available) return;
      var id = uuidv7();
      await insertTask(db, {
        id: id, user_id: USER_ID, text: 'one-shot', task_type: 'task',
        dur: 25, pri: 'P2', status: '',
        created_at: db.fn.now(), updated_at: db.fn.now()
      });
      var m = await db('task_masters').where('id', id).first();
      var i = await db('task_instances').where('id', id).first();
      expect(m).toBeTruthy();
      expect(m.text).toBe('one-shot');
      expect(m.pri).toBe('P2');
      expect(Number(m.recurring)).toBe(0);
      expect(i).toBeTruthy();
      expect(i.master_id).toBe(id);
      expect(i.occurrence_ordinal).toBe(1);
      expect(i.split_ordinal).toBe(1);
      expect(i.split_total).toBe(1);
    });

    test('applies defaults (dur=30, pri=P3)', async () => {
      if (!available) return;
      var id = uuidv7();
      await insertTask(db, {
        id: id, user_id: USER_ID, text: 'defaults', task_type: 'task',
        created_at: db.fn.now(), updated_at: db.fn.now()
      });
      var m = await db('task_masters').where('id', id).first();
      expect(m.dur).toBe(30);
      expect(m.pri).toBe('P3');
    });
  });

  describe('insertTask — recurring template', () => {
    test('creates master only, no instance', async () => {
      if (!available) return;
      var tid = uuidv7();
      await insertTask(db, {
        id: tid, user_id: USER_ID, text: 'daily workout', task_type: 'recurring_template',
        recurring: 1, dur: 30, pri: 'P3',
        recur: JSON.stringify({ type: 'daily' }),
        created_at: db.fn.now(), updated_at: db.fn.now()
      });
      var m = await db('task_masters').where('id', tid).first();
      var i = await db('task_instances').where('id', tid).first();
      expect(m).toBeTruthy();
      expect(Number(m.recurring)).toBe(1);
      expect(i).toBeUndefined();
    });
  });

  describe('insertTask — recurring instance', () => {
    test('assigns occurrence_ordinal = MAX + 1 per master', async () => {
      if (!available) return;
      var tid = uuidv7();
      await insertTask(db, {
        id: tid, user_id: USER_ID, text: 'daily', task_type: 'recurring_template',
        recurring: 1, dur: 30, pri: 'P3',
        recur: JSON.stringify({ type: 'daily' }),
        created_at: db.fn.now(), updated_at: db.fn.now()
      });
      var iid1 = uuidv7(), iid2 = uuidv7(), iid3 = uuidv7();
      var base = {
        user_id: USER_ID, task_type: 'recurring_instance', source_id: tid,
        recurring: 1, dur: 30, pri: 'P3', status: '',
        created_at: db.fn.now(), updated_at: db.fn.now()
      };
      await insertTask(db, Object.assign({}, base, { id: iid1, scheduled_at: new Date('2026-05-01T10:00:00Z') }));
      await insertTask(db, Object.assign({}, base, { id: iid2, scheduled_at: new Date('2026-05-02T10:00:00Z') }));
      await insertTask(db, Object.assign({}, base, { id: iid3, scheduled_at: new Date('2026-05-03T10:00:00Z') }));

      var inst = await db('task_instances')
        .where('master_id', tid)
        .select('id', 'occurrence_ordinal')
        .orderBy('occurrence_ordinal');
      expect(inst.map(function(r) { return r.occurrence_ordinal; })).toEqual([1, 2, 3]);
      expect(inst[0].id).toBe(iid1);
      expect(inst[2].id).toBe(iid3);
    });

    test('throws when source_id missing', async () => {
      if (!available) return;
      await expect(insertTask(db, {
        id: uuidv7(), user_id: USER_ID, task_type: 'recurring_instance', recurring: 1
      })).rejects.toThrow(/source_id/);
    });
  });

  describe('updateTaskById — field routing', () => {
    test('template-field update lands on master only', async () => {
      if (!available) return;
      var id = uuidv7();
      await insertTask(db, {
        id: id, user_id: USER_ID, text: 'original', task_type: 'task',
        dur: 20, pri: 'P3', status: '',
        created_at: db.fn.now(), updated_at: db.fn.now()
      });
      var r = await updateTaskById(db, id, { text: 'renamed', pri: 'P1' });
      expect(r.masterUpdated).toBe(1);
      expect(r.instanceUpdated).toBe(0);
      var m = await db('task_masters').where('id', id).first();
      expect(m.text).toBe('renamed');
      expect(m.pri).toBe('P1');
    });

    test('status update lands on both tables (template-level + instance-level)', async () => {
      if (!available) return;
      var id = uuidv7();
      await insertTask(db, {
        id: id, user_id: USER_ID, text: 't', task_type: 'task',
        dur: 20, pri: 'P3', status: '',
        created_at: db.fn.now(), updated_at: db.fn.now()
      });
      var r = await updateTaskById(db, id, { status: 'done' });
      // status now lives on both master (for templates) and instance (for occurrences)
      expect(r.masterUpdated).toBe(1);
      expect(r.instanceUpdated).toBe(1);
      var m = await db('task_masters').where('id', id).first();
      var i = await db('task_instances').where('id', id).first();
      expect(m.status).toBe('done');
      expect(i.status).toBe('done');
    });

    test('time_remaining is instance-only', async () => {
      if (!available) return;
      var id = uuidv7();
      await insertTask(db, {
        id: id, user_id: USER_ID, text: 't', task_type: 'task',
        dur: 20, pri: 'P3', status: '',
        created_at: db.fn.now(), updated_at: db.fn.now()
      });
      var r = await updateTaskById(db, id, { time_remaining: 10 });
      expect(r.masterUpdated).toBe(0);
      expect(r.instanceUpdated).toBe(1);
      var i = await db('task_instances').where('id', id).first();
      expect(i.time_remaining).toBe(10);
    });

    test('mixed update hits both tables', async () => {
      if (!available) return;
      var id = uuidv7();
      await insertTask(db, {
        id: id, user_id: USER_ID, text: 't', task_type: 'task',
        dur: 20, pri: 'P3', status: '',
        created_at: db.fn.now(), updated_at: db.fn.now()
      });
      var r = await updateTaskById(db, id, {
        text: 'both', status: 'wip', updated_at: db.fn.now()
      });
      expect(r.masterUpdated).toBe(1);
      expect(r.instanceUpdated).toBe(1);
    });
  });

  describe('deleteTaskById', () => {
    test('one-shot: removes both rows', async () => {
      if (!available) return;
      var id = uuidv7();
      await insertTask(db, {
        id: id, user_id: USER_ID, text: 't', task_type: 'task',
        created_at: db.fn.now(), updated_at: db.fn.now()
      });
      var r = await deleteTaskById(db, id, USER_ID);
      expect(r.masterDeleted).toBe(1);
      expect(r.instanceDeleted).toBe(1);
      expect(await db('task_masters').where('id', id).first()).toBeUndefined();
      expect(await db('task_instances').where('id', id).first()).toBeUndefined();
    });

    test('recurring template: master delete cascades to instances', async () => {
      if (!available) return;
      var tid = uuidv7();
      await insertTask(db, {
        id: tid, user_id: USER_ID, text: 'daily', task_type: 'recurring_template',
        recurring: 1, dur: 30, pri: 'P3', recur: JSON.stringify({ type: 'daily' }),
        created_at: db.fn.now(), updated_at: db.fn.now()
      });
      var base = {
        user_id: USER_ID, task_type: 'recurring_instance', source_id: tid,
        recurring: 1, dur: 30, pri: 'P3', status: '',
        created_at: db.fn.now(), updated_at: db.fn.now()
      };
      await insertTask(db, Object.assign({}, base, { id: uuidv7(), scheduled_at: new Date('2026-05-01T10:00:00Z') }));
      await insertTask(db, Object.assign({}, base, { id: uuidv7(), scheduled_at: new Date('2026-05-02T10:00:00Z') }));

      // Deleting the master should cascade via FK.
      var r = await deleteTaskById(db, tid, USER_ID);
      expect(r.masterDeleted).toBe(1);
      var leftover = await db('task_instances').where('master_id', tid).count({ c: 'id' }).first();
      expect(Number(leftover.c)).toBe(0);
    });
  });
});
