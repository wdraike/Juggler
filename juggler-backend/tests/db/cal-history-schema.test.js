/**
 * Tests for cal_history table schema and status transitions.
 *
 * Validates:
 *   - Table structure, columns, types
 *   - Foreign key constraints
 *   - CHECK constraints on status values
 *   - Index presence
 *   - Basic CRUD operations
 */

process.env.NODE_ENV = 'test';

var { setupTestDb } = require('./helpers/jest.db');
var knex = require('../src/db')(process.env.DB_NAME || 'juggler_test');

function createChainMock() {
  const chain = jest.fn(() => chain);
  ['where', 'whereRaw', 'whereNotNull', 'whereNull', 'whereNot', 'whereIn',
   'orWhere', 'orderBy', 'orderByRaw', 'limit', 'offset', 'join', 'leftJoin',
   'count', 'distinct', 'pluck'].forEach(m => { chain[m] = jest.fn(() => chain); });
  chain.select = jest.fn(() => Promise.resolve([]));
  chain.first = jest.fn(() => Promise.resolve(null));
  chain.update = jest.fn(() => Promise.resolve(1));
  chain.del = jest.fn(() => Promise.resolve(0));
  chain.then = jest.fn((resolve, reject) => Promise.resolve([]).then(resolve, reject));
  chain.fn = { now: () => 'MOCK_NOW' };
  chain.raw = jest.fn(() => Promise.resolve([[]]));
  return chain;
}

