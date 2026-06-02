import React from 'react';
import { render, screen } from '@testing-library/react';
import AllDayBanner from '../AllDayBanner';

var TASKS = [
  { id: 't1', text: 'Morning run', when: 'morning', date: '2026-05-18' },
  { id: 't2', text: 'All-day meditation', placementMode: 'all_day', date: '2026-05-18' },
  { id: 't3', text: 'Hospital appt', isAllDay: true, date: '2026-05-18' },
  { id: 't4', text: 'Other day task', placementMode: 'all_day', date: '2026-05-19' },
];

var STATUSES = {};

test('renders only all-day tasks for the given dateKey', () => {
  render(
    <AllDayBanner
      allTasks={TASKS}
      dateKey="2026-05-18"
      statuses={STATUSES}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  expect(screen.getByText('All-day meditation')).toBeInTheDocument();
  expect(screen.getByText('Hospital appt')).toBeInTheDocument();
  expect(screen.queryByText('Morning run')).not.toBeInTheDocument();
  expect(screen.queryByText('Other day task')).not.toBeInTheDocument();
});

test('returns null when no all-day items for dateKey', () => {
  var { container } = render(
    <AllDayBanner
      allTasks={TASKS}
      dateKey="2026-05-20"
      statuses={STATUSES}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  expect(container.firstChild).toBeNull();
});

test('shows done glyph and line-through for done status', () => {
  render(
    <AllDayBanner
      allTasks={[{ id: 't2', text: 'All-day meditation', placementMode: 'all_day', date: '2026-05-18' }]}
      dateKey="2026-05-18"
      statuses={{ t2: 'done' }}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  var chip = screen.getByText('All-day meditation').closest('[data-testid="all-day-chip"]');
  expect(chip).not.toBeNull();
  expect(chip.style.textDecoration).toMatch(/line-through/);
});

test('shows skip glyph for skip status', () => {
  render(
    <AllDayBanner
      allTasks={[{ id: 't2', text: 'All-day meditation', placementMode: 'all_day', date: '2026-05-18' }]}
      dateKey="2026-05-18"
      statuses={{ t2: 'skip' }}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  // The skip glyph ⏭ should be present
  expect(screen.getByText('⏭')).toBeInTheDocument();
});

test('applies reduced opacity on past day done items when isPastDay=true', () => {
  render(
    <AllDayBanner
      allTasks={[{ id: 't2', text: 'All-day meditation', placementMode: 'all_day', date: '2026-05-18' }]}
      dateKey="2026-05-18"
      statuses={{ t2: 'done' }}
      onExpand={() => {}}
      darkMode={false}
      isPastDay={true}
    />
  );
  var chip = screen.getByText('All-day meditation').closest('[data-testid="all-day-chip"]');
  // PAST_OPACITY is 0.35 — opacity should be < 1
  var opacity = parseFloat(chip.style.opacity);
  expect(opacity).toBeLessThan(1);
});

test('banner container has data-testid=all-day-banner', () => {
  render(
    <AllDayBanner
      allTasks={TASKS}
      dateKey="2026-05-18"
      statuses={STATUSES}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  expect(screen.getByTestId('all-day-banner')).toBeInTheDocument();
});

test('shows fixed pin indicator for placementMode=fixed all-day tasks', () => {
  render(
    <AllDayBanner
      allTasks={[
        { id: 't1', text: 'Fixed meeting', when: 'allday', date: '2026-05-18', placementMode: 'fixed' },
        { id: 't2', text: 'Regular all-day', when: 'allday', date: '2026-05-18' }
      ]}
      dateKey="2026-05-18"
      statuses={{}}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  var chips = screen.getAllByTestId('all-day-chip');
  expect(chips[0].textContent).toContain('📌');
  expect(chips[1].textContent).not.toContain('📌');
});

test('shows fixed pin indicator for placement_mode=fixed all-day tasks (snake_case)', () => {
  render(
    <AllDayBanner
      allTasks={[
        { id: 't1', text: 'Fixed via snake', when: 'allday', date: '2026-05-18', placement_mode: 'fixed' }
      ]}
      dateKey="2026-05-18"
      statuses={{}}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  var chip = screen.getByText('Fixed via snake').closest('[data-testid="all-day-chip"]');
  expect(chip.textContent).toContain('📌');
});
