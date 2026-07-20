// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * BLOCK-2 adapter SELECT pin — fetchTaskRecurring includes placement_mode
 *
 * Traceability: .planning/kermit/999.867/TRACEABILITY.md (BLOCK-2a / BLOCK-2b)
 *
 * WHY THIS FILE EXISTS:
 *   fixed-recurring-exclusion.test.js mocks `makeUpdateTaskDeps` so the repo's
 *   fetchTaskRecurring is a jest.fn() that returns whatever the test seeds — removing
 *   `placement_mode` from the REAL KnexTaskRepository.fetchTaskRecurring SELECT leaves
 *   ALL those tests green (the mock never queries a DB column).
 *
 *   This file exercises the REAL adapter SELECTs against the 3407 test-bed DB so
 *   that removing `placement_mode` from KnexTaskRepository.fetchTaskRecurring's
 *   `.first('recurring', 'task_type', 'placement_mode')` call causes this suite
 *   to go RED.
 *
 * MUTATION PROOF (performed during authoring, 2026-06-26):
 *   Temporarily changed KnexTaskRepository.js:406 from
 *     .first('recurring', 'task_type', 'placement_mode')
 *   to
 *     .first('recurring', 'task_type')
 *   Result: "BLOCK-2a: KnexTaskRepository.fetchTaskRecurring returns placement_mode"
 *   failed with: Expected: ObjectContaining {"placement_mode": "fixed"}
 *                Received: {"recurring": 0, "task_type": "task"}
 *   Restored after confirmation.
 *
 * Test coverage:
 *   BLOCK-2a — Knex adapter: real SELECT against tasks_v on 3407 (DB-backed)
 *   BLOCK-2b — InMemory adapter: unit test (no DB needed)
 */

'use strict';

var { v7: uuidv7 } = require('uuid');
var testDb = require('./helpers/test-db');
var { assertDbAvailable } = require('./helpers/requireDB');
var { insertTask } = require('../src/lib/tasks-write');
var KnexTaskRepository = require('../src/slices/task/adapters/KnexTaskRepository');
var InMemoryTaskRepository = require('../src/slices/task/adapters/InMemoryTaskRepository');

// ── BLOCK-2a: Knex adapter (real DB, 3407) ───────────────────────────────────

var USER_ID = 'fetch-recur-pin-test-user';
var available = false;

