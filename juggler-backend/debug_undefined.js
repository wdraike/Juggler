const { createComprehensiveTestDataset, flattenDataset } = require('./tests/factories/comprehensive.factory');

const dataset = createComprehensiveTestDataset();
const flattened = flattenDataset(dataset);

const masters = flattened.task_masters;
console.log('Masters length:', masters.length);
console.log('First 10 masters:');
for (let i = 0; i < 10; i++) {
  console.log(`  [${i}]:`, masters[i] ? 'defined' : 'undefined');
}

// Check what's in the original dataset
console.log('Dataset tasks length:', dataset.tasks.length);
console.log('First 10 dataset tasks:');
for (let i = 0; i < 10; i++) {
  console.log(`  [${i}]:`, dataset.tasks[i] ? (dataset.tasks[i].master ? 'has master' : 'no master') : 'undefined');
}