import { isAllDayTask } from '../isAllDayTask';

// Canonical predicate tests — placement_mode-based contract (Phase 15+)
// Legacy when='allday' fallback was removed in the jug-placement-mode-finalize refactor.
// All-day detection now requires placement_mode='all_day' or isAllDay=true.

// placement_mode (camelCase) — primary frontend contract
test('placementMode=all_day returns true', () => {
  expect(isAllDayTask({ placementMode: 'all_day' })).toBe(true);
});

// placement_mode (snake_case) — from backend DB rows
test('placement_mode=all_day returns true (snake_case from backend)', () => {
  expect(isAllDayTask({ placement_mode: 'all_day' })).toBe(true);
});

test('isAllDay=true returns true', () => {
  expect(isAllDayTask({ isAllDay: true })).toBe(true);
});

test('when=morning, isAllDay=false returns false', () => {
  expect(isAllDayTask({ when: 'morning', isAllDay: false })).toBe(false);
});

// Legacy when='allday' is no longer a sufficient indicator (fallback removed)
test('when=allday alone returns false (legacy fallback removed)', () => {
  expect(isAllDayTask({ when: 'allday' })).toBe(false);
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

// when=allday without placement_mode=all_day is no longer sufficient
test('when=allday AND isAllDay=false returns false (legacy fallback removed)', () => {
  expect(isAllDayTask({ when: 'allday', isAllDay: false })).toBe(false);
});

// when=allday WITH placement_mode=all_day returns true
test('placement_mode=all_day AND when=allday returns true', () => {
  expect(isAllDayTask({ placement_mode: 'all_day', when: 'allday' })).toBe(true);
});

test('isAllDay=false alone returns false', () => {
  expect(isAllDayTask({ isAllDay: false })).toBe(false);
});

test('empty object returns false', () => {
  expect(isAllDayTask({})).toBe(false);
});
