/**
 * useTaskState — load/autosave failure reporting (999.1594)
 *
 * loadTasks (initial task load) and flushSave (the debounced autosave) used
 * to swallow rejections with console.error only: a failed loadTasks silently
 * rendered an empty task list with no explanation, and a failed flushSave
 * silently left edits unpersisted with nothing telling the user their change
 * wasn't actually saved. Both now report through an onError callback
 * (mirroring useConfig's 999.1225 onSaveError), which AppLayout wires to
 * showToast.
 */

import { renderHook, act } from '@testing-library/react';
import useTaskState from '../useTaskState';

jest.mock('../../services/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn()
  },
  TZ_OVERRIDE_KEY: 'juggler-tz-override',
  USER_TZ_KEY: 'juggler-user-tz',
  getAccessToken: jest.fn(() => null)
}));

import apiClient from '../../services/apiClient';

beforeEach(() => {
  jest.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: {} });
  apiClient.post.mockResolvedValue({ data: {} });
});

test('loadTasks() reports a visible error via onError when the fetch fails, instead of failing silently', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/tasks') return Promise.reject(new Error('boom'));
    return Promise.resolve({ data: {} });
  });
  const onError = jest.fn();
  const { result } = renderHook(() => useTaskState(onError));

  await act(async () => {
    await result.current.loadTasks();
  });

  expect(onError).toHaveBeenCalledWith(
    'Failed to load your tasks — please refresh the page.',
    expect.any(Error)
  );
});

test('loadTasks() does NOT invoke onError on a successful load (happy path unbroken)', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/tasks') return Promise.resolve({ data: { tasks: [] } });
    return Promise.resolve({ data: {} });
  });
  const onError = jest.fn();
  const { result } = renderHook(() => useTaskState(onError));

  await act(async () => {
    await result.current.loadTasks();
  });

  expect(onError).not.toHaveBeenCalled();
});

test('flushSave (debounced autosave) reports a visible error via onError when the save PUT fails', async () => {
  apiClient.get.mockImplementation((url) => {
    if (url === '/tasks') return Promise.resolve({ data: { tasks: [{ id: 'task-1', text: 'A' }] } });
    return Promise.resolve({ data: {} });
  });
  apiClient.put.mockRejectedValue(new Error('save boom'));
  const onError = jest.fn();
  const { result } = renderHook(() => useTaskState(onError));

  await act(async () => {
    await result.current.loadTasks();
  });

  act(() => {
    result.current.dispatch({ type: 'UPDATE_TASK', id: 'task-1', fields: { text: 'B' } });
  });

  await act(async () => {
    await result.current.flushNow();
  });

  expect(onError).toHaveBeenCalledWith(
    'Failed to save your changes — please retry.',
    expect.any(Error)
  );
});
