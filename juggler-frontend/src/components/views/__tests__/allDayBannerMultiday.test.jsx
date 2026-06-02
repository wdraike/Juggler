/**
 * AllDayBanner.jsx tests — JUG-MED-17: Multiday all-day tasks support
 *
 * Tests the multiday date range filtering logic in AllDayBanner.
 * Single-day and multiday all-day tasks should both appear in the banner
 * for dates within their range.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import AllDayBanner from '../AllDayBanner';

// Mock theme/colors
jest.mock('../../../theme/colors', () => ({
  getTheme: () => ({
    bg: '#fff',
    bgCard: '#f5f5f5',
    text: '#000',
    textMuted: '#666',
    border: '#ddd',
    badgeBg: '#eee',
    projectBadgeBg: '#e3f2fd',
    projectBadgeText: '#1565c0',
    accent: '#1976d2',
  }),
}));

// Mock constants
jest.mock('../../../state/constants', () => ({
  isTerminalStatus: jest.fn((status) => ['done', 'skip', 'cancel', 'missed'].includes(status)),
  PAST_OPACITY: 0.7,
}));

const createTask = (id, overrides = {}) => ({
  id,
  text: `Task ${id}`,
  date: '2026-05-15',
  placementMode: 'all_day',
  ...overrides,
});

describe('AllDayBanner - Multiday support (JUG-MED-17)', () => {
  const baseDate = '2026-05-15';

  describe('Single-day all-day tasks', () => {
    test('shows single-day all-day task on its date', () => {
      const tasks = [
        createTask('single-day', { date: '2026-05-15' }),
      ];

      render(
        <AllDayBanner
          allTasks={tasks}
          dateKey="2026-05-15"
          statuses={{}}
          darkMode={false}
          isPastDay={false}
        />
      );

      expect(screen.getByTestId('all-day-banner')).toBeInTheDocument();
      expect(screen.getByText('Task single-day')).toBeInTheDocument();
    });

    test('does not show single-day task on a different date', () => {
      const tasks = [
        createTask('single-day', { date: '2026-05-15' }),
      ];

      const { container } = render(
        <AllDayBanner
          allTasks={tasks}
          dateKey="2026-05-16"
          statuses={{}}
          darkMode={false}
          isPastDay={false}
        />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Multiday all-day tasks (JUG-MED-17)', () => {
    test('shows multiday task on start date', () => {
      const tasks = [
        createTask('multi-conf', { date: '2026-05-15', endDate: '2026-05-17' }),
      ];

      render(
        <AllDayBanner
          allTasks={tasks}
          dateKey="2026-05-15"
          statuses={{}}
          darkMode={false}
          isPastDay={false}
        />
      );

      expect(screen.getByTestId('all-day-banner')).toBeInTheDocument();
      expect(screen.getByText('Task multi-conf')).toBeInTheDocument();
    });

    test('shows multiday task on middle date', () => {
      const tasks = [
        createTask('multi-conf', { date: '2026-05-15', endDate: '2026-05-17' }),
      ];

      render(
        <AllDayBanner
          allTasks={tasks}
          dateKey="2026-05-16"
          statuses={{}}
          darkMode={false}
          isPastDay={false}
        />
      );

      expect(screen.getByTestId('all-day-banner')).toBeInTheDocument();
      expect(screen.getByText('Task multi-conf')).toBeInTheDocument();
    });

    test('shows multiday task on end date (inclusive)', () => {
      const tasks = [
        createTask('multi-conf', { date: '2026-05-15', endDate: '2026-05-17' }),
      ];

      render(
        <AllDayBanner
          allTasks={tasks}
          dateKey="2026-05-17"
          statuses={{}}
          darkMode={false}
          isPastDay={false}
        />
      );

      expect(screen.getByTestId('all-day-banner')).toBeInTheDocument();
      expect(screen.getByText('Task multi-conf')).toBeInTheDocument();
    });

    test('does not show multiday task before start date', () => {
      const tasks = [
        createTask('multi-conf', { date: '2026-05-15', endDate: '2026-05-17' }),
      ];

      const { container } = render(
        <AllDayBanner
          allTasks={tasks}
          dateKey="2026-05-14"
          statuses={{}}
          darkMode={false}
          isPastDay={false}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    test('does not show multiday task after end date', () => {
      const tasks = [
        createTask('multi-conf', { date: '2026-05-15', endDate: '2026-05-17' }),
      ];

      const { container } = render(
        <AllDayBanner
          allTasks={tasks}
          dateKey="2026-05-18"
          statuses={{}}
          darkMode={false}
          isPastDay={false}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    test('shows multiday task in WeekView for all dates in range', () => {
      const tasks = [
        createTask('week-conf', { date: '2026-05-15', endDate: '2026-05-18' }),
      ];

      // WeekView renders 7 day columns, each with its own dateKey
      const dates = ['2026-05-15', '2026-05-16', '2026-05-17', '2026-05-18'];
      
      dates.forEach(dateKey => {
        const { unmount } = render(
          <AllDayBanner
            allTasks={tasks}
            dateKey={dateKey}
            statuses={{}}
            darkMode={false}
            isPastDay={false}
          />
        );

        expect(screen.getByTestId('all-day-banner')).toBeInTheDocument();
        expect(screen.getByText('Task week-conf')).toBeInTheDocument();
        unmount();
      });
    });

    test('shows multiple all-day tasks with mixed single and multiday', () => {
      const tasks = [
        createTask('single-1', { date: '2026-05-15' }),
        createTask('multi-conference', { date: '2026-05-15', endDate: '2026-05-17' }),
        createTask('single-2', { date: '2026-05-15' }),
      ];

      render(
        <AllDayBanner
          allTasks={tasks}
          dateKey="2026-05-16"
          statuses={{}}
          darkMode={false}
          isPastDay={false}
        />
      );

      // Only the multiday task should appear on 2026-05-16
      expect(screen.getByTestId('all-day-banner')).toBeInTheDocument();
      expect(screen.getByText('Task multi-conference')).toBeInTheDocument();
      expect(screen.queryByText('Task single-1')).not.toBeInTheDocument();
      expect(screen.queryByText('Task single-2')).not.toBeInTheDocument();
    });
  });

  describe('Date range edge cases', () => {
    test('handles single-day task with same date as endDate', () => {
      // Edge case: endDate === date (should behave like single-day, but still work)
      const tasks = [
        createTask('same-day-edge', { date: '2026-05-15', endDate: '2026-05-15' }),
      ];

      render(
        <AllDayBanner
          allTasks={tasks}
          dateKey="2026-05-15"
          statuses={{}}
          darkMode={false}
          isPastDay={false}
        />
      );

      expect(screen.getByTestId('all-day-banner')).toBeInTheDocument();
      expect(screen.getByText('Task same-day-edge')).toBeInTheDocument();
    });

    test('handles year boundary dates correctly', () => {
      const tasks = [
        createTask('year-end', { date: '2026-12-30', endDate: '2027-01-02' }),
      ];

      // Should appear on Dec 31 and Jan 1
      const { unmount } = render(
        <AllDayBanner
          allTasks={tasks}
          dateKey="2026-12-31"
          statuses={{}}
          darkMode={false}
          isPastDay={false}
        />
      );
      expect(screen.getByText('Task year-end')).toBeInTheDocument();
      unmount();

      render(
        <AllDayBanner
          allTasks={tasks}
          dateKey="2027-01-01"
          statuses={{}}
          darkMode={false}
          isPastDay={false}
        />
      );
      expect(screen.getByText('Task year-end')).toBeInTheDocument();
    });

    test('filters non-all-day tasks even within date range', () => {
      const tasks = [
        { id: 'timed-task', text: 'Timed Task', date: '2026-05-16', placementMode: 'fixed' },
        createTask('allday-task', { date: '2026-05-15', endDate: '2026-05-17' }),
      ];

      render(
        <AllDayBanner
          allTasks={tasks}
          dateKey="2026-05-16"
          statuses={{}}
          darkMode={false}
          isPastDay={false}
        />
      );

      // Only the all-day task should appear
      expect(screen.queryByText('Timed Task')).not.toBeInTheDocument();
      expect(screen.getByText('Task allday-task')).toBeInTheDocument();
    });
  });
});
