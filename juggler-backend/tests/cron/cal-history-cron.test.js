const CalHistoryCron = require('../../src/jobs/cal-history-cron');
const knex = require('../../src/db');
const { createLogger } = require('../../src/lib/logger');

// Mock logger
jest.mock('../../src/lib/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }))
}));

describe('Cal History Cron Tests', () => {
  let cron;
  
  beforeAll(() => {
    // Mock the logger module for the cron job
    const mockLogger = createLogger('CalHistoryCron');
    const logger = require('../../src/lib/logger');
    logger.createLogger = jest.fn(() => mockLogger);
    
    cron = new CalHistoryCron();
  });

  afterAll(async () => {
    if (cron) {
      cron.stop();
    }
    await knex.destroy();
  });

  test('cronJobToRunDaily', () => {
    // Test that cron job is configured to run daily
    expect(cron.cronInterval).toBeDefined();
    // The actual schedule testing would be more complex and might require mocking
  });

  test('missedAutoMarkToWork', async () => {
    // Test that missed auto-mark functionality works
    const currentTime = new Date();
    
    // Create a test user first
    const userId = 'test-user-' + Date.now();
    await knex('users').insert({
      id: userId,
      email: 'test-' + userId + '@example.com',
      name: 'Test User',
      timezone: 'America/New_York',
      created_at: new Date(),
      updated_at: new Date()
    });
    
    // Create a master task first (required for foreign key constraint)
    const masterId = 'test-master-' + Date.now();
    await knex('task_masters').insert({
      id: masterId,
      user_id: userId,
      text: 'Test Master Task',
      dur: 30,
      created_at: new Date(),
      updated_at: new Date()
      // status can be NULL for masters
    });
    
    // Create a test task that should be marked as missed
    const taskId = 'test-missed-task-' + Date.now();
    const pastTime = new Date(currentTime.getTime() - (48 * 60 * 60 * 1000)); // 48 hours ago
    
    await knex('task_instances').insert({
      id: taskId,
      user_id: userId,
      master_id: masterId,
      status: 'wip',
      scheduled_at: pastTime,
      created_at: pastTime,
      updated_at: pastTime
    });
    
    // Run the auto-mark function
    await cron.autoMarkMissedTasks();
    
    // Check if task was marked as missed
    const task = await knex('task_instances').where('id', taskId).first();
    expect(task.status).toBe('missed');
    
    // Check if cal_history entry was created
    const historyEntry = await knex('cal_history').where('task_id', taskId).first();
    expect(historyEntry).toBeDefined();
    expect(historyEntry.status).toBe('MISSED');
    
    // Cleanup
    await knex('cal_history').where('task_id', taskId).del();
    await knex('task_instances').where('id', taskId).del();
    await knex('task_masters').where('id', masterId).del();
    await knex('users').where('id', userId).del();
  });

  test('purgeOldEntriesToWork', async () => {
    // Test that purge functionality works
    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 13); // 13 months ago
    
    // Create a test user first
    const userId = 'test-user-purge-' + Date.now();
    await knex('users').insert({
      id: userId,
      email: 'test-purge-' + userId + '@example.com',
      name: 'Test Purge User',
      timezone: 'America/New_York',
      created_at: new Date(),
      updated_at: new Date()
    });
    
    // Create an old cal_history entry
    await knex('cal_history').insert({
      task_id: 'old-task-' + Date.now(),
      user_id: userId,
      scheduled_at: oldDate,
      status: 'COMPLETED',
      created_at: oldDate,
      updated_at: oldDate
    });
    
    // Run the purge function
    await cron.purgeOldEntries();
    
    // Check if old entry was purged
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 12); // 12 months ago
    const oldEntries = await knex('cal_history').where('created_at', '<', cutoffDate);
    // Should have purged entries older than 12 months
    expect(oldEntries.length).toBe(0);
    
    // Cleanup
    await knex('users').where('id', userId).del();
  });

  test('leaderElectionToWork', async () => {
    // Test leader election
    const isLeader = await cron.acquireLock();
    expect(typeof isLeader).toBe('boolean');
    
    // Release lock for cleanup
    await cron.releaseLock();
  });

  test('shardingToWork', () => {
    // Test sharding logic
    const userId1 = 'user1';
    const userId2 = 'user2';
    
    const shard1 = cron.getUserShard(userId1);
    const shard2 = cron.getUserShard(userId2);
    
    expect(typeof shard1).toBe('number');
    expect(typeof shard2).toBe('number');
    
    // Should consistently return same shard for same user
    expect(cron.getUserShard(userId1)).toBe(shard1);
  });
});