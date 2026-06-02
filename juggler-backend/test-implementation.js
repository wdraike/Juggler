const { TERMINAL_STATUSES, isTerminalStatus } = require('./src/lib/task-status');
const { CalHistoryStatus, isValidCalHistoryStatus, isTerminalCalHistoryStatus } = require('./src/constants/status-enum');

console.log('=== Task Status Library Tests ===');
console.log('TERMINAL_STATUSES:', TERMINAL_STATUSES);
console.log('isTerminalStatus("missed"):', isTerminalStatus('missed'));
console.log('isTerminalStatus("wip"):', isTerminalStatus('wip'));
console.log('TERMINAL_STATUSES includes missed:', TERMINAL_STATUSES.includes('missed'));

console.log('\n=== Status Enum Tests ===');
console.log('CalHistoryStatus.SCHEDULED:', CalHistoryStatus.SCHEDULED);
console.log('CalHistoryStatus.COMPLETED:', CalHistoryStatus.COMPLETED);
console.log('CalHistoryStatus.MISSED:', CalHistoryStatus.MISSED);
console.log('CalHistoryStatus.CANCELLED:', CalHistoryStatus.CANCELLED);
console.log('isValidCalHistoryStatus("SCHEDULED"):', isValidCalHistoryStatus('SCHEDULED'));
console.log('isValidCalHistoryStatus("INVALID"):', isValidCalHistoryStatus('INVALID'));
console.log('isTerminalCalHistoryStatus("COMPLETED"):', isTerminalCalHistoryStatus('COMPLETED'));
console.log('isTerminalCalHistoryStatus("MISSED"):', isTerminalCalHistoryStatus('MISSED'));
console.log('isTerminalCalHistoryStatus("SCHEDULED"):', isTerminalCalHistoryStatus('SCHEDULED'));

console.log('\n=== Missed Helpers Tests ===');
const { isTaskMissed, shouldAutoMarkMissed } = require('../shared/scheduler/missedHelpers');

const testTask = {
  scheduled_at: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
  status: 'wip'
};

console.log('isTaskMissed(testTask):', isTaskMissed(testTask, new Date()));
console.log('shouldAutoMarkMissed(testTask):', shouldAutoMarkMissed(testTask, new Date()));

console.log('\n=== All tests completed successfully ===');