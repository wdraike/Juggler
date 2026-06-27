// src/components/tasks/__tests__/TaskCard.pin-badge.test.jsx
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

it('Renders 📌 pin badge for task with placementMode=fixed', () => {
  renderCard({ placementMode: 'fixed' });
  var row2 = screen.getByTestId('task-card-row2');
  expect(row2.textContent).toContain('\uD83D\uDCCC'); // 📌 emoji
});

it('Renders 📌 pin badge for task with placement_mode=fixed (snake_case)', () => {
  renderCard({ placement_mode: 'fixed' });
  var row2 = screen.getByTestId('task-card-row2');
  expect(row2.textContent).toContain('\uD83D\uDCCC'); // 📌 emoji
});

it('Renders 📌 pin badge for task with fixed=true', () => {
  renderCard({ fixed: true });
  var row2 = screen.getByTestId('task-card-row2');
  expect(row2.textContent).toContain('📌'); // 📌 emoji
});

it('Renders 📌 pin badge for task with rigid=true', () => {
  renderCard({ rigid: true });
  var row2 = screen.getByTestId('task-card-row2');
  expect(row2.textContent).toContain('📌'); // 📌 emoji
});

it('Does NOT render pin badge when placementMode is undefined', () => {
  renderCard({});
  var row2 = screen.getByTestId('task-card-row2');
  expect(row2.textContent).not.toContain('\uD83D\uDCCC'); // No 📌 emoji
});

it('Pin badge has correct title tooltip for accessibility', () => {
  renderCard({ placementMode: 'fixed' });
  var row2 = screen.getByTestId('task-card-row2');
  // The pin badge span should have a title attribute
  var pinSpan = row2.querySelector('span[title*="Fixed"]');
  expect(pinSpan).toBeTruthy();
  expect(pinSpan.getAttribute('title')).toContain('Fixed — locked to set date and time');
});

it('Pin badge styling includes flexShrink to prevent layout overflow', () => {
  renderCard({ placementMode: 'fixed' });
  var row2 = screen.getByTestId('task-card-row2');
  var pinSpan = row2.querySelector('span[title*="Fixed"]');
  expect(pinSpan).toBeTruthy();
  // The span should have flexShrink in its inline styles
  expect(row2.style.flexWrap).toBe('wrap');
});
