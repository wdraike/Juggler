/**
 * AppLayout — handleCreate onError wiring (999.1544 AC3).
 *
 * REFER→telly (BERT-LOG.md, telly-999-1544-ac3-gap): bert wired
 * AppLayout.jsx's handleCreate (1002-1008) to createTask's new `opts.onError`
 * callback — `onError: function(msg) { showToast(msg, 'error'); }` — mirroring
 * the identical convention already used for setStatus at handleStatusChange
 * (880) and handleCompletionConfirm (902). This was previously UNTESTED at
 * the AppLayout level (only the hook-level useTaskState.create.test.js
 * covered createTask's own rollback/onError contract).
 *
 * IMPORTANT — handleCreate does NOT await createTask (fire-and-forget, same
 * shape as handleStatusChange/handleCompletionConfirm): it calls
 * `showToast('Added: ...', 'success')` unconditionally and synchronously
 * BEFORE createTask's promise settles. ToastNotification (useToast) holds a
 * SINGLE `toast` slot (`setToast(entry)` overwrites, no queue/list — see
 * ToastNotification.jsx). So on a rejected create, the success toast fires
 * first, then the error toast (fired later, once the POST rejects) OVERWRITES
 * it as the last-write-wins visible toast. This test asserts that observable
 * END STATE — matching AppLayout.deleteUndo.test.jsx's sibling assertion
 * shape ("a failed delete shows the error toast and does NOT show the undo
 * toast") — not a claim that the success toast never renders at all.
 *
 * Harness (auth mock, ListView stub, HeaderBar stub for react-konva) cloned
 * from AppLayout.deleteUndo.test.jsx.
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import AppLayout from '../AppLayout';

// Increase timeout for async tests (house convention — see RO frontend
// __tests__ files). Needed so the outer per-test clock (react-scripts/jest
// default 5000ms) doesn't race the waitFor({ timeout: 5000 }) calls below
// under machine load — a per-test timeout equal to the waitFor timeout lets
// Jest kill the test before waitFor's own internal timeout is ever exercised.
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

// View layer is not the seam under test — stub to a create trigger plus a
// live task-text readout so the optimistic add (and its rollback) is
// observable, mirroring AppLayout.deleteUndo.test.jsx's mock ListView.
jest.mock('../../views/ListView', () => ({
  __esModule: true,
  default: function MockListView(props) {
    return (
      <div>
        <button
          onClick={function() {
            props.onCreate({
              id: 'new-task-1',
              text: 'Water the plants',
              taskType: 'one-off',
              date: '2026-07-12',
              time: '9:00 AM',
              dur: 30
            });
          }}
        >
          mock-trigger-create
        </button>
        <div data-testid="task-texts">
          {(props.allTasks || []).map(function(t) { return t.text; }).join(',')}
        </div>
      </div>
    );
  }
}));

// HeaderBar pulls in FeedbackDialog -> react-konva (native canvas) — stub.
jest.mock('../HeaderBar', () => ({
  __esModule: true,
  default: function MockHeaderBar() { return null; }
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

test('AC3: a rejected createTask POST ends with the error toast visible (overwriting the unconditional success toast), and rolls back the optimistic add', async function() {
  var serverError = new Error('rejected');
  serverError.response = { status: 500, data: { error: 'Could not create task — server error.' } };
  apiClient.post.mockImplementation(function(url) {
    if (url === '/tasks') return Promise.reject(serverError);
    return Promise.resolve({ data: {} });
  });

  render(<AppLayout />);
  await flush();
  expect(screen.getByTestId('task-texts')).not.toHaveTextContent('Water the plants');

  fireEvent.click(screen.getByText('mock-trigger-create'));
  await flush();

  // The onError-driven error toast is the one left standing (last-write-wins
  // over the unconditional synchronous success toast — see file-header note).
  await waitFor(function() {
    expect(screen.getByText('Could not create task — server error.')).toBeInTheDocument();
  }, { timeout: 5000 });
  expect(screen.queryByText('Added: Water the plants')).not.toBeInTheDocument();

  // Rollback: the optimistically-added task is gone from client state too
  // (useTaskState.create.test.js AC1, exercised here end-to-end through the
  // real AppLayout->createTask wiring rather than the hook in isolation).
  expect(screen.getByTestId('task-texts')).not.toHaveTextContent('Water the plants');
});

test('regression guard: a successful createTask POST shows the "Added" success toast and keeps the task in state', async function() {
  render(<AppLayout />);
  await flush();

  fireEvent.click(screen.getByText('mock-trigger-create'));
  await flush();

  await waitFor(function() {
    expect(screen.getByText('Added: Water the plants')).toBeInTheDocument();
  }, { timeout: 5000 });
  expect(screen.getByTestId('task-texts')).toHaveTextContent('Water the plants');
});
