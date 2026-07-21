import React from 'react';
import { render, screen } from '@testing-library/react';
import DailyView, { computeColumns } from '../DailyView';

// Use the real theme module. NOTE: a factory mock of the form
// `() => ({ getTheme: jest.fn().mockReturnValue({...}) })` silently returns
// undefined under this CRA/jest+babel-hoist setup (the chained mock config is
// lost at hoist time), which made getTheme() -> undefined -> theme.border crash.
// theme/colors is a plain pure function (getTheme(darkMode)) always present in
// the real app, so pass it through unmocked.
jest.mock('../../../theme/colors', () => jest.requireActual('../../../theme/colors'));

// Use the real constants module. The previous hand-rolled subset dropped
// exports (e.g. STATUS_OPTIONS) that the real child component tree
// (StatusToggle via shared/task-status) depends on, causing crashes once the
// view rendered its real children. constants.js is a pure value/helper module.
jest.mock('../../../state/constants', () => jest.requireActual('../../../state/constants'));

// NOTE: under this repo's CRA/jest setup, babel-plugin-jest-hoist neuters
// jest.fn() calls written inside a hoisted mock factory — both
// `jest.fn().mockReturnValue(x)` and `jest.fn(() => x)` lose their return value
// and yield undefined. Value-returning helpers must therefore be plain
// functions (or jest.requireActual passthroughs) in the factory.
jest.mock('../../../scheduler/dateHelpers', () => ({
  formatHour: (h) => `${h}:00`,
  formatDateKey: (date) => {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  },
  parseDate: (str) => new Date(str)
}));

// 999.2165: use the REAL timeBlockHelpers (pure shared module) — the previous
// `getBlocksForDate: () => []` stub made the block wiring untestable and hid
// the 2-arg call bug this ticket fixes. mockSchedCfg carries timeBlocks: {}
// so pre-existing tests still resolve to [] blocks, unchanged.
jest.mock('../../../scheduler/timeBlockHelpers', () =>
  jest.requireActual('../../../scheduler/timeBlockHelpers'));

jest.mock('../../../scheduler/locationHelpers', () => ({
  resolveLocationId: () => 'home',
  getLocationForDatePure: () => ({ icon: '🏠', name: 'Home' })
}));

// Use the real task-status module. The previous subset mock dropped
// TERMINAL_STATUSES, which StatusToggle (rendered via the real child tree)
// dereferences — yielding `undefined.indexOf` crashes. It is a pure module.
jest.mock('../../../shared/task-status', () => jest.requireActual('../../../shared/task-status'));

jest.mock('../../../utils/taskIcon', () => ({
  getTaskIcon: () => null
}));

jest.mock('../../../utils/weatherMatch', () => ({
  checkWeatherMatch: () => ({ ok: true }),
  hasWeatherRestrictions: () => false
}));

jest.mock('../../../utils/weatherIcons', () => ({
  weatherIconUrl: () => ''
}));

jest.mock('../../../utils/isAllDayTask', () => ({
  isAllDayTask: () => false
}));

// Mock ReactDOM.createPortal
jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (children) => children
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
  // 999.2165: DailyView now passes schedCfg.timeBlocks as the blocksMap arg —
  // the real schedCfg (AppLayout <- useConfig) always carries it.
  timeBlocks: {},
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