describe('cal_history table — schema validation', () => {
  let testDb;
  let userId;
  let taskMasterId;
  let taskInstanceId;

  beforeAll(async () => {
    testDb = await setupTestDb();

    // Create a test user
    userId = 'test-' + Date.now();
    await knex('users').insert({
      id: userId,
      email: 'test-cal-history@example.com',
      sub: 'cal-history-sub-' + Date.now(),
      created_at: knex.fn.now()
    });

    // Create a task master
    taskMasterId = 'tm-' + Date.now();
    await knex('task_masters').insert({
      id: taskMasterId,
      user_id: userId,
      text: 'Test task for cal_history',
      dur: 30,
      created_at: knex.fn.now()
    });

    // Create a task instance
    taskInstanceId = 'ti-' + Date.now();
    await knex('task_instances').insert({
      id: taskInstanceId,
      master_id: taskMasterId,
      user_id: userId,
      dur: 30,
      created_at: knex.fn.now()
    });
  });

  afterAll(async () => {
    // Cleanup
    await knex('cal_history').where('user_id', userId).del();
    await knex('task_instances').where('user_id', userId).del();
    await knex('task_masters').where('user_id', userId).del();
    await knex('users').where('id', userId).del();
    await knex.destroy();
  });

  test('cal_history table exists', async () => {
    const exists = await knex.schema.hasTable('cal_history');
    expect(exists).toBe(true);
  });

  test('cal_history has required columns', async () => {
    const columns = await knex.raw(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cal_history'
      ORDER BY ORDINAL_POSITION
    `);
    const columnNames = columns[0].map(c => c.COLUMN_NAME);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('task_id');
    expect(columnNames).toContain('user_id');
    expect(columnNames).toContain('scheduled_at');
    expect(columnNames).toContain('completed_at');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('previous_status');
    expect(columnNames).toContain('calendar_provider');
    expect(columnNames).toContain('calendar_event_id');
    expect(columnNames).toContain('status_reason');
    expect(columnNames).toContain('metadata');
    expect(columnNames).toContain('created_by');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  test('cal_history has required indexes', async () => {
    const indexes = await knex.raw(`
      SELECT INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cal_history'
    `);
    const indexNames = [...new Set(indexes[0].map(i => i.INDEX_NAME))];
    expect(indexNames).toContain('idx_cal_history_task_created');
    expect(indexNames).toContain('idx_cal_history_user_scheduled');
    expect(indexNames).toContain('idx_cal_history_user_status');
    expect(indexNames).toContain('idx_cal_history_status_scheduled');
  });

  test('cal_history has foreign key constraint on task_id', async () => {
    const constraints = await knex.raw(`
      SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cal_history'
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `);
    const fk = constraints[0].find(c => c.CONSTRAINT_NAME === 'fk_cal_history_task_id');
    expect(fk).toBeTruthy();
    expect(fk.REFERENCED_TABLE_NAME).toBe('task_instances');
  });

  test('can insert a valid cal_history record with SCHEDULED status', async () => {
    const scheduledAt = new Date('2026-05-30T10:00:00Z');
    const [id] = await knex('cal_history').insert({
      task_id: taskInstanceId,
      user_id: userId,
      scheduled_at: scheduledAt,
      status: 'SCHEDULED',
      calendar_provider: 'gcal',
      calendar_event_id: 'event123',
      created_by: 'user',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });

    const record = await knex('cal_history').where('id', id).first();
    expect(record.status).toBe('SCHEDULED');
    expect(record.task_id).toBe(taskInstanceId);
    expect(record.user_id).toBe(userId);
    expect(record.calendar_provider).toBe('gcal');
    expect(new Date(record.scheduled_at).toISOString()).toBe(scheduledAt.toISOString());

    // Cleanup
    await knex('cal_history').where('id', id).del();
  });

  test('can transition status from SCHEDULED to COMPLETED', async () => {
    const scheduledAt = new Date('2026-05-30T10:00:00Z');
    const [id] = await knex('cal_history').insert({
      task_id: taskInstanceId,
      user_id: userId,
      scheduled_at: scheduledAt,
      status: 'SCHEDULED',
      created_by: 'user',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });

    // Transition to COMPLETED
    await knex('cal_history').where('id', id).update({
      status: 'COMPLETED',
      previous_status: 'SCHEDULED',
      completed_at: knex.fn.now(),
      status_reason: 'user_completed',
      updated_at: knex.fn.now()
    });

    const record = await knex('cal_history').where('id', id).first();
    expect(record.status).toBe('COMPLETED');
    expect(record.previous_status).toBe('SCHEDULED');
    expect(record.status_reason).toBe('user_completed');

    // Cleanup
    await knex('cal_history').where('id', id).del();
  });

  test('can transition status from SCHEDULED to MISSED', async () => {
    const scheduledAt = new Date('2026-05-30T10:00:00Z');
    const [id] = await knex('cal_history').insert({
      task_id: taskInstanceId,
      user_id: userId,
      scheduled_at: scheduledAt,
      status: 'SCHEDULED',
      created_by: 'user',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });

    // Transition to MISSED (e.g., by cron)
    await knex('cal_history').where('id', id).update({
      status: 'MISSED',
      previous_status: 'SCHEDULED',
      completed_at: knex.fn.now(),
      status_reason: 'window_closed',
      created_by: 'cron',
      updated_at: knex.fn.now()
    });

    const record = await knex('cal_history').where('id', id).first();
    expect(record.status).toBe('MISSED');
    expect(record.previous_status).toBe('SCHEDULED');
    expect(record.status_reason).toBe('window_closed');
    expect(record.created_by).toBe('cron');

    // Cleanup
    await knex('cal_history').where('id', id).del();
  });

  test('can transition status from SCHEDULED to CANCELLED', async () => {
    const scheduledAt = new Date('2026-05-30T10:00:00Z');
    const [id] = await knex('cal_history').insert({
      task_id: taskInstanceId,
      user_id: userId,
      scheduled_at: scheduledAt,
      status: 'SCHEDULED',
      created_by: 'user',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });

    // Transition to CANCELLED
    await knex('cal_history').where('id', id).update({
      status: 'CANCELLED',
      previous_status: 'SCHEDULED',
      completed_at: knex.fn.now(),
      status_reason: 'user_cancelled',
      updated_at: knex.fn.now()
    });

    const record = await knex('cal_history').where('id', id).first();
    expect(record.status).toBe('CANCELLED');
    expect(record.previous_status).toBe('SCHEDULED');

    // Cleanup
    await knex('cal_history').where('id', id).del();
  });

  test('foreign key deletes cal_history when task_instance is deleted', async () => {
    const scheduledAt = new Date('2026-05-30T10:00:00Z');
    await knex('cal_history').insert({
      task_id: taskInstanceId,
      user_id: userId,
      scheduled_at: scheduledAt,
      status: 'SCHEDULED',
      calendar_provider: 'gcal',
      calendar_event_id: 'event456',
      created_by: 'user',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });

    // Verify record exists
    const before = await knex('cal_history').where('task_id', taskInstanceId).first();
    expect(before).toBeTruthy();

    // Delete task instance (should cascade)
    await knex('task_instances').where('id', taskInstanceId).del();

    // Verify cal_history record was deleted
    const after = await knex('cal_history').where('task_id', taskInstanceId).first();
    expect(after).toBeFalsy();

    // Recreate task instance for other tests
    await knex('task_instances').insert({
      id: taskInstanceId,
      master_id: taskMasterId,
      user_id: userId,
      dur: 30,
      created_at: knex.fn.now()
    });
  });

  test('insert invalid status throws CHECK constraint error', async () => {
    expect.assertions(1);
    try {
      await knex('cal_history').insert({
        task_id: taskInstanceId,
        user_id: userId,
        scheduled_at: new Date(),
        status: 'INVALID_STATUS',
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
    } catch (err) {
      // MySQL CHECK constraint violation
      expect(err.message).toMatch(/CHECK CONSTRAINT|check constraint/i);
    }
  });
});
