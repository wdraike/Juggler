/**
 * Tests for src/lib/reconcile-splits.js — the chunk materializer.
 */
var db = require('../src/db');
var { v7: uuidv7 } = require('uuid');
var { insertTask } = require('../src/lib/tasks-write');
var { computeChunks, reconcileSplitsForMaster } = require('../src/lib/reconcile-splits');

var available = false;
var USER_ID = 'reconcile-splits-test-user';

beforeAll(async () => {
  try { await db.raw('SELECT 1'); available = true; } catch (e) {
    console.warn('Test DB not available:', e.message); return;
  }
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
  await db('users').insert({
    id: USER_ID, email: 'splits@test.com', name: 'Splits Test',
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

describe('computeChunks', () => {
  test('returns [] for zero duration', () => {
    expect(computeChunks(0, 30)).toEqual([]);
    expect(computeChunks(null, 30)).toEqual([]);
  });
  test('90 / 30 → three 30-min chunks', () => {
    expect(computeChunks(90, 30)).toEqual([
      { splitOrdinal: 1, dur: 30, splitTotal: 3 },
      { splitOrdinal: 2, dur: 30, splitTotal: 3 },
      { splitOrdinal: 3, dur: 30, splitTotal: 3 },
    ]);
  });
  test('75 / 30 → two chunks: 30, 45 (tiny last merged into previous)', () => {
    expect(computeChunks(75, 30)).toEqual([
      { splitOrdinal: 1, dur: 30, splitTotal: 2 },
      { splitOrdinal: 2, dur: 45, splitTotal: 2 },
    ]);
  });
  test('30 / 30 → single chunk', () => {
    expect(computeChunks(30, 30)).toEqual([{ splitOrdinal: 1, dur: 30, splitTotal: 1 }]);
  });
  test('45 / 30 → one chunk of 45 (whole dur < 2× min)', () => {
    expect(computeChunks(45, 30)).toEqual([{ splitOrdinal: 1, dur: 45, splitTotal: 1 }]);
  });
  test('100 / 30 → three chunks: 30, 30, 40', () => {
    expect(computeChunks(100, 30)).toEqual([
      { splitOrdinal: 1, dur: 30, splitTotal: 3 },
      { splitOrdinal: 2, dur: 30, splitTotal: 3 },
      { splitOrdinal: 3, dur: 40, splitTotal: 3 },
    ]);
  });
  test('uses default MIN_CHUNK=15 when splitMin null', () => {
    expect(computeChunks(60, null)).toEqual([
      { splitOrdinal: 1, dur: 15, splitTotal: 4 },
      { splitOrdinal: 2, dur: 15, splitTotal: 4 },
      { splitOrdinal: 3, dur: 15, splitTotal: 4 },
      { splitOrdinal: 4, dur: 15, splitTotal: 4 },
    ]);
  });
});

describe('reconcileSplitsForMaster — one-shot', () => {
  test('expands 90/30 single instance into 3 chunks', async () => {
    if (!available) return;
    var id = uuidv7();
    await insertTask(db, {
      id: id, user_id: USER_ID, text: 'split90', task_type: 'task',
      dur: 90, pri: 'P3', status: '', split: 1, split_min: 30,
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    // Initially one instance row (split_ordinal=1, split_total=1)
    var before = await db('task_instances').where('master_id', id).select();
    expect(before).toHaveLength(1);
    expect(before[0].split_total).toBe(1);

    var r = await db.transaction(function(trx) { return reconcileSplitsForMaster(trx, id); });
    expect(r.inserted).toBe(2);
    expect(r.deleted).toBe(0);
    expect(r.updated).toBe(1); // split_total 1 → 3, dur 90 → 30

    var after = await db('task_instances').where('master_id', id)
      .orderBy('split_ordinal').select();
    expect(after).toHaveLength(3);
    expect(after.map(function(r) { return r.split_ordinal; })).toEqual([1, 2, 3]);
    expect(after.every(function(r) { return r.split_total === 3; })).toBe(true);
    expect(after.every(function(r) { return r.dur === 30; })).toBe(true);
    // survivor keeps its id
    expect(after[0].id).toBe(id);
  });

  test('shrinks 3 chunks back to 1 when master.split becomes falsy', async () => {
    if (!available) return;
    var id = uuidv7();
    await insertTask(db, {
      id: id, user_id: USER_ID, text: 's', task_type: 'task',
      dur: 90, pri: 'P3', status: '', split: 1, split_min: 30,
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await db.transaction(function(trx) { return reconcileSplitsForMaster(trx, id); });
    expect(await db('task_instances').where('master_id', id).count({c:'id'}).first()).toMatchObject({c: 3});

    // Flip master.split off
    await db('task_masters').where('id', id).update({ split: 0 });
    var r = await db.transaction(function(trx) { return reconcileSplitsForMaster(trx, id); });
    expect(r.deleted).toBe(2);
    expect(r.updated).toBe(1);

    var after = await db('task_instances').where('master_id', id).select();
    expect(after).toHaveLength(1);
    expect(after[0].split_ordinal).toBe(1);
    expect(after[0].split_total).toBe(1);
    expect(after[0].dur).toBe(90);
    expect(after[0].id).toBe(id); // ordinal-1 row preserved
  });

  test('re-running is idempotent', async () => {
    if (!available) return;
    var id = uuidv7();
    await insertTask(db, {
      id: id, user_id: USER_ID, text: 's', task_type: 'task',
      dur: 90, pri: 'P3', status: '', split: 1, split_min: 30,
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await db.transaction(function(trx) { return reconcileSplitsForMaster(trx, id); });
    var r2 = await db.transaction(function(trx) { return reconcileSplitsForMaster(trx, id); });
    expect(r2).toEqual({ inserted: 0, deleted: 0, updated: 0 });
  });

  test('re-chunk 90/30→75/30 (3 chunks → 2)', async () => {
    if (!available) return;
    var id = uuidv7();
    await insertTask(db, {
      id: id, user_id: USER_ID, text: 's', task_type: 'task',
      dur: 90, pri: 'P3', status: '', split: 1, split_min: 30,
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await db.transaction(function(trx) { return reconcileSplitsForMaster(trx, id); });
    await db('task_masters').where('id', id).update({ dur: 75 });
    var r = await db.transaction(function(trx) { return reconcileSplitsForMaster(trx, id); });
    expect(r.deleted).toBe(1);
    var after = await db('task_instances').where('master_id', id).orderBy('split_ordinal').select();
    expect(after).toHaveLength(2);
    expect(after.map(function(x) { return x.dur; })).toEqual([30, 45]);
    expect(after.every(function(x) { return x.split_total === 2; })).toBe(true);
  });

  test('skipped when master not found', async () => {
    if (!available) return;
    var r = await db.transaction(function(trx) { return reconcileSplitsForMaster(trx, 'nonexistent'); });
    expect(r.skipped).toBe('master_not_found');
  });
});

describe('reconcileSplitsForMaster — recurring', () => {
  test('reconciles chunks per occurrence independently', async () => {
    if (!available) return;
    var tid = uuidv7();
    await insertTask(db, {
      id: tid, user_id: USER_ID, text: 'daily-split',
      task_type: 'recurring_template', recurring: 1,
      dur: 60, split: 1, split_min: 30, pri: 'P3',
      recur: JSON.stringify({ type: 'daily' }),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    // Two occurrences
    var iid1 = uuidv7(), iid2 = uuidv7();
    await insertTask(db, {
      id: iid1, user_id: USER_ID, task_type: 'recurring_instance',
      source_id: tid, recurring: 1, dur: 60, pri: 'P3', status: '',
      scheduled_at: new Date('2026-05-01T10:00:00Z'),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });
    await insertTask(db, {
      id: iid2, user_id: USER_ID, task_type: 'recurring_instance',
      source_id: tid, recurring: 1, dur: 60, pri: 'P3', status: '',
      scheduled_at: new Date('2026-05-02T10:00:00Z'),
      created_at: db.fn.now(), updated_at: db.fn.now()
    });

    var r = await db.transaction(function(trx) { return reconcileSplitsForMaster(trx, tid); });
    // Each occurrence expands from 1 → 2 chunks, so 2 inserts total, 2 updates (split_total 1→2, dur 60→30 on survivors)
    expect(r.inserted).toBe(2);
    expect(r.updated).toBe(2);
    var rows = await db('task_instances').where('master_id', tid).orderBy(['occurrence_ordinal', 'split_ordinal']).select();
    expect(rows).toHaveLength(4);
    expect(rows.map(function(x) { return [x.occurrence_ordinal, x.split_ordinal, x.dur]; })).toEqual([
      [1, 1, 30], [1, 2, 30],
      [2, 1, 30], [2, 2, 30],
    ]);
  });
});
