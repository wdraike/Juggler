/**
 * 999.15605 — the SEAM test for the "Next Cycle Starts" fix.
 *
 * utils/saveRouting has its own unit suite, but a green pure function proves
 * nothing about which URL the hook actually calls: the bug was precisely that
 * every edit — single-task form included — went to PUT /tasks/batch, which
 * refuses nextStart. These tests drive updateTask and assert the request that
 * leaves the hook.
 *
 * Mirrors the renderHook + act(async) + apiClient-mock shape of the sibling
 * useTaskState suites.
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
  apiClient.put.mockResolvedValue({ data: {} });
});

function putUrls() {
  return apiClient.put.mock.calls.map(function(c) { return c[0]; });
}

describe('999.15605: updateTask routes by field, not by count', function() {
  test('a nextStart edit goes to PUT /tasks/:id — the endpoint wired for the anchor', async function() {
    var hook = renderHook(function() { return useTaskState(); });

    await act(async function() {
      await hook.result.current.updateTask('t1', { nextStart: '2026-09-01' });
    });

    expect(putUrls()).toEqual(['/tasks/t1']);
    expect(apiClient.put).toHaveBeenCalledWith('/tasks/t1',
      expect.objectContaining({ id: 't1', nextStart: '2026-09-01' }));
  });

  test('an ordinary edit still goes to PUT /tasks/batch', async function() {
    var hook = renderHook(function() { return useTaskState(); });

    await act(async function() {
      await hook.result.current.updateTask('t1', { text: 'clean bathrooms' });
    });

    expect(putUrls()).toEqual(['/tasks/batch']);
  });

  test('a mixed edit splits: ordinary fields batch, the anchor alone goes single', async function() {
    // The two endpoints are NOT interchangeable — PUT /tasks/:id is zod-validated
    // and rejects the edit form's own 12-hour time ("2:00 PM") and its '' for a
    // cleared field, both of which the batch route accepts; it also lacks the
    // batch path's keep-the-existing-time-of-day block and its `_timezone`
    // handling. So only the refused field peels off.
    var hook = renderHook(function() { return useTaskState(); });

    await act(async function() {
      await hook.result.current.updateTask('t1', {
        nextStart: '2026-09-01', text: 'renamed', time: '2:00 PM',
      });
    });

    expect(putUrls()).toEqual(['/tasks/batch', '/tasks/t1']);

    var batchCall = apiClient.put.mock.calls.find(function(c) { return c[0] === '/tasks/batch'; });
    batchCall[1].updates.forEach(function(u) {
      expect(u).not.toHaveProperty('nextStart');
    });
    expect(batchCall[1].updates[0]).toMatchObject({ id: 't1', text: 'renamed', time: '2:00 PM' });

    var singleCall = apiClient.put.mock.calls.find(function(c) { return c[0] === '/tasks/t1'; });
    // Nothing the single endpoint's stricter schema could reject rides along.
    expect(Object.keys(singleCall[1]).sort()).toEqual(['id', 'nextStart']);
  });

  test('a recurrence change rides WITH the anchor through the hook, not just in the helper', async function() {
    // Leaving `recur` on the batch lane makes the batch write delete the very
    // instance row the anchor write then targets — 404, anchor lost, and the
    // rollback reverts a recurrence change the server committed.
    var hook = renderHook(function() { return useTaskState(); });

    await act(async function() {
      await hook.result.current.updateTask('t1-1', {
        recur: { type: 'weekly', every: 2 }, nextStart: '2026-09-07', text: 'Haircut',
      });
    });

    var singleCall = apiClient.put.mock.calls.find(function(c) { return c[0] === '/tasks/t1-1'; });
    expect(singleCall[1]).toMatchObject({
      nextStart: '2026-09-07', recur: { type: 'weekly', every: 2 },
    });
    var batchCall = apiClient.put.mock.calls.find(function(c) { return c[0] === '/tasks/batch'; });
    expect(batchCall[1].updates[0]).not.toHaveProperty('recur');
  });

  test('when the anchor write fails, the fields the batch write SAVED are not rolled back', async function() {
    // prevFields is pruned as each lane returns, so a rejection on the second
    // write cannot revert what the first one persisted.
    apiClient.put.mockImplementation(function(url) {
      if (url === '/tasks/batch') return Promise.resolve({ data: {} });
      var err = new Error('rejected');
      err.response = { status: 400, data: { error: 'Task not found' } };
      return Promise.reject(err);
    });

    var hook = renderHook(function() { return useTaskState(); });
    await act(async function() {
      hook.result.current.dispatch({
        type: 'INIT',
        tasks: [{ id: 't1', text: 'before', nextStart: '2026-08-01' }],
        statuses: {},
      });
    });

    await act(async function() {
      await hook.result.current.updateTask('t1', { text: 'after', nextStart: '2026-09-07' });
    });

    var task = hook.result.current.taskState.tasks.find(function(t) { return t.id === 't1'; });
    expect(task.text).toBe('after');            // batch lane committed — keep it
    expect(task.nextStart).toBe('2026-08-01');  // anchor lane rejected — reverted
  });

  test('the DEBOUNCED lane keeps the anchor dirty when only its write fails', async function() {
    // The debounced autosave (card edits, AI ops) splits the same way. Clearing
    // the whole dirty map after the batch write would un-dirty the anchor the
    // singles lane has not sent yet: a rejected anchor would sit on screen with
    // nothing dirty and nothing to retry — silent loss. Dirty markers are
    // therefore cleared per lane, from that lane's own payload.
    apiClient.put.mockImplementation(function(url) {
      if (url === '/tasks/batch') return Promise.resolve({ data: {} });
      return Promise.reject(Object.assign(new Error('rejected'), {
        response: { status: 400, data: { error: 'Task not found' } },
      }));
    });

    var hook = renderHook(function() { return useTaskState(); });
    await act(async function() {
      hook.result.current.dispatch({
        type: 'INIT',
        tasks: [{ id: 't1', text: 'before', nextStart: '2026-08-01' }],
        statuses: {},
      });
    });
    await act(async function() {
      hook.result.current.dispatchPersist({
        type: 'UPDATE_TASK', id: 't1', fields: { text: 'after', nextStart: '2026-09-07' },
      });
    });
    await act(async function() {
      await hook.result.current.flushNow();
    });

    var dirty = hook.result.current.taskState._dirtyTaskIds.t1 || {};
    expect(dirty.nextStart).toBe(true);   // still pending — it can be retried
    expect(dirty.text).toBeUndefined();   // committed by the batch write
  });

  test('a rejected save returns a message with no endpoint jargon in it', async function() {
    var err = new Error('rejected');
    err.response = {
      status: 400,
      data: {
        error: 'Update item 0 (t1-1): nextStart ("Next Cycle Starts") is not supported '
          + 'in batch updates — edit it via the single-task update endpoint'
      }
    };
    apiClient.put.mockRejectedValueOnce(err);

    var hook = renderHook(function() { return useTaskState(); });
    var result;
    await act(async function() {
      result = await hook.result.current.updateTask('t1', { nextStart: '2026-09-01' });
    });

    expect(typeof result).toBe('string');
    expect(result).not.toContain('batch');
    expect(result).not.toContain('endpoint');
    expect(result).toMatch(/Next Cycle Starts/);
  });
});
