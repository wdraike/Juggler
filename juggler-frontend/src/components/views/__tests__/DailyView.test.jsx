import React from 'react';
import { render, screen } from '@testing-library/react';
import DailyView, { computeColumns } from '../DailyView';

// Mock the dependencies that DailyView uses
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
  GRID_START: 6,
  GRID_END: 22,
  PRI_COLORS: {
    P1: '#dc3545',
    P2: '#fd7e14',
    P3: '#0d6efd',
    P4: '#6c757d'
  },
  STATUS_MAP: {},
  MONTH_NAMES: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  DAY_NAMES_FULL: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  DAY_NAMES: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  locIcon: jest.fn().mockReturnValue('📍'),
  LOC_TINT: jest.fn().mockReturnValue('#ffffff'),
  locBgTint: jest.fn().mockReturnValue('#f8f9fa'),
  WHEN_TAG_ICONS: {},
  DEFAULT_TOOLS: [],
  PAST_OPACITY: 0.35
}));

jest.mock('../../../scheduler/dateHelpers', () => ({
  formatHour: jest.fn().mockImplementation((h) => `${h}:00`),
  formatDateKey: jest.fn().mockImplementation((date) => {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  }),
  parseDate: jest.fn().mockImplementation((str) => new Date(str))
}));

jest.mock('../../../scheduler/timeBlockHelpers', () => ({
  getBlocksForDate: jest.fn().mockReturnValue([]),
  parseWhen: jest.fn().mockReturnValue([])
}));

jest.mock('../../../scheduler/locationHelpers', () => ({
  resolveLocationId: jest.fn().mockReturnValue('home'),
  getLocationForDatePure: jest.fn().mockReturnValue({ icon: '🏠', name: 'Home' })
}));

jest.mock('../../../shared/task-status', () => ({
  isTerminalStatus: jest.fn().mockReturnValue(false)
}));

jest.mock('../../../utils/taskIcon', () => ({
  getTaskIcon: jest.fn().mockReturnValue(null)
}));

jest.mock('../../../utils/weatherMatch', () => ({
  checkWeatherMatch: jest.fn().mockReturnValue({ ok: true }),
  hasWeatherRestrictions: jest.fn().mockReturnValue(false)
}));

jest.mock('../../../utils/weatherIcons', () => ({
  weatherIconUrl: jest.fn().mockReturnValue('')
}));

jest.mock('../../../utils/isAllDayTask', () => ({
  isAllDayTask: jest.fn().mockReturnValue(false)
}));

// Mock ReactDOM.createPortal
jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: jest.fn((children) => children)
}));

