const s = require('./src/lib/task-status');
console.log('STATUS_OPTIONS:', s.STATUS_OPTIONS);
console.log('isTerminalStatus(missed):', s.isTerminalStatus('missed'));