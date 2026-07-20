// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * W1 BLOCK 2 regression: KnexScheduleRepository.js:130 — the batched
 * scheduledAtUpdates path auto-clears unplaced_reason/detail when a task
 * is being placed (scheduled_at written).
 *
 * Bug identified by zoe: the clear at line 130 (`unplaced_reason:null,
 * unplaced_detail:null` inside the batched CASE update) was guarded by NO
 * test.  The existing IT2 round-trip uses updateTaskById (routes to
 * otherUpdates), and IT-S85's delta has no scheduled_at (also routes to
 * otherUpdates).  Neither ever hit the `scheduledAtUpdates` branch, so
 * deleting line 130's clear left all W1 tests GREEN.
 *
 * FIX: call writeChanged() with a delta whose dbUpdate HAS scheduled_at (and
 * no status), which routes to the batched scheduledAtUpdates path (line 112:
 * `if ((pu.dbUpdate.scheduled_at || pu.dbUpdate.dur) && !pu.dbUpdate.status)`).
 * The seeded row carries a stale unplaced_reason; after writeChanged the row
 * must have reason=null.
 *
 * Mutation proof: deleting `unplaced_reason:null, unplaced_detail:null` from
 * KnexScheduleRepository.js:130 leaves the row with reason='no_slot' after
 * writeChanged — this test flips RED.
 *
 * Traceability: W1 (juggler-db-single-source), KnexScheduleRepository clear
 * site (batched CASE path).
 * Requires: test-bed MySQL on 3407, migration 20260622020000 applied.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { v7: uuidv7 } = require('uuid');
var { insertTask } = require('../src/lib/tasks-write');
var KnexScheduleRepository = require('../src/slices/scheduler/adapters/KnexScheduleRepository');
var { assertDbAvailable } = require('./helpers/requireDB');

var USER_ID = 'w1-batched-clear-user';
var available = false;

// ── lifecycle ───────────────────────────────────────────────────────────────

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
    email: 'w1-batched-clear@test.com',
    name: 'W1 Batched Clear Test',
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

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Seed a task_instance that carries a stale unplaced_reason, simulating a row
 * that was unplaced in a prior scheduler run but is now being placed (the
 * batched scheduledAtUpdates path fires when scheduled_at is in the delta).
 */
async function seedTaskWithStaleReason() {
  const id = uuidv7();

  await insertTask(db, {
    id,
    user_id: USER_ID,
    text: 'W1 batched-clear test task',
    task_type: 'task',
    scheduled_at: null,
    dur: 30,
    pri: 'P3',
    status: '',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  // Force stale unplaced state: prior run marked it unplaced with a reason.
  await db('task_instances').where({ id, user_id: USER_ID }).update({
    unscheduled: 1,
    unplaced_reason: 'no_slot',
    unplaced_detail: 'time window full',
    updated_at: db.fn.now()
  });

  return id;
}

// ── test ─────────────────────────────────────────────────────────────────────

describe('W1 KnexScheduleRepository — batched scheduledAtUpdates path clears stale unplaced_reason', () => {

  /**
   * IT-BATCH-a: writeChanged with scheduled_at in dbUpdate (no status) routes
   * to the batched CASE path (line 112) and the clear at line 130 nulls out
   * unplaced_reason and unplaced_detail on the placed row.
   *
   * This is the ONLY test that exercises KnexScheduleRepository.js:130.
   * The routing condition (line 112):
   *   if ((pu.dbUpdate.scheduled_at || pu.dbUpdate.dur) && !pu.dbUpdate.status)
   *     → scheduledAtUpdates (batched CASE)
   * The existing roundtrip (IT2) and §8.5 test (IT-S85) both route to
   * otherUpdates because their deltas lack scheduled_at — neither pins line 130.
   *
   * Mutation proof: delete `unplaced_reason:null, unplaced_detail:null` from
   * KnexScheduleRepository.js:130 → row retains reason='no_slot' → test RED.
   * Restore line 130 → test GREEN.
   */
  test('IT-BATCH-a: writeChanged with scheduled_at routes to batched path and clears stale unplaced_reason/detail', async () => {
    if (!available) return;

    const id = await seedTaskWithStaleReason();

    // Confirm stale state before writeChanged.
    const before = await db('task_instances').where('id', id).first();
    expect(before.unscheduled).toBe(1);
    expect(before.unplaced_reason).toBe('no_slot');
    expect(before.unplaced_detail).toBe('time window full');

    // Delta with scheduled_at (no status) — routes to scheduledAtUpdates (line 112).
    // This is the shape the scheduler emits when placing a task for the first time
    // or moving its scheduled_at.  The clear at line 130 must fire on this path.
    const placedAt = new Date('2099-12-31T14:00:00.000Z');
    const delta = [{
      id,
      dbUpdate: {
        scheduled_at: placedAt,
        updated_at: new Date()
        // NOTE: no `status` field — this is the routing condition for scheduledAtUpdates
      }
    }];

    const repo = new KnexScheduleRepository({ db });
    const result = await repo.writeChanged(delta, { userId: USER_ID, instanceOnly: true });
    expect(result.written).toBe(1);

    // Assert the batched-path clear (line 130) wiped the stale reason.
    const afterInstance = await db('task_instances').where('id', id).first();
    expect(afterInstance.unplaced_reason).toBeNull();
    expect(afterInstance.unplaced_detail).toBeNull();
    // unscheduled is also cleared by line 130's updateFields.
    expect(afterInstance.unscheduled).toBeNull();
    // The new scheduled_at must be persisted.
    expect(afterInstance.scheduled_at).toBeTruthy();

    // Confirm via the read model.
    const afterView = await db('tasks_v').where('id', id).first();
    expect(afterView).toBeTruthy();
    expect(afterView.unplaced_reason).toBeNull();
    expect(afterView.unplaced_detail).toBeNull();
  });

  /**
   * IT-BATCH-b: a delta with `dur` only (no scheduled_at, no status) also
   * routes to the batched path (line 112: `pu.dbUpdate.dur` truthy) and the
   * same clear at line 130 fires.
   *
   * This tests the second branch of the routing condition and ensures the
   * clear is not scheduled_at-specific.
   */
  test('IT-BATCH-b: writeChanged with dur-only delta (no scheduled_at) also routes to batched path and clears unplaced_reason', async () => {
    if (!available) return;

    const id = await seedTaskWithStaleReason();

    // Delta with dur only (no status, no scheduled_at) — still batched path per line 112.
    const delta = [{
      id,
      dbUpdate: {
        dur: 45,
        updated_at: new Date()
      }
    }];

    const repo = new KnexScheduleRepository({ db });
    await repo.writeChanged(delta, { userId: USER_ID, instanceOnly: true });

    const afterInstance = await db('task_instances').where('id', id).first();
    expect(afterInstance.unplaced_reason).toBeNull();
    expect(afterInstance.unplaced_detail).toBeNull();
  });
});
