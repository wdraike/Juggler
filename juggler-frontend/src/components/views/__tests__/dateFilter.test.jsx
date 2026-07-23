/**
 * 999.2775 — date-range filters for Priority/List/Dependency views.
 * Tests that dateFilter prop filters tasks by date range.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import PriorityView from '../PriorityView';
import ListView from '../ListView';

// Use a fixed "today" — 2026-07-15 (a Wednesday)
const TODAY_KEY = '2026-07-15';
const todayDate = new Date('2026-07-15T12:00:00');

// Week starts on Sunday: 2026-07-12 (Sun) .. 2026-07-18 (Sat)
const MONDAY_KEY = '2026-07-13';
const THURSDAY_KEY = '2026-07-16';
const NEXT_MONDAY_KEY = '2026-07-20';
const PAST_KEY = '2026-07-10';
const NEXT_MONTH_KEY = '2026-08-15';

const MOCK_TASKS = [
  { id: 't-today',   text: 'Today Task',       date: TODAY_KEY,        pri: 'P1' },
  { id: 't-thu',     text: 'Thursday Task',    date: THURSDAY_KEY,     pri: 'P2' },
  { id: 't-past',    text: 'Past Task',        date: PAST_KEY,         pri: 'P1' },
  { id: 't-nextmon', text: 'Next Monday Task', date: NEXT_MONDAY_KEY,  pri: 'P3' },
  { id: 't-nextmo',  text: 'Next Month Task',  date: NEXT_MONTH_KEY,   pri: 'P4' },
  { id: 't-nodate',  text: 'No Date Task',     date: null,             pri: 'P2' },
  { id: 't-tbd',     text: 'TBD Task',         date: 'TBD',            pri: 'P3' },
];

const MOCK_SCHED_CFG = {
  locScheduleDefaults: {},
  locScheduleOverrides: {},
  timeBlocks: []
};

// ── PriorityView date filter tests ──

describe('PriorityView dateFilter', () => {
  function renderPriority(dateFilter) {
    render(
      <PriorityView
        allTasks={MOCK_TASKS}
        statuses={{}}
        filter="all"
        dateFilter={dateFilter}
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
  }

  test('dateFilter="all" shows all tasks', () => {
    renderPriority('all');
    expect(screen.getByText('Today Task')).toBeInTheDocument();
    expect(screen.getByText('Past Task')).toBeInTheDocument();
    expect(screen.getByText('Next Month Task')).toBeInTheDocument();
    expect(screen.getByText('No Date Task')).toBeInTheDocument();
  });

  test('dateFilter="today" shows only today tasks', () => {
    renderPriority('today');
    expect(screen.getByText('Today Task')).toBeInTheDocument();
    expect(screen.queryByText('Thursday Task')).not.toBeInTheDocument();
    expect(screen.queryByText('Past Task')).not.toBeInTheDocument();
    expect(screen.queryByText('No Date Task')).not.toBeInTheDocument();
  });

  test('dateFilter="thisweek" shows tasks within Sun-Sat of current week', () => {
    renderPriority('thisweek');
    expect(screen.getByText('Today Task')).toBeInTheDocument();   // Wed
    expect(screen.getByText('Thursday Task')).toBeInTheDocument(); // Thu
    expect(screen.queryByText('Past Task')).not.toBeInTheDocument(); // before Sun
    expect(screen.queryByText('Next Monday Task')).not.toBeInTheDocument(); // next week
  });

  test('dateFilter="nextweek" shows tasks in next week', () => {
    renderPriority('nextweek');
    expect(screen.getByText('Next Monday Task')).toBeInTheDocument();
    expect(screen.queryByText('Today Task')).not.toBeInTheDocument();
    expect(screen.queryByText('Next Month Task')).not.toBeInTheDocument();
  });

  test('dateFilter="nodate" shows tasks with no date or TBD', () => {
    renderPriority('nodate');
    expect(screen.getByText('No Date Task')).toBeInTheDocument();
    expect(screen.getByText('TBD Task')).toBeInTheDocument();
    expect(screen.queryByText('Today Task')).not.toBeInTheDocument();
  });

  test('dateFilter="overdue" shows past-dated non-terminal tasks', () => {
    renderPriority('overdue');
    expect(screen.getByText('Past Task')).toBeInTheDocument();
    expect(screen.queryByText('Today Task')).not.toBeInTheDocument();
    expect(screen.queryByText('No Date Task')).not.toBeInTheDocument();
  });
});

// ── ListView date filter tests ──

describe('ListView dateFilter', () => {
  function renderList(dateFilter) {
    render(
      <ListView
        allTasks={MOCK_TASKS}
        statuses={{}}
        filter="all"
        dateFilter={dateFilter}
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
  }

  test('dateFilter="today" shows only today tasks', () => {
    renderList('today');
    expect(screen.getByText('Today Task')).toBeInTheDocument();
    expect(screen.queryByText('Thursday Task')).not.toBeInTheDocument();
    expect(screen.queryByText('Past Task')).not.toBeInTheDocument();
  });

  test('dateFilter="thisweek" shows this week tasks', () => {
    renderList('thisweek');
    expect(screen.getByText('Today Task')).toBeInTheDocument();
    expect(screen.getByText('Thursday Task')).toBeInTheDocument();
    expect(screen.queryByText('Past Task')).not.toBeInTheDocument();
    expect(screen.queryByText('Next Monday Task')).not.toBeInTheDocument();
  });

  test('dateFilter="nodate" shows no-date tasks', () => {
    renderList('nodate');
    expect(screen.getByText('No Date Task')).toBeInTheDocument();
    expect(screen.queryByText('Today Task')).not.toBeInTheDocument();
  });

  test('dateFilter="all" shows all tasks', () => {
    renderList('all');
    expect(screen.getByText('Today Task')).toBeInTheDocument();
    expect(screen.getByText('Past Task')).toBeInTheDocument();
  });
});