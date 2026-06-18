import React from 'react';
import { render, screen } from '@testing-library/react';
import WeekView from '../WeekView';

// Minimal schedCfg to avoid crashes in CalendarGrid/getBlocksForDate
var SCHED_CFG = { timeBlocks: [], locScheduleOverrides: {}, locScheduleDefaults: {} };

// A Wednesday in the test week
var WEDNESDAY = '2026-05-20';
var SELECTED_DATE = new Date(2026, 4, 19); // Monday May 19 (week contains May 20)

// placement_mode-based contract (Phase 15+); legacy when='allday' fallback removed.
var ALL_DAY_TASK = {
  id: 'ad1',
  text: 'All-day Wednesday',
  placement_mode: 'all_day',
  date: WEDNESDAY,
};

var TIMED_TASK = {
  id: 'tm1',
  text: 'Timed task',
  when: 'morning',
  date: WEDNESDAY,
  time: '09:00',
  dur: 30,
};

var DAY_PLACEMENTS = {
  [WEDNESDAY]: [
    { task: TIMED_TASK, start: 9 * 60, end: 9 * 60 + 30, dur: 30 }
  ]
};

test('WeekView renders AllDayBanner for all-day task in its column', () => {
  render(
    <WeekView
      selectedDate={SELECTED_DATE}
      dayPlacements={DAY_PLACEMENTS}
      allTasks={[ALL_DAY_TASK, TIMED_TASK]}
      statuses={{}}
      onStatusChange={() => {}}
      onDelete={() => {}}
      onExpand={() => {}}
      gridZoom={60}
      darkMode={false}
      schedCfg={SCHED_CFG}
      nowMins={600}
      onGridDrop={() => {}}
      blockedTaskIds={new Set()}
      onZoomChange={() => {}}
      isMobile={false}
      onMarkerDrag={() => {}}
      weatherByDate={{}}
    />
  );
  // The all-day banner should contain the task text
  expect(screen.getByText('All-day Wednesday')).toBeInTheDocument();
  // There should be an all-day-banner testid
  expect(screen.getByTestId('all-day-banner')).toBeInTheDocument();
});

test('WeekView does NOT render all-day task inside CalendarGrid timed area', () => {
  render(
    <WeekView
      selectedDate={SELECTED_DATE}
      dayPlacements={DAY_PLACEMENTS}
      allTasks={[ALL_DAY_TASK, TIMED_TASK]}
      statuses={{}}
      onStatusChange={() => {}}
      onDelete={() => {}}
      onExpand={() => {}}
      gridZoom={60}
      darkMode={false}
      schedCfg={SCHED_CFG}
      nowMins={600}
      onGridDrop={() => {}}
      blockedTaskIds={new Set()}
      onZoomChange={() => {}}
      isMobile={false}
      onMarkerDrag={() => {}}
      weatherByDate={{}}
    />
  );
  // The all-day task chip in the banner
  var banner = screen.getByTestId('all-day-banner');
  expect(banner).toHaveTextContent('All-day Wednesday');
  // The all-day task text should only appear once (inside the banner, not in the grid)
  var allMatches = screen.getAllByText('All-day Wednesday');
  expect(allMatches).toHaveLength(1);
});

test('WeekView column shows no banner when day has no all-day tasks', () => {
  render(
    <WeekView
      selectedDate={SELECTED_DATE}
      dayPlacements={{}}
      allTasks={[TIMED_TASK]}
      statuses={{}}
      onStatusChange={() => {}}
      onDelete={() => {}}
      onExpand={() => {}}
      gridZoom={60}
      darkMode={false}
      schedCfg={SCHED_CFG}
      nowMins={600}
      onGridDrop={() => {}}
      blockedTaskIds={new Set()}
      onZoomChange={() => {}}
      isMobile={false}
      onMarkerDrag={() => {}}
      weatherByDate={{}}
    />
  );
  // No all-day task means no banner
  expect(screen.queryByTestId('all-day-banner')).toBeNull();
});