describe('BLOCK-2a — KnexTaskRepository.fetchTaskRecurring includes placement_mode (real DB)', function () {

  beforeAll(async function () {
    await assertDbAvailable();
    try { await testDb.raw('SELECT 1'); available = true; } catch (e) {
      console.warn('Test DB not available:', e.message);
    }
    if (!available) return;
    // Clean any leftover state from a prior run.
    await testDb('task_instances').where('user_id', USER_ID).del();
    await testDb('task_masters').where('user_id', USER_ID).del();
    await testDb('users').where('id', USER_ID).del();
    await testDb('users').insert(__stampFixture({
      id: USER_ID,
      email: 'fetchrecurpin@test.local',
      name: 'fetchTaskRecurring SELECT pin',
      timezone: 'America/New_York',
      created_at: testDb.fn.now(),
      updated_at: testDb.fn.now(),
    }));
  }, 15000);

  afterAll(async function () {
    if (available) {
      await testDb('task_instances').where('user_id', USER_ID).del();
      await testDb('task_masters').where('user_id', USER_ID).del();
      await testDb('users').where('id', USER_ID).del();
    }
    await testDb.destroy();
  });

  beforeEach(async function () {
    if (!available) return;
    await testDb('task_instances').where('user_id', USER_ID).del();
    await testDb('task_masters').where('user_id', USER_ID).del();
  });

  test('BLOCK-2a: KnexTaskRepository.fetchTaskRecurring returns placement_mode for a fixed task', async function () {
    // Goes RED if placement_mode is removed from the .first() SELECT in KnexTaskRepository.js.
    if (!available) return;

    var taskId = uuidv7();
    // Seed a FIXED non-recurring task via the real write path so it appears in tasks_v.
    await insertTask(testDb, {
      id: taskId,
      user_id: USER_ID,
      text: 'BLOCK-2 pin: fixed task',
      task_type: 'task',
      recurring: 0,
      placement_mode: 'fixed',
      dur: 30,
      pri: 'P3',
      status: '',
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Real KnexTaskRepository using the test-bed connection (injected, not lib/db default).
    var repo = new KnexTaskRepository({ db: testDb });
    var result = await repo.fetchTaskRecurring(taskId, USER_ID);

    // Must return a non-null object — task exists and belongs to the user.
    expect(result).not.toBeNull();
    // Must include placement_mode: BLOCK-2a fix pins this column in the SELECT.
    // Fails if placement_mode is removed from .first('recurring', 'task_type', 'placement_mode').
    expect(result).toEqual(expect.objectContaining({
      placement_mode: 'fixed',
      recurring: 0,
      task_type: 'task',
    }));
  });

  test('BLOCK-2a: KnexTaskRepository.fetchTaskRecurring returns falsy for a non-existent task', async function () {
    // Knex .first() returns undefined (not null) when no row matches — both are
    // treated as falsy "not found" by the caller. Assert falsy, not strictly null.
    if (!available) return;
    var repo = new KnexTaskRepository({ db: testDb });
    var result = await repo.fetchTaskRecurring(uuidv7(), USER_ID);
    expect(result).toBeFalsy();
  });

  test('BLOCK-2a: KnexTaskRepository.fetchTaskRecurring returns falsy when userId does not match (tenancy)', async function () {
    if (!available) return;
    var taskId = uuidv7();
    await insertTask(testDb, {
      id: taskId,
      user_id: USER_ID,
      text: 'tenancy check task',
      task_type: 'task',
      recurring: 0,
      placement_mode: 'fixed',
      dur: 20,
      pri: 'P3',
      status: '',
      created_at: new Date(),
      updated_at: new Date(),
    });
    var repo = new KnexTaskRepository({ db: testDb });
    // Query with wrong userId — TENANCY invariant: the WHERE clause filters out the
    // row, so Knex .first() returns undefined. Assert falsy (undefined/null both fine).
    var result = await repo.fetchTaskRecurring(taskId, 'wrong-user-id');
    expect(result).toBeFalsy();
  });

});

// ── BLOCK-2b: InMemoryTaskRepository (unit test, no DB) ─────────────────────

describe('BLOCK-2b — InMemoryTaskRepository.fetchTaskRecurring includes placement_mode (unit)', function () {

  test('BLOCK-2b: InMemoryTaskRepository.fetchTaskRecurring returns placement_mode for a fixed task', async function () {
    // Goes RED if placement_mode is removed from the returned object in InMemoryTaskRepository.js:158.
    var repo = new InMemoryTaskRepository({
      rows: [{
        id: 'inmem-fixed-task',
        user_id: 'inmem-user',
        text: 'BLOCK-2 in-memory pin',
        task_type: 'task',
        recurring: 0,
        placement_mode: 'fixed',
        status: '',
        dur: 30,
        pri: 'P3',
        created_at: new Date(),
        updated_at: new Date(),
      }],
    });

    var result = await repo.fetchTaskRecurring('inmem-fixed-task', 'inmem-user');

    expect(result).not.toBeNull();
    // Must include placement_mode — BLOCK-2b fix pins this field in the returned object.
    // Fails if placement_mode is removed from { recurring, task_type, placement_mode } in
    // InMemoryTaskRepository.js:158.
    expect(result).toEqual({
      recurring: 0,
      task_type: 'task',
      placement_mode: 'fixed',
    });
  });

  test('BLOCK-2b: InMemoryTaskRepository.fetchTaskRecurring returns null for unknown id', async function () {
    var repo = new InMemoryTaskRepository({ rows: [] });
    var result = await repo.fetchTaskRecurring('no-such-id', 'any-user');
    expect(result).toBeNull();
  });

  test('BLOCK-2b: InMemoryTaskRepository.fetchTaskRecurring returns null when userId does not match (tenancy)', async function () {
    var repo = new InMemoryTaskRepository({
      rows: [{
        id: 'task-x', user_id: 'owner', recurring: 0,
        task_type: 'task', placement_mode: 'fixed',
        created_at: new Date(), updated_at: new Date(),
      }],
    });
    var result = await repo.fetchTaskRecurring('task-x', 'not-owner');
    expect(result).toBeNull();
  });

  test('BLOCK-2b: InMemoryTaskRepository.fetchTaskRecurring returns placement_mode:null for non-fixed task', async function () {
    var repo = new InMemoryTaskRepository({
      rows: [{
        id: 'task-y', user_id: 'u1', recurring: 1,
        task_type: 'recurring_template', placement_mode: null,
        created_at: new Date(), updated_at: new Date(),
      }],
    });
    var result = await repo.fetchTaskRecurring('task-y', 'u1');
    expect(result).not.toBeNull();
    expect(result).toEqual({
      recurring: 1,
      task_type: 'recurring_template',
      placement_mode: null,
    });
  });

});
