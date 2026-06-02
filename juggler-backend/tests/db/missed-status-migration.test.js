// Tests for missed status migration
const knex = require('../../src/lib/db');

async function checkConstraintAccepts(status) {
  try {
    await knex('task_instances').insert({
      id: 'test-constraint-' + Date.now(),
      user_id: 'test-user',
      status: status,
      title: 'Test Task',
      created_at: new Date(),
      updated_at: new Date()
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function checkConstraintRejects(status) {
  try {
    await knex('task_instances').insert({
      id: 'test-constraint-' + Date.now(),
      user_id: 'test-user',
      status: status,
      title: 'Test Task',
      created_at: new Date(),
      updated_at: new Date()
    });
    return false;
  } catch (error) {
    return true;
  }
}

async function viewExposesCompletedAt() {
  const result = await knex('tasks_v').select('completed_at').first();
  return result && result.hasOwnProperty('completed_at');
}

async function legacyTerminalRowsBackfilled() {
  const result = await knex('task_instances')
    .whereIn('status', ['done', 'skip', 'cancel'])
    .whereNotNull('completed_at')
    .first();
  return result !== undefined;
}

async function calHistoryTableExists() {
  const result = await knex.raw('SHOW TABLES LIKE "cal_history"');
  return result[0].length > 0;
}

async function calHistoryStatusEnumValid() {
  const { CalHistoryStatus } = require('../../src/constants/status-enum');
  return CalHistoryStatus.SCHEDULED === 'SCHEDULED' &&
         CalHistoryStatus.COMPLETED === 'COMPLETED' &&
         CalHistoryStatus.MISSED === 'MISSED' &&
         CalHistoryStatus.CANCELLED === 'CANCELLED';
}

describe('Missed Status Migration', () => {
  test('check constraint accepts missed', async () => {
    const result = await checkConstraintAccepts('missed');
    expect(result).toBe(true);
  });

  test('check constraint rejects bogus status', async () => {
    const result = await checkConstraintRejects('bogus');
    expect(result).toBe(true);
  });

  test('view exposes completed_at', async () => {
    const result = await viewExposesCompletedAt();
    expect(result).toBe(true);
  });

  test('legacy terminal rows backfilled', async () => {
    const result = await legacyTerminalRowsBackfilled();
    expect(result).toBe(true);
  });

  test('cal_history table exists', async () => {
    const result = await calHistoryTableExists();
    expect(result).toBe(true);
  });

  test('cal_history status enum valid', async () => {
    const result = await calHistoryStatusEnumValid();
    expect(result).toBe(true);
  });
});