/**
 * Comprehensive test fixtures for juggler domain use cases.
 * This file contains test data and scenarios for:
 * - Users (free/premium)
 * - Tasks (one-off, chain, recurring)
 * - Recurring rules with edge cases
 * - Calendar events and providers
 * - Deadline conflicts
 * - Dependency cycles
 */

const { createUser, createUserWithPlan } = require('./user.factory');
const { createTask, createChain, createRecurring, createSplit } = require('./task.factory');
const { createProject } = require('./project.factory');
const { createLocation } = require('./location.factory');
const { createTool } = require('./tool.factory');
const { createCalendarEvent } = require('./calendar.factory');
const {
  createDailyRule,
  createWeeklyRule,
  createMonthlyRule,
  createYearlyRule,
  createCustomRule,
  createEdgeCaseRule
} = require('./recurring-rule.factory');

// Test user IDs
const TEST_USERS = {
  FREE_USER: 'free-user-001',
  PREMIUM_USER: 'premium-user-001',
  PRO_USER: 'pro-user-001',
};

// Test project IDs
const TEST_PROJECTS = {
  WORK: 'work-project',
  PERSONAL: 'personal-project',
  SIDE_HUSTLE: 'side-hustle-project',
};

/**
 * Create a comprehensive test dataset covering all juggler domain use cases.
 * @returns {Object} Test dataset with users, projects, tasks, calendar events, etc.
 */
function createComprehensiveTestDataset() {
  const dataset = {
    users: [],
    projects: [],
    locations: [],
    tools: [],
    tasks: [],
    calendarEvents: [],
  };

  // 1. Create users with different plans
  dataset.users.push(
    createUserWithPlan('free', { id: TEST_USERS.FREE_USER, name: 'Free User' }),
    createUserWithPlan('pro-monthly', { id: TEST_USERS.PRO_USER, name: 'Pro User' }),
    createUserWithPlan('premium-annual', { id: TEST_USERS.PREMIUM_USER, name: 'Premium User' })
  );

  // 2. Create projects for each user
  for (const user of dataset.users) {
    dataset.projects.push(
      createProject(user.id, { name: 'Work', project_id: TEST_PROJECTS.WORK }),
      createProject(user.id, { name: 'Personal', project_id: TEST_PROJECTS.PERSONAL }),
      createProject(user.id, { name: 'Side Hustle', project_id: TEST_PROJECTS.SIDE_HUSTLE })
    );
  }

  // 3. Create locations and tools
  for (const user of dataset.users) {
    dataset.locations.push(
      createLocation(user.id, { name: 'Home Office' }),
      createLocation(user.id, { name: 'Co-working Space' }),
      createLocation(user.id, { name: 'Coffee Shop' })
    );

    dataset.tools.push(
      createTool(user.id, { name: 'Laptop' }),
      createTool(user.id, { name: 'Phone' }),
      createTool(user.id, { name: 'Tablet' })
    );
  }

  // 4. Create one-off tasks
  const oneOffTasks = createBatchTasks(TEST_USERS.FREE_USER, 5, { project: TEST_PROJECTS.WORK });
  dataset.tasks.push(...oneOffTasks);
  
  const proOneOffTasks = createBatchTasks(TEST_USERS.PRO_USER, 3, { project: TEST_PROJECTS.PERSONAL });
  dataset.tasks.push(...proOneOffTasks);
  
  const premiumOneOffTasks = createBatchTasks(TEST_USERS.PREMIUM_USER, 7, { project: TEST_PROJECTS.SIDE_HUSTLE });
  dataset.tasks.push(...premiumOneOffTasks);

  // 5. Create task chains (dependency chains)
  dataset.tasks.push(
    ...createChain(TEST_USERS.FREE_USER, { count: 3, prefix: 'Research → Write → Publish', project: TEST_PROJECTS.WORK }),
    ...createChain(TEST_USERS.PRO_USER, { count: 5, prefix: 'Plan → Design → Develop → Test → Deploy', project: TEST_PROJECTS.SIDE_HUSTLE })
  );

  // 6. Create recurring tasks with various rules
  dataset.tasks.push(
    ...createRecurringTasks(TEST_USERS.FREE_USER),
    ...createRecurringTasks(TEST_USERS.PREMIUM_USER)
  );

  // 7. Create split tasks
  dataset.tasks.push(
    ...createSplitTasks(TEST_USERS.FREE_USER),
    ...createSplitTasks(TEST_USERS.PRO_USER)
  );

  // 8. Create tasks with deadline conflicts
  const deadlineResults = createDeadlineConflictTasks(TEST_USERS.PREMIUM_USER);
  
  // Convert flat results back to task objects for consistency
  dataset.tasks.push(...convertFlatToTasks(deadlineResults));

  // 9. Create calendar events for sync testing
  dataset.calendarEvents.push(
    ...createCalendarEventsForUser(TEST_USERS.FREE_USER, 3, 'gcal'),
    ...createCalendarEventsForUser(TEST_USERS.PRO_USER, 2, 'msft'),
    ...createCalendarEventsForUser(TEST_USERS.PREMIUM_USER, 4, 'apple')
  );

  return dataset;
}

