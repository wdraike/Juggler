const s = require('./src/lib/task-status');
console.log('STATUS_OPTIONS:', s.STATUS_OPTIONS);
console.log('isTerminalStatus("missed"):', s.isTerminalStatus('missed'));

// Check if CalHistoryStatus constants are defined
const statusEnum = require('./src/constants/status-enum');
console.log('CalHistoryStatus constants:', Object.keys(statusEnum.CalHistoryStatus));
console.log('CAL_HISTORY_STATUSES:', statusEnum.CAL_HISTORY_STATUSES);
console.log('CAL_HISTORY_TERMINAL_STATUSES:', statusEnum.CAL_HISTORY_TERMINAL_STATUSES);