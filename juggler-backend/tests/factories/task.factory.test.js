/**
 * Task factory tests - comprehensive validation of all task factory functions.
 * Tests one-off tasks, chains, recurring tasks, split tasks, and edge cases.
 */

const { 
  createTask, 
  createChain, 
  createRecurring, 
  createSplit, 
  createBatch, 
  flattenForDb, 
  generateId 
} = require('./task.factory');

describe('Task Factory', () => {
  const testUserId = 'test-user-123';

  describe('generateId()', () => {
    it('should generate valid UUIDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(id2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(id1).not.toBe(id2); // Should be unique
    });
  });

  describe('createTask() - One-off tasks', () => {
    it('should create a basic one-off task', () => {
      const task = createTask(testUserId);
      
      expect(task.master).toBeDefined();
      expect(task.instance).toBeDefined();
      expect(task.master.id).toBeDefined();
      expect(task.instance.id).toBeDefined();
      expect(task.master.user_id).toBe(testUserId);
      expect(task.instance.user_id).toBe(testUserId);
      expect(task.instance.master_id).toBe(task.master.id);
      expect(task.master.recurring).toBe(false);
      expect(task.master.split).toBe(false);
      expect(task.master.text).toBe('Test task');
      expect(task.master.dur).toBe(30);
      expect(task.master.pri).toBe('P3');
    });

    it('should create tasks with custom properties', () => {
      const customDate = '2026-06-01';
      const task = createTask(testUserId, {
        text: 'Custom task',
        dur: 60,
        pri: 'P1',
        project: 'work-project',
        section: 'development',
        notes: 'Important task',
        deadline: customDate,
        status: 'wip',
        scheduled_at: new Date('2026-06-01T09:00:00Z'),
        date: '6/1',
        time: '9:00 AM',
        day: 'Wed',
        placement_mode: 'fixed'
      });

      expect(task.master.text).toBe('Custom task');
      expect(task.master.dur).toBe(60);
      expect(task.master.pri).toBe('P1');
      expect(task.master.project).toBe('work-project');
      expect(task.master.section).toBe('development');
      expect(task.master.notes).toBe('Important task');
      expect(task.master.deadline).toBe(customDate);
      expect(task.instance.status).toBe('wip');
      expect(task.instance.scheduled_at).toEqual(new Date('2026-06-01T09:00:00Z'));
      expect(task.instance.date).toBe('6/1');
      expect(task.instance.time).toBe('9:00 AM');
      expect(task.instance.day).toBe('Wed');
      expect(task.master.placement_mode).toBe('fixed');
    });

    it('should create tasks with all priority levels', () => {
      const priorities = ['P1', 'P2', 'P3', 'P4'];
      
      priorities.forEach(priority => {
        const task = createTask(testUserId, { pri: priority });
        expect(task.master.pri).toBe(priority);
      });
    });

    it('should create tasks with deadlines', () => {
      const deadlineDate = '2026-12-31';
      const task = createTask(testUserId, { deadline: deadlineDate });
      
      expect(task.master.deadline).toBe(deadlineDate);
      expect(task.instance.status).toBe(''); // Should be empty by default
    });
  });

  describe('createChain() - Task chains with dependencies', () => {
    it('should create a simple dependency chain', () => {
      const chain = createChain(testUserId, { count: 3 });
      
      expect(chain).toHaveLength(3);
      
      // First task should have no dependencies
      expect(chain[0].master.depends_on).toBeNull();
      
      // Subsequent tasks should depend on previous ones
      expect(chain[1].master.depends_on).toContain(chain[0].master.id);
      expect(chain[2].master.depends_on).toContain(chain[1].master.id);
    });

    it('should create chains with custom configuration', () => {
      const chain = createChain(testUserId, {
        count: 5,
        prefix: 'Step',
        dur: 45,
        pri: 'P2',
        project: 'chain-project'
      });

      expect(chain).toHaveLength(5);
      
      chain.forEach((task, index) => {
        expect(task.master.text).toBe(`Step ${index + 1}`);
        expect(task.master.dur).toBe(45);
        expect(task.master.pri).toBe('P2');
        expect(task.master.project).toBe('chain-project');
      });
    });

    it('should handle single-task chains', () => {
      const chain = createChain(testUserId, { count: 1 });
      
      expect(chain).toHaveLength(1);
      expect(chain[0].master.depends_on).toBeNull();
    });
  });

  describe('createRecurring() - Recurring tasks', () => {
    it('should create a basic recurring task', () => {
      const recurring = createRecurring(testUserId, {
        instanceCount: 3
      });

      expect(recurring.master).toBeDefined();
      expect(recurring.instances).toBeDefined();
      expect(recurring.instances).toHaveLength(3);
      expect(recurring.master.recurring).toBe(true);
      expect(recurring.master.recur).toEqual({ type: 'daily', every: 1 });

      // Verify instances have proper structure
      recurring.instances.forEach((instance, index) => {
        expect(instance.master_id).toBe(recurring.master.id);
        expect(instance.occurrence_ordinal).toBe(index + 1);
        expect(instance.split_ordinal).toBe(1);
        expect(instance.split_total).toBe(1);
      });
    });

    it('should create recurring tasks with different frequencies', () => {
      const weekly = createRecurring(testUserId, {
        recur: { type: 'weekly', every: 1, days: ['Mon', 'Wed', 'Fri'] },
        instanceCount: 2
      });

      const monthly = createRecurring(testUserId, {
        recur: { type: 'monthly', every: 1 },
        instanceCount: 2
      });

      const custom = createRecurring(testUserId, {
        recur: { type: 'custom', every: 2 },
        instanceCount: 2
      });

      expect(weekly.master.recur.type).toBe('weekly');
      expect(monthly.master.recur.type).toBe('monthly');
      expect(custom.master.recur.type).toBe('custom');
    });

    it('should create recurring tasks with custom properties', () => {
      const recurring = createRecurring(testUserId, {
        text: 'Weekly review',
        dur: 60,
        pri: 'P1',
        project: 'recurring-project',
        recur_start: '2026-01-01',
        recur_end: '2026-12-31',
        instanceCount: 4,
        instances: [
          { date: '1/1', time: '9:00 AM', status: 'done' },
          { date: '1/8', time: '9:00 AM', status: 'wip' }
        ]
      });

      expect(recurring.master.text).toBe('Weekly review');
      expect(recurring.master.dur).toBe(60);
      expect(recurring.master.pri).toBe('P1');
      expect(recurring.master.project).toBe('recurring-project');
      expect(recurring.master.recur_start).toBe('2026-01-01');
      expect(recurring.master.recur_end).toBe('2026-12-31');
      expect(recurring.instances).toHaveLength(4);

      // First two instances should have custom properties
      expect(recurring.instances[0].date).toBe('1/1');
      expect(recurring.instances[0].time).toBe('9:00 AM');
      expect(recurring.instances[0].status).toBe('done');
      
      expect(recurring.instances[1].date).toBe('1/8');
      expect(recurring.instances[1].time).toBe('9:00 AM');
      expect(recurring.instances[1].status).toBe('wip');
    });

    it('should create recurring tasks with deadlines', () => {
      const deadlineDate = '2026-12-31';
      const recurring = createRecurring(testUserId, {
        deadline: deadlineDate,
        instanceCount: 2
      });

      expect(recurring.master.deadline).toBe(deadlineDate);
      expect(recurring.master.recurring).toBe(true);
    });
  });

  describe('createSplit() - Split tasks', () => {
    it('should create a basic split task', () => {
      const split = createSplit(testUserId, {
        totalDur: 120,
        chunkCount: 3
      });

      expect(split.master).toBeDefined();
      expect(split.instances).toBeDefined();
      expect(split.instances).toHaveLength(3);
      expect(split.master.split).toBe(true);
      expect(split.master.dur).toBe(120);

      // Verify chunk durations sum to total
      const totalChunkDur = split.instances.reduce((sum, instance) => sum + instance.dur, 0);
      expect(totalChunkDur).toBe(120);

      // Verify split properties
      split.instances.forEach((instance, index) => {
        expect(instance.split_ordinal).toBe(index + 1);
        expect(instance.split_total).toBe(3);
        expect(instance.split_group).toBeDefined();
      });

      // All chunks should have the same split_group (primary chunk ID)
      const splitGroup = split.instances[0].split_group;
      split.instances.forEach(instance => {
        expect(instance.split_group).toBe(splitGroup);
      });
    });

    it('should create split tasks with custom chunk durations', () => {
      const split = createSplit(testUserId, {
        totalDur: 180,
        chunkDurations: [45, 60, 75]
      });

      expect(split.instances).toHaveLength(3);
      expect(split.instances[0].dur).toBe(45);
      expect(split.instances[1].dur).toBe(60);
      expect(split.instances[2].dur).toBe(75);
    });

    it('should create split tasks with minimum duration constraint', () => {
      const split = createSplit(testUserId, {
        totalDur: 120,
        chunkCount: 4,
        split_min: 20
      });

      expect(split.master.split_min).toBe(20);
      split.instances.forEach(instance => {
        expect(instance.dur).toBeGreaterThanOrEqual(20);
      });
    });

    it('should create split tasks with different priorities', () => {
      const priorities = ['P1', 'P2', 'P3', 'P4'];
      
      priorities.forEach(priority => {
        const split = createSplit(testUserId, { pri: priority });
        expect(split.master.pri).toBe(priority);
      });
    });

    it('should create split tasks with deadlines', () => {
      const deadlineDate = '2026-12-31';
      const split = createSplit(testUserId, {
        deadline: deadlineDate,
        totalDur: 180,
        chunkCount: 3
      });

      expect(split.master.deadline).toBe(deadlineDate);
      expect(split.master.split).toBe(true);
    });
  });

  describe('createBatch() - Batch task creation', () => {
    it('should create multiple one-off tasks', () => {
      const batch = createBatch(testUserId, 5, {
        text: 'Batch task',
        dur: 45,
        pri: 'P2'
      });

      expect(batch).toHaveLength(5);
      
      batch.forEach((task, index) => {
        expect(task.master.text).toBe(`Batch task ${index + 1}`);
        expect(task.master.dur).toBe(45);
        expect(task.master.pri).toBe('P2');
        expect(task.master.user_id).toBe(testUserId);
        expect(task.instance).toBeDefined();
      });
    });

    it('should create batches with default priority', () => {
      const batch = createBatch(testUserId, 4);
      
      // Should use default priority P3 for all tasks
      batch.forEach((task) => {
        expect(task.master.pri).toBe('P3');
      });
    });
  });

  describe('flattenForDb() - Database flattening helper', () => {
    it('should flatten single task', () => {
      const task = createTask(testUserId);
      const flattened = flattenForDb(task);

      expect(flattened.masters).toHaveLength(1);
      expect(flattened.instances).toHaveLength(1);
      expect(flattened.masters[0]).toBe(task.master);
      expect(flattened.instances[0]).toBe(task.instance);
    });

    it('should flatten multiple tasks', () => {
      const tasks = [
        createTask(testUserId, { text: 'Task 1' }),
        createTask(testUserId, { text: 'Task 2' })
      ];

      const flattened = flattenForDb(tasks);
      expect(flattened.masters).toHaveLength(2);
      expect(flattened.instances).toHaveLength(2);
    });

    it('should flatten recurring tasks', () => {
      const recurring = createRecurring(testUserId, { instanceCount: 3 });
      const flattened = flattenForDb(recurring);

      expect(flattened.masters).toHaveLength(1);
      expect(flattened.instances).toHaveLength(3);
    });

    it('should flatten split tasks', () => {
      const split = createSplit(testUserId, { totalDur: 120, chunkCount: 3 });
      const flattened = flattenForDb(split);

      expect(flattened.masters).toHaveLength(1);
      expect(flattened.instances).toHaveLength(3);
    });

    it('should flatten mixed task types', () => {
      const tasks = [
        createTask(testUserId, { text: 'One-off' }),
        createRecurring(testUserId, { text: 'Recurring', instanceCount: 2 }),
        createSplit(testUserId, { text: 'Split', totalDur: 90, chunkCount: 2 })
      ];

      const flattened = flattenForDb(tasks);
      expect(flattened.masters).toHaveLength(3);
      expect(flattened.instances).toHaveLength(1 + 2 + 2); // 1 + 2 + 2 = 5
    });
  });

  describe('Edge Cases and Validation', () => {
    it('should create tasks with null/undefined optional fields', () => {
      const task = createTask(testUserId, {});
      
      expect(task.master.project).toBeNull();
      expect(task.master.section).toBeNull();
      expect(task.master.notes).toBeNull();
      expect(task.master.location).toBeNull();
      expect(task.master.tools).toBeNull();
      expect(task.master.deadline).toBeNull();
      expect(task.master.depends_on).toBeNull();
    });

    it('should create tasks with various time preferences', () => {
      const timePrefs = ['morning', 'afternoon', 'evening', 'night', 'lunch'];
      
      timePrefs.forEach(pref => {
        const task = createTask(testUserId, { when: pref });
        expect(task.master.when).toContain(pref);
      });
    });

    it('should create tasks with different day requirements', () => {
      const dayReqs = ['any', 'weekday', 'weekend'];
      
      dayReqs.forEach(req => {
        const task = createTask(testUserId, { day_req: req });
        expect(task.master.day_req).toBe(req);
      });
    });

    it('should create tasks with various placement modes', () => {
      const modes = ['flexible', 'fixed', 'reminder'];
      
      modes.forEach(mode => {
        const task = createTask(testUserId, { placement_mode: mode });
        expect(task.master.placement_mode).toBe(mode);
      });
    });

    it('should create tasks with different status values', () => {
      const statuses = ['', 'done', 'wip', 'skip', 'cancel', 'unscheduled'];
      
      statuses.forEach(status => {
        const task = createTask(testUserId, { status });
        expect(task.instance.status).toBe(status);
      });
    });
  });

  describe('Integration Tests', () => {
    it('should create a complete scenario with all task types', () => {
      const oneOff = createTask(testUserId, { 
        text: 'One-off task', 
        pri: 'P1',
        deadline: '2026-12-31'
      });

      const chain = createChain(testUserId, { 
        count: 3, 
        prefix: 'Chain',
        pri: 'P2'
      });

      const recurring = createRecurring(testUserId, {
        text: 'Daily meeting',
        dur: 30,
        pri: 'P3',
        recur: { type: 'daily', every: 1 },
        instanceCount: 5
      });

      const split = createSplit(testUserId, {
        text: 'Large project',
        totalDur: 180,
        chunkCount: 3,
        pri: 'P4',
        deadline: '2026-11-30'
      });

      // Verify all task types are created correctly
      expect(oneOff.master.recurring).toBe(false);
      expect(oneOff.master.split).toBe(false);
      expect(oneOff.master.deadline).toBe('2026-12-31');

      expect(chain[1].master.depends_on).toContain(chain[0].master.id);

      expect(recurring.master.recurring).toBe(true);
      expect(recurring.instances).toHaveLength(5);

      expect(split.master.split).toBe(true);
      expect(split.instances).toHaveLength(3);
    });

    it('should handle flattening of complex mixed scenarios', () => {
      const oneOff1 = createTask(testUserId, { text: 'Task 1', pri: 'P1' });
      const oneOff2 = createTask(testUserId, { text: 'Task 2', pri: 'P2' });
      const chain = createChain(testUserId, { count: 2, prefix: 'Chain' });
      const recurring = createRecurring(testUserId, { text: 'Recurring', instanceCount: 2 });
      const split = createSplit(testUserId, { text: 'Split', totalDur: 90, chunkCount: 2 });

      // Flatten each type separately and combine
      const oneOffsFlat = flattenForDb([oneOff1, oneOff2]);
      const chainFlat = flattenForDb(chain);
      const recurringFlat = flattenForDb(recurring);
      const splitFlat = flattenForDb(split);

      const allMasters = [
        ...oneOffsFlat.masters,
        ...chainFlat.masters,
        ...recurringFlat.masters,
        ...splitFlat.masters
      ];
      
      const allInstances = [
        ...oneOffsFlat.instances,
        ...chainFlat.instances,
        ...recurringFlat.instances,
        ...splitFlat.instances
      ];

      // Count: 2 one-offs + 2 chain + 1 recurring + 1 split = 6 masters
      expect(allMasters).toHaveLength(6);
      
      // Count: 2 one-offs + 2 chain + 2 recurring instances + 2 split chunks = 8 instances
      expect(allInstances).toHaveLength(8);

      // Verify all masters have required fields
      allMasters.forEach(master => {
        expect(master.id).toBeDefined();
        expect(master.user_id).toBe(testUserId);
        expect(master.text).toBeDefined();
        expect(master.dur).toBeGreaterThan(0);
        expect(master.pri).toBeDefined();
      });

      // Verify all instances have required fields
      allInstances.forEach(instance => {
        expect(instance.id).toBeDefined();
        expect(instance.master_id).toBeDefined();
        expect(instance.user_id).toBe(testUserId);
        expect(instance.dur).toBeGreaterThan(0);
      });
    });
  });
});