/**
 * Create a batch of one-off tasks
 */
function createBatchTasks(userId, count, options = {}) {
  const tasks = [];
  for (let i = 0; i < count; i++) {
    tasks.push(createTask(userId, {
      text: `One-off task ${i + 1}`,
      dur: 30 + (i * 15),
      pri: ['P1', 'P2', 'P3', 'P4'][i % 4],
      ...options,
    }));
  }
  return tasks;
}

/**
 * Create recurring tasks with various recurrence rules using the new RecurringRule factory
 */
function createRecurringTasks(userId) {
  const tasks = [];

  // Daily recurring task using createDailyRule
  const dailyResult = createDailyRule(userId, {
    text: 'Daily standup',
    dur: 15,
    pri: 'P1',
    every: 1
  });
  tasks.push({ master: dailyResult.master, instances: dailyResult.instances });

  // Weekly recurring task (every Tuesday and Thursday) using createWeeklyRule
  const weeklyResult = createWeeklyRule(userId, {
    text: 'Team meeting',
    dur: 60,
    pri: 'P2',
    days: ['Tue', 'Thu'],
    every: 1
  });
  tasks.push({ master: weeklyResult.master, instances: weeklyResult.instances });

  // Bi-weekly recurring task using createWeeklyRule
  const biweeklyResult = createWeeklyRule(userId, {
    text: 'Sprint planning',
    dur: 90,
    pri: 'P1',
    every: 2
  });
  tasks.push({ master: biweeklyResult.master, instances: biweeklyResult.instances });

  // Monthly recurring task using createMonthlyRule
  const monthlyResult = createMonthlyRule(userId, {
    text: 'Monthly review',
    dur: 120,
    pri: 'P2',
    every: 1
  });
  tasks.push({ master: monthlyResult.master, instances: monthlyResult.instances });

  // Yearly recurring task using createYearlyRule
  const yearlyResult = createYearlyRule(userId, {
    text: 'Year-end review',
    dur: 180,
    pri: 'P1',
    every: 1
  });
  tasks.push({ master: yearlyResult.master, instances: yearlyResult.instances });

  // Edge case: leap year handling
  const leapYearResult = createEdgeCaseRule(userId, {
    text: 'Leap year birthday',
    dur: 30,
    pri: 'P3',
    edgeCase: 'leapYear'
  });
  tasks.push({ master: leapYearResult.master, instances: leapYearResult.instances });

  // Edge case: month-end dates
  const monthEndResult = createEdgeCaseRule(userId, {
    text: 'Month-end reporting',
    dur: 60,
    pri: 'P2',
    edgeCase: 'monthEnd'
  });
  tasks.push({ master: monthEndResult.master, instances: monthEndResult.instances });

  return tasks;
}

/**
 * Create split tasks
 */
function createSplitTasks(userId) {
  const tasks = [];

  // Split task into 3 chunks
  tasks.push(createSplit(userId, {
    text: 'Write annual report',
    totalDur: 180,
    chunkCount: 3,
    pri: 'P2'
  }));

  // Split task with minimum chunk duration
  tasks.push(createSplit(userId, {
    text: 'Code review session',
    totalDur: 120,
    chunkCount: 4,
    split_min: 20,
    pri: 'P3'
  }));

  return tasks;
}

/**
 * Create tasks with deadline conflicts for testing scheduler behavior
 */
