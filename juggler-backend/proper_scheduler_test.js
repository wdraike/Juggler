// Proper scheduler test with correct function signature
const unifiedScheduleV2 = require('./src/scheduler/unifiedScheduleV2');

// Create test tasks
const testTasks = [];
for (let i = 0; i < 100; i++) {
  testTasks.push({
    id: `task_${i}`,
    text: `Test task ${i}`,
    dur: 30 + (i % 60),
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
    const result = await unifiedScheduleV2(
      testTasks,  // allTasks
      {},          // statuses
      '2026-06-02', // effectiveTodayKey
      420,         // nowMins (7:00 AM)
      {
        timezone: 'America/New_York',
        startDate: '2026-06-02',
        endDate: '2026-06-30',
        dryRun: true
      }
    );
    
    console.log('Scheduler completed successfully');
    console.log('Tasks placed:', result.placedCount);
    console.log('Tasks unplaced:', result.unplaced.length);
    console.log('Score:', result.score);
    
  } catch (error) {
    console.error('Scheduler error:', error.message);
    console.error(error.stack);
  }
}

runTest();