/**
 * HeaderBar — visible Undo affordance driven by canUndo (999.1227).
 *
 * David's 2026-07-06 ruling: undo needs a VISIBLE button (mobile parity —
 * Ctrl/Cmd+Z is keyboard-only). The button renders on both desktop and mobile
 * (it sits outside the overflow menu) and is disabled/dimmed when the undo
 * stack is empty (canUndo === false). An absent canUndo prop keeps the legacy
 * always-enabled behavior.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('../../../services/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.resolve({ data: {} })), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  TZ_OVERRIDE_KEY: 'juggler-tz-override',
  USER_TZ_KEY: 'juggler-user-tz',
  getAccessToken: jest.fn(() => null),
  setAccessToken: jest.fn(),
  clearAccessToken: jest.fn()
}));

jest.mock('../../auth/AuthProvider', () => ({
  __esModule: true,
  useAuth: () => ({
    user: { id: 'u1', name: 'Test User', email: 't@example.invalid' },
    loading: false,
    isAuthenticated: true,
    login: jest.fn(),
    logout: jest.fn()
  })
}));

// FeedbackDialog -> AnnotationCanvas -> react-konva needs a native canvas
// binding unavailable in jsdom — not the seam under test.
jest.mock('../../feedback/FeedbackWidget', () => ({
  __esModule: true,
  default: function MockFeedbackWidget() { return null; }
}));

import HeaderBar from '../HeaderBar';

function renderHeader(extraProps) {
  var noop = function() {};
  var props = Object.assign({
    darkMode: false, setDarkMode: noop, saving: false,
    selectedDateKey: '2026-07-10', statuses: {}, tasksByDate: {},
    onShowSettings: noop, onShowExport: noop,
    onShowGCalSync: noop, gcalSyncing: false,
    onShowMsftCalSync: noop, msftCalSyncing: false,
    calSyncing: false, calSyncProgress: null, schedulerRunning: false,
    onShowCalSync: noop, onShowHelp: noop,
    onAddTask: noop, onUndo: jest.fn(),
    isMobile: false, isCompact: false, aiPanel: null,
    weekStripDates: [], selectedDate: new Date('2026-07-10T12:00:00'),
    dayOffset: 0, setDayOffset: noop, today: new Date('2026-07-10T12:00:00'),
    activeTimezone: 'America/New_York', tzSource: 'auto',
    onManageDisabled: noop, onCompactChange: noop
  }, extraProps || {});
  render(<HeaderBar {...props} />);
  return props;
}

test('renders the Undo button enabled when canUndo is true, and clicking it fires onUndo', () => {
  var props = renderHeader({ canUndo: true });
  var btn = screen.getByRole('button', { name: 'Undo last action' });
  expect(btn).not.toBeDisabled();
  fireEvent.click(btn);
  expect(props.onUndo).toHaveBeenCalledTimes(1);
});

test('disables the Undo button when canUndo is false (empty undo stack)', () => {
  var props = renderHeader({ canUndo: false });
  var btn = screen.getByRole('button', { name: 'Undo last action' });
  expect(btn).toBeDisabled();
  fireEvent.click(btn);
  expect(props.onUndo).not.toHaveBeenCalled();
});

test('still renders the Undo button on mobile (parity — no keyboard shortcut there)', () => {
  renderHeader({ canUndo: true, isMobile: true });
  expect(screen.getByRole('button', { name: 'Undo last action' })).toBeInTheDocument();
});