function createDeadlineConflictTasks(userId) {
  const now = new Date();
  const tasks = [];

  // Task 1: High priority, tight deadline
  const deadline1 = new Date(now);
  deadline1.setDate(deadline1.getDate() + 1); // Tomorrow
  
  tasks.push(createTask(userId, {
    text: 'Urgent client deliverable',
    dur: 120,
    pri: 'P1',
    deadline: deadline1.toISOString().split('T')[0],
    status: ''
  }));

  // Task 2: Also high priority, same deadline (conflict!)
  tasks.push(createTask(userId, {
    text: 'Critical bug fix',
    dur: 180,
    pri: 'P1',
    deadline: deadline1.toISOString().split('T')[0],
    status: ''
  }));

  // Task 3: Lower priority, same deadline
  tasks.push(createTask(userId, {
    text: 'Documentation update',
    dur: 60,
    pri: 'P3',
    deadline: deadline1.toISOString().split('T')[0],
    status: ''
  }));

  // Task 4: No deadline (flexible)
  tasks.push(createTask(userId, {
    text: 'Optional training',
    dur: 90,
    pri: 'P4',
    deadline: null,
    status: ''
  }));

  return tasks;
}

/**
 * Create calendar events for calendar sync testing
 */
function createCalendarEventsForUser(userId, count, provider) {
  const events = [];
  const now = new Date();

  for (let i = 0; i < count; i++) {
    const start = new Date(now);
    start.setDate(start.getDate() + i);
    start.setHours(10 + i, 0, 0, 0);

    const end = new Date(start);
    end.setHours(end.getHours() + 1, 0, 0, 0);

    events.push(createCalendarEvent(userId, {
      title: `${provider.toUpperCase()} Event ${i + 1}`,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      provider: provider,
      all_day: i % 3 === 0 // Every 3rd event is all-day
    }));
  }

  return events;
}

/**
 * Create a dependency cycle scenario for testing
 * A → B → C → A (cycle!)
 */
function createDependencyCycle(userId) {
  const taskA = createTask(userId, {
    text: 'Task A (cycle start)',
    dur: 30,
    pri: 'P2'
  });

  const taskB = createTask(userId, {
    text: 'Task B (depends on A)',
    dur: 30,
    pri: 'P2',
    depends_on: [taskA.master.id]
  });

  const taskC = createTask(userId, {
    text: 'Task C (depends on B)',
    dur: 30,
    pri: 'P2',
    depends_on: [taskB.master.id]
  });

  // This creates the cycle: C depends on B, B depends on A, and we'll make A depend on C
  taskA.master.depends_on = [taskC.master.id];

  return [taskA, taskB, taskC];
}

/**
 * Convert flat array of masters and instances back to task objects for consistency
 */
function convertFlatToTasks(flatArray) {
  const taskObjects = [];
  const mastersById = new Map();
  
  // First pass: collect all masters
  flatArray.forEach(item => {
    if (item && item.master) {
      // This is already a task object, keep it as is
      taskObjects.push(item);
    } else if (item && !item.master_id) {
      // This is a master (no master_id field)
      mastersById.set(item.id, item);
    }
  });
  
  // Second pass: group instances with their masters
  flatArray.forEach(item => {
    if (item && item.master_id) {
      // This is an instance
      const masterId = item.master_id;
      if (mastersById.has(masterId)) {
        const master = mastersById.get(masterId);
        
        // Find or create the task object for this master
        let taskObj = taskObjects.find(t => t.master && t.master.id === masterId);
        if (!taskObj) {
          taskObj = { master, instances: [] };
          taskObjects.push(taskObj);
        } else if (!taskObj.instances) {
          taskObj.instances = [];
        }
        
        taskObj.instances.push(item);
      }
    }
  });
  
  return taskObjects;
}

/**
 * Flatten the dataset for database insertion
 */
function flattenDataset(dataset) {
  return {
    users: dataset.users,
    projects: dataset.projects,
    locations: dataset.locations,
    tools: dataset.tools,
    task_masters: dataset.tasks.flatMap(item => {
      // Handle both old format (direct master) and new format (master/instances)
      if (item.master) {
        return item.master;
      } else if (item.instances) {
        // This is a task object with instances
        return item.master || {};
      } else {
        // Old format: item is the master directly
        return item;
      }
    }),
    task_instances: dataset.tasks.flatMap(item => {
      if (item.instances) {
        return item.instances;
      } else if (item.instance) {
        return [item.instance];
      } else {
        return [];
      }
    }),
    calendar_events: dataset.calendarEvents
  };
}

module.exports = {
  createComprehensiveTestDataset,
  createBatchTasks,
  createRecurringTasks,
  createSplitTasks,
  createDeadlineConflictTasks,
  createCalendarEventsForUser,
  createDependencyCycle,
  flattenDataset,
  convertFlatToTasks,
  TEST_USERS,
  TEST_PROJECTS,
};