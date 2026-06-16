#!/usr/bin/env node

/**
 * Test FakeClockAdapter injection into RunScheduleCommand
 * This verifies that FakeClockAdapter can be properly wired into the hexagonal core
 */

'use strict';

const RunScheduleCommand = require('./juggler-backend/src/slices/scheduler/application/RunScheduleCommand');
const FakeClockAdapter = require('./juggler-backend/src/slices/scheduler/adapters/FakeClockAdapter');
const MysqlClockAdapter = require('./juggler-backend/src/slices/scheduler/adapters/MysqlClockAdapter');

console.log('=== FakeClockAdapter Injection Test ===\n');

// Test 1: Default injection (MysqlClockAdapter)
console.log('Test 1: Default clock injection...');
const defaultCommand = new RunScheduleCommand();
const defaultNow = defaultCommand.clockNow();
console.log('✅ Default clock works:', defaultNow instanceof Date);

// Test 2: FakeClockAdapter injection
console.log('\nTest 2: FakeClockAdapter injection...');
const testClock = new FakeClockAdapter({ startTime: new Date('2026-01-01T12:00:00Z') });
const fakeCommand = new RunScheduleCommand({ clock: testClock });

const injectedNow = fakeCommand.clockNow();
const expectedTime = new Date('2026-01-01T12:00:00Z');

if (injectedNow.getTime() === expectedTime.getTime()) {
  console.log('✅ FakeClockAdapter successfully injected and returns expected time');
} else {
  console.error('❌ Injection failed:', injectedNow, '!==', expectedTime);
  process.exit(1);
}

// Test 3: Time manipulation through injected clock
console.log('\nTest 3: Time manipulation through injected clock...');
testClock.advance(3600000); // 1 hour forward
const afterAdvance = fakeCommand.clockNow();
expectedTime.setHours(expectedTime.getHours() + 1);

if (afterAdvance.getTime() === expectedTime.getTime()) {
  console.log('✅ Time manipulation works through injected FakeClockAdapter');
} else {
  console.error('❌ Time manipulation failed:', afterAdvance, '!==', expectedTime);
  process.exit(1);
}

// Test 4: Verify clock instance is used consistently
console.log('\nTest 4: Clock instance consistency...');
if (fakeCommand.clock === testClock) {
  console.log('✅ Injected clock instance is used consistently');
} else {
  console.error('❌ Clock instance mismatch');
  process.exit(1);
}

console.log('\n=== All Injection Tests Passed! ===');
console.log('FakeClockAdapter can be successfully injected into hexagonal components ✅');