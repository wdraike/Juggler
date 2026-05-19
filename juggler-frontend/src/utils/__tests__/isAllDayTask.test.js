import { isAllDayTask } from '../isAllDayTask';

// Canonical predicate tests — 5 cases per behavior spec
test('when=allday returns true', () => {
  expect(isAllDayTask({ when: 'allday' })).toBe(true);
});

test('isAllDay=true returns true', () => {
  expect(isAllDayTask({ isAllDay: true })).toBe(true);
});

test('when=morning, isAllDay=false returns false', () => {
  expect(isAllDayTask({ when: 'morning', isAllDay: false })).toBe(false);
});

test('time=null, dur=0 returns false (DayView over-broad rule dropped)', () => {
  expect(isAllDayTask({ time: null, dur: 0 })).toBe(false);
});

test('null task returns false (defensive)', () => {
  expect(isAllDayTask(null)).toBe(false);
});

test('undefined task returns false (defensive)', () => {
  expect(isAllDayTask(undefined)).toBe(false);
});

test('time=null, dur=null returns false (only canonical predicate)', () => {
  expect(isAllDayTask({ time: null, dur: null })).toBe(false);
});

test('when=allday AND isAllDay=false still returns true', () => {
  expect(isAllDayTask({ when: 'allday', isAllDay: false })).toBe(true);
});

test('isAllDay=false alone returns false', () => {
  expect(isAllDayTask({ isAllDay: false })).toBe(false);
});

test('empty object returns false', () => {
  expect(isAllDayTask({})).toBe(false);
});
