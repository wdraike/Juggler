// src/components/tasks/__tests__/TaskCard.overflow.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import TaskCard from '../TaskCard';

var BASE_TASK = {
  id: 'task-1',
  text: 'Fix the critical production issue before the deadline expires',
  pri: 'P1',
  dur: 90,
  date: '2026-05-20',
  time: '9:00',
  location: ['home'],
  deadline: '2026-05-20',
  overdue: true,
  status: 'wip',
  timeRemaining: 15,
  recurring: false,
  marker: false,
  _whenRelaxed: false,
  dependsOn: [],
};

function renderCard(overrides) {
  var task = Object.assign({}, BASE_TASK, overrides);
  render(
    <div style={{ width: 320 }}>
      <TaskCard
        task={task}
        status="wip"
        onStatusChange={null}
        onDelete={null}
        onExpand={null}
        darkMode={false}
        showDate={false}
        draggable={false}
        isBlocked={false}
        isMobile={false}
        allTasks={[]}
        statuses={{}}
        todayDate={new Date('2026-05-19')}
      />
    </div>
  );
}

it('Row 2 flex container has flexWrap: wrap so badges never overflow the card', () => {
  renderCard();
  var row2 = screen.getByTestId('task-card-row2');
  expect(row2.style.flexWrap).toBe('wrap');
  // jsdom normalizes minWidth: 0 to '0' (not '0px') — accept either form
  expect(['0', '0px']).toContain(row2.style.minWidth);
});

it('Card root still has overflow: hidden (preserves rounded left-border bar clipping)', () => {
  renderCard();
  var cardRoot = screen.getByTestId('task-card-root');
  expect(cardRoot.style.overflow).toBe('hidden');
});

it('Row 1 title span still has textOverflow: ellipsis and overflow: hidden (regression guard)', () => {
  renderCard();
  var titleSpan = screen.getByTestId('task-card-title');
  expect(titleSpan.style.textOverflow).toBe('ellipsis');
  expect(titleSpan.style.overflow).toBe('hidden');
});
