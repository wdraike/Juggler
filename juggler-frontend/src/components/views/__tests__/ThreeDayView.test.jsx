import React from 'react';
import { render, screen } from '@testing-library/react';
import ThreeDayView from '../ThreeDayView';

// Use the real theme module. NOTE: a factory mock of the form
// `() => ({ getTheme: jest.fn().mockReturnValue({...}) })` silently returns
// undefined under this CRA/jest+babel-hoist setup (the chained mock config is
// lost at hoist time), which made getTheme() -> undefined -> theme.border crash.
// theme/colors is a plain pure function (getTheme(darkMode)) always present in
// the real app, so pass it through unmocked.
jest.mock('../../../theme/colors', () => jest.requireActual('../../../theme/colors'));

jest.mock('../../../state/constants', () => ({
  DAY_NAMES: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
}));

// NOTE: under this repo's CRA/jest setup, babel-plugin-jest-hoist neuters
// jest.fn() calls written inside a hoisted mock factory — both
// `jest.fn().mockReturnValue(x)` and `jest.fn(() => x)` lose their value and
// yield undefined. Use plain functions in the factory so mocks actually return.
jest.mock('../../../scheduler/dateHelpers', () => ({
  formatDateKey: (date) => {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  }
}));

jest.mock('../../../scheduler/locationHelpers', () => ({
  getLocationForDatePure: () => ({ icon: '🏠', name: 'Home' })
}));

jest.mock('../../schedule/CalendarGrid', () => ({
  __esModule: true,
  default: ({ dateKey, placements }) => (
    <div data-testid="calendar-grid" data-date={dateKey}>
      {placements.length} tasks
    </div>
  )
}));

jest.mock('../AllDayBanner', () => ({
  __esModule: true,
  default: () => <div data-testid="all-day-banner">All Day Banner</div>
}));

jest.mock('../../features/WeatherBadge', () => ({
  __esModule: true,
  default: () => <div data-testid="weather-badge">Weather</div>
}));

const mockTasks = [
  {
    id: 't1',
    text: 'Day 1 Task',
    pri: 'P1',
    dur: 60,
    start: 480,
    end: 540,
    task: {
      id: 't1',
      text: 'Day 1 Task',
      pri: 'P1',
      dur: 60
    }
  }
];

const mockStatuses = {};
const mockSchedCfg = {
  locScheduleDefaults: {},
  locScheduleOverrides: {},
  scheduleTemplates: {
    'weekday': { blocks: [] },
    'weekend': { blocks: [] }
  }
};

describe('ThreeDayView Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders three days correctly', () => {
    const selectedDate = new Date('2026-06-15'); // Monday
    
    const { getAllByTestId } = render(
      <ThreeDayView
        selectedDate={selectedDate}
        dayPlacements={{
          '2026-06-15': [mockTasks[0]],
          '2026-06-16': [],
          '2026-06-17': []
        }}
        allTasks={mockTasks}
        statuses={mockStatuses}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        gridZoom={100}
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={960}
        onGridDrop={() => {}}
        blockedTaskIds={[]}
        onZoomChange={() => {}}
        isMobile={false}
        onMarkerDrag={() => {}}
        weatherByDate={{
          '2026-06-15': { code: 0, temp: 22 },
          '2026-06-16': { code: 1, temp: 23 },
          '2026-06-17': { code: 2, temp: 21 }
        }}
      />
    );
    
    // Should render 3 calendar grids (one for each day)
    const grids = getAllByTestId('calendar-grid');
    expect(grids.length).toBe(3);
    
    // Should render all day banners
    expect(screen.getAllByTestId('all-day-banner').length).toBe(3);
  });

  test('renders empty state for all three days', () => {
    const selectedDate = new Date('2026-06-15');
    
    const { getAllByTestId } = render(
      <ThreeDayView
        selectedDate={selectedDate}
        dayPlacements={{
          '2026-06-15': [],
          '2026-06-16': [],
          '2026-06-17': []
        }}
        allTasks={[]}
        statuses={mockStatuses}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        gridZoom={100}
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={960}
        onGridDrop={() => {}}
        blockedTaskIds={[]}
        onZoomChange={() => {}}
        isMobile={false}
        onMarkerDrag={() => {}}
        weatherByDate={{
          '2026-06-15': { code: 0, temp: 22 },
          '2026-06-16': { code: 1, temp: 23 },
          '2026-06-17': { code: 2, temp: 21 }
        }}
      />
    );
    
    // Should still render 3 calendar grids even with no tasks
    const grids = getAllByTestId('calendar-grid');
    expect(grids.length).toBe(3);
  });

  test('handles different grid zoom levels', () => {
    const selectedDate = new Date('2026-06-15');
    const { rerender } = render(
      <ThreeDayView
        selectedDate={selectedDate}
        dayPlacements={{
          '2026-06-15': [],
          '2026-06-16': [],
          '2026-06-17': []
        }}
        allTasks={[]}
        statuses={mockStatuses}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        gridZoom={50}
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={960}
        onGridDrop={() => {}}
        blockedTaskIds={[]}
        onZoomChange={() => {}}
        isMobile={false}
        onMarkerDrag={() => {}}
        weatherByDate={{
          '2026-06-15': { code: 0, temp: 22 },
          '2026-06-16': { code: 1, temp: 23 },
          '2026-06-17': { code: 2, temp: 21 }
        }}
      />
    );
    
    expect(screen.getAllByTestId('calendar-grid').length).toBe(3);
    
    // Test with higher zoom
    rerender(
      <ThreeDayView
        selectedDate={selectedDate}
        dayPlacements={{
          '2026-06-15': [],
          '2026-06-16': [],
          '2026-06-17': []
        }}
        allTasks={[]}
        statuses={mockStatuses}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        gridZoom={200}
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={960}
        onGridDrop={() => {}}
        blockedTaskIds={[]}
        onZoomChange={() => {}}
        isMobile={false}
        onMarkerDrag={() => {}}
        weatherByDate={{
          '2026-06-15': { code: 0, temp: 22 },
          '2026-06-16': { code: 1, temp: 23 },
          '2026-06-17': { code: 2, temp: 21 }
        }}
      />
    );
    
    expect(screen.getAllByTestId('calendar-grid').length).toBe(3);
  });
});