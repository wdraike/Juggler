// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * 999.1019 regression: KnexScheduleRepository.writeChanged batched-CASE path
 * must persist split_ordinal and split_total when they appear in a delta
 * alongside dur (the drift-fix shape).
 *
 * Bug: writeChanged's batched path handled scheduled_at, dur, date, day, time
 * but had NO CASE branch for split_ordinal/split_total. A drift-fix delta
 * (dur + split_ordinal + split_total) routed to the batched path via `dur`,
 * wrote dur, and silently dropped the split-chunk metadata columns —
 * desyncing split metadata for every user.
 *
 * Fix: added split_ordinal/split_total CASE branches mirroring the dur pattern.
 *
 * Mutation proof: remove the split_ordinal/split_total CASE forEach →
 * afterInstance.split_ordinal stays at the seeded value (1), not the delta
 * value (2) → test RED.
 *
 * Traceability: BUG-1 (999.1019), KnexScheduleRepository.writeChanged batched path.
 * Requires: test-bed MySQL on 3407, migration applied.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { v7: uuidv7 } = require('uuid');
var { insertTask } = require('../src/lib/tasks-write');
var KnexScheduleRepository = require('../src/slices/scheduler/adapters/KnexScheduleRepository');
var { assertDbAvailable } = require('./helpers/requireDB');

var USER_ID = 'w1-split-case-user';
var available = false;

