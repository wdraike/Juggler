/**
 * useTaskState.deleteTask — blocked/failed delete must NOT remove local state
 * (zoe-w6-001, BLOCK; ernie-w6-opt-001 fix)
 *
 * deleteTask() used to dispatch DELETE_TASK (+ strip placements + mint
 * self-write tokens) BEFORE `await apiClient.delete(...)` resolved. That meant
 * a blocked/failed delete (e.g. the FR-6/AC7 CAL_LOCKED_DELETE_BLOCKED 403 on
 * a series-delete) still silently vanished the task from both the task list
 * and the calendar grid, even though the server never touched the DB — no SSE
 * fires (nothing mutated) and the version-poll is a no-op, so nothing ever
 * brings it back. This violates the NEVER-MISSING governing invariant (every
 * task is always placed|overdue|unscheduled, never absent).
 *
 * The fix (useTaskState.js:339-386) moves the DELETE_TASK dispatch, placement
 * strip, and markSelfWrite calls to AFTER `await apiClient.delete(...)`
 * resolves, and rethrows on failure so callers can react (AppLayout.jsx).
 *
 * zoe-w6-001 MUTATION-PROVEN: reverting the fix (re-inserting the
 * `idsToRemove.forEach(dispatch DELETE_TASK)` line BEFORE the `await
 * apiClient.delete(url)` call) left the full 945-test frontend suite green —
 * nothing caught the regression. These tests close that gap: they must go RED
 * against the reverted (pre-fix) code and GREEN against the current fix.
 *
 * Self-verification performed while authoring (per TEST-AUTHORING.md
 * §Regression-test self-verification): reverted useTaskState.js exactly as
 * zoe's mutation describes (dispatch moved pre-await, via a /tmp backup, never
 * `git checkout --`), reran this file — "rejected delete" test went RED
 * (task stayed removed / placement stayed stripped even though the server
 * rejected). Restored the fix from the backup and reran — GREEN. Tree
 * confirmed clean via `git diff --stat` after restore.
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
  id: 'recur-instance-1',
  text: 'Water the plants',
  status: '',
  taskType: 'recurring_instance',
  sourceId: 'recur-template-1',
  recurring: true,
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
  return renderHook(function() { return useTaskState(); });
}

beforeEach(function() {
  jest.clearAllMocks();
});

test('a REJECTED delete leaves the task and its calendar placement UNCHANGED (no DELETE_TASK dispatch fires)', async function() {
  var deleteError = new Error('blocked');
  deleteError.response = { data: { code: 'CAL_LOCKED_DELETE_BLOCKED', error: 'This series has a calendar-linked instance.' } };
  apiClient.delete.mockRejectedValue(deleteError);

  var hook = makeLoadedHook();

  await act(async function() {
    await hook.result.current.loadTasks();
  });
  await act(async function() {
    await hook.result.current.loadPlacements();
  });

  // Preconditions: guard against a vacuous pass — the task and its placement
  // must genuinely be present before we attempt the (blocked) delete.
  expect(hook.result.current.taskState.tasks.map(function(t) { return t.id; })).toEqual(['recur-instance-1']);
  expect(hook.result.current.placements.dayPlacements['2026-07-10']).toHaveLength(1);
  expect(hook.result.current.placements.dayPlacements['2026-07-10'][0].task.id).toBe('recur-instance-1');

  var thrown = null;
  await act(async function() {
    try {
      await hook.result.current.deleteTask('recur-instance-1', { cascade: 'recurring' });
    } catch (e) {
      thrown = e;
    }
  });

  // deleteTask must rethrow the server's rejection to the caller (bird-w6-002).
  expect(thrown).toBe(deleteError);

  // THE REGRESSION: the task must still be present in state, and its
  // calendar-grid placement must still be present — a blocked/failed delete
  // must not remove anything locally, because the server never mutated
  // anything. This assertion is what goes RED if DELETE_TASK is dispatched
  // before the await resolves.
  expect(hook.result.current.taskState.tasks.map(function(t) { return t.id; })).toEqual(['recur-instance-1']);
  expect(hook.result.current.placements.dayPlacements['2026-07-10']).toHaveLength(1);
  expect(hook.result.current.placements.dayPlacements['2026-07-10'][0].task.id).toBe('recur-instance-1');
});

test('a SUCCESSFUL delete still removes the task and strips its calendar placement (fix does not break the happy path)', async function() {
  apiClient.delete.mockResolvedValue({ data: {} });

  var hook = makeLoadedHook();

  await act(async function() {
    await hook.result.current.loadTasks();
  });
  await act(async function() {
    await hook.result.current.loadPlacements();
  });

  expect(hook.result.current.taskState.tasks).toHaveLength(1);
  expect(hook.result.current.placements.dayPlacements['2026-07-10']).toHaveLength(1);

  await act(async function() {
    await hook.result.current.deleteTask('recur-instance-1', { cascade: 'recurring' });
  });

  expect(hook.result.current.taskState.tasks).toHaveLength(0);
  expect(
    hook.result.current.placements.dayPlacements['2026-07-10']
      ? hook.result.current.placements.dayPlacements['2026-07-10'].length
      : 0
  ).toBe(0);
});
