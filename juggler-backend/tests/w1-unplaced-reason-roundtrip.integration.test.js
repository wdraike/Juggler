// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../src/lib/audit-context').stampInsert(rows);
/**
 * W1 — DB-single-source: unplaced_reason/detail round-trip integration test.
 *
 * Covers TRACEABILITY W1 (integration path):
 *   1. updateTaskById with unplaced_reason/detail persists to task_instances.
 *   2. tasks_v exposes those cols (migration 20260622020000).
 *   3. rowToTask on the tasks_v row surfaces _unplacedReason/_unplacedDetail.
 *   4. Transitioning to placed/overdue (reason=null) clears the fields.
 *
 * Requires: test-bed MySQL on 3407 (DB_PORT=3407).
 * Test-bed guard: uses assertDbAvailable (TEST-FR-001).
 * Teardown: removes all rows inserted under USER_ID (beforeEach + afterAll).
 *
 * DB invariant: The migration 20260622020000 must be applied before this runs.
 * The globalSetup guard in jest.globalSetup.js already verifies migrations are
 * current — tests will fail loud if not.
 */

'use strict';

process.env.NODE_ENV = 'test';

var db = require('../src/db');
var { v7: uuidv7 } = require('uuid');
var { insertTask, updateTaskById } = require('../src/lib/tasks-write');
var { rowToTask } = require('../src/slices/task/domain/mappers/taskMappers');
var { assertDbAvailable } = require('./helpers/requireDB');

var USER_ID = 'w1-roundtrip-test-user';
var available = false;

beforeAll(async () => {
  await assertDbAvailable();
  available = true;
  // Clean up in case a prior run left debris.
  await db('task_instances').where('user_id', USER_ID).del();
  await db('task_masters').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
  await db('users').insert(__stampFixture({
    id: USER_ID,
    email: 'w1-roundtrip@test.com',
    name: 'W1 Round-trip Test',
    timezone: 'America/New_York',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  }));
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

// ── helpers ────────────────────────────────────────────────────────────────────

async function insertOneOffTask(id) {
  await insertTask(db, {
    id,
    user_id: USER_ID,
    text: 'W1 integration test task',
    task_type: 'task',
    scheduled_at: null,
    dur: 30,
    pri: 'P3',
    status: '',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}

async function readViaView(id) {
  return db('tasks_v').where('id', id).first();
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('W1 — unplaced_reason round-trip (tasks-write → task_instances → tasks_v → rowToTask)', () => {

  describe('IT1: write unplaced_reason/detail; read back from tasks_v', () => {

    test('IT1-a: set unplaced_reason persists to task_instances and appears in tasks_v', async () => {
      if (!available) return;
      const id = uuidv7();
      await insertOneOffTask(id);

      await updateTaskById(db, id, {
        unscheduled: 1,
        unplaced_reason: 'tool_conflict',
        unplaced_detail: 'needs personal_pc; biz-day blocks',
        updated_at: db.fn.now()
      });

      const instanceRow = await db('task_instances').where('id', id).first();
      expect(instanceRow.unplaced_reason).toBe('tool_conflict');
      expect(instanceRow.unplaced_detail).toBe('needs personal_pc; biz-day blocks');

      // tasks_v must expose the columns (migration 20260622020000 applied).
      const viewRow = await readViaView(id);
      expect(viewRow).toBeTruthy();
      expect(viewRow.unplaced_reason).toBe('tool_conflict');
      expect(viewRow.unplaced_detail).toBe('needs personal_pc; biz-day blocks');
    });

    test('IT1-b: rowToTask on the tasks_v row maps _unplacedReason/_unplacedDetail', async () => {
      if (!available) return;
      const id = uuidv7();
      await insertOneOffTask(id);

      await updateTaskById(db, id, {
        unscheduled: 1,
        unplaced_reason: 'missed',
        unplaced_detail: 'window has passed',
        updated_at: db.fn.now()
      });

      const viewRow = await readViaView(id);
      const task = rowToTask(viewRow, null, {});
      expect(task._unplacedReason).toBe('missed');
      expect(task._unplacedDetail).toBe('window has passed');
    });
  });

  describe('IT2: transition to placed — reason cleared', () => {

    test('IT2-a: clearing unplaced_reason (scheduler places the task) sets fields to null in DB', async () => {
      if (!available) return;
      const id = uuidv7();
      await insertOneOffTask(id);

      // First set an unplaced reason (simulating prior scheduler run).
      await updateTaskById(db, id, {
        unscheduled: 1,
        unplaced_reason: 'tpc_budget',
        unplaced_detail: 'no capacity',
        updated_at: db.fn.now()
      });

      // Then clear it (simulating scheduler placing the task in a subsequent run).
      // `overdue` field removed (sched-drop-overdue-column, M-5): stored column
      // gone; updateTaskById's INSTANCE_UPDATE_FIELDS allowlist no longer
      // includes it either way.
      await updateTaskById(db, id, {
        unscheduled: null,
        unplaced_reason: null,
        unplaced_detail: null,
        updated_at: db.fn.now()
      });

      const viewRow = await readViaView(id);
      expect(viewRow.unplaced_reason).toBeNull();
      expect(viewRow.unplaced_detail).toBeNull();
    });

    test('IT2-b: rowToTask after placement → both _unplacedReason and _unplacedDetail null', async () => {
      if (!available) return;
      const id = uuidv7();
      await insertOneOffTask(id);

      await updateTaskById(db, id, {
        unscheduled: 1,
        unplaced_reason: 'location_conflict',
        unplaced_detail: 'requires home',
        updated_at: db.fn.now()
      });
      await updateTaskById(db, id, {
        unscheduled: null,
        unplaced_reason: null,
        unplaced_detail: null,
        updated_at: db.fn.now()
      });

      const viewRow = await readViaView(id);
      const task = rowToTask(viewRow, null, {});
      expect(task._unplacedReason).toBeNull();
      expect(task._unplacedDetail).toBeNull();
    });
  });

  describe('IT3: migration idempotency — tasks_v exposes both columns', () => {
    test('IT3-a: tasks_v has unplaced_reason and unplaced_detail columns', async () => {
      if (!available) return;
      const id = uuidv7();
      await insertOneOffTask(id);
      const viewRow = await readViaView(id);
      // If the migration is NOT applied, these would be undefined.
      expect(Object.prototype.hasOwnProperty.call(viewRow, 'unplaced_reason')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(viewRow, 'unplaced_detail')).toBe(true);
      // For a fresh unplaced row, both are null.
      expect(viewRow.unplaced_reason).toBeNull();
      expect(viewRow.unplaced_detail).toBeNull();
    });
  });
});