// ---------------------------------------------------------------------------
// 999.882 — calendar time-grid must render ALL lifecycle states, DECOUPLED
// from the open/done LIST filter. The grid shows what happened in each slot
// regardless of the list filter; terminal states render styled/dimmed + icon.
// RED-first: on current code the grid drops terminal states when filter!=='all'
// (DailyView.jsx:933) and pause/cancelled aren't even terminal in derivePlacements.
// ---------------------------------------------------------------------------
describe('DailyView — 999.882 calendar shows all lifecycle states (grid decoupled from list filter)', () => {
  // A FUTURE day so isPast === false — the bug only manifests when the
  // `isPast && isTerminalStatus` bypass (line 932) does NOT fire, i.e. the
  // grid must show terminal states on its own, not because the day is past.
  var FUTURE_KEY = '2030-06-15';
  var FUTURE_DATE = new Date('2030-06-15T12:00:00');

  // One placement per lifecycle state, each at a distinct slot (no overlap).
  function lifecyclePlacements() {
    return [
      { start: 480, end: 510, task: { id: 'open1', text: 'Open task', date: FUTURE_KEY, dur: 30 } },
      { start: 540, end: 570, task: { id: 'wip1', text: 'Started task', date: FUTURE_KEY, dur: 30 } },
      { start: 600, end: 630, task: { id: 'done1', text: 'Done task', date: FUTURE_KEY, dur: 30 } },
      { start: 660, end: 690, task: { id: 'skip1', text: 'Skipped task', date: FUTURE_KEY, dur: 30 } },
      { start: 720, end: 750, task: { id: 'missed1', text: 'Missed task', date: FUTURE_KEY, dur: 30 } },
      { start: 780, end: 810, task: { id: 'cancelled1', text: 'Cancelled task', date: FUTURE_KEY, dur: 30 } },
      { start: 840, end: 870, task: { id: 'pause1', text: 'Paused task', date: FUTURE_KEY, dur: 30 } },
    ];
  }
  // NOTE: 'missed1' keeps its placement below (the grid still shows the
  // block — any placement with a parseable start renders regardless of
  // status) but is deliberately NOT given a 'missed' status entry here.
  // 'missed' was removed as a task status in commit df8adfa (2026-06-28 —
  // "overdue is the display concept"; existing status='missed' rows were
  // migrated to status=''+overdue=1) and is no longer in TERMINAL_STATUSES or
  // STATUS_OPTIONS — see constants.test.js and derivePlacements.test.js
  // (999.998 test-rot precedent, same class of bug: telly found this exact
  // omission left over from df8adfa's "Updated all tests" sweep). Asserting a
  // literal 'missed' status value here would pin dead behavior; the "missed"
  // placement/text is retained purely so the "grid renders every placement's
  // text regardless of the list filter" assertions stay meaningful.
  var lifecycleStatuses = {
    open1: '', done1: 'done', skip1: 'skip',
    cancelled1: 'cancelled', pause1: 'pause',
  };

  function renderGrid(filter) {
    var placements = lifecyclePlacements();
    return render(
      <DailyView
        selectedDate={FUTURE_DATE}
        selectedDateKey={FUTURE_KEY}
        placements={placements}
        allTasks={placements.map(function (p) { return p.task; })}
        statuses={lifecycleStatuses}
        filter={filter}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={0}
        isToday={false}
        blockedTaskIds={new Set()}
        unplacedIds={new Set()}
        pastDueIds={new Set()}
        fixedIds={new Set()}
        isMobile={false}
        weatherByDate={{}}
      />
    );
  }

  test('with list filter=open, the GRID renders EVERY lifecycle state block (terminal states not dropped)', () => {
    renderGrid('open');
    // Active states already render today — these are the regression guards.
    expect(screen.getByText('Open task')).toBeInTheDocument();
    expect(screen.getByText('Started task')).toBeInTheDocument();
    // Terminal states — DROPPED by the buggy filter coupling (RED before fix).
    expect(screen.getByText('Done task')).toBeInTheDocument();
    expect(screen.getByText('Skipped task')).toBeInTheDocument();
    expect(screen.getByText('Missed task')).toBeInTheDocument();
    expect(screen.getByText('Cancelled task')).toBeInTheDocument();
    expect(screen.getByText('Paused task')).toBeInTheDocument();
  });

  test('each terminal lifecycle state shows its status icon on the grid card', () => {
    renderGrid('open');
    expect(screen.getAllByText('✓').length).toBeGreaterThan(0);   // done ✓
    expect(screen.getAllByText('⏭').length).toBeGreaterThan(0);   // skip ⏭
    // 'missed' status icon assertion removed — 'missed' is no longer a
    // valid status (df8adfa, 2026-06-28); TaskBlock has no icon branch for it.
    expect(screen.getAllByText('⏸').length).toBeGreaterThan(0);   // pause ⏸
    expect(screen.getAllByText('✗').length).toBeGreaterThan(0);   // cancelled ✗
  });

  test('grid is decoupled from the list filter: terminal blocks render under filter=action too', () => {
    renderGrid('action');
    expect(screen.getByText('Done task')).toBeInTheDocument();
    expect(screen.getByText('Missed task')).toBeInTheDocument();
    expect(screen.getByText('Paused task')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 999.2034 — split chunks must coalesce into ONE display block on DailyView.
// The scheduler splits a task into N chunks (split_ordinal/split_total); the
// UI must merge same-occurrence chunks into a single card (R56). DailyView
// was the only grid NOT applying coalesceAdjacentSplitChunks, so split tasks
// showed N overlapping cards instead of one. This test pins the fix.
// ---------------------------------------------------------------------------
describe('DailyView — 999.2034 split chunks coalesce into one display block', () => {
  var DATE_KEY = '2030-06-15';
  var DATE = new Date('2030-06-15T12:00:00');

  function splitChunksPlacements() {
    // 4 chunks of the same occurrence, same splitGroup, 60 min each.
    return [
      { start: 1200, end: 1260, dur: 60, splitOrdinal: 1, splitTotal: 4,
        task: { id: 'split-1', text: 'Apply for Jobs', date: DATE_KEY, dur: 60, sourceId: 'master-1', splitGroup: 'occ-1' } },
      { start: 1395, end: 1455, dur: 60, splitOrdinal: 2, splitTotal: 4,
        task: { id: 'split-2', text: 'Apply for Jobs', date: DATE_KEY, dur: 60, sourceId: 'master-1', splitGroup: 'occ-1' } },
      { start: 1560, end: 1620, dur: 60, splitOrdinal: 3, splitTotal: 4,
        task: { id: 'split-3', text: 'Apply for Jobs', date: DATE_KEY, dur: 60, sourceId: 'master-1', splitGroup: 'occ-1' } },
      { start: 1740, end: 1800, dur: 60, splitOrdinal: 4, splitTotal: 4,
        task: { id: 'split-4', text: 'Apply for Jobs', date: DATE_KEY, dur: 60, sourceId: 'master-1', splitGroup: 'occ-1' } },
    ];
  }

  test('4 split chunks of one occurrence render as ONE card (not 4)', () => {
    var placements = splitChunksPlacements();
    render(
      <DailyView
        selectedDate={DATE}
        selectedDateKey={DATE_KEY}
        placements={placements}
        allTasks={placements.map(function (p) { return p.task; })}
        statuses={{}}
        onStatusChange={() => {}}
        onDelete={() => {}}
        onExpand={() => {}}
        darkMode={false}
        schedCfg={mockSchedCfg}
        nowMins={0}
        isToday={false}
        blockedTaskIds={new Set()}
        unplacedIds={new Set()}
        pastDueIds={new Set()}
        fixedIds={new Set()}
        isMobile={false}
        weatherByDate={{}}
      />
    );
    // 'Apply for Jobs' should appear exactly ONCE — coalesced into one card.
    // Before the fix it appeared 4 times (one per chunk).
    var cards = screen.getAllByText('Apply for Jobs');
    expect(cards).toHaveLength(1);
  });
});
// 999.2165 — DailyView used to call getBlocksForDate(dateKey, schedCfg) (2 args:
// blocksMap=schedCfg, cfg=undefined), so blocks were ALWAYS [] and neither the
// time-block accent bands nor block-aware hour locations ever rendered, and
// canonical template day-assignments (999.2161) never reached DailyView.
test('renders time-block accent bands from a canonical template day assignment (999.2165)', () => {
  const cfg = {
    timeBlocks: {},
    locScheduleDefaults: {},
    locScheduleOverrides: {},
    scheduleTemplates: {
      weekday: { blocks: [{ id: 'b1', tag: 'biz', name: 'Biz', start: 540, end: 720, loc: 'work' }] }
    },
    templateDefaults: { Mon: 'weekday' }
  };
  const { getAllByTestId } = render(
    <DailyView
      selectedDate={new Date('2026-06-15')} // a Monday
      selectedDateKey="2026-06-15"
      dayPlacements={{}}
      allTasks={[]}
      statuses={{}}
      onStatusChange={() => {}}
      onDelete={() => {}}
      onExpand={() => {}}
      gridZoom={100}
      darkMode={false}
      schedCfg={cfg}
      nowMins={960}
      onGridDrop={() => {}}
      blockedTaskIds={[]}
      onZoomChange={() => {}}
      isMobile={false}
      onMarkerDrag={() => {}}
      weatherByDate={{}}
    />
  );
  expect(getAllByTestId('day-block-band').length).toBe(1);
});
