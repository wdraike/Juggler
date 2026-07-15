// src/components/tasks/__tests__/TaskCard.addFailed-badge.test.jsx
//
// 999.1631 — visible marker for a bulk-add task that failed to save
// (`_addFailed: true`, set by useTaskState.js's SET_ADD_FAILED, 999.1571).
// Mirrors TaskCard.pin-badge.test.jsx's render helper + assertion shape.
import React from 'react';
import { render, screen } from '@testing-library/react';
import TaskCard from '../TaskCard';

var BASE_TASK = {
  id: 'task-1',
  text: 'Test task',
  pri: 'P1',
  dur: 60,
  date: '2026-05-20',
  time: '9:00',
  location: [],
  deadline: null,
  overdue: false,
  status: '',
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
        status=""
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

it('Renders a "Not saved" badge for a task flagged _addFailed', () => {
  renderCard({ _addFailed: true });
  var row2 = screen.getByTestId('task-card-row2');
  expect(row2.textContent).toContain('Not saved');
});

it('Does NOT render the "Not saved" badge for a normal (non-failed) task', () => {
  renderCard({});
  var row2 = screen.getByTestId('task-card-row2');
  expect(row2.textContent).not.toContain('Not saved');
});

it('Does NOT render the badge once _addFailed clears (retry succeeded)', () => {
  renderCard({ _addFailed: false });
  var row2 = screen.getByTestId('task-card-row2');
  expect(row2.textContent).not.toContain('Not saved');
});
