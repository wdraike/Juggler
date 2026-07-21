import React from 'react';
import { render, screen } from '@testing-library/react';
import DependencyView from '../DependencyView';

// Mock task data with dependencies
const MOCK_TASKS = [
  {
    id: 'task1',
    text: 'Design database schema',
    date: '2026-06-15',
    project: 'backend',
    pri: 'P1',
    dependsOn: []  // No dependencies
  },
  {
    id: 'task2',
    text: 'Implement API endpoints',
    date: '2026-06-16',
    project: 'backend',
    pri: 'P2',
    dependsOn: ['task1']  // Depends on task1
  },
  {
    id: 'task3',
    text: 'Write unit tests',
    date: '2026-06-17',
    project: 'backend',
    pri: 'P3',
    dependsOn: ['task2']  // Depends on task2
  }
];

describe('DependencyView Component', () => {
  test('renders dependency graph with tasks that have dependencies', async () => {
    render(
      <DependencyView
        allTasks={MOCK_TASKS}
        statuses={{}}
        projectFilter={null}
        filter="all"
        search=""
        pastDueIds={new Set()}
        fixedIds={new Set()}
        onUpdate={() => {}}
        onExpand={() => {}}
        darkMode={false}
        isMobile={false}
      />
    );

    // The async ELK layout window now renders a skeleton (999.2122) —
    // await the laid-out toolbar instead of asserting synchronously.
    expect(await screen.findByText(/\d+ tasks with dependencies/)).toBeInTheDocument();
    expect(screen.getByText('−')).toBeInTheDocument(); // Zoom out button
    expect(screen.getByText('+')).toBeInTheDocument(); // Zoom in button
    expect(screen.getByText('100%')).toBeInTheDocument(); // Zoom level
  });

  test('shows empty state when no tasks have dependencies', () => {
    const independentTasks = [
      {
        id: 'task1',
        text: 'Standalone task 1',
        date: '2026-06-15',
        project: 'work',
        pri: 'P3',
        dependsOn: []
      }
    ];

    render(
      <DependencyView
        allTasks={independentTasks}
        statuses={{}}
        filter="all"
        darkMode={false}
        isMobile={false}
      />
    );

    expect(screen.getByText('No tasks with dependencies. Use the project filter to view a project\'s tasks.')).toBeInTheDocument();
  });
});