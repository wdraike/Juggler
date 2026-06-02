const { up, down } = require('../src/db/migrations/20260509000300_add_missed_status_and_completed_at');
const db = require('../src/db');

describe('20260509000300_add_missed_status_and_completed_at', () => {
  beforeAll(async () => {
    // Set up a clean test database
    await db.raw('CREATE DATABASE IF NOT EXISTS juggler_test_clean');
    await db.raw('USE juggler_test_clean');
    
    // Create minimal schema for testing
    await db.schema.createTable('users', function(table) {
      table.string('id', 36).primary();
    });
    
    await db.schema.createTable('task_masters', function(table) {
      table.string('id', 100).primary();
      table.string('user_id', 36).references('users.id');
      table.text('text');
      table.integer('dur').defaultTo(30);
      table.string('status', 10).defaultTo('');
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.timestamp('updated_at').defaultTo(db.fn.now());
      table.timestamp('completed_at').nullable();
      table.timestamp('scheduled_at').nullable();
    });
    
    await db.schema.createTable('task_instances', function(table) {
      table.string('id', 100).primary();
      table.string('master_id', 100).references('task_masters.id');
      table.string('user_id', 36).references('users.id');
      table.string('status', 10).defaultTo('');
      table.timestamp('created_at').defaultTo(db.fn.now());
      table.timestamp('updated_at').defaultTo(db.fn.now());
      table.timestamp('scheduled_at').nullable();
    });
    
    // Add initial constraints
    await db.raw(`
      ALTER TABLE task_instances
      ADD CONSTRAINT chk_task_instances_status
      CHECK (status IN ('','wip','done','cancel','skip','pause','disabled'))
    `);
    
    await db.raw(`
      ALTER TABLE task_masters
      ADD CONSTRAINT chk_task_masters_status
      CHECK (status IN ('','wip','done','cancel','skip','pause','disabled') OR status IS NULL)
    `);
  });

  afterAll(async () => {
    await db.raw('DROP DATABASE IF EXISTS juggler_test_clean');
  });

  describe('up', () => {
    test('adds missed status to constraints', async () => {
      await up(db);
      
      // Test that missed status is now allowed
      await db('users').insert({id: 'test-user'});
      await db('task_masters').insert({
        id: 'test-master',
        user_id: 'test-user',
        text: 'Test',
        status: 'missed'
      });
      
      const master = await db('task_masters').where('id', 'test-master').first();
      expect(master.status).toBe('missed');
    });

    test('adds completed_at column', async () => {
      await db('users').insert({id: 'test-user-2'});
      await db('task_masters').insert({
        id: 'test-master-2',
        user_id: 'test-user-2',
        text: 'Test 2'
      });
      
      await db('task_instances').insert({
        id: 'test-instance',
        master_id: 'test-master-2',
        user_id: 'test-user-2',
        status: 'done',
        completed_at: new Date('2024-01-15 10:00:00')
      });
      
      const instance = await db('task_instances').where('id', 'test-instance').first();
      expect(instance.completed_at).not.toBeNull();
    });

    test('adds index with completed_at', async () => {
      // Verify index exists by checking if we can query it
      const indexes = await db.raw('SHOW INDEX FROM task_instances WHERE Key_name = "idx_task_instances_purge"');
      expect(indexes[0].length).toBeGreaterThan(0);
      expect(indexes[0].some(idx => idx.Column_name === 'completed_at')).toBe(true);
    });
  });

  describe('down', () => {
    test('removes missed status from constraints', async () => {
      await down(db);
      
      // Test that missed status is no longer allowed
      await expect(
        db('task_masters').insert({
          id: 'test-master-down',
          user_id: 'test-user',
          text: 'Test Down',
          status: 'missed'
        })
      ).rejects.toThrow();
    });

    test('removes completed_at column', async () => {
      const columnInfo = await db('task_instances').columnInfo();
      expect(columnInfo.completed_at).toBeUndefined();
    });
  });
});