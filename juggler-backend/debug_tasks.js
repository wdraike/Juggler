const { createComprehensiveTestDataset, flattenDataset } = require('./tests/factories/comprehensive.factory');

const dataset = createComprehensiveTestDataset();
const flattened = flattenDataset(dataset);

const masters = flattened.task_masters;
console.log('Masters length:', masters.length);
console.log('First master recurring:', masters[0].recurring);
console.log('First master split:', masters[0].split);

const oneOffTasks = masters.filter(t => !t.recurring && !t.split);
console.log('One-off tasks:', oneOffTasks.length);

const recurringTasks = masters.filter(t => t.recurring);
console.log('Recurring tasks:', recurringTasks.length);

const splitTasks = masters.filter(t => t.split);
console.log('Split tasks:', splitTasks.length);