// Test loading the scheduler module
try {
  console.log('Attempting to load scheduler module...');
  const scheduler = require('./src/scheduler/unifiedScheduleV2');
  console.log('Module loaded successfully');
  console.log('Type of scheduler:', typeof scheduler);
  console.log('Keys:', Object.keys(scheduler));
} catch (error) {
  console.error('Error loading scheduler:', error.message);
  console.error('Stack:', error.stack);
}