/**
 * Comprehensive test fixtures demonstration.
 * This test suite validates that all domain use cases are covered by the test fixtures.
 */

const { createComprehensiveTestDataset, flattenDataset, TEST_USERS } = require('./factories/comprehensive.factory');
const { createUserWithPlan } = require('./factories/user.factory');
const { createChain } = require('./factories/task.factory');

describe('Comprehensive Test Fixtures', () => {
  describe('Dataset Creation', () => {
    it('should create a complete dataset with all entity types', () => {
      const dataset = createComprehensiveTestDataset();
      const flattened = flattenDataset(dataset);

      // Verify all entity types are present
      expect(flattened.users).toHaveLength(3);
      expect(flattened.projects).toHaveLength(9); // 3 users × 3 projects each
      expect(flattened.locations).toHaveLength(9); // 3 users × 3 locations each
      expect(flattened.tools).toHaveLength(9); // 3 users × 3 tools each
      expect(flattened.task_masters).toBeTruthy();
      expect(flattened.task_instances).toBeTruthy();
      expect(flattened.calendar_events).toHaveLength(9); // 3 users × 3 events each

      // Verify user plans
      const freeUser = flattened.users.find(u => u.id === TEST_USERS.FREE_USER);
      const proUser = flattened.users.find(u => u.id === TEST_USERS.PRO_USER);
      const premiumUser = flattened.users.find(u => u.id === TEST_USERS.PREMIUM_USER);

      expect(freeUser).toBeDefined();
      expect(proUser).toBeDefined();
      expect(premiumUser).toBeDefined();
      expect(freeUser._plan).toBe('free');
      expect(proUser._plan).toBe('pro-monthly');
      expect(premiumUser._plan).toBe('premium-annual');
    });

    it('should create tasks of all types', () => {
      const dataset = createComprehensiveTestDataset();
      const flattened = flattenDataset(dataset);

      // Count different task types by examining their properties
      const masters = flattened.task_masters;
      
      // Should have one-off tasks
      const oneOffTasks = masters.filter(t => !t.recurring && !t.split);
      expect(oneOffTasks.length).toBeGreaterThan(0);

      // Should have recurring tasks
      const recurringTasks = masters.filter(t => t.recurring === true);
      expect(recurringTasks.length).toBeGreaterThan(0);

      // Should have split tasks
      const splitTasks = masters.filter(t => t.split === true);
      expect(splitTasks.length).toBeGreaterThan(0);

      // Should have tasks with dependencies (chains)
      const dependentTasks = masters.filter(t => t.depends_on && t.depends_on.length > 0);
      expect(dependentTasks.length).toBeGreaterThan(0);

      // Should have tasks with deadlines
      const deadlineTasks = masters.filter(t => t.deadline);
      expect(deadlineTasks.length).toBeGreaterThan(0);
    });

    it('should create calendar events for all providers', () => {
      const dataset = createComprehensiveTestDataset();
      const events = dataset.calendarEvents;

      const gcalEvents = events.filter(e => e.provider === 'gcal');
      const msftEvents = events.filter(e => e.provider === 'msft');
      const appleEvents = events.filter(e => e.provider === 'apple');

      expect(gcalEvents.length).toBeGreaterThan(0);
      expect(msftEvents.length).toBeGreaterThan(0);
      expect(appleEvents.length).toBeGreaterThan(0);

      // Should have a mix of regular and all-day events
      const allDayEvents = events.filter(e => e.all_day);
      const regularEvents = events.filter(e => !e.all_day);
      expect(allDayEvents.length).toBeGreaterThan(0);
      expect(regularEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Task Chain Creation', () => {
    it('should create valid dependency chains', () => {
      const userId = 'test-user-chain';
      const chain = createChain(userId, { count: 5, prefix: 'Step' });

      expect(chain).toHaveLength(5);

      // Verify chain structure: each task depends on the previous one
      for (let i = 1; i < chain.length; i++) {
        const currentTask = chain[i];
        const previousTask = chain[i - 1];
        
        expect(currentTask.master.depends_on).toContain(previousTask.master.id);
      }

      // First task should have no dependencies
      expect(chain[0].master.depends_on).toBeNull();
    });

    it('should handle circular dependencies', () => {
      const { createDependencyCycle } = require('./factories/comprehensive.factory');
      const userId = 'test-user-cycle';
      const cycleTasks = createDependencyCycle(userId);

      // Should create 3 masters that form a cycle
      const masters = cycleTasks.filter(item => item && item.master).map(item => item.master);
      expect(masters).toHaveLength(3);

      // Verify the cycle: A → B → C → A
      const taskA = masters.find(t => t.text.includes('cycle start'));
      const taskB = masters.find(t => t.text.includes('depends on A'));
      const taskC = masters.find(t => t.text.includes('depends on B'));

      expect(taskA).toBeDefined();
      expect(taskB).toBeDefined();
      expect(taskC).toBeDefined();
      expect(taskB.depends_on).toContain(taskA.id);
      expect(taskC.depends_on).toContain(taskB.id);
      expect(taskA.depends_on).toContain(taskC.id);
    });
  });

  describe('Recurring Task Edge Cases', () => {
    it('should create recurring tasks with various frequencies', () => {
      const { createRecurringTasks } = require('./factories/comprehensive.factory');
      const userId = 'test-user-recurring';
      const recurringTasks = createRecurringTasks(userId);

      // Should create multiple recurring task sets
      expect(recurringTasks.length).toBeGreaterThan(0);

      const masters = recurringTasks.filter(item => item && item.master);
      
      // Check for different recurrence types
      const daily = masters.find(t => t.master.recur.type === 'daily');
      const weekly = masters.find(t => t.master.recur.type === 'weekly');
      const monthly = masters.find(t => t.master.recur.type === 'monthly');
      const yearly = masters.find(t => t.master.recur.type === 'yearly');

      expect(daily).toBeDefined();
      expect(weekly).toBeDefined();
      expect(monthly).toBeDefined();
      expect(yearly).toBeDefined();
    });

    it('should create recurring task instances', () => {
      const { createRecurringTasks } = require('./factories/comprehensive.factory');
      const userId = 'test-user-instances';
      const recurringTasks = createRecurringTasks(userId);

      const instances = recurringTasks.flatMap(task => task.instances);
      
      expect(instances.length).toBeGreaterThan(0);

      // Verify instances have proper ordinals
      instances.forEach(instance => {
        expect(instance.occurrence_ordinal).toBeGreaterThan(0);
        expect(instance.split_ordinal).toBe(1);
        expect(instance.split_total).toBe(1);
      });
    });
  });

  describe('Deadline Conflict Scenarios', () => {
    it('should create tasks with conflicting deadlines', () => {
      const { createDeadlineConflictTasks } = require('./factories/comprehensive.factory');
      const userId = 'test-user-deadline';
      const conflictTasks = createDeadlineConflictTasks(userId);

      expect(conflictTasks.length).toBe(4);

      // Should have tasks with the same deadline
      const tasksWithDeadlines = conflictTasks.filter(t => t.master.deadline);
      expect(tasksWithDeadlines.length).toBeGreaterThan(1);

      const deadlineDates = tasksWithDeadlines.map(t => t.master.deadline);
      const uniqueDeadlines = [...new Set(deadlineDates)];

      // Should have at least one deadline that's shared by multiple tasks
      expect(uniqueDeadlines.length).toBeLessThan(tasksWithDeadlines.length);
    });

    it('should include tasks with different priorities for conflict resolution', () => {
      const { createDeadlineConflictTasks } = require('./factories/comprehensive.factory');
      const userId = 'test-user-priority';
      const conflictTasks = createDeadlineConflictTasks(userId);

      const priorities = conflictTasks.map(t => t.master.pri);
      const uniquePriorities = [...new Set(priorities)];

      // Should have tasks with different priorities
      expect(uniquePriorities.length).toBeGreaterThan(1);
      expect(priorities).toContain('P1');
      expect(priorities).toContain('P4');
    });
  });

  describe('User Plan Coverage', () => {
    it('should create users with all supported plans', () => {
      const validPlans = ['free', 'pro-monthly', 'pro-annual', 'premium-monthly', 'premium-annual'];
      
      for (const plan of validPlans) {
        const user = createUserWithPlan(plan, { id: `test-${plan}` });
        expect(user._plan).toBe(plan);
      }
    });

    it('should reject invalid plans', () => {
      expect(() => {
        createUserWithPlan('invalid-plan');
      }).toThrow('Invalid plan');
    });
  });
});