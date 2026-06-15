import React from 'react';
import { render, screen } from '@testing-library/react';
import SCurveView from '../SCurveView';

// Mock data
const TODAY = '2026-06-15';
const selectedDate = new Date('2026-06-15'); // This is a Monday

const MOCK_TASKS = [
  {
    id: 'task1',
    text: 'Morning standup',
    date: TODAY,
    time: '09:00',
    dur: 30,
    pri: 'P1'
  }
];

const MOCK_PLACEMENTS = [{
  task: MOCK_TASKS[0],
  start: 9 * 60,
  end: 9 * 60 + 30,
  dur: 30
}];

const MOCK_SCHED_CFG = {
  locScheduleDefaults: {
    Monday: 'weekday',
    Tuesday: 'weekday',
    Wednesday: 'weekday',
    Thursday: 'weekday',
    Friday: 'weekday',
    Saturday: 'weekend',
    Sunday: 'weekend'
  },
  locScheduleOverrides: {},
  locations: [
    { id: 'office', name: 'Office', icon: '🏢' }
  ],
  timeBlocks: {
    weekday: [],
    weekend: []
  }
};

const MOCK_LOC_SCHEDULES = {
  weekday: {
    id: 'weekday',
    name: 'Weekday',
    icon: '📅',
    blocks: []
  }
};

describe('SCurveView Component', () => {
  test('renders S-curve view', () => {
    render(
      <SCurveView
        selectedDate={selectedDate}
        selectedDateKey={TODAY}
        placements={MOCK_PLACEMENTS}
        statuses={{}}
        darkMode={false}
        schedCfg={MOCK_SCHED_CFG}
        nowMins={9 * 60}
        isToday={true}
        blockedTaskIds={new Set()}
        isMobile={false}
        locSchedules={MOCK_LOC_SCHEDULES}
        weatherByDate={{}}
      />
    );

    // SCurveView renders successfully - basic smoke test
    // The component is complex with many text nodes broken up by elements
    // Test that it renders without crashing and shows progress indicator
    expect(screen.getByText('0/1')).toBeInTheDocument(); // Progress indicator
  });
});