#!/usr/bin/env node

/**
 * Verify FakeClockAdapter implements ClockPort interface
 * This script validates that FakeClockAdapter satisfies the ClockPort contract
 */

'use strict';

const ClockPort = require('./juggler-backend/src/slices/scheduler/domain/ports/ClockPort');
const FakeClockAdapter = require('./juggler-backend/src/slices/scheduler/adapters/FakeClockAdapter');

console.log('=== FakeClockAdapter ClockPort Compliance Test ===\n');

// Test 1: Verify all required methods exist
console.log('Test 1: Checking required ClockPort methods...');
const adapter = new FakeClockAdapter();
const missingMethods = [];

ClockPort.CLOCK_PORT_METHODS.forEach(method => {
  if (typeof adapter[method] !== 'function') {
    missingMethods.push(method);
  }
});

if (missingMethods.length === 0) {
  console.log('✅ All required methods implemented:', ClockPort.CLOCK_PORT_METHODS.join(', '));
} else {
  console.log('❌ Missing methods:', missingMethods.join(', '));
  process.exit(1);
}

// Test 2: Verify method signatures and return types
console.log('\nTest 2: Verifying method signatures and return types...');

try {
  // Test now() - should return Date
  const nowResult = adapter.now();
  if (!(nowResult instanceof Date)) {
    throw new Error(`now() should return Date, got ${typeof nowResult}`);
  }
  console.log('✅ now() returns Date object');

  // Test dbNow() - should return Promise<Date>
  const dbNowResult = adapter.dbNow();
  if (!(dbNowResult instanceof Promise)) {
    throw new Error(`dbNow() should return Promise, got ${typeof dbNowResult}`);
  }
  
  // Resolve the promise to check the Date
  dbNowResult.then(dbDate => {
    if (!(dbDate instanceof Date)) {
      throw new Error(`dbNow() should resolve to Date, got ${typeof dbDate}`);
    }
    console.log('✅ dbNow() returns Promise<Date>');
    
    // Test 3: Verify time manipulation methods work
    console.log('\nTest 3: Verifying time manipulation methods...');
    
    const initialTime = adapter.now();
    
    // Test advance
    adapter.advance(3600000); // 1 hour
    const afterAdvance = adapter.now();
    const hourDiff = (afterAdvance - initialTime) / (1000 * 60 * 60);
    if (Math.abs(hourDiff - 1) < 0.001) {
      console.log('✅ advance(3600000) works correctly (1 hour forward)');
    } else {
      throw new Error(`advance() failed: expected 1 hour difference, got ${hourDiff} hours`);
    }
    
    // Test tick (1 minute)
    const beforeTick = adapter.now();
    adapter.tick();
    const afterTick = adapter.now();
    const minuteDiff = (afterTick - beforeTick) / (1000 * 60);
    if (Math.abs(minuteDiff - 1) < 0.001) {
      console.log('✅ tick() works correctly (1 minute forward)');
    } else {
      throw new Error(`tick() failed: expected 1 minute difference, got ${minuteDiff} minutes`);
    }
    
    // Test skipDays
    adapter.skipDays(1); // 1 day
    const afterSkip = adapter.now();
    const dayDiff = (afterSkip - afterTick) / (1000 * 60 * 60 * 24);
    if (Math.abs(dayDiff - 1) < 0.001) {
      console.log('✅ skipDays(1) works correctly (1 day forward)');
    } else {
      throw new Error(`skipDays() failed: expected 1 day difference, got ${dayDiff} days`);
    }
    
    // Test setTime
    const testDate = new Date('2026-01-01T12:00:00Z');
    adapter.setTime(testDate);
    const afterSet = adapter.now();
    if (afterSet.getTime() === testDate.getTime()) {
      console.log('✅ setTime() works correctly');
    } else {
      throw new Error(`setTime() failed: expected ${testDate}, got ${afterSet}`);
    }
    
    // Test reset
    adapter.reset();
    const afterReset = adapter.now();
    const resetDiff = Math.abs(afterReset - new Date());
    if (resetDiff < 1000) { // Within 1 second of real time
      console.log('✅ reset() works correctly (returned to real time)');
    } else {
      throw new Error(`reset() failed: expected close to real time, got ${resetDiff}ms difference`);
    }
    
    console.log('\n=== All Tests Passed! ===');
    console.log('FakeClockAdapter is fully ClockPort compliant ✅');
    
  }).catch(error => {
    console.error('❌ dbNow() test failed:', error.message);
    process.exit(1);
  });

} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}