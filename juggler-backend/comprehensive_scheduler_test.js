// Comprehensive scheduler profiling with full synthetic workload
const unifiedScheduleV2 = require('./src/scheduler/unifiedScheduleV2');
const workload = require('/Users/david/.hermes/kanban/workspaces/t_8e7b7966/workload/synthetic_workload.json');

async function runComprehensiveTest() {
  console.log('Running comprehensive scheduler profiling');
  console.log('Total users:', workload.users.length);
  console.log('Total tasks:', workload.tasks.length);
  
  let totalPlaced = 0;
  let totalUnplaced = 0;
  let totalTime = 0;
  
  for (const user of workload.users) {
    console.log(`\nProcessing user ${user.id}...`);
    const userTasks = workload.tasks.filter(t => t.user_id === user.id);
    
    const startTime = Date.now();
    
    try {
      const result = await unifiedScheduleV2(
        userTasks,
        {},
        '2026-06-02',
        420,
        {
          timezone: 'America/New_York',
          startDate: '2026-06-02',
          endDate: '2026-06-30',
          dryRun: true
        }
      );
      
      const duration = Date.now() - startTime;
      totalTime += duration;
      totalPlaced += result.placedCount;
      totalUnplaced += result.unplaced.length;
      
      console.log(`  User ${user.id}: ${result.placedCount} placed, ${result.unplaced.length} unplaced, ${duration}ms`);
      
    } catch (error) {
      console.error(`  Error for user ${user.id}:`, error.message);
    }
  }
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total tasks processed: ${workload.tasks.length}`);
  console.log(`Total tasks placed: ${totalPlaced}`);
  console.log(`Total tasks unplaced: ${totalUnplaced}`);
  console.log(`Total execution time: ${totalTime}ms`);
  console.log(`Average time per user: ${totalTime / workload.users.length}ms`);
}

runComprehensiveTest().catch(console.error);