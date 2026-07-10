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

  // 999.1235 (2): a zero-task account must NOT be told its filters are the
  // problem — no-tasks-yet and filtered-out are distinct states.
  test('shows first-task CTA when the account has no tasks at all', () => {
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

    expect(screen.getByText(/No tasks yet — press \+ in the header/)).toBeInTheDocument();
  });

  test('shows filter-aware empty state when tasks exist but search excludes them', () => {
    render(
      <ListView
        allTasks={[{ id: 't1', text: 'Write the report', date: '2026-07-08', pri: 'P3' }]}
        statuses={{}}
        filter="open"
        search="zzz-no-match"
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

    expect(screen.getByText(/No tasks match your search or project filter/)).toBeInTheDocument();
  });
});