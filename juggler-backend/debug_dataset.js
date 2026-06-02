const { createComprehensiveTestDataset, flattenDataset } = require('./tests/factories/comprehensive.factory');

const dataset = createComprehensiveTestDataset();
const flattened = flattenDataset(dataset);

console.log('Dataset tasks length:', dataset.tasks.length);
console.log('First task:', JSON.stringify(dataset.tasks[0], null, 2));
console.log('Flattened task_masters length:', flattened.task_masters.length);
console.log('Flattened task_instances length:', flattened.task_instances.length);
console.log('First master:', JSON.stringify(flattened.task_masters[0], null, 2));
console.log('First instance:', JSON.stringify(flattened.task_instances[0], null, 2));