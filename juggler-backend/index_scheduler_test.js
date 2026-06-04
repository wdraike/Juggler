// Test using the scheduler index
const { runScheduler } = require('./src/scheduler/index');

// Mock database
const mockDB = {
  query: async () => [],
  select: async () => [],
  where: () => mockDB,
  first: async () => null,
  from: () => mockDB,
  insert: async () => ({}),
  update: async () => ({})
};

// Create test tasks
const testTasks = [];
for (let i = 0; i < 50; i++) {
  testTasks.push({
    id: `task_${i}`,
    text: `Test task ${i}`,
    dur: 30 + (i % 45),
    pri: i % 4 === 0 ? 'P1' : i % 4 === 1 ? 'P2' : i % 4 === 2 ? 'P3' : 'P4',
    placement_mode: i % 4 === 0 ? 'fixed' : i % 4 === 1 ? 'time_blocks' : 'anytime',
    when: i % 4 === 1 ? 'morning,afternoon' : undefined,
    date: i % 4 === 0 ? '6/2/2026' : undefined,
    time: i % 4 === 0 ? '9:00 AM' : undefined,
    user_id: 'test_user'
  });
}

async function runTest() {
  console.log('Running scheduler test with', testTasks.length, 'tasks');
  
  try {
    const result = await runScheduler({
      db: mockDB,
      userId: 'test_user',
      startDate: new Date('2026-06-02'),
      endDate: new Date('2026-06-30'),
      dryRun: true
    });
    
    console.log('Scheduler completed successfully');
    console.log('Result:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('Scheduler error:', error.message);
    console.error(error.stack);
  }
}

runTest();