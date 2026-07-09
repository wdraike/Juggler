jest.mock('../../services/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() }
}));

import apiClient from '../../services/apiClient';
import { getTaskIcon, requestAIIcon } from '../taskIcon';

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

// 999.1239 — AI fallback must go through the shared authed apiClient (Bearer
// token + apiBase), not a bare same-origin fetch that 401s on the JWT-guarded
// task router.
test('requestAIIcon calls apiClient with the suggest-icon path and reports the icon', async () => {
  var text = 'Zylbx ai fallback text';
  expect(getTaskIcon(text)).toBeNull(); // confirm keyword miss so AI path is eligible
  apiClient.get.mockResolvedValueOnce({ data: { icon: '🎯' } });

  var onResult = jest.fn();
  requestAIIcon(text, onResult);

  expect(apiClient.get).toHaveBeenCalledWith('/tasks/suggest-icon', { params: { text: text } });
  await new Promise(function(r) { setTimeout(r, 0); });
  expect(onResult).toHaveBeenCalledWith('🎯');
  // Result is cached — the suggestion now resolves synchronously
  expect(getTaskIcon(text)).toBe('🎯');
});
