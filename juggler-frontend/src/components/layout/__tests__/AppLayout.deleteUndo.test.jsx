/**
 * AppLayout — delete-undo round trip (999.1227).
 *
 * David's 2026-07-06 BINDING ruling: client snapshot undo (useUndo.js) stays
 * canonical; task delete becomes undoable via the backend soft-cancel path
 * (DELETE /tasks/:id → softCancelById, R55 — row kept, status='cancelled') plus
 * a "Task deleted — Undo" toast whose Undo restores the task by un-cancelling
 * through the EXPLICIT reactivation endpoint (PUT /tasks/:id/status).
 *
 * The real chain this exercises (nothing re-implements AppLayout's closures):
 *   mock ListView delete click -> requestDelete(id) -> ConfirmDialog (real)
 *   -> Confirm ("Delete") -> AppLayout onConfirm: pushUndo('delete task',
 *      revert) THEN deleteTask(id) -> apiClient.delete resolves
 *   -> showToast('Task deleted — Undo', 'success', { label: 'Undo', ... })
 *      renders the REAL ToastNotification action button
 *   -> clicking Undo -> handleUndo -> popUndo: dispatches RESTORE (task back
 *      in client state) and runs the revert -> setStatus(id, prevStatus) ->
 *      apiClient.put('/tasks/<id>/status', { status: '' }) — the server
 *      un-cancel, through the explicit un-terminal path (terminal guard and
 *      reopen date gate stand unweakened — ruling 7, cancelled is terminal).
 *
 * Harness (auth mock, ListView stub, HeaderBar stub for react-konva) cloned
 * from AppLayout.deleteSeries.test.jsx.
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

// View layer is not the seam under test — stub to a delete trigger plus a live
// task-text readout so the RESTORE (client-side re-add) is observable.
jest.mock('../../views/ListView', () => ({
  __esModule: true,
  default: function MockListView(props) {
    return (
      <div>
        <button onClick={function() { props.onDelete('oneoff-1'); }}>
          mock-trigger-delete
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

var TASK_FIXTURE = {
  id: 'oneoff-1',
  text: 'Water the plants',
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
  apiClient.delete.mockResolvedValue({ data: {} });
});

test('deleting a task shows a "Task deleted — Undo" toast; Undo restores the task client-side AND un-cancels via PUT /tasks/:id/status', async function() {
  render(<AppLayout />);
  await flush();
  expect(screen.getByTestId('task-texts')).toHaveTextContent('Water the plants');

  // Delete via the REAL ConfirmDialog (non-recurring path).
  fireEvent.click(screen.getByText('mock-trigger-delete'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await act(async function() {
    fireEvent.click(screen.getByText('Delete'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(apiClient.delete).toHaveBeenCalledWith('/tasks/oneoff-1');
  // Task gone from client state after the server-confirmed delete.
  await waitFor(function() {
    expect(screen.getByTestId('task-texts')).not.toHaveTextContent('Water the plants');
  });

  // The undo toast, with its visible action button (mobile parity — no
  // keyboard needed).
  var undoBtn = await screen.findByRole('button', { name: 'Undo' });
  expect(screen.getByText(/Task deleted/)).toBeInTheDocument();

  await act(async function() {
    fireEvent.click(undoBtn);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  // Client snapshot restored (canonical client undo)…
  await waitFor(function() {
    expect(screen.getByTestId('task-texts')).toHaveTextContent('Water the plants');
  });
  // …AND the server row un-cancelled through the explicit reactivation
  // endpoint. prevStatus was '' (absent from the statuses map = open).
  expect(apiClient.put).toHaveBeenCalledWith('/tasks/oneoff-1/status', { status: '' });
});

test('a failed delete shows the error toast and does NOT show the undo toast', async function() {
  var genericError = new Error('server exploded');
  genericError.response = { data: { error: 'Failed to delete task' } };
  apiClient.delete.mockRejectedValue(genericError);

  render(<AppLayout />);
  await flush();

  fireEvent.click(screen.getByText('mock-trigger-delete'));
  await act(async function() {
    fireEvent.click(screen.getByText('Delete'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(screen.queryByText(/Task deleted/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  // Task never left local state (delete defers removal until server success).
  expect(screen.getByTestId('task-texts')).toHaveTextContent('Water the plants');
});
