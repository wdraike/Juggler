/**
 * useTaskState.setStatus — rejected status save must revert the optimistic
 * status and surface the failure (999.1225 / JUG-UI-OPTIMISTIC-ROLLBACK).
 *
 * setStatus() used to dispatch SET_STATUS optimistically and then
 * `.catch(err => console.error(...))` the PUT /tasks/:id/status — no toast, no
 * rollback. A Done/Cancelled checkmark persisted visually while the server
 * never recorded it (the sibling updateTask() already captured pre-values and
 * rolled back — the pattern existed right next door, useTaskState.js REG-44/F3).
 *
 * The fix captures the pre-change status (+ the pre-values of opts.taskFields)
 * BEFORE the optimistic dispatch, and on rejection: re-dispatches SET_STATUS
 * with the previous value (guarded by a per-task statusSeqRef so a newer
 * in-flight status write is never clobbered), clears the dirty markers it
 * minted, and invokes opts.onError with the server's error body so the caller
 * (AppLayout) can toast it.
 *
 * Mirrors the renderHook + act(async) + apiClient-mock shape proven in
 * ./useTaskState.delete.test.js.
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

var TASK_FIXTURE = {
  id: 'task-1',
  text: 'Water the plants',
  status: '',
  taskType: 'one-off',
  date: '2026-07-10',
  time: '9:00 AM',
  dur: 30
};

function makeLoadedHook() {
  apiClient.get.mockImplementation(function(url) {
    if (url === '/tasks') {
      return Promise.resolve({ data: { tasks: [Object.assign({}, TASK_FIXTURE)], version: 1 } });
    }
    if (url === '/config') return Promise.resolve({ data: {} });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValue({ data: {} });
  return renderHook(function() { return useTaskState(); });
}

beforeEach(function() {
  jest.clearAllMocks();
});

test('a REJECTED status save reverts the optimistic status + task field and surfaces the server error via opts.onError', async function() {
  var statusError = new Error('rejected');
  statusError.response = { status: 403, data: { error: 'Task is calendar-locked and cannot be completed here.' } };
  apiClient.put.mockImplementation(function(url) {
    if (url === '/tasks/task-1/status') return Promise.reject(statusError);
    return Promise.resolve({ data: {} });
  });

  var hook = makeLoadedHook();
  await act(async function() {
    await hook.result.current.loadTasks();
  });

  // Precondition (guards against a vacuous pass): task starts un-done.
  expect(hook.result.current.taskState.statuses['task-1']).toBeUndefined();
  expect(hook.result.current.taskState.tasks[0].status).toBe('');

  var onError = jest.fn();
  await act(async function() {
    hook.result.current.setStatus('task-1', 'done', {
      taskFields: { status: 'done' },
      onError: onError
    });
    // Let the PUT rejection + rollback dispatches flush.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  // THE REGRESSION: the optimistic Done must have been rolled back — both the
  // statuses map and the task's own status field — because the server never
  // recorded it. Pre-fix code left statuses['task-1'] === 'done' forever.
  expect(hook.result.current.taskState.statuses['task-1']).toBeUndefined();
  expect(hook.result.current.taskState.tasks[0].status).toBe('');

  // The rollback must clear the dirty markers it minted so the debounced
  // flushSave doesn't re-send the reverted value.
  expect((hook.result.current.taskState._dirtyStatuses || {})['task-1']).toBeUndefined();

  // And the failure must be surfaced, with the server's own message.
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0][0]).toBe('Task is calendar-locked and cannot be completed here.');
});

test('a SUCCESSFUL status save keeps the optimistic status and does NOT invoke onError (happy path unbroken)', async function() {
  apiClient.put.mockResolvedValue({ data: {} });

  var hook = makeLoadedHook();
  await act(async function() {
    await hook.result.current.loadTasks();
  });

  var onError = jest.fn();
  await act(async function() {
    hook.result.current.setStatus('task-1', 'done', {
      taskFields: { status: 'done' },
      onError: onError
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(hook.result.current.taskState.statuses['task-1']).toBe('done');
  expect(hook.result.current.taskState.tasks[0].status).toBe('done');
  expect(onError).not.toHaveBeenCalled();
});

test('a rejected status save does NOT roll back when a NEWER status write for the same task is already in flight (seq guard)', async function() {
  // First write (-> 'done') rejects SLOWLY; second write (-> 'cancel')
  // resolves. The stale rejection must not clobber the newer 'cancel'.
  var rejectFirst;
  var firstCall = true;
  apiClient.put.mockImplementation(function(url) {
    if (url === '/tasks/task-1/status') {
      if (firstCall) {
        firstCall = false;
        return new Promise(function(resolve, reject) { rejectFirst = reject; });
      }
      return Promise.resolve({ data: {} });
    }
    return Promise.resolve({ data: {} });
  });

  var hook = makeLoadedHook();
  await act(async function() {
    await hook.result.current.loadTasks();
  });

  var onError = jest.fn();
  await act(async function() {
    hook.result.current.setStatus('task-1', 'done', { onError: onError });
    hook.result.current.setStatus('task-1', 'cancel', { onError: onError });
    await Promise.resolve();
  });

  // Now the FIRST (stale) write fails — the newer 'cancel' must survive.
  await act(async function() {
    var err = new Error('stale rejection');
    err.response = { status: 500, data: { error: 'boom' } };
    rejectFirst(err);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(hook.result.current.taskState.statuses['task-1']).toBe('cancel');
  // The failure is still surfaced even though no rollback fired.
  expect(onError).toHaveBeenCalledTimes(1);
});
