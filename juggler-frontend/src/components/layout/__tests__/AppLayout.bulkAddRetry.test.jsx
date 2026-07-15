/**
 * AppLayout — bulk-add retry affordance (999.1631, follow-up to 999.1571).
 *
 * 999.1571 built useTaskState's retryAddTasks + `_addFailed` preserve-on-
 * failure state layer for a rejected BULK (N>1) addTasks() POST, but left it
 * with no production caller: AppLayout destructured `addTasks` but never
 * `retryAddTasks`, and the aggregate "N of M tasks failed to save" toast had
 * no action button. This test wires handleAiOps's bulk 'add' path (the same
 * seam AppLayout.aiOpsRollback.test.jsx exercises for the N=1 rollback case)
 * to pass a real ToastNotification "Retry" action that re-invokes
 * retryAddTasks with exactly the ids of the tasks that just failed.
 *
 * Harness cloned from AppLayout.aiOpsRollback.test.jsx: HeaderBar mocked to
 * render its `aiPanel` prop, AiCommandPanel mocked to a trigger button that
 * fires TWO 'add' ops (N>1 — the bulk/preserve path, not the N=1 rollback
 * path already covered by aiOpsRollback.test.jsx).
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import AppLayout from '../AppLayout';

jest.setTimeout(30000);

jest.mock('../../../services/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn()
  },
  TZ_OVERRIDE_KEY: 'juggler-tz-override',
  USER_TZ_KEY: 'juggler-user-tz',
  getAccessToken: jest.fn(() => null),
  setAccessToken: jest.fn(),
  clearAccessToken: jest.fn()
}));

jest.mock('../../auth/AuthProvider', () => ({
  __esModule: true,
  useAuth: () => ({
    user: { id: 'u1', name: 'Test User' },
    loading: false,
    isAuthenticated: true,
    login: jest.fn(),
    logout: jest.fn()
  })
}));

// View layer is not the seam under test — stub with a live task-text readout
// so the preserved (not rolled back) bulk-add phantoms are observable.
jest.mock('../../views/ListView', () => ({
  __esModule: true,
  default: function MockListView(props) {
    return (
      <div data-testid="task-texts">
        {(props.allTasks || []).map(function(t) { return t.text; }).join(',')}
      </div>
    );
  }
}));

jest.mock('../HeaderBar', () => ({
  __esModule: true,
  default: function MockHeaderBar(props) {
    return <div>{props.aiPanel}</div>;
  }
}));

// Fires TWO 'add' ops per click — the bulk (N>1) preserve-on-failure path.
jest.mock('../../features/AiCommandPanel', () => ({
  __esModule: true,
  default: function MockAiCommandPanel(props) {
    return (
      <button
        onClick={function() {
          props.onApplyOps(
            [
              { op: 'add', task: { id: 'ai001', text: 'Follow up with client', taskType: 'one-off', date: '2026-07-15' } },
              { op: 'add', task: { id: 'ai002', text: 'Draft the proposal', taskType: 'one-off', date: '2026-07-16' } }
            ],
            'AI: 2 changes applied'
          );
        }}
      >
        mock-trigger-ai-ops
      </button>
    );
  }
}));

import apiClient from '../../../services/apiClient';

async function flush() {
  await act(async function() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(function() {
  jest.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('juggler-ui-state', JSON.stringify({ viewMode: 'list' }));

  window.matchMedia = window.matchMedia || function() {
    return { matches: false, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn() };
  };

  apiClient.get.mockImplementation(function(url) {
    if (url === '/tasks') return Promise.resolve({ data: { tasks: [], version: 1 } });
    if (url === '/config') return Promise.resolve({ data: {} });
    if (url === '/now') return Promise.resolve({ data: { epochMs: Date.now() } });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValue({ data: {} });
  apiClient.put.mockResolvedValue({ data: {} });
  apiClient.delete.mockResolvedValue({ data: {} });
});

test('a rejected bulk addTasks POST (AI ops, N=2) shows the aggregate error toast with a Retry action, and the phantoms survive', async function() {
  var serverError = new Error('rejected');
  serverError.response = { status: 500, data: { error: 'db unavailable' } };
  apiClient.post.mockImplementation(function(url) {
    if (url === '/tasks/batch') return Promise.reject(serverError);
    return Promise.resolve({ data: {} });
  });

  render(<AppLayout />);
  await flush();

  fireEvent.click(screen.getByText('mock-trigger-ai-ops'));
  await flush();

  await waitFor(function() {
    expect(screen.getByText(/2 of 2 tasks failed to save/)).toBeInTheDocument();
  }, { timeout: 5000 });

  // Preserved, not rolled back (999.1571 preserve-on-failure for N>1).
  expect(screen.getByTestId('task-texts')).toHaveTextContent('Follow up with client');
  expect(screen.getByTestId('task-texts')).toHaveTextContent('Draft the proposal');

  // A real Retry action button on the ToastNotification.
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

test('clicking Retry re-POSTs exactly the failed subset via retryAddTasks, and a subsequent success clears the failure', async function() {
  var serverError = new Error('rejected');
  serverError.response = { status: 500, data: { error: 'db unavailable' } };
  var batchCallCount = 0;
  apiClient.post.mockImplementation(function(url, body) {
    if (url === '/tasks/batch') {
      batchCallCount++;
      if (batchCallCount === 1) return Promise.reject(serverError);
      return Promise.resolve({ data: {} });
    }
    return Promise.resolve({ data: {} });
  });

  render(<AppLayout />);
  await flush();

  fireEvent.click(screen.getByText('mock-trigger-ai-ops'));
  await flush();

  var retryBtn = await screen.findByRole('button', { name: 'Retry' });

  await act(async function() {
    fireEvent.click(retryBtn);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  // Exactly two POST /tasks/batch calls: the original bulk add + one retry.
  expect(batchCallCount).toBe(2);
  var batchCalls = apiClient.post.mock.calls.filter(function(c) { return c[0] === '/tasks/batch'; });
  var originalIds = batchCalls[0][1].tasks.map(function(t) { return t.id; }).sort();
  var retriedIds = batchCalls[1][1].tasks.map(function(t) { return t.id; }).sort();
  // retryAddTasks re-sent EXACTLY the ids from the failed original attempt —
  // no more (a 3rd unrelated task), no less (a partial resend).
  expect(retriedIds).toEqual(originalIds);
  expect(retriedIds.length).toBe(2);

  // Second attempt succeeded — the aggregate failure toast is gone (no
  // lingering "failed to save" text), and the tasks are still present.
  await waitFor(function() {
    expect(screen.queryByText(/tasks failed to save/)).not.toBeInTheDocument();
  });
  expect(screen.getByTestId('task-texts')).toHaveTextContent('Follow up with client');
  expect(screen.getByTestId('task-texts')).toHaveTextContent('Draft the proposal');
});
