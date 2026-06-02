/**
 * Test suite for comprehensive test fixtures
 */

const {
  createComprehensiveTestDataset,
  flattenDataset,
  TEST_USERS,
  TEST_PROJECTS,
  createDependencyCycle,
} = require('./comprehensive.factory');

describe('Comprehensive Test Fixtures', () => {
  describe('createComprehensiveTestDataset', () => {
    it('should create a comprehensive dataset with all juggler domain entities', () => {
      const dataset = createComprehensiveTestDataset();
      
      // Check users
      expect(dataset.users).toHaveLength(3); // free, pro, premium
      expect(dataset.users[0].id).toBe(TEST_USERS.FREE_USER);
      expect(dataset.users[1].id).toBe(TEST_USERS.PRO_USER);
      expect(dataset.users[2].id).toBe(TEST_USERS.PREMIUM_USER);
      
      // Check projects
      expect(dataset.projects).toHaveLength(9); // 3 users × 3 projects each
      
      // Check locations
      expect(dataset.locations).toHaveLength(9); // 3 users × 3 locations each
      
      // Check tools
      expect(dataset.tools).toHaveLength(9); // 3 users × 3 tools each
      
      // Check tasks
      expect(dataset.tasks).toBeTruthy();
      expect(Array.isArray(dataset.tasks)).toBe(true);
      
      // Check calendar events
      expect(dataset.calendarEvents).toHaveLength(9); // 3 users × 3 events each
    });

    it('should create tasks with proper user distribution', () => {
      const dataset = createComprehensiveTestDataset();
      
      // Count tasks by user
      const tasksByUser = {};
      for (const task of dataset.tasks) {
        const userId = task.master.user_id;
        tasksByUser[userId] = (tasksByUser[userId] || 0) + 1;
      }
      
      // Each user should have tasks
      expect(tasksByUser[TEST_USERS.FREE_USER]).toBeGreaterThan(0);
      expect(tasksByUser[TEST_USERS.PRO_USER]).toBeGreaterThan(0);
      expect(tasksByUser[TEST_USERS.PREMIUM_USER]).toBeGreaterThan(0);
    });
  });

  describe('flattenDataset', () => {
    it('should flatten dataset for database insertion', () => {
      const dataset = createComprehensiveTestDataset();
      const flattened = flattenDataset(dataset);
      
      expect(flattened).toHaveProperty('users');
      expect(flattened).toHaveProperty('projects');
      expect(flattened).toHaveProperty('locations');
      expect(flattened).toHaveProperty('tools');
      expect(flattened).toHaveProperty('task_masters');
      expect(flattened).toHaveProperty('task_instances');
      expect(flattened).toHaveProperty('calendar_events');
      
      // Check that task masters and instances are properly separated
      expect(flattened.task_masters.length).toBeGreaterThan(0);
      expect(flattened.task_instances.length).toBeGreaterThan(0);
    });
  });

  describe('TEST_USERS constants', () => {
    it('should define test user IDs', () => {
      expect(TEST_USERS.FREE_USER).toBe('free-user-001');
      expect(TEST_USERS.PREMIUM_USER).toBe('premium-user-001');
      expect(TEST_USERS.PRO_USER).toBe('pro-user-001');
    });
  });

  describe('RecurringRule factory integration', () => {
    it('should create comprehensive recurring tasks using RecurringRule factory', () => {
      const dataset = createComprehensiveTestDataset();
      
      // Find recurring tasks
      const recurringTasks = dataset.tasks.filter(task => 
        task.master && task.master.recurring === true
      );
      
      // Should have recurring tasks from both users
      expect(recurringTasks.length).toBeGreaterThan(0);
      
      // Check that recurring tasks have proper structure
      for (const task of recurringTasks) {
        expect(task.master).toBeDefined();
        expect(task.master.recurring).toBe(true);
        expect(task.master.recur).toBeDefined();
        expect(task.instances).toBeDefined();
        expect(Array.isArray(task.instances)).toBe(true);
        expect(task.instances.length).toBeGreaterThan(0);
      }
    });

    it('should include edge case recurring rules', () => {
      const dataset = createComprehensiveTestDataset();
      
      // Look for edge case tasks
      const edgeCaseTasks = dataset.tasks.filter(task => 
        task.master && task.master.text && 
        (task.master.text.includes('Leap year') || task.master.text.includes('Month-end'))
      );
      
      expect(edgeCaseTasks.length).toBeGreaterThan(0);
    });
  });

  describe('Dependency cycle scenarios', () => {
    it('should create dependency cycles for testing', () => {
      const cycleTasks = createDependencyCycle(TEST_USERS.PRO_USER);
      
      expect(cycleTasks).toHaveLength(3);
      
      // Verify the cycle structure: A → B → C → A
      const taskA = cycleTasks[0];
      const taskB = cycleTasks[1];
      const taskC = cycleTasks[2];
      
      expect(taskA.master.text).toContain('Task A');
      expect(taskB.master.text).toContain('Task B');
      expect(taskC.master.text).toContain('Task C');
      
      // B depends on A
      expect(taskB.master.depends_on).toContain(taskA.master.id);
      
      // C depends on B
      expect(taskC.master.depends_on).toContain(taskB.master.id);
      
      // A depends on C (completing the cycle)
      expect(taskA.master.depends_on).toContain(taskC.master.id);
    });
  });

  describe('TEST_PROJECTS constants', () => {
    it('should define test project IDs', () => {
      expect(TEST_PROJECTS.WORK).toBe('work-project');
      expect(TEST_PROJECTS.PERSONAL).toBe('personal-project');
      expect(TEST_PROJECTS.SIDE_HUSTLE).toBe('side-hustle-project');
    });
  });
});