import React from 'react';
import { render, screen } from '@testing-library/react';
import PriorityView from '../PriorityView';

// Mock task data
const MOCK_TASKS = [
  {
    id: 'task1',
    text: 'Critical bug fix',
    date: '2026-06-15',
    project: 'work',
    pri: 'P1'
  },
  {
    id: 'task2',
    text: 'Important feature',
    date: '2026-06-15',
    project: 'work',
    pri: 'P2'
  }
];

describe('PriorityView Component', () => {
  const todayDate = new Date('2026-06-15');
  
  test('renders P1-P4 priority columns', () => {
    render(
      <PriorityView
        allTasks={MOCK_TASKS}
        statuses={{}}
        filter="open"
        darkMode={false}
        blockedTaskIds={new Set()}
        unplacedIds={new Set()}
        pastDueIds={new Set()}
        fixedIds={new Set()}
        isMobile={false}
        todayDate={todayDate}
        weatherByDate={{}}
      />
    );

    // Should show all four priority columns - use getAllByText to handle multiple matches
    expect(screen.getAllByText('P1')[0]).toBeInTheDocument();
    expect(screen.getAllByText('P2')[0]).toBeInTheDocument();
    expect(screen.getAllByText('P3')[0]).toBeInTheDocument();
    expect(screen.getAllByText('P4')[0]).toBeInTheDocument();
  });

  test('groups tasks by priority', () => {
    render(
      <PriorityView
        allTasks={MOCK_TASKS}
        statuses={{}}
        filter="open"
        darkMode={false}
        blockedTaskIds={new Set()}
        unplacedIds={new Set()}
        pastDueIds={new Set()}
        fixedIds={new Set()}
        isMobile={false}
        todayDate={todayDate}
        weatherByDate={{}}
      />
    );

    // P1 column should contain the P1 task
    expect(screen.getByText('Critical bug fix')).toBeInTheDocument();

    // P2 column should contain the P2 task
    expect(screen.getByText('Important feature')).toBeInTheDocument();
  });
});