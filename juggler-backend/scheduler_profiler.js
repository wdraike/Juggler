const workload = require('/Users/david/.hermes/kanban/workspaces/t_8e7b7966/workload/synthetic_workload.json');
const { unifiedScheduleV2 } = require('./src/scheduler/unifiedScheduleV2');

// Mock database connection
const mockDB = {
  query: async () => [],
  select: async () => [],
  insert: async () => ({}),
  update: async () => ({}),
  where: () => mockDB,
  first: async () => null,
  from: () => mockDB
};

async function runProfiling() {
  console.log('Starting scheduler profiling with synthetic workload');
  console.log('Users:', workload.users.length);
  console.log('Tasks:', workload.tasks.length);
  
  // Run scheduler for each user
  for (const user of workload.users) {
    console.log(`Running scheduler for user ${user.id}`);
    
    try {
      const result = await unifiedScheduleV2({
        db: mockDB,
        userId: user.id,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        dryRun: true,
        tasks: workload.tasks.filter(t => t.user_id === user.id)
      });
      
      console.log(`Completed for user ${user.id}: ${result.tasksPlaced || 0} tasks placed`);
    } catch (error) {
      console.error(`Error scheduling for user ${user.id}:`, error.message);
    }
  }
  
  console.log('Profiling complete');
}

runProfiling().catch(console.error);