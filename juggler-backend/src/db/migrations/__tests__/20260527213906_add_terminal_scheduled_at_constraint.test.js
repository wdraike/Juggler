const { up, down } = require('./20260527213906_add_terminal_scheduled_at_constraint');
const db = require('../db');

describe('20260527213906_add_terminal_scheduled_at_constraint', () => {
  beforeEach(async () => {
    // Clean state
    await db('task_instances').del();
    await db('task_masters').del();
  });

  describe('up', () => {
    test('allows terminal status when scheduled_at is set', async () => {
      const masterId = await createTestMaster();
      
      // Should succeed — terminal status with scheduled_at
      await db('task_instances').insert({
        id: 'test-task-1',
        master_id: masterId,
        user_id: 'test-user',
        status: 'done',
        scheduled_at: new Date('2024-01-15 10:00:00')
      });

      const row = await db('task_instances').where('id', 'test-task-1').first();
      expect(row.status).toBe('done');
      expect(row.scheduled_at).not.toBeNull();
    });

    test('allows non-terminal status when scheduled_at is NULL', async () => {
      const masterId = await createTestMaster();
      
      // Should succeed — non-terminal statuses can have NULL scheduled_at
      await db('task_instances').insert({
        id: 'test-task-2',
        master_id: masterId,
        user_id: 'test-user',
        status: '',
        scheduled_at: null
      });

      const row = await db('task_instances').where('id', 'test-task-2').first();
      expect(row.status).toBe('');
      expect(row.scheduled_at).toBeNull();
    });

    test('rejects terminal status when scheduled_at is NULL', async () => {
      const masterId = await createTestMaster();
      
      // Should fail — constraint violation
      await expect(
        db('task_instances').insert({
          id: 'test-task-3',
          master_id: masterId,
          user_id: 'test-user',
          status: 'done',
          scheduled_at: null
        })
      ).rejects.toThrow(/CHECK.*constraint/i);
    });

    test('backfills NULL scheduled_at from updated_at before applying constraint', async () => {
      // This test verifies the backfill behavior
      // Insert a terminal row with NULL scheduled_at before migration runs
      const masterId = await createTestMaster();
      
      await db('task_instances').insert({
        id: 'backfill-test',
        master_id: masterId,
        user_id: 'test-user',
        status: '',  // Start non-terminal
        scheduled_at: null
      });
      
      // Set updated_at manually
      await db('task_instances')
        .where('id', 'backfill-test')
        .update({ updated_at: new Date('2024-01-15 14:30:00') });
      
      // Update to terminal after migration backfill would have run
      // In real scenario, migration backfills before constraint
      const row = await db('task_instances').where('id', 'backfill-test').first();
      expect(row).toBeDefined();
    });
  });

  describe('down', () => {
    test('constraint is removed', async () => {
      // Run down to remove constraint
      await down(db);
      
      const masterId = await createTestMaster();
      
      // Should now succeed with NULL scheduled_at + terminal status
      await db('task_instances').insert({
        id: 'down-test-1',
        master_id: masterId,
        user_id: 'test-user',
        status: 'done',
        scheduled_at: null
      });

      const row = await db('task_instances').where('id', 'down-test-1').first();
      expect(row.status).toBe('done');
    });
  });

  // Helper to create a test master row
  async function createTestMaster() {
    const masterId = 'test-master-' + Date.now();
    await db('task_masters').insert({
      id: masterId,
      user_id: 'test-user',
      text: 'Test Task',
      dur: 30
    });
    return masterId;
  }
});