const mockTasks = [
  {
    id: 't1',
    text: 'Morning meeting',
    pri: 'P1',
    dur: 60,
    start: 480, // 8:00 AM
    end: 540, // 9:00 AM
    task: {
      id: 't1',
      text: 'Morning meeting',
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

describe('DailyView Component', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  test('renders without crashing', () => {
    render(
      <DailyView
        selectedDate={new Date('2026-06-15')}
        dayPlacements={{
          '2026-06-15': mockTasks
        }}
        allTasks={mockTasks}
        statuses={mockStatuses}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        gridZoom={100}
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={960} // 4:00 PM
        onGridDrop={() => {}}
        blockedTaskIds={[]}
        onZoomChange={() => {}}
        isMobile={false}
        onMarkerDrag={() => {}}
        weatherByDate={{
          '2026-06-15': { code: 0, temp: 22 }
        }}
      />
    );
    
    // Basic render test - just check that it doesn't crash
    expect(true).toBe(true);
  });

  test('renders empty state when no tasks', () => {
    const { container } = render(
      <DailyView
        selectedDate={new Date('2026-06-15')}
        dayPlacements={{
          '2026-06-15': []
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
          '2026-06-15': { code: 0, temp: 22 }
        }}
      />
    );
    
    // Should render without errors even with no tasks
    expect(container).toBeTruthy();
  });

  test('handles different grid zoom levels', () => {
    const { rerender } = render(
      <DailyView
        selectedDate={new Date('2026-06-15')}
        dayPlacements={{
          '2026-06-15': mockTasks
        }}
        allTasks={mockTasks}
        statuses={mockStatuses}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        gridZoom={50} // Half zoom
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={960}
        onGridDrop={() => {}}
        blockedTaskIds={[]}
        onZoomChange={() => {}}
        isMobile={false}
        onMarkerDrag={() => {}}
        weatherByDate={{
          '2026-06-15': { code: 0, temp: 22 }
        }}
      />
    );
    
    expect(true).toBe(true); // Basic render test
    
    // Test with higher zoom
    rerender(
      <DailyView
        selectedDate={new Date('2026-06-15')}
        dayPlacements={{
          '2026-06-15': mockTasks
        }}
        allTasks={mockTasks}
        statuses={mockStatuses}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        gridZoom={200} // Double zoom
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={960}
        onGridDrop={() => {}}
        blockedTaskIds={[]}
        onZoomChange={() => {}}
        isMobile={false}
        onMarkerDrag={() => {}}
        weatherByDate={{
          '2026-06-15': { code: 0, temp: 22 }
        }}
      />
    );
    
    expect(true).toBe(true); // Should still render
  });
});

/*
 * M-SCH-2 (backlog 999.579) — adjacent same-task chunk collapse.
 *
 * computeColumns() merges visually-adjacent split chunks of the SAME task into a
 * single block. Two chunks merge when (a) they share a source identity
 * (task.sourceId or task.splitGroup) AND (b) the next chunk starts exactly where
 * the previous one ends (curr.start === prev.end). The merged block spans the
 * full range and carries `_mergedChunks` = the count of chunks folded in.
 *
 * hourHeight = 60 → 1 minute == 1px, so layout math is trivial to reason about.
 */
describe('computeColumns — adjacent same-task chunk collapse (M-SCH-2 / 999.579)', () => {
  const HOUR_H = 60; // 1px per minute

  function chunk(sourceId, start, end, extra) {
    return Object.assign({ start, end, task: { id: sourceId, sourceId, dur: end - start } }, extra || {});
  }

  test('merges two adjacent chunks of the same task into one block', () => {
    const placements = [
      chunk('A', 480, 510), // 8:00–8:30
      chunk('A', 510, 540), // 8:30–9:00 (adjacent → merge)
    ];
    const result = computeColumns(placements, HOUR_H);

    expect(result).toHaveLength(1);
    const block = result[0];
    expect(block.p.task.sourceId).toBe('A');
    expect(block.p._mergedChunks).toBe(2);
    // Spans the full 60 minutes → 60px tall at 1px/min.
    expect(block.height).toBe(60);
  });

  test('merges three consecutive adjacent chunks into one block', () => {
    const placements = [
      chunk('A', 480, 510),
      chunk('A', 510, 540),
      chunk('A', 540, 570),
    ];
    const result = computeColumns(placements, HOUR_H);

    expect(result).toHaveLength(1);
    expect(result[0].p._mergedChunks).toBe(3);
    expect(result[0].height).toBe(90); // 480→570 = 90 min
  });

  test('does NOT merge chunks of the same task that are NOT time-adjacent (a gap)', () => {
    const placements = [
      chunk('A', 480, 510), // 8:00–8:30
      chunk('A', 540, 570), // 9:00–9:30 (30-min gap → keep separate)
    ];
    const result = computeColumns(placements, HOUR_H);

    expect(result).toHaveLength(2);
    result.forEach((b) => expect(b.p._mergedChunks).toBeUndefined());
  });

  test('does NOT merge adjacent chunks belonging to DIFFERENT tasks', () => {
    const placements = [
      chunk('A', 480, 510),
      chunk('B', 510, 540), // adjacent in time but different source → keep separate
    ];
    const result = computeColumns(placements, HOUR_H);

    expect(result).toHaveLength(2);
    // Different sources at the same time slot → laid out in separate columns.
    expect(result.map((b) => b.p.task.sourceId).sort()).toEqual(['A', 'B']);
  });

  test('merges on splitGroup when sourceId is absent', () => {
    const placements = [
      { start: 480, end: 510, task: { id: 'x1', splitGroup: 'G' } },
      { start: 510, end: 540, task: { id: 'x2', splitGroup: 'G' } },
    ];
    const result = computeColumns(placements, HOUR_H);

    expect(result).toHaveLength(1);
    expect(result[0].p._mergedChunks).toBe(2);
  });

  test('chunks with no source identity never merge (one-off tasks)', () => {
    const placements = [
      { start: 480, end: 510, task: { id: 'o1' } },
      { start: 510, end: 540, task: { id: 'o2' } },
    ];
    const result = computeColumns(placements, HOUR_H);

    expect(result).toHaveLength(2);
    result.forEach((b) => expect(b.p._mergedChunks).toBeUndefined());
  });

  test('derives chunk end from start + task.dur when end is omitted', () => {
    const placements = [
      { start: 480, task: { id: 'A', sourceId: 'A', dur: 30 } }, // 480–510
      { start: 510, task: { id: 'A', sourceId: 'A', dur: 30 } }, // 510–540 adjacent
    ];
    const result = computeColumns(placements, HOUR_H);

    expect(result).toHaveLength(1);
    expect(result[0].p._mergedChunks).toBe(2);
    expect(result[0].height).toBe(60);
  });
});