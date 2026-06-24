import React from 'react';
import { render, screen } from '@testing-library/react';
import TimelineView from '../TimelineView';

// Use the real theme module. NOTE: a factory mock of the form
// `() => ({ getTheme: jest.fn().mockReturnValue({...}) })` silently returns
// undefined under this CRA/jest+babel-hoist setup (the chained mock config is
// lost at hoist time), which made getTheme() -> undefined -> theme.border crash.
// theme/colors is a plain pure function (getTheme(darkMode)) always present in
// the real app, so pass it through unmocked.
jest.mock('../../../theme/colors', () => jest.requireActual('../../../theme/colors'));

jest.mock('../../../state/constants', () => ({
  MONTH_NAMES: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  DAY_NAMES_FULL: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  DAY_NAMES: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
}));

// NOTE: under this repo's CRA/jest setup, babel-plugin-jest-hoist neuters
// jest.fn() calls written inside a hoisted mock factory — both
// `jest.fn().mockReturnValue(x)` and `jest.fn(() => x)` lose their value and
// yield undefined. Use plain functions in the factory so mocks actually return.
jest.mock('../../../scheduler/locationHelpers', () => ({
  getLocationForDatePure: () => ({ icon: '🏠', name: 'Home' })
}));

jest.mock('../../schedule/HorizontalTimeline', () => ({
  __esModule: true,
  default: ({ placements }) => (
    <div data-testid="horizontal-timeline">
      {placements.length} tasks on timeline
    </div>
  )
}));

jest.mock('../../features/WeatherBadge', () => ({
  __esModule: true,
  default: () => <div data-testid="weather-badge">Weather</div>
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
    
    // Should show progress (1/1 tasks done, (2h / 2h)). The component rounds
    // hours via Math.round(mins/60*10)/10, so 120min -> 2 (not "2.0"), and
    // renders the duration span wrapped in parens: "(2h / 2h)".
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByText('(2h / 2h)')).toBeInTheDocument();
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