// Test script to verify status-enum.js loads without errors
const statusEnum = require('./src/constants/status-enum.js');
const taskStatus = require('./src/lib/task-status.js');

console.log('status-enum.js loaded successfully');
console.log('CalHistoryStatus:', Object.keys(statusEnum.CalHistoryStatus));
console.log('CAL_HISTORY_STATUSES:', statusEnum.CAL_HISTORY_STATUSES);
console.log('CAL_HISTORY_TERMINAL_STATUSES:', statusEnum.CAL_HISTORY_TERMINAL_STATUSES);

console.log('\ntask-status.js loaded successfully');
console.log('STATUS_OPTIONS:', taskStatus.STATUS_OPTIONS);
console.log('TERMINAL_STATUSES:', taskStatus.TERMINAL_STATUSES);

// Test validation functions
console.log('\nValidation tests:');
console.log('isValidCalHistoryStatus("SKIPPED"):', statusEnum.isValidCalHistoryStatus('SKIPPED'));
console.log('isTerminalCalHistoryStatus("SKIPPED"):', statusEnum.isTerminalCalHistoryStatus('SKIPPED'));
console.log('getCalHistoryStatusDisplayName("SKIPPED"):', statusEnum.getCalHistoryStatusDisplayName('SKIPPED'));

console.log('\nTask status validation:');
console.log('isTerminalStatus("missed"):', taskStatus.isTerminalStatus('missed'));

console.log('\nAll modules loaded and validated successfully!');