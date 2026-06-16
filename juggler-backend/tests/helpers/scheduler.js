const { runScheduler } = require('../../src/scheduler/unifiedScheduleV2');
const { runScheduleAndPersist } = require('../../src/scheduler/runSchedule');

async function runSchedulerWithClock(clock) {
  // This is a simplified version for testing
  // In a real implementation, this would run the full scheduler with clock injection
  const userId = 1; // Default test user
  const options = { timezone: 'America/New_York' };
  
  // Run the scheduler with the injected clock
  const result = await runScheduleAndPersist(userId, 0, options, clock);
  
  return {
    timeInfo: {
      todayKey: result.todayKey,
      nowMins: result.nowMins
    },
    weatherInfo: result.weatherInfo,
    ...result
  };
}

module.exports = { 
  runScheduler: runScheduler,
  runSchedulerWithClock: runSchedulerWithClock
};