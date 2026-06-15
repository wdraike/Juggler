import React from 'react';
import { render, screen } from '@testing-library/react';
import TimelineView from '../TimelineView';

// Mock the dependencies that TimelineView uses
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
  MONTH_NAMES: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  DAY_NAMES_FULL: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  DAY_NAMES: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
}));

jest.mock('../../../scheduler/locationHelpers', () => ({
  getLocationForDatePure: jest.fn().mockReturnValue({ icon: '🏠', name: 'Home' })
}));

jest.mock('../../schedule/HorizontalTimeline', () => ({
  __esModule: true,
  default: jest.fn(({ placements }) => (
    <div data-testid="horizontal-timeline">
      {placements.length} tasks on timeline
    </div>
  ))
}));

jest.mock('../../features/WeatherBadge', () => ({
  __esModule: true,
  default: jest.fn(() => <div data-testid="weather-badge">Weather</div>)
}));

const mockTasks = [
  {
    id: 't1',
    text: 'Morning Task',
    pri: 'P1',
    dur: 120,
    start: 480,
    end: 600,
    task: {
      id: 't1',
      text: 'Morning Task',
      pri: 'P1',
      dur: 120
    }
  }
];

const mockStatuses = {
  't1': 'done'
};

const mockSchedCfg = {
  locScheduleDefaults: {
    '1': 'weekday',
    '2': 'weekday',
    '3': 'weekday',
    '4': 'weekday',
    '5': 'weekday',
    '6': 'weekend',
    '0': 'weekend'
  },
  locScheduleOverrides: {}
};

const mockLocSchedules = {
  'weekday': { icon: '🏢', name: 'Weekday' },
  'weekend': { icon: '🏡', name: 'Weekend' }
};

const mockLocations = [
  { id: 'home', name: 'Home', icon: '🏠' },
  { id: 'office', name: 'Office', icon: '🏢' }
];

describe('TimelineView Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders horizontal timeline with tasks', () => {
    const selectedDate = new Date('2026-06-15'); // Monday
    
    render(
      <TimelineView
        selectedDate={selectedDate}
        selectedDateKey="2026-06-15"
        placements={mockTasks}
        statuses={mockStatuses}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        onCreate={() => {}}
        gridZoom={100}
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={960} // 4:00 PM
        isToday={true}
        onGridDrop={() => {}}
        locSchedules={mockLocSchedules}
        onUpdateLocScheduleOverrides={() => {}}
        allTasks={mockTasks}
        onBatchRecurringsDone={() => {}}
        locations={mockLocations}
        onHourLocationOverride={() => {}}
        blockedTaskIds={[]}
        onZoomChange={() => {}}
        isMobile={false}
        onMarkerDrag={() => {}}
        weatherByDate={{
          '2026-06-15': { code: 0, temp: 22 }
        }}
      />
    );
    
    // Should render the horizontal timeline component
    expect(screen.getByTestId('horizontal-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('horizontal-timeline')).toHaveTextContent('1 tasks on timeline');
    
    // Should render weather badge
    expect(screen.getByTestId('weather-badge')).toBeInTheDocument();
  });

  test('shows progress bar with correct completion percentage', () => {
    const selectedDate = new Date('2026-06-15');
    
    render(
      <TimelineView
        selectedDate={selectedDate}
        selectedDateKey="2026-06-15"
        placements={mockTasks}
        statuses={mockStatuses}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        onCreate={() => {}}
        gridZoom={100}
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={960}
        isToday={true}
        onGridDrop={() => {}}
        locSchedules={mockLocSchedules}
        onUpdateLocScheduleOverrides={() => {}}
        allTasks={mockTasks}
        onBatchRecurringsDone={() => {}}
        locations={mockLocations}
        onHourLocationOverride={() => {}}
        blockedTaskIds={[]}
        onZoomChange={() => {}}
        isMobile={false}
        onMarkerDrag={() => {}}
        weatherByDate={{
          '2026-06-15': { code: 0, temp: 22 }
        }}
      />
    );
    
    // Should show progress (1/1 tasks done, 2.0h / 2.0h)
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByText('2.0h / 2.0h')).toBeInTheDocument();
  });

  test('handles different grid zoom levels', () => {
    const selectedDate = new Date('2026-06-15');
    const { rerender } = render(
      <TimelineView
        selectedDate={selectedDate}
        selectedDateKey="2026-06-15"
        placements={mockTasks}
        statuses={mockStatuses}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        onCreate={() => {}}
        gridZoom={50}
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={960}
        isToday={true}
        onGridDrop={() => {}}
        locSchedules={mockLocSchedules}
        onUpdateLocScheduleOverrides={() => {}}
        allTasks={mockTasks}
        onBatchRecurringsDone={() => {}}
        locations={mockLocations}
        onHourLocationOverride={() => {}}
        blockedTaskIds={[]}
        onZoomChange={() => {}}
        isMobile={false}
        onMarkerDrag={() => {}}
        weatherByDate={{
          '2026-06-15': { code: 0, temp: 22 }
        }}
      />
    );
    
    expect(screen.getByTestId('horizontal-timeline')).toBeInTheDocument();
    
    // Test with higher zoom
    rerender(
      <TimelineView
        selectedDate={selectedDate}
        selectedDateKey="2026-06-15"
        placements={mockTasks}
        statuses={mockStatuses}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        onCreate={() => {}}
        gridZoom={200}
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={960}
        isToday={true}
        onGridDrop={() => {}}
        locSchedules={mockLocSchedules}
        onUpdateLocScheduleOverrides={() => {}}
        allTasks={mockTasks}
        onBatchRecurringsDone={() => {}}
        locations={mockLocations}
        onHourLocationOverride={() => {}}
        blockedTaskIds={[]}
        onZoomChange={() => {}}
        isMobile={false}
        onMarkerDrag={() => {}}
        weatherByDate={{
          '2026-06-15': { code: 0, temp: 22 }
        }}
      />
    );
    
    expect(screen.getByTestId('horizontal-timeline')).toBeInTheDocument();
  });

  test('handles empty timeline gracefully', () => {
    const selectedDate = new Date('2026-06-15');
    
    render(
      <TimelineView
        selectedDate={selectedDate}
        selectedDateKey="2026-06-15"
        placements={[]}
        statuses={mockStatuses}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        onCreate={() => {}}
        gridZoom={100}
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={960}
        isToday={true}
        onGridDrop={() => {}}
        locSchedules={mockLocSchedules}
        onUpdateLocScheduleOverrides={() => {}}
        allTasks={[]}
        onBatchRecurringsDone={() => {}}
        locations={mockLocations}
        onHourLocationOverride={() => {}}
        blockedTaskIds={[]}
        onZoomChange={() => {}}
        isMobile={false}
        onMarkerDrag={() => {}}
        weatherByDate={{
          '2026-06-15': { code: 0, temp: 22 }
        }}
      />
    );
    
    // Should render without errors even with no tasks
    expect(screen.getByTestId('horizontal-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('horizontal-timeline')).toHaveTextContent('0 tasks on timeline');
    
    // Progress should show 0/0
    expect(screen.getByText('0/0')).toBeInTheDocument();
  });
});