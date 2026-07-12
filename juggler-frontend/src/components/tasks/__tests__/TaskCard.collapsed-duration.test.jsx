// src/components/tasks/__tests__/TaskCard.collapsed-duration.test.jsx
/**
 * BUG-1 (juggler-taskcard-collapsed-duration) — regression tests.
 *
 * TaskCard.jsx:34 computes its duration badge directly from `task.dur`:
 *   var durLabel = task.dur ? (task.dur >= 60 ? Math.round(task.dur / 60 * 10) / 10 + 'h' : task.dur + 'm') : '';
 *
 * For a collapsed split-occurrence row (produced by conflictBuckets.js's
 * groupBySplitOccurrence, shipped in the prior juggler-issues-split-overdue-collapse
 * leg), `task.dur` is just the FIRST chunk's own duration — the correct summed
 * total already exists on the same object as `_overdueTotalDur` (Overdue section)
 * or `_unplacedTotalDur` (Unscheduled section), matching the established pattern
 * in DailyViewUnschedEntry.jsx:88 — `(task._unplacedTotalDur || task.dur)`.
 *
 * These tests assert the duration badge shows the SUMMED total when either
 * field is present, and the plain `task.dur` value when neither is (regression
 * guard for the non-collapsed case). They FAIL against the current
 * unmodified TaskCard.jsx (which reads task.dur directly, ignoring both
 * override fields).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import TaskCard from '../TaskCard';

var BASE_TASK = {
  id: 'task-collapsed-1',
  text: 'Collapsed occurrence task',
  pri: 'P2',
  dur: 60,
  date: '2026-07-12',
  time: null,
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
        todayDate={new Date('2026-07-12')}
      />
    </div>
  );
}

describe('TaskCard duration badge — collapsed split-occurrence totals (BUG-1)', () => {
  test('collapsed OVERDUE occurrence: dur=60 (first chunk) but _overdueTotalDur=240 (4 chunks) → badge shows "4h", not "1h"', () => {
    renderCard({ dur: 60, _overdueTotalDur: 240, _overdueChunkCount: 4 });
    expect(screen.getByText('4h')).toBeInTheDocument();
    expect(screen.queryByText('1h')).toBeNull();
  });

  test('collapsed UNSCHEDULED occurrence: dur=60 (first chunk) but _unplacedTotalDur=180 (3 chunks) → badge shows "3h", not "1h"', () => {
    renderCard({ dur: 60, _unplacedTotalDur: 180 });
    expect(screen.getByText('3h')).toBeInTheDocument();
    expect(screen.queryByText('1h')).toBeNull();
  });

  test('REGRESSION GUARD — normal non-collapsed task: dur=45, no _overdueTotalDur/_unplacedTotalDur → badge still shows "45m"', () => {
    renderCard({ dur: 45 });
    expect(screen.getByText('45m')).toBeInTheDocument();
  });
});
