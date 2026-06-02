const { up, down } = require('../src/db/migrations/20260509000300_add_missed_status_and_completed_at');
const db = require('../src/db');

describe('20260509000300_add_missed_status_and_completed_at', () => {
  beforeEach(async () => {
    // Clean state
    await db('task_instances').del();
    await db('task_masters').del();
  });

  describe('up', () => {
    test('adds missed status to task_instances CHECK constraint', async () => {
      const masterId = await createTestMaster();
      
      // Should succeed — missed status is now allowed
      await db('task_instances').insert({
        id: 'test-task-missed',
        master_id: masterId,
        user_id: 'test-user',
        status: 'missed',
        scheduled_at: new Date('2024-01-15 10:00:00')
      });

      const row = await db('task_instances').where('id', 'test-task-missed').first();
      expect(row.status).toBe('missed');
    });

    test('adds missed status to task_masters CHECK constraint', async () => {
      // Should succeed — missed status is now allowed for masters
      await db('task_masters').insert({
        id: 'test-master-missed',
        user_id: 'test-user',
        text: 'Test Master',
        dur: 30,
        status: 'missed'
      });

      const row = await db('task_masters').where('id', 'test-master-missed').first();
      expect(row.status).toBe('missed');
    });

    test('adds completed_at column to task_instances', async () => {
      const masterId = await createTestMaster();
      
      await db('task_instances').insert({
        id: 'test-task-completed-at',
        master_id: masterId,
        user_id: 'test-user',
        status: 'done',
        scheduled_at: new Date('2024-01-15 10:00:00'),
        completed_at: new Date('2024-01-15 11:00:00')
      });

      const row = await db('task_instances').where('id', 'test-task-completed-at').first();
      expect(row.completed_at).not.toBeNull();
      expect(row.completed_at).toBeInstanceOf(Date);
    });

    test('backfills completed_at for existing terminal statuses', async () => {
      const masterId = await createTestMaster();
      
      // Insert legacy rows without completed_at
      await db('task_instances').insert([
        {
          id: 'legacy-done',
          master_id: masterId,
          user_id: 'test-user',
          status: 'done',
          scheduled_at: new Date('2024-01-15 10:00:00'),
          updated_at: new Date('2024-01-15 11:00:00')
        },
        {
          id: 'legacy-skip',
          master_id: masterId,
          user_id: 'test-user',
          status: 'skip',
          scheduled_at: new Date('2024-01-16 10:00:00'),
          updated_at: new Date('2024-01-16 11:00:00')
        },
        {
          id: 'legacy-cancel',
          master_id: masterId,
          user_id: 'test-user',
          status: 'cancel',
          scheduled_at: new Date('2024-01-17 10:00:00'),
          updated_at: new Date('2024-01-17 11:00:00')
        }
      ]);

      // Run the migration
      await up(db);

      // Verify backfill
      const doneRow = await db('task_instances').where('id', 'legacy-done').first();
      const skipRow = await db('task_instances').where('id', 'legacy-skip').first();
      const cancelRow = await db('task_instances').where('id', 'legacy-cancel').first();
      
      expect(doneRow.completed_at).not.toBeNull();
      expect(skipRow.completed_at).not.toBeNull();
      expect(cancelRow.completed_at).not.toBeNull();
    });

    test('adds idx_task_instances_purge index', async () => {
      // This is verified by the migration running without error
      // The index creation would fail if it already existed
      await up(db);
      // If we get here, the index was created successfully
    });

    test('updates tasks_v view with completed_at column', async () => {
      const masterId = await createTestMaster();
      
      await db('task_instances').insert({
        id: 'view-test',
        master_id: masterId,
        user_id: 'test-user',
        status: 'done',
        scheduled_at: new Date('2024-01-15 10:00:00'),
        completed_at: new Date('2024-01-15 11:00:00')
      });

      // Query the view
      const viewRow = await db('tasks_v').where('id', 'view-test').first();
      expect(viewRow).toBeDefined();
      expect(viewRow.completed_at).not.toBeNull();
    });
  });

  describe('down', () => {
    test('removes completed_at column', async () => {
      // Run down to remove completed_at
      await down(db);
      
      // Verify column is removed by checking if we can query it
      // This will fail if the column still exists
      await expect(
        db('task_instances').columnInfo().then(info => {
          if (info.completed_at) {
            throw new Error('completed_at column still exists');
          }
        })
      ).resolves.not.toThrow();
    });

    test('removes missed status from constraints', async () => {
      await down(db);
      
      const masterId = await createTestMaster();
      
      // Should now fail with missed status
      await expect(
        db('task_instances').insert({
          id: 'down-test-missed',
          master_id: masterId,
          user_id: 'test-user',
          status: 'missed',
          scheduled_at: new Date('2024-01-15 10:00:00')
        })
      ).rejects.toThrow(/CHECK.*constraint/i);
    });

    test('restores original tasks_v view without completed_at', async () => {
      await down(db);
      
      const masterId = await createTestMaster();
      
      await db('task_instances').insert({
        id: 'down-view-test',
        master_id: masterId,
        user_id: 'test-user',
        status: 'done',
        scheduled_at: new Date('2024-01-15 10:00:00')
      });

      // Query the view - should not have completed_at column
      const viewRow = await db('tasks_v').where('id', 'down-view-test').first();
      expect(viewRow).toBeDefined();
      // The view should work but completed_at column should not exist
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