async function cleanup() {
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeAll(async () => {
  await assertDbAvailable();
  available = true;
  await cleanup();
  await db('users').insert(__stampFixture({
    id: USER_ID,
    email: 'w1-split-case@test.com',
    name: 'W1 Split Case Test',
    timezone: 'America/New_York',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  }));
}, 15000);

afterAll(async () => {
  if (available) {
    await cleanup();
  }
  await db.destroy();
});

beforeEach(async () => {
  if (!available) return;
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
});

/**
 * Seed a task_instance with split_ordinal=1, split_total=2, dur=30.
 * The drift-fix delta will update split_ordinal→2, split_total→3, dur→45.
 */
async function seedSplitChunk() {
  const id = uuidv7();

  await insertTask(db, {
    id,
    user_id: USER_ID,
    text: 'Split chunk drift-fix test',
    task_type: 'task',
    scheduled_at: new Date('2099-12-31T14:00:00.000Z'),
    dur: 30,
    pri: 'P3',
    status: '',
    split_ordinal: 1,
    split_total: 2,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  return id;
}

describe('999.1019: KnexScheduleRepository.writeChanged — batched path persists split_ordinal/split_total', () => {

  /**
   * IT-SPLIT-a: A drift-fix delta carrying dur + split_ordinal + split_total
   * routes to the batched CASE path (triggered by dur at line 112).
   * Without the fix, split_ordinal and split_total are silently dropped.
   * With the fix, all three columns are persisted via CASE expressions.
   */
  test('IT-SPLIT-a: writeChanged with dur+split_ordinal+split_total persists all three columns', async () => {
    if (!available) return;

    const id = await seedSplitChunk();

    // Confirm seeded state.
    const before = await db('task_instances').where('id', id).first();
    expect(before.split_ordinal).toBe(1);
    expect(before.split_total).toBe(2);
    expect(before.dur).toBe(30);

    // Drift-fix delta: dur triggers batched path; split_ordinal + split_total
    // must also be written via the new CASE branches.
    const delta = [{
      id,
      dbUpdate: {
        dur: 45,
        split_ordinal: 2,
        split_total: 3,
        updated_at: new Date()
      }
    }];

    const repo = new KnexScheduleRepository({ db });
    const result = await repo.writeChanged(delta, { userId: USER_ID, instanceOnly: true });
    expect(result.written).toBe(1);

    // All three columns must be persisted — not just dur.
    const after = await db('task_instances').where('id', id).first();
    expect(after.dur).toBe(45);
    expect(after.split_ordinal).toBe(2);
    expect(after.split_total).toBe(3);
  });

  /**
   * IT-SPLIT-b: A delta carrying split_ordinal + split_total WITHOUT dur or
   * scheduled_at routes to otherUpdates (per-row path), which handles all
   * fields generically. This confirms the split columns are not broken on
   * the per-row path either.
   */
  test('IT-SPLIT-b: writeChanged with split-only delta (no dur/scheduled_at) routes to otherUpdates and persists', async () => {
    if (!available) return;

    const id = await seedSplitChunk();

    // split-only delta — no dur, no scheduled_at → routes to otherUpdates.
    const delta = [{
      id,
      dbUpdate: {
        split_ordinal: 2,
        split_total: 1,
        updated_at: new Date()
      }
    }];

    const repo = new KnexScheduleRepository({ db });
    const result = await repo.writeChanged(delta, { userId: USER_ID, instanceOnly: true });
    expect(result.written).toBe(1);

    const after = await db('task_instances').where('id', id).first();
    expect(after.split_ordinal).toBe(2);
    expect(after.split_total).toBe(1);
    // dur unchanged (not in delta).
    expect(after.dur).toBe(30);
  });

  /**
   * IT-SPLIT-c: A delta carrying scheduled_at + split_ordinal + split_total
   * (no dur) routes to the batched CASE path via scheduled_at. Proves the
   * split CASE branches fire independently of the dur CASE branch.
   * (zoe Z3 coverage gap)
   */
  test('IT-SPLIT-c: writeChanged with scheduled_at+split (no dur) routes to batched path and persists', async () => {
    if (!available) return;

    const id = await seedSplitChunk();

    // scheduled_at triggers batched path; split columns must persist via CASE.
    const delta = [{
      id,
      dbUpdate: {
        scheduled_at: new Date('2099-12-31T16:00:00.000Z'),
        split_ordinal: 2,
        split_total: 3,
        updated_at: new Date()
      }
    }];

    const repo = new KnexScheduleRepository({ db });
    const result = await repo.writeChanged(delta, { userId: USER_ID, instanceOnly: true });
    expect(result.written).toBe(1);

    const after = await db('task_instances').where('id', id).first();
    expect(after.split_ordinal).toBe(2);
    expect(after.split_total).toBe(3);
    // dur unchanged (not in delta).
    expect(after.dur).toBe(30);
  });

  /**
   * IT-SPLIT-d: Multi-row delta — 3 instances with different split_ordinal
   * values in one writeChanged call. Proves the CASE expressions correctly
   * map multiple ids to their respective values via CASE id WHEN ? THEN ?.
   * (zoe Z4 coverage gap — the real batched use case)
   */
  test('IT-SPLIT-d: writeChanged with multi-row delta persists per-instance split_ordinal via CASE', async () => {
    if (!available) return;

    const id1 = await seedSplitChunk();
    const id2 = await seedSplitChunk();
    const id3 = await seedSplitChunk();

    // Multi-row delta: each instance gets a different split_ordinal.
    const delta = [
      { id: id1, dbUpdate: { dur: 10, split_ordinal: 1, split_total: 3, updated_at: new Date() } },
      { id: id2, dbUpdate: { dur: 20, split_ordinal: 2, split_total: 3, updated_at: new Date() } },
      { id: id3, dbUpdate: { dur: 30, split_ordinal: 3, split_total: 3, updated_at: new Date() } }
    ];

    const repo = new KnexScheduleRepository({ db });
    const result = await repo.writeChanged(delta, { userId: USER_ID, instanceOnly: true });
    expect(result.written).toBe(3);

    const after1 = await db('task_instances').where('id', id1).first();
    const after2 = await db('task_instances').where('id', id2).first();
    const after3 = await db('task_instances').where('id', id3).first();

    expect(after1.split_ordinal).toBe(1);
    expect(after1.split_total).toBe(3);
    expect(after1.dur).toBe(10);

    expect(after2.split_ordinal).toBe(2);
    expect(after2.split_total).toBe(3);
    expect(after2.dur).toBe(20);

    expect(after3.split_ordinal).toBe(3);
    expect(after3.split_total).toBe(3);
    expect(after3.dur).toBe(30);
  });
});