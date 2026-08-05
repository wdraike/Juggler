/**
 * 999.5162: date selector (week strip) should be hidden on views that
 * don't use the selected date (priority, deps, conflicts).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('../../../services/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(() => Promise.resolve({ data: {} })), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  TZ_OVERRIDE_KEY: 'juggler-tz-override',
  USER_TZ_KEY: 'juggler-user-tz',
  getAccessToken: jest.fn(() => null),
  setAccessToken: jest.fn(),
  clearAccessToken: jest.fn()
}));

jest.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({ setConnectionStatus: jest.fn() }),
  ConnectionProvider: ({ children }) => children,
}));

jest.mock('../../common/GlobalConnectionModal', () => ({
  showConnectionModal: jest.fn(),
  hideConnectionModal: jest.fn(),
  default: () => null,
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
    weekStripDates: [
      new Date('2026-07-07'),
      new Date('2026-07-08'),
      new Date('2026-07-09'),
      new Date('2026-07-10'),
      new Date('2026-07-11'),
      new Date('2026-07-12'),
      new Date('2026-07-13'),
    ],
    selectedDate: new Date('2026-07-10T12:00:00'),
    dayOffset: 0, setDayOffset: noop, today: new Date('2026-07-10T12:00:00'),
    activeTimezone: 'America/New_York', tzSource: 'auto',
    onManageDisabled: noop, onCompactChange: noop
  }, extraProps);
  render(<HeaderBar {...props} />);
  return props;
}

describe('HeaderBar date selector visibility (999.5163)', () => {
  test('shows date selector on date-dependent views (daily)', () => {
    renderHeader({ viewMode: 'daily' });
    // The "Today" button is part of the week strip — present when date selector is visible
    expect(screen.getByTitle('Go to today')).toBeInTheDocument();
  });

  test('hides date selector on priority view', () => {
    renderHeader({ viewMode: 'priority' });
    expect(screen.queryByTitle('Go to today')).not.toBeInTheDocument();
  });

  test('hides date selector on deps view', () => {
    renderHeader({ viewMode: 'deps' });
    expect(screen.queryByTitle('Go to today')).not.toBeInTheDocument();
  });

  test('hides date selector on conflicts view', () => {
    renderHeader({ viewMode: 'conflicts' });
    expect(screen.queryByTitle('Go to today')).not.toBeInTheDocument();
  });
});