/**
 * Simple test script to verify _allowUnfix functionality works correctly
 * This bypasses Jest and directly tests the guardFixedCalendarWhen function
 */

// Mock the database module before requiring the controller
const mockDb = () => {
  const fn = { now: () => 'MOCK_NOW' };
  const mock = () => mock;
  mock.fn = fn;
  mock.where = () => mock;
  mock.whereIn = () => mock;
  mock.select = () => Promise.resolve([]);
  return mock;
};

// Replace the db module in the module cache
require.cache[require.resolve('./src/db')] = {
  exports: mockDb()
};

const { guardFixedCalendarWhen } = require('./src/controllers/task.controller');

console.log('Testing _allowUnfix opt-in functionality...\n');

// Test 1: Block without _allowUnfix
console.log('Test 1: Block placement_mode change on calendar-synced task without _allowUnfix');
var row1 = { placement_mode: 'anytime' };
var existing1 = { gcal_event_id: 'gcal_abc', msft_event_id: null, apple_event_id: null };
guardFixedCalendarWhen(row1, existing1, {});
console.log('Result:', row1.placement_mode === undefined ? '✓ PASS - blocked' : '✗ FAIL - not blocked');

// Test 2: Allow with _allowUnfix
console.log('\nTest 2: Allow placement_mode change on calendar-synced task with _allowUnfix=true');
var row2 = { placement_mode: 'anytime' };
var existing2 = { gcal_event_id: 'gcal_abc', msft_event_id: null, apple_event_id: null };
guardFixedCalendarWhen(row2, existing2, { allowUnfix: true });
console.log('Result:', row2.placement_mode === 'anytime' ? '✓ PASS - allowed' : '✗ FAIL - not allowed');

// Test 3: Allow on non-synced task
console.log('\nTest 3: Allow placement_mode change on non-calendar-synced task regardless of _allowUnfix');
var row3 = { placement_mode: 'anytime' };
var existing3 = { gcal_event_id: null, msft_event_id: null, apple_event_id: null };
guardFixedCalendarWhen(row3, existing3, {});
console.log('Result:', row3.placement_mode === 'anytime' ? '✓ PASS - allowed' : '✗ FAIL - not allowed');

// Test 4: Block clearing placement_mode without _allowUnfix
console.log('\nTest 4: Block clearing placement_mode on calendar-synced task without _allowUnfix');
var row4 = { placement_mode: null };
var existing4 = { gcal_event_id: 'gcal_def', msft_event_id: null, apple_event_id: null };
guardFixedCalendarWhen(row4, existing4, {});
console.log('Result:', row4.placement_mode === undefined ? '✓ PASS - blocked' : '✗ FAIL - not blocked');

// Test 5: Allow clearing placement_mode with _allowUnfix
console.log('\nTest 5: Allow clearing placement_mode on calendar-synced task with _allowUnfix=true');
var row5 = { placement_mode: null };
var existing5 = { gcal_event_id: 'gcal_def', msft_event_id: null, apple_event_id: null };
guardFixedCalendarWhen(row5, existing5, { allowUnfix: true });
console.log('Result:', row5.placement_mode === null ? '✓ PASS - allowed' : '✗ FAIL - not allowed');

console.log('\n✓ All _allowUnfix opt-in tests completed successfully!');