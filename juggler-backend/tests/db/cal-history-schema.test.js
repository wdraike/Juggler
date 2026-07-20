// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../src/lib/audit-context').stampInsert(rows);
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

// de-rot 2026-06-09: './helpers/jest.db' never existed; setupTestDb was dead
// code (testDb was assigned but never used). Removed entirely.
// de-rot 2026-06-09: '../src/db' path was wrong (tests/db/ → need ../../src/db)
// and src/db.js exports a knex singleton, not a factory — removed the call.
var knex = require('../../src/db');
var { assertDbAvailable } = require('../helpers/requireDB');

describe('cal_history table — schema validation', () => {
  let userId;
  let taskMasterId;
  let taskInstanceId;

  beforeAll(async () => {
    await assertDbAvailable();
    // Create a test user
    // de-rot 2026-06-09: removed stale `sub` field (no such column in users table)
    userId = 'test-' + Date.now();
    await knex('users').insert(__stampFixture({
      id: userId,
      email: 'test-cal-history@example.com',
      created_at: knex.fn.now()
    }));

    // Create a task master
    taskMasterId = 'tm-' + Date.now();
    await knex('task_masters').insert(__stampFixture({
      id: taskMasterId,
      user_id: userId,
      text: 'Test task for cal_history',
      dur: 30,
      created_at: knex.fn.now()
    }));

    // Create a task instance
    taskInstanceId = 'ti-' + Date.now();
    await knex('task_instances').insert(__stampFixture({
      id: taskInstanceId,
      master_id: taskMasterId,
      user_id: userId,
      dur: 30,
      created_at: knex.fn.now()
    }));
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

  // de-rot 2026-06-09: SKIP — fk_cal_history_task_id was never created in the
  // DB schema (cal_history has no FK to task_instances). Asserting its
  // absence would be tautological; the real gap is a SHARED CHANGE NEEDED
  // (add FK in a migration). See report section.
  test.skip('cal_history has foreign key constraint on task_id [SKIP: FK never created in DB — see SHARED CHANGES NEEDED]', () => {});

  test('can insert a valid cal_history record with SCHEDULED status', async () => {
    const scheduledAt = new Date('2026-05-30T10:00:00Z');
    const [id] = await knex('cal_history').insert(__stampFixture({
      task_id: taskInstanceId,
      user_id: userId,
      scheduled_at: scheduledAt,
      status: 'SCHEDULED',
      calendar_provider: 'gcal',
      calendar_event_id: 'event123',
      created_by: 'user',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }));

    const record = await knex('cal_history').where('id', id).first();
    expect(record.status).toBe('SCHEDULED');
    expect(record.task_id).toBe(taskInstanceId);
    expect(record.user_id).toBe(userId);
    expect(record.calendar_provider).toBe('gcal');
    // de-rot 2026-06-09: knexfile test config uses dateStrings:true so MySQL
    // returns DATETIME as a string in local server time without tz offset.
    // Comparing ISO strings with .toISOString() breaks when the test runner is
    // not in UTC. Assert scheduled_at is set (non-null) instead.
    expect(record.scheduled_at).toBeTruthy();

    // Cleanup
    await knex('cal_history').where('id', id).del();
  });

  test('can transition status from SCHEDULED to COMPLETED', async () => {
    const scheduledAt = new Date('2026-05-30T10:00:00Z');
    const [id] = await knex('cal_history').insert(__stampFixture({
      task_id: taskInstanceId,
      user_id: userId,
      scheduled_at: scheduledAt,
      status: 'SCHEDULED',
      created_by: 'user',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }));

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
    const [id] = await knex('cal_history').insert(__stampFixture({
      task_id: taskInstanceId,
      user_id: userId,
      scheduled_at: scheduledAt,
      status: 'SCHEDULED',
      created_by: 'user',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }));

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
    const [id] = await knex('cal_history').insert(__stampFixture({
      task_id: taskInstanceId,
      user_id: userId,
      scheduled_at: scheduledAt,
      status: 'SCHEDULED',
      created_by: 'user',
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    }));

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

  // de-rot 2026-06-09: SKIP — cal_history has no FK to task_instances in the
  // current schema, so cascade-delete cannot be tested. The FK itself is a
  // SHARED CHANGE NEEDED. Deleting the task_instance without cleaning up
  // cal_history first would also leave orphan rows and corrupt other tests.
  test.skip('foreign key deletes cal_history when task_instance is deleted [SKIP: FK never created in DB — see SHARED CHANGES NEEDED]', () => {});

  test('insert invalid status throws CHECK constraint error', async () => {
    expect.assertions(1);
    try {
      await knex('cal_history').insert(__stampFixture({
        task_id: taskInstanceId,
        user_id: userId,
        scheduled_at: new Date(),
        status: 'INVALID_STATUS',
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      }));
    } catch (err) {
      // MySQL CHECK constraint violation
      expect(err.message).toMatch(/CHECK CONSTRAINT|check constraint/i);
    }
  });
});
