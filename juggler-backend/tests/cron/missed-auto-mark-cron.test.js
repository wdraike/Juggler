const MissedAutoMarkCron = require('../../src/jobs/missed-auto-mark-cron');
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

// Mock knex
jest.mock('../../src/db', () => ({
  transaction: jest.fn((fn) => fn({}))
}));

describe('Missed Auto-Mark Cron Tests', () => {
  let cron;
  
  beforeAll(() => {
    // Mock the logger module for the cron job
    const mockLogger = createLogger('MissedAutoMarkCron');
    const logger = require('../../src/lib/logger');
    logger.createLogger = jest.fn(() => mockLogger);
    
    cron = new MissedAutoMarkCron();
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

  test('shouldProcessUserToWork', () => {
    // Test user processing based on shard
    const userId = 'test-user-123';
    const shouldProcess = cron.shouldProcessUser(userId);
    
    expect(typeof shouldProcess).toBe('boolean');
    
    // Should consistently return same result for same user
    expect(cron.shouldProcessUser(userId)).toBe(shouldProcess);
  });

  test('getUserShardConsistency', () => {
    // Test that same user ID always maps to same shard
    const testUserIds = ['user1', 'user2', 'user123', 'test@email.com'];
    
    testUserIds.forEach(userId => {
      const shard1 = cron.getUserShard(userId);
      const shard2 = cron.getUserShard(userId);
      expect(shard1).toBe(shard2);
    });
  });

  test('shardRangeWithinBounds', () => {
    // Test that shard values are within expected bounds
    const testUserIds = ['user1', 'user2', 'user3', 'user4', 'user5'];
    
    testUserIds.forEach(userId => {
      const shard = cron.getUserShard(userId);
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(cron.totalShards);
    });
  });
});