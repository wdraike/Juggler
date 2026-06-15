import React from 'react';
import { render, screen } from '@testing-library/react';
import ThreeDayView from '../ThreeDayView';

// Mock the dependencies that ThreeDayView uses
jest.mock('../../../theme/colors', () => ({
  getTheme: jest.fn().mockReturnValue({
    bg: '#ffffff',
    bgCard: '#f8f9fa',
    text: '#212529',
    textMuted: '#6c757d',
    border: '#dee2e6',
    accent: '#0d6efd',
    shadow: 'rgba(0, 0, 0, 0.1)',
    projectBadgeBg: '#e7f1ff',
    projectBadgeText: '#004085',
    bgTertiary: '#f1f3f5',
    error: '#dc3545',
    amberText: '#ffc107'
  })
}));

jest.mock('../../../state/constants', () => ({
  DAY_NAMES: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
}));

jest.mock('../../../scheduler/dateHelpers', () => ({
  formatDateKey: jest.fn().mockImplementation((date) => {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  })
}));

jest.mock('../../../scheduler/locationHelpers', () => ({
  getLocationForDatePure: jest.fn().mockReturnValue({ icon: '🏠', name: 'Home' })
}));

jest.mock('../../schedule/CalendarGrid', () => ({
  __esModule: true,
  default: jest.fn(({ dateKey, placements }) => (
    <div data-testid="calendar-grid" data-date={dateKey}>
      {placements.length} tasks
    </div>
  ))
}));

jest.mock('../AllDayBanner', () => ({
  __esModule: true,
  default: jest.fn(() => <div data-testid="all-day-banner">All Day Banner</div>)
}));

jest.mock('../../features/WeatherBadge', () => ({
  __esModule: true,
  default: jest.fn(() => <div data-testid="weather-badge">Weather</div>)
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