import React from 'react';
import { render, screen } from '@testing-library/react';
import ListView from '../ListView';

// Mock task data
const TODAY = '2026-06-15';

const MOCK_TASKS = [
  {
    id: 'task1',
    text: 'Complete project documentation',
    date: TODAY,
    project: 'work',
    pri: 'P1'
  },
  {
    id: 'task2',
    text: 'Review code changes',
    date: TODAY,
    project: 'work',
    pri: 'P2'
  }
];

const MOCK_SCHED_CFG = {
  locScheduleDefaults: {},
  locScheduleOverrides: {},
  timeBlocks: []
};

describe('ListView Component', () => {
  const todayDate = new Date(TODAY);
  
  test('renders tasks', () => {
    render(
      <ListView
        allTasks={MOCK_TASKS}
        statuses={{}}
        filter="open"
        darkMode={false}
        schedCfg={MOCK_SCHED_CFG}
        blockedTaskIds={new Set()}
        unplacedIds={new Set()}
        pastDueIds={new Set()}
        fixedIds={new Set()}
        isMobile={false}
        todayDate={todayDate}
        weatherByDate={{}}
        onCreate={() => {}}
      />
    );

    // Should render all tasks
    expect(screen.getByText('Complete project documentation')).toBeInTheDocument();
    expect(screen.getByText('Review code changes')).toBeInTheDocument();
  });

  test('shows empty state when no tasks match filters', () => {
    render(
      <ListView
        allTasks={[]}
        statuses={{}}
        filter="open"
        darkMode={false}
        schedCfg={MOCK_SCHED_CFG}
        blockedTaskIds={new Set()}
        unplacedIds={new Set()}
        pastDueIds={new Set()}
        fixedIds={new Set()}
        isMobile={false}
        todayDate={todayDate}
        weatherByDate={{}}
        onCreate={() => {}}
      />
    );

    expect(screen.getByText('No tasks match current filters')).toBeInTheDocument();
  });
});