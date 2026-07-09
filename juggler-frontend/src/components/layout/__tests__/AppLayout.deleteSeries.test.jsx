/**
 * AppLayout — onDeleteSeries cal_locked blocked-delete wiring (zoe-w6-002, WARN)
 *
 * The real chain this exercises:
 *   ListView "delete" click -> requestDelete(id) -> RecurringDeleteDialog rendered
 *   -> user clicks "Delete entire series" (RecurringDeleteDialog's onDeleteSeries,
 *      wired 1:1 to ConfirmModal's Confirm slot) -> AppLayout.jsx's inline
 *      onDeleteSeries handler calls deleteTask(id, { cascade: 'recurring' })
 *   -> apiClient.delete rejects with a CAL_LOCKED_DELETE_BLOCKED 403
 *   -> AppLayout's .catch reads error.response.data.code, and (bert bird-w6-002
 *      fix) calls setRecurringDeleteBlockedMessage(...) instead of closing the
 *      dialog -> RecurringDeleteDialog re-renders with blocked=true +
 *      blockedMessage -> ConfirmModal disables ONLY the Confirm ("Delete entire
 *      series") button and shows the message.
 *
 * Before this test, that catch-wiring (AppLayout.jsx:1608-1630) had ZERO
 * coverage: `--testPathPattern=AppLayout` matched no suite, and the only
 * existing "blocked" test lived on ConfirmDialog (a component the code's own
 * comments say never receives this 403 — zoe-w6-003). RecurringDeleteDialog's
 * own test file exercises the prop CONTRACT (blocked=true as an input), never
 * the real trigger (a rejected deleteTask call flowing through AppLayout's own
 * closure). This test exercises the REAL closure — nothing here re-implements
 * or mirrors AppLayout's catch logic.
 *
 * Boundary chosen: full AppLayout render, with only (a) the view layer
 * (ListView — not part of the seam under test; stubbed to a single button that
 * calls the real onDelete prop AppLayout passed it) and (b) auth (mocked to a
 * fixed logged-in user, bypassing the unrelated OAuth/session-restore flow)
 * replaced. useTaskState (deleteTask, the reducer, placements) and the
 * RecurringDeleteDialog -> ConfirmModal chain are all REAL, unmocked code.
 *
 * Self-verification performed while authoring (TEST-AUTHORING.md §Seam-move /
 * §Golden-master self-verification): temporarily made AppLayout.jsx's catch
 * branch NOT call setRecurringDeleteBlockedMessage (so blocked never flips
 * true) — this test went RED (Confirm stayed enabled / no message shown).
 * Restored the original code (via /tmp backup, never `git checkout --`) and
 * reran — GREEN. `git diff --stat` confirmed clean after restore.
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

// Auth is not the seam under test — replace it with a fixed logged-in user so
// AppLayout renders immediately, instead of exercising the unrelated OAuth /
// session-restore flow (AuthProvider.jsx).
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

// The view layer is not the seam under test (this leg's fix is in AppLayout's
// delete-series wiring + the dialog chain, not in ListView's rendering). Stub
// it down to a single button that invokes the REAL onDelete prop AppLayout
// wires to requestDelete -> setDeleteConfirmTask, which is what actually
// drives the RecurringDeleteDialog conditional render under test.
jest.mock('../../views/ListView', () => ({
  __esModule: true,
  default: function MockListView(props) {
    return (
      <button onClick={function() { props.onDelete('recur-instance-1'); }}>
        mock-trigger-delete
      </button>
    );
  }
}));

// HeaderBar pulls in FeedbackDialog -> AnnotationCanvas -> react-konva, which
// requires a native `canvas` binding unavailable in this jsdom test env. Not
// part of the seam under test (the delete-series wiring lives entirely below
// HeaderBar in the tree) — stub it out so the module graph never reaches
// react-konva.
jest.mock('../HeaderBar', () => ({
  __esModule: true,
  default: function MockHeaderBar() { return null; }
}));

import apiClient from '../../../services/apiClient';

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
  // Force the 'list' view so the mocked ListView (and its delete trigger) renders.
  localStorage.setItem('juggler-ui-state', JSON.stringify({ viewMode: 'list' }));

  // jsdom does not implement matchMedia (useIsMobile/useIsCompact read it directly).
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

test('a CAL_LOCKED_DELETE_BLOCKED rejection on series-delete keeps the dialog open, disables ONLY "Delete entire series", and shows the server message', async function() {
  var blockedError = new Error('blocked');
  blockedError.response = {
    data: { code: 'CAL_LOCKED_DELETE_BLOCKED', error: 'This series has a calendar-linked instance.' }
  };
  apiClient.delete.mockRejectedValue(blockedError);

  render(<AppLayout />);
  await flush();

  fireEvent.click(screen.getByText('mock-trigger-delete'));

  // RecurringDeleteDialog (the real component) is now open.
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  var confirmBtn = screen.getByText(/Delete entire series/);
  var tertiaryBtn = screen.getByText(/Skip this instance/);
  expect(confirmBtn).not.toBeDisabled();
  expect(tertiaryBtn).not.toBeDisabled();

  // Fire the REAL onDeleteSeries -> deleteTask(...) -> apiClient.delete (rejected).
  await act(async function() {
    fireEvent.click(confirmBtn);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(apiClient.delete).toHaveBeenCalledWith('/tasks/recur-instance-1?cascade=recurring');

  // The dialog must still be open (AppLayout's catch must NOT have cleared
  // deleteConfirmTask on this specific error code) and the blocked message
  // must be visible.
  await waitFor(function() {
    expect(screen.getByText('This series has a calendar-linked instance.')).toBeInTheDocument();
  });
  expect(screen.getByRole('dialog')).toBeInTheDocument();

  // Only the destructive Confirm ("Delete entire series") action is disabled —
  // Skip-instance (tertiary) and Cancel must remain live, per RecurringDeleteDialog's
  // own contract (confirmDisabled={!!blocked} only gates Confirm).
  expect(screen.getByText(/Delete entire series/)).toBeDisabled();
  expect(screen.getByText(/Skip this instance/)).not.toBeDisabled();
  expect(screen.getByText('Cancel')).not.toBeDisabled();
});

test('a NON-cal_locked delete failure preserves the prior fire-and-forget behavior: the dialog closes (no blocked state)', async function() {
  var genericError = new Error('server exploded');
  genericError.response = { data: { code: 'SOME_OTHER_ERROR' } };
  apiClient.delete.mockRejectedValue(genericError);

  render(<AppLayout />);
  await flush();

  fireEvent.click(screen.getByText('mock-trigger-delete'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();

  await act(async function() {
    fireEvent.click(screen.getByText(/Delete entire series/));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  await waitFor(function() {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

test('a SUCCESSFUL series delete closes the dialog (happy path unaffected by the blocked-state wiring)', async function() {
  apiClient.delete.mockResolvedValue({ data: {} });

  render(<AppLayout />);
  await flush();

  fireEvent.click(screen.getByText('mock-trigger-delete'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();

  await act(async function() {
    fireEvent.click(screen.getByText(/Delete entire series/));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  await waitFor(function() {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
