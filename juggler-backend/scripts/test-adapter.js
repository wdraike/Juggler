#!/usr/bin/env node

/**
 * Test adapter script for Juggler comprehensive test fixtures
 * This script validates that all factory integrations are working correctly
 */

const { createComprehensiveTestDataset, flattenDataset } = require('../tests/factories/comprehensive.factory');

console.log('🧪 Running Juggler Test Adapter...\n');

try {
  // Create comprehensive dataset
  console.log('📊 Creating comprehensive test dataset...');
  const dataset = createComprehensiveTestDataset();
  
  // Validate dataset structure
  console.log('✅ Dataset created successfully');
  console.log(`   Users: ${dataset.users.length}`);
  console.log(`   Projects: ${dataset.projects.length}`);
  console.log(`   Locations: ${dataset.locations.length}`);
  console.log(`   Tools: ${dataset.tools.length}`);
  console.log(`   Tasks: ${dataset.tasks.length}`);
  console.log(`   Calendar Events: ${dataset.calendarEvents.length}`);
  
  // Flatten dataset for database insertion
  console.log('\n🗃️  Flattening dataset for database...');
  const flattened = flattenDataset(dataset);
  
  console.log('✅ Dataset flattened successfully');
  console.log(`   Task Masters: ${flattened.task_masters.length}`);
  console.log(`   Task Instances: ${flattened.task_instances.length}`);
  console.log(`   Calendar Events: ${flattened.calendar_events.length}`);
  
  // Validate recurring tasks integration
  const recurringTasks = dataset.tasks.filter(task => 
    task.master && task.master.recurring === true
  );
  
  console.log('\n🔄 Recurring Rule Factory Integration:');
  console.log(`   ✅ ${recurringTasks.length} recurring tasks created`);
  
  // Check for edge cases
  const edgeCaseTasks = dataset.tasks.filter(task => 
    task.master && task.master.text && 
    (task.master.text.includes('Leap year') || task.master.text.includes('Month-end'))
  );
  
  console.log(`   ✅ ${edgeCaseTasks.length} edge case tasks included`);
  
  // Validate all required components
  const validationResults = [
    { name: 'User Factory', passed: dataset.users.length === 3 },
    { name: 'Task Factory', passed: dataset.tasks.length > 0 },
    { name: 'RecurringRule Factory', passed: recurringTasks.length > 0 },
    { name: 'CalendarEvent Factory', passed: dataset.calendarEvents.length > 0 },
    { name: 'Flattening Function', passed: flattened.task_masters.length > 0 && flattened.task_instances.length > 0 }
  ];
  
  console.log('\n📋 Factory Integration Summary:');
  let allPassed = true;
  for (const result of validationResults) {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`   ${status} ${result.name}`);
    if (!result.passed) allPassed = false;
  }
  
  if (allPassed) {
    console.log('\n🎉 All tests passed! Test gate successful.');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
  }
  
} catch (error) {
  console.error('\n❌ Test adapter failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}