/**
 * useTaskState.createTask / addTasks — a REJECTED POST must roll back the
 * optimistic add + surface the failure (999.1544 / BUG-999.1544).
 *
 * createTask() (useTaskState.js:425-434) and addTasks() (344-353) both
 * dispatch ADD_TASKS optimistically BEFORE `await apiClient.post(...)`
 * resolves, and on rejection only `console.error(...)` — no rollback
 * dispatch, no onError callback, no retry. Contrast with updateTask
 * (294-342) and setStatus (225-292), which already capture pre-state and
 * roll back + call `opts.onError` on rejection (863e7e6c, 999.1225,
 * JUG-UI-FEEDBACK-STANDARD).
 *
 * STEP-0 RED (telly, before any fix): this suite encodes the DESIRED
 * end-state behavior against the CURRENT (unfixed) createTask/addTasks.
 * Neither function takes an `opts` param today — the onError assertions
 * fail because the callback is simply never invoked (JS silently ignores
 * the extra argument; this is NOT a TypeError), which is the correct RED
 * shape per the dispatch note. bert's fix must:
 *   - add an `opts = {}` param to both, mirroring setStatus's
 *     `(id, val, opts = {})` shape (AC2/AC-addTasks-analog,
 *     INTAKE-BRIEF.json)
 *   - dispatch a REMOVE_TASKS rollback (taskReducer.js:117-127) on
 *     rejection, guarded the same way updateTask/setStatus guard theirs
 *     (AC1)
 *   - wire AppLayout.jsx's handleCreate (1002-1006, currently an
 *     unconditional success toast) to the new onError (AC3 — NOT covered by
 *     this hook-level suite; see TELLY-REVIEW.md note)
 *
 * Mirrors the renderHook + act(async) + apiClient-mock shape proven in
 * ./useTaskState.status.test.js / ./useTaskState.delete.test.js.
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

beforeEach(function() {
  jest.clearAllMocks();
  // Neither createTask nor addTasks needs loadTasks() first — both operate
  // directly on TASK_STATE_INIT (tasks: []); no apiClient.get stub needed.
});

// ---------------------------------------------------------------------------
// createTask (useTaskState.js:425-434)
// ---------------------------------------------------------------------------

describe('createTask', function() {
  var NEW_TASK = {
    id: 'new-task-1',
    text: 'Water the plants',
    taskType: 'one-off',
    date: '2026-07-12',
    time: '9:00 AM',
    dur: 30
  };

  test('AC1: a REJECTED POST /tasks removes the optimistically-added task from state', async function() {
    var serverError = new Error('rejected');
    serverError.response = { status: 500, data: { error: 'Could not create task — server error.' } };
    apiClient.post.mockImplementation(function(url) {
      if (url === '/tasks') return Promise.reject(serverError);
      return Promise.resolve({ data: {} });
    });

    var hook = renderHook(function() { return useTaskState(); });

    // Precondition (guards against a vacuous pass): task absent before the call.
    expect(hook.result.current.taskState.tasks.some(function(t) { return t.id === 'new-task-1'; })).toBe(false);

    await act(async function() {
      await hook.result.current.createTask(Object.assign({}, NEW_TASK));
    });

    // THE BUG: createTask has no rollback today, so the optimistically-added
    // task remains in state forever even though the server rejected it.
    expect(hook.result.current.taskState.tasks.some(function(t) { return t.id === 'new-task-1'; })).toBe(false);
  });

  test('AC2: a REJECTED POST /tasks invokes opts.onError with the server error message', async function() {
    var serverError = new Error('rejected');
    serverError.response = { status: 500, data: { error: 'Could not create task — server error.' } };
    apiClient.post.mockImplementation(function(url) {
      if (url === '/tasks') return Promise.reject(serverError);
      return Promise.resolve({ data: {} });
    });

    var hook = renderHook(function() { return useTaskState(); });
    var onError = jest.fn();

    await act(async function() {
      await hook.result.current.createTask(Object.assign({}, NEW_TASK), { onError: onError });
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('Could not create task — server error.');
  });

  test('AC4 (regression guard): a SUCCESSFUL POST /tasks keeps the task in state and does NOT invoke onError', async function() {
    apiClient.post.mockResolvedValue({ data: {} });

    var hook = renderHook(function() { return useTaskState(); });
    var onError = jest.fn();

    await act(async function() {
      await hook.result.current.createTask(Object.assign({}, NEW_TASK), { onError: onError });
    });

    expect(hook.result.current.taskState.tasks.some(function(t) { return t.id === 'new-task-1'; })).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addTasks (bulk path — same bug shape, useTaskState.js:344-353)
// ---------------------------------------------------------------------------

describe('addTasks', function() {
  var BULK_TASKS = [
    { id: 'bulk-1', text: 'Bulk task one', taskType: 'one-off', date: '2026-07-12' },
    { id: 'bulk-2', text: 'Bulk task two', taskType: 'one-off', date: '2026-07-12' }
  ];

  test('a REJECTED POST /tasks/batch removes the optimistically-added tasks from state', async function() {
    var serverError = new Error('rejected');
    serverError.response = { status: 500, data: { error: 'Could not add tasks — server error.' } };
    apiClient.post.mockImplementation(function(url) {
      if (url === '/tasks/batch') return Promise.reject(serverError);
      return Promise.resolve({ data: {} });
    });

    var hook = renderHook(function() { return useTaskState(); });

    await act(async function() {
      await hook.result.current.addTasks(BULK_TASKS.map(function(t) { return Object.assign({}, t); }));
    });

    var ids = hook.result.current.taskState.tasks.map(function(t) { return t.id; });
    expect(ids).not.toContain('bulk-1');
    expect(ids).not.toContain('bulk-2');
  });

  test('a REJECTED POST /tasks/batch invokes opts.onError with the server error message', async function() {
    var serverError = new Error('rejected');
    serverError.response = { status: 500, data: { error: 'Could not add tasks — server error.' } };
    apiClient.post.mockImplementation(function(url) {
      if (url === '/tasks/batch') return Promise.reject(serverError);
      return Promise.resolve({ data: {} });
    });

    var hook = renderHook(function() { return useTaskState(); });
    var onError = jest.fn();

    await act(async function() {
      await hook.result.current.addTasks(BULK_TASKS.map(function(t) { return Object.assign({}, t); }), { onError: onError });
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('Could not add tasks — server error.');
  });

  test('regression guard: a SUCCESSFUL POST /tasks/batch keeps both tasks in state and does NOT invoke onError', async function() {
    apiClient.post.mockResolvedValue({ data: {} });

    var hook = renderHook(function() { return useTaskState(); });
    var onError = jest.fn();

    await act(async function() {
      await hook.result.current.addTasks(BULK_TASKS.map(function(t) { return Object.assign({}, t); }), { onError: onError });
    });

    var ids = hook.result.current.taskState.tasks.map(function(t) { return t.id; });
    expect(ids).toContain('bulk-1');
    expect(ids).toContain('bulk-2');
    expect(onError).not.toHaveBeenCalled();
  });
});
