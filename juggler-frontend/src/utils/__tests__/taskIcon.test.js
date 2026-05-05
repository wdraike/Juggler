import { getTaskIcon } from '../taskIcon';

test('returns null when text starts with emoji', () => {
  expect(getTaskIcon('🏃 Morning run')).toBeNull();
});
test('matches keyword run', () => {
  expect(getTaskIcon('Morning run')).toBe('🏃');
});
test('matches keyword gym', () => {
  expect(getTaskIcon('Go to gym')).toBe('💪');
});
test('matches keyword meeting (case-insensitive)', () => {
  expect(getTaskIcon('Team Meeting')).toBe('📞');
});
test('returns null for unrecognised text', () => {
  expect(getTaskIcon('Zylbx something')).toBeNull();
});
test('returns null for empty string', () => {
  expect(getTaskIcon('')).toBeNull();
});
