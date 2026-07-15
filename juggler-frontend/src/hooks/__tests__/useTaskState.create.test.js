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
//
// 999.1571 — a rejected MULTI-task addTasks() batch (ICS import, multi-op AI
// ops) used to REMOVE_TASKS every optimistically-added task, discarding the
// user's whole batch with no way back and no aggregate failure count (only
// a generic single-slot toast message). Bulk (N>1) failures now PRESERVE the
// tasks in state (flagged `_addFailed: true`) instead of vanishing them, and
// surface one aggregate "N of M tasks failed to save" message. A single-task
// addTasks() call (N=1 — e.g. a lone AI 'add' op) keeps the pre-existing
// rollback-on-failure behavior; see AppLayout.aiOpsRollback.test.jsx's
// ratified last-write-wins contract, which this lane does not touch.
// ---------------------------------------------------------------------------

describe('addTasks', function() {
  var BULK_TASKS = [
    { id: 'bulk-1', text: 'Bulk task one', taskType: 'one-off', date: '2026-07-12' },
    { id: 'bulk-2', text: 'Bulk task two', taskType: 'one-off', date: '2026-07-12' }
  ];

  test('999.1571 AC-a: a REJECTED POST /tasks/batch with MULTIPLE tasks preserves them in state, flagged _addFailed', async function() {
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

    var tasks = hook.result.current.taskState.tasks;
    var bulk1 = tasks.find(function(t) { return t.id === 'bulk-1'; });
    var bulk2 = tasks.find(function(t) { return t.id === 'bulk-2'; });
    expect(bulk1).toBeTruthy();
    expect(bulk2).toBeTruthy();
    expect(bulk1._addFailed).toBe(true);
    expect(bulk2._addFailed).toBe(true);
  });

  test('999.1571 AC-b: a REJECTED POST /tasks/batch with MULTIPLE tasks invokes opts.onError with an aggregate "N of M" message', async function() {
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
    expect(onError.mock.calls[0][0]).toMatch(/^2 of 2 tasks failed to save/);
  });

  test('regression guard: single-task (N=1) addTasks failure still rolls back (ratified AppLayout.aiOpsRollback contract, unchanged)', async function() {
    var serverError = new Error('rejected');
    serverError.response = { status: 500, data: { error: 'Could not add tasks — change reverted' } };
    apiClient.post.mockImplementation(function(url) {
      if (url === '/tasks/batch') return Promise.reject(serverError);
      return Promise.resolve({ data: {} });
    });

    var hook = renderHook(function() { return useTaskState(); });
    var onError = jest.fn();
    var soloTask = { id: 'solo-1', text: 'Solo add', taskType: 'one-off', date: '2026-07-12' };

    await act(async function() {
      await hook.result.current.addTasks([soloTask], { onError: onError });
    });

    var ids = hook.result.current.taskState.tasks.map(function(t) { return t.id; });
    expect(ids).not.toContain('solo-1');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('Could not add tasks — change reverted');
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

// ---------------------------------------------------------------------------
// retryAddTasks (999.1571 AC-c) — cheap retry of the failed subset preserved
// by the bulk addTasks() path above, reusing the same POST /tasks/batch +
// success/failure plumbing.
// ---------------------------------------------------------------------------

describe('retryAddTasks', function() {
  var BULK_TASKS = [
    { id: 'bulk-1', text: 'Bulk task one', taskType: 'one-off', date: '2026-07-12' },
    { id: 'bulk-2', text: 'Bulk task two', taskType: 'one-off', date: '2026-07-12' }
  ];

  test('retrying a failed subset that now SUCCEEDS clears _addFailed and keeps the tasks in state', async function() {
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
    var afterFail = hook.result.current.taskState.tasks.find(function(t) { return t.id === 'bulk-1'; });
    expect(afterFail._addFailed).toBe(true);

    apiClient.post.mockImplementation(function(url) {
      if (url === '/tasks/batch') return Promise.resolve({ data: {} });
      return Promise.resolve({ data: {} });
    });

    await act(async function() {
      await hook.result.current.retryAddTasks(['bulk-1', 'bulk-2']);
    });

    var tasks = hook.result.current.taskState.tasks;
    var bulk1 = tasks.find(function(t) { return t.id === 'bulk-1'; });
    var bulk2 = tasks.find(function(t) { return t.id === 'bulk-2'; });
    expect(bulk1).toBeTruthy();
    expect(bulk2).toBeTruthy();
    expect(bulk1._addFailed).toBe(false);
    expect(bulk2._addFailed).toBe(false);
  });

  test('retrying a failed subset that FAILS AGAIN re-flags _addFailed and invokes onError again', async function() {
    var serverError = new Error('rejected');
    serverError.response = { status: 500, data: { error: 'still broken' } };
    apiClient.post.mockImplementation(function(url) {
      if (url === '/tasks/batch') return Promise.reject(serverError);
      return Promise.resolve({ data: {} });
    });

    var hook = renderHook(function() { return useTaskState(); });
    await act(async function() {
      await hook.result.current.addTasks(BULK_TASKS.map(function(t) { return Object.assign({}, t); }));
    });

    var onError = jest.fn();
    await act(async function() {
      await hook.result.current.retryAddTasks(['bulk-1', 'bulk-2'], { onError: onError });
    });

    var tasks = hook.result.current.taskState.tasks;
    expect(tasks.find(function(t) { return t.id === 'bulk-1'; })._addFailed).toBe(true);
    expect(tasks.find(function(t) { return t.id === 'bulk-2'; })._addFailed).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/^2 of 2 tasks failed to save/);
  });

  test('retrying with no matching _addFailed tasks is a no-op (does not call the API)', async function() {
    apiClient.post.mockResolvedValue({ data: {} });
    var hook = renderHook(function() { return useTaskState(); });

    await act(async function() {
      await hook.result.current.retryAddTasks(['not-a-real-id']);
    });

    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// _addFailed phantoms — edit persistence (999.1571, harrison WARN-2).
// A phantom task (preserved after a failed bulk add) does not exist on the
// server: a PUT /tasks/batch for its id UPDATEs 0 rows and returns 200, so
// the old behavior silently dropped the edit AND cleared the dirty flag.
// Edits to a phantom must stay local and ride along with retryAddTasks.
// ---------------------------------------------------------------------------

describe('_addFailed phantom edits (999.1571 WARN-2)', function() {
  var BULK_TASKS = [
    { id: 'bulk-1', text: 'Bulk task one', taskType: 'one-off', date: '2026-07-12' },
    { id: 'bulk-2', text: 'Bulk task two', taskType: 'one-off', date: '2026-07-12' }
  ];

  async function renderWithFailedBulkAdd() {
    var serverError = new Error('rejected');
    serverError.response = { status: 500, data: { error: 'server down' } };
    apiClient.post.mockImplementation(function(url) {
      if (url === '/tasks/batch') return Promise.reject(serverError);
      return Promise.resolve({ data: {} });
    });
    var hook = renderHook(function() { return useTaskState(); });
    await act(async function() {
      await hook.result.current.addTasks(BULK_TASKS.map(function(t) { return Object.assign({}, t); }));
    });
    return hook;
  }

  test('updateTask on an _addFailed task applies the edit locally WITHOUT a PUT (no phantom 0-row update)', async function() {
    var hook = await renderWithFailedBulkAdd();
    apiClient.put.mockResolvedValue({ data: {} });

    var result;
    await act(async function() {
      result = await hook.result.current.updateTask('bulk-1', { text: 'Edited offline' });
    });

    expect(apiClient.put).not.toHaveBeenCalled();
    expect(result).toBe(true);
    var edited = hook.result.current.taskState.tasks.find(function(t) { return t.id === 'bulk-1'; });
    expect(edited.text).toBe('Edited offline');
    expect(edited._addFailed).toBe(true);
  });

  test('retryAddTasks after a local edit POSTs the EDITED field values', async function() {
    var hook = await renderWithFailedBulkAdd();

    await act(async function() {
      await hook.result.current.updateTask('bulk-1', { text: 'Edited offline' });
    });

    apiClient.post.mockClear();
    apiClient.post.mockResolvedValue({ data: {} });
    await act(async function() {
      await hook.result.current.retryAddTasks(['bulk-1', 'bulk-2']);
    });

    expect(apiClient.post).toHaveBeenCalledTimes(1);
    var sent = apiClient.post.mock.calls[0][1].tasks;
    expect(sent.find(function(t) { return t.id === 'bulk-1'; }).text).toBe('Edited offline');
    var after = hook.result.current.taskState.tasks;
    expect(after.find(function(t) { return t.id === 'bulk-1'; })._addFailed).toBe(false);
  });
});
