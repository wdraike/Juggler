/**
 * AppLayout — provider-origin delete wall escape hatch (999.1240).
 *
 * The real chain this exercises:
 *   ListView "delete" click -> requestDelete(id) -> ConfirmDialog (single-task
 *   branch) -> Confirm ("Delete") -> AppLayout's onConfirm calls deleteTask(id)
 *   -> apiClient.delete rejects with a PROVIDER_ORIGIN_DELETE_BLOCKED 403
 *   -> AppLayout's .catch reads error.response.data.code and (999.1240) sets
 *      takeOwnershipPrompt instead of dead-ending in an error toast
 *   -> the take-ownership ConfirmDialog renders with the server's message and a
 *      "Take ownership" confirm -> clicking it POSTs
 *      /tasks/:id/take-ownership (the previously UI-unreachable endpoint) and
 *      reloads tasks.
 *
 * Mocking boundary mirrors AppLayout.deleteSeries.test.jsx: apiClient, auth,
 * ListView (stubbed to a delete-trigger button), HeaderBar (react-konva) are
 * replaced; useTaskState.deleteTask and the ConfirmDialog -> ConfirmModal chain
 * are REAL, unmocked code.
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import AppLayout from '../AppLayout';

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

jest.mock('../../views/ListView', () => ({
  __esModule: true,
  default: function MockListView(props) {
    return (
      <button onClick={function() { props.onDelete('gcal-task-1'); }}>
        mock-trigger-delete
      </button>
    );
  }
}));

jest.mock('../HeaderBar', () => ({
  __esModule: true,
  default: function MockHeaderBar() { return null; }
}));

import apiClient from '../../../services/apiClient';

// NON-recurring provider-origin task — drives the single-task ConfirmDialog
// branch (the provider-origin 403 is only emitted on non-series deletes).
var TASK_FIXTURE = {
  id: 'gcal-task-1',
  text: 'Dentist appointment',
  status: '',
  taskType: 'task',
  recurring: false,
  date: '2026-07-10',
  time: '9:00 AM',
  dur: 30
};

async function flush() {
  await act(async function() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function providerBlockedError() {
  var err = new Error('blocked');
  err.response = {
    status: 403,
    data: {
      code: 'PROVIDER_ORIGIN_DELETE_BLOCKED',
      error: 'This task came from Google Calendar. To remove it, delete it from Google Calendar directly.',
      provider: 'gcal'
    }
  };
  return err;
}

beforeEach(function() {
  jest.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('juggler-ui-state', JSON.stringify({ viewMode: 'list' }));

  window.matchMedia = window.matchMedia || function() {
    return { matches: false, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn() };
  };

  apiClient.get.mockImplementation(function(url) {
    if (url === '/tasks') {
      return Promise.resolve({ data: { tasks: [Object.assign({}, TASK_FIXTURE)], version: 1 } });
    }
    if (url === '/config') return Promise.resolve({ data: {} });
    if (url === '/now') return Promise.resolve({ data: { epochMs: Date.now() } });
    return Promise.resolve({ data: {} });
  });
  apiClient.post.mockResolvedValue({ data: {} });
  apiClient.put.mockResolvedValue({ data: {} });
});

async function openDeleteAndConfirm() {
  render(<AppLayout />);
  await flush();

  fireEvent.click(screen.getByText('mock-trigger-delete'));

  // The single-task ConfirmDialog (real component) is open.
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText(/Delete "Dentist appointment"/)).toBeInTheDocument();

  // Fire the REAL onConfirm -> deleteTask(id) -> apiClient.delete (rejected).
  await act(async function() {
    fireEvent.click(screen.getByText('Delete'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

test('a PROVIDER_ORIGIN_DELETE_BLOCKED rejection surfaces the take-ownership escape hatch instead of a dead-end toast', async function() {
  apiClient.delete.mockRejectedValue(providerBlockedError());

  await openDeleteAndConfirm();

  // The escape-hatch dialog is open, carrying the server's explanation and the
  // take-ownership offer.
  await waitFor(function() {
    expect(screen.getByText('Take ownership')).toBeInTheDocument();
  });
  expect(screen.getByText(/This task came from Google Calendar/)).toBeInTheDocument();
  expect(screen.getByText(/Juggler will manage \(and can delete\) it/)).toBeInTheDocument();
});

test('confirming the escape hatch POSTs /tasks/:id/take-ownership and reloads tasks', async function() {
  apiClient.delete.mockRejectedValue(providerBlockedError());

  await openDeleteAndConfirm();
  await waitFor(function() {
    expect(screen.getByText('Take ownership')).toBeInTheDocument();
  });

  var tasksGetsBefore = apiClient.get.mock.calls.filter(function(c) { return c[0] === '/tasks'; }).length;

  await act(async function() {
    fireEvent.click(screen.getByText('Take ownership'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  // The previously dead endpoint is now reachable from the UI.
  expect(apiClient.post).toHaveBeenCalledWith('/tasks/gcal-task-1/take-ownership');

  // Success feedback + task reload.
  await waitFor(function() {
    expect(screen.getByText(/Juggler now owns this task/)).toBeInTheDocument();
  });
  var tasksGetsAfter = apiClient.get.mock.calls.filter(function(c) { return c[0] === '/tasks'; }).length;
  expect(tasksGetsAfter).toBeGreaterThan(tasksGetsBefore);

  // The escape-hatch dialog is gone.
  expect(screen.queryByText('Take ownership')).not.toBeInTheDocument();
});

test('cancelling the escape hatch closes it without calling take-ownership', async function() {
  apiClient.delete.mockRejectedValue(providerBlockedError());

  await openDeleteAndConfirm();
  await waitFor(function() {
    expect(screen.getByText('Take ownership')).toBeInTheDocument();
  });

  fireEvent.click(screen.getByText('Cancel'));

  expect(screen.queryByText('Take ownership')).not.toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalledWith('/tasks/gcal-task-1/take-ownership');
});

test('a non-provider delete failure keeps the prior toast behavior (no escape hatch)', async function() {
  var genericError = new Error('server exploded');
  genericError.response = { status: 500, data: { code: 'SOME_OTHER_ERROR', error: 'Something broke.' } };
  apiClient.delete.mockRejectedValue(genericError);

  await openDeleteAndConfirm();

  await waitFor(function() {
    expect(screen.getByText(/Something broke\./)).toBeInTheDocument();
  });
  expect(screen.queryByText('Take ownership')).not.toBeInTheDocument();
});
