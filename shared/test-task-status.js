/**
 * Test script for the shared task-status library
 */

const taskStatus = require('./task-status');

console.log('Testing Juggler Shared Task Status Library');
console.log('=============================================\n');

// Test basic constants
console.log('TaskStatus constants:', taskStatus.TaskStatus);
console.log('TASK_STATUSES array:', taskStatus.TASK_STATUSES);
console.log('TERMINAL_STATUSES:', taskStatus.TERMINAL_STATUSES);
console.log('ACTIVE_STATUSES:', taskStatus.ACTIVE_STATUSES);

// Test validation functions
console.log('\nValidation Tests:');
console.log('isValidTaskStatus("done"):', taskStatus.isValidTaskStatus('done'));
console.log('isValidTaskStatus("invalid"):', taskStatus.isValidTaskStatus('invalid'));
console.log('isTerminalStatus("done"):', taskStatus.isTerminalStatus('done'));
console.log('isTerminalStatus(""):', taskStatus.isTerminalStatus(''));
console.log('isActiveStatus(""):', taskStatus.isActiveStatus(''));
console.log('isActiveStatus("done"):', taskStatus.isActiveStatus('done'));

// Test display functions
console.log('\nDisplay Tests:');
console.log('getTaskStatusDisplayName("done"):', taskStatus.getTaskStatusDisplayName('done'));
console.log('getTaskStatusDisplayName("missed"):', taskStatus.getTaskStatusDisplayName('missed'));
console.log('getTaskStatusDescription("missed"):', taskStatus.getTaskStatusDescription('missed'));

// Test transition logic
console.log('\nTransition Tests:');
console.log('canTransition("", "done"):', taskStatus.canTransition('', 'done'));
console.log('canTransition("done", ""):', taskStatus.canTransition('done', ''));
console.log('canTransition("done", "invalid"):', taskStatus.canTransition('done', 'invalid'));

// Test Cal History statuses
console.log('\nCal History Tests:');
console.log('CalHistoryStatus:', taskStatus.CalHistoryStatus);
console.log('isValidCalHistoryStatus("SCHEDULED"):', taskStatus.isValidCalHistoryStatus('SCHEDULED'));
console.log('isCalHistoryTerminalStatus("COMPLETED"):', taskStatus.isCalHistoryTerminalStatus('COMPLETED'));

console.log('\n✅ All tests completed successfully!');