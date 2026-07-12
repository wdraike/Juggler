/**
 * AppLayout — handleAiOps onError wiring (999.1544 / ernie-1544-w1 WARN).
 *
 * REFER→telly (BERT-LOG.md Refer-outs): bert wired AppLayout.jsx's handleAiOps
 * (bulk AI-applied "add" ops, ~1114-1214) to addTasks's `opts.onError` callback
 * at AppLayout.jsx:1210 — `addTasks(addedTasks, { onError: function(msg) {
 * showToast(msg, 'error'); } })` — matching handleCreate's identical onError
 * convention (AppLayout.jsx:1002-1008, see AppLayout.createRollback.test.jsx).
 *
 * IMPORTANT — handleAiOps does NOT await addTasks (fire-and-forget, same shape
 * as handleCreate/handleStatusChange/handleCompletionConfirm): it calls
 * addTasks(...) and then unconditionally fires `showToast(msg || 'AI: N
 * changes applied', 'success')` on the very next line, BEFORE the POST
 * settles. ernie's own INFO finding (ernie-1544-i1) confirmed this
 * unconditional-success + onError-overwrite shape is the RATIFIED 999.1225
 * JUG-UI-FEEDBACK-STANDARD pattern shared by the 3 sibling handlers, NOT a
 * defect bert or telly should gate/remove. So — like AppLayout.createRollback
 * .test.jsx's AC3 test — this test asserts the observable END STATE (the
 * error toast is the one left standing, overwriting the single-slot
 * ToastNotification toast, per useToast's setToast(entry) semantics) rather
 * than a literal "the success toast function is never invoked" claim.
 *
 * Harness: HeaderBar is mocked to actually render its `aiPanel` prop (instead
 * of the real HeaderBar, which pulls in react-konva) so the real handleAiOps
 * closure gets exercised end-to-end. AiCommandPanel is mocked to a trigger
 * button that calls onApplyOps with a single 'add' op — the seam under test
 * is AppLayout's handleAiOps + the real useTaskState addTasks hook, not
 * AiCommandPanel's own NL-command UI.
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

// View layer is not the seam under test — stub with a live task-text readout
// so the optimistic bulk add (and its rollback) is observable.
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

// Real HeaderBar pulls in FeedbackDialog -> react-konva (native canvas) and is
// not the seam under test — but we DO need the `aiPanel` prop it forwards to
// actually mount, so render it (unlike the null-stub used by the other
// AppLayout.*.test.jsx files, which don't need onApplyOps reachable).
jest.mock('../HeaderBar', () => ({
  __esModule: true,
  default: function MockHeaderBar(props) {
    return <div>{props.aiPanel}</div>;
  }
}));

// AiCommandPanel's own NL-command UI is not the seam under test — stub to a
// trigger that invokes the real onApplyOps (== AppLayout's handleAiOps) with
// a single bulk 'add' op, mirroring how AiCommandPanel really calls it.
jest.mock('../../features/AiCommandPanel', () => ({
  __esModule: true,
  default: function MockAiCommandPanel(props) {
    return (
      <button
        onClick={function() {
          props.onApplyOps(
            [{ op: 'add', task: { id: 'ai001', text: 'Follow up with client', taskType: 'one-off', date: '2026-07-15' } }],
            'AI: 1 change applied'
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

test('ernie-1544-w1: a rejected bulk addTasks POST (AI ops) ends with the error toast visible, and rolls back the optimistic add', async function() {
  var serverError = new Error('rejected');
  serverError.response = { status: 500, data: { error: 'Could not add tasks — change reverted' } };
  apiClient.post.mockImplementation(function(url) {
    if (url === '/tasks/batch') return Promise.reject(serverError);
    return Promise.resolve({ data: {} });
  });

  render(<AppLayout />);
  await flush();
  expect(screen.getByTestId('task-texts')).not.toHaveTextContent('Follow up with client');

  fireEvent.click(screen.getByText('mock-trigger-ai-ops'));
  await flush();

  // The onError-driven error toast is the one left standing (last-write-wins
  // over the unconditional synchronous "AI: 1 change applied" success toast
  // — see file-header note; matches ernie-1544-i1's confirmed pattern).
  await waitFor(function() {
    expect(screen.getByText('Could not add tasks — change reverted')).toBeInTheDocument();
  }, { timeout: 5000 });
  expect(screen.queryByText('AI: 1 change applied')).not.toBeInTheDocument();

  // Rollback: the optimistically-added task is gone from client state too.
  expect(screen.getByTestId('task-texts')).not.toHaveTextContent('Follow up with client');
});

test('regression guard: a successful bulk addTasks POST (AI ops) shows the "AI: N changes applied" success toast and keeps the task in state', async function() {
  render(<AppLayout />);
  await flush();

  fireEvent.click(screen.getByText('mock-trigger-ai-ops'));
  await flush();

  await waitFor(function() {
    expect(screen.getByText('AI: 1 change applied')).toBeInTheDocument();
  }, { timeout: 5000 });
  expect(screen.getByTestId('task-texts')).toHaveTextContent('Follow up with client');
});
