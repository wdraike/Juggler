process.env.NODE_ENV = 'test';

var knex = require('../../src/db');
const { CalHistoryStatus, isValidCalHistoryStatus } = require('../../src/constants/status-enum');

describe('Calendar History Migration Tests', () => {
  beforeAll(async () => {
    // Setup test database
    await knex.migrate.latest();
  });

  afterAll(async () => {
    await knex.destroy();
  });

  test('checkConstraintAccepts missed status', async () => {
    // Test that the check constraint accepts 'missed' status
    const result = await knex('task_instances').insert({
      id: 'test-missed-' + Date.now(),
      user_id: 'test-user',
      master_id: 'test-master',
      status: 'missed',
      scheduled_at: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    }).catch(() => false);
    
    expect(result).toBeTruthy();
  });

  test('checkConstraintRejects bogus status', async () => {
    // Test that the check constraint rejects invalid status
    const result = await knex('task_instances').insert({
      id: 'test-bogus-' + Date.now(),
      user_id: 'test-user',
      master_id: 'test-master',
      status: 'bogus',
      scheduled_at: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    }).catch(() => false);
    
    expect(result).toBeFalsy();
  });

  test('viewExposesCompletedAt', async () => {
    // Test that tasks_v view exposes completed_at column
    const result = await knex('tasks_v').columnInfo();
    expect(result).toHaveProperty('completed_at');
  });

  test('legacyTerminalRowsBackfilled', async () => {
    // Test that legacy rows with terminal statuses have completed_at backfilled
    const legacyTasks = await knex('task_instances')
      .whereIn('status', ['done', 'skip', 'cancel'])
      .whereNotNull('completed_at');
    
    // Should have some backfilled rows
    expect(legacyTasks.length).toBeGreaterThan(0);
  });

  test('calHistoryTableExists', async () => {
    // Test that cal_history table exists
    const hasTable = await knex.schema.hasTable('cal_history');
    expect(hasTable).toBe(true);
  });

  test('calHistoryStatusEnumValid', async () => {
    // Test that cal_history status enum is valid
    expect(isValidCalHistoryStatus('SCHEDULED')).toBe(true);
    expect(isValidCalHistoryStatus('COMPLETED')).toBe(true);
    expect(isValidCalHistoryStatus('MISSED')).toBe(true);
    expect(isValidCalHistoryStatus('CANCELLED')).toBe(true);
    expect(isValidCalHistoryStatus('INVALID')).toBe(false);
  });
});