// src/components/tasks/__tests__/TaskCard.overdue-delegation.test.jsx
/**
 * 999.1224 (JUG-UI-OVERDUE-FLAG-FORK) — AC3 regression guard.
 *
 * TaskCard.jsx:36 currently RE-DERIVES the overdue boolean inline instead of
 * calling the canonical isTaskOverdue(task, isDone) helper (utils/overdue.js,
 * SSOT per 999.671):
 *   var isOverdue = !isDone && !!task.overdue;
 *
 * This happens to be VALUE-equivalent to isTaskOverdue today, so a fixture
 * test on task.overdue alone cannot expose a display bug (there isn't a
 * live one yet). The real risk the SSOT doc warns about is DRIFT: because
 * TaskCard does not delegate, isTaskOverdue's logic can change (as it did
 * for the 999.671 fix) without TaskCard picking up the change. This test
 * drives that risk directly: it swaps the canonical helper's behavior via
 * the real module (mocked) and asserts TaskCard's rendered output is
 * actually DRIVEN BY the helper's return value — not by an inline
 * re-implementation. It fails today because TaskCard never imports/calls
 * isTaskOverdue at all.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('../../../utils/overdue', () => ({
  isTaskOverdue: jest.fn(),
}));

// eslint-disable-next-line import/first
import { isTaskOverdue } from '../../../utils/overdue';
// eslint-disable-next-line import/first
import TaskCard from '../TaskCard';

var BASE_TASK = {
  id: 'task-deleg-1',
  text: 'Delegation contract task',
  pri: 'P2',
  dur: 45,
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

beforeEach(() => {
  isTaskOverdue.mockReset();
});

describe('TaskCard overdue derivation delegates to isTaskOverdue (AC3)', () => {
  test('task.overdue=false but isTaskOverdue mocked to return true → TaskCard MUST show the Overdue badge (proves TaskCard is driven by the helper, not an inline re-derivation)', () => {
    isTaskOverdue.mockReturnValue(true);
    renderCard({ overdue: false });
    expect(screen.getByText(/Overdue/i)).toBeInTheDocument();
  });

  test('task.overdue=true but isTaskOverdue mocked to return false → TaskCard must NOT show the Overdue badge', () => {
    isTaskOverdue.mockReturnValue(false);
    renderCard({ overdue: true });
    expect(screen.queryByText(/Overdue/i)).toBeNull();
  });

  test('isTaskOverdue is actually invoked with (task, isDone) — not bypassed', () => {
    isTaskOverdue.mockReturnValue(false);
    renderCard({ overdue: true, id: 'task-deleg-invoked' });
    expect(isTaskOverdue).toHaveBeenCalled();
    var callArgs = isTaskOverdue.mock.calls[0];
    expect(callArgs[0]).toEqual(expect.objectContaining({ id: 'task-deleg-invoked' }));
    expect(callArgs[1]).toBe(false); // isDone — status='' is non-terminal
  });
});

/**
 * zoe-taskcard-mockonly-1 (WARN) closure — 999.1224 re-review.
 *
 * All 3 tests above jest.mock('utils/overdue') at the file level (hoisted,
 * applies for the whole file's static `import { isTaskOverdue } from
 * '../../../utils/overdue'` binding). They correctly pin the DELEGATION
 * contract (TaskCard calls the helper and is driven by its return value —
 * confirmed by zoe: reverting TaskCard.jsx:37 to the inline re-derivation
 * flips all 3 RED). But no case in this file exercised the REAL,
 * un-stubbed isTaskOverdue logic end-to-end through TaskCard — a wiring/arg
 * bug specific to how TaskCard calls the real helper would be invisible to
 * a suite that only ever sees a canned mockReturnValue.
 *
 * This block closes that seam WITHOUT touching the 3 tests above. A
 * file-level `jest.mock(...)` is hoisted and rebinds the static import for
 * the entire test file, so the only way to get a genuinely un-mocked
 * TaskCard + utils/overdue pair inside this SAME file (mirroring the
 * zero-jest.mock pattern already used unmocked in
 * ScheduleCard.overdue-fork.test.jsx / CalendarView.overdue-fork.test.jsx)
 * is `jest.isolateModules` + `jest.dontMock`: it opens a sandboxed module
 * registry for the callback, cancels the outer mock registration for
 * `utils/overdue` inside that sandbox only, and re-requires TaskCard fresh
 * so its `import { isTaskOverdue }` resolves to the REAL exported function
 * (`!!(task && task.overdue) && !isDone`) — not a jest.fn(). The 3 tests
 * above are untouched; their static import still resolves to the mock.
 *
 * Only `react` + `../TaskCard` are re-required inside the isolated
 * registry (so TaskCard's own static `import { isTaskOverdue }` re-resolves
 * against the un-mocked module). The OUTER, already-loaded `render`/
 * `screen` from `@testing-library/react` (top of this file, real —
 * `utils/overdue` is the only thing this file ever mocks) perform the
 * actual render/query — re-requiring `@testing-library/react` itself
 * inside `isolateModules` fails ("Hooks cannot be defined inside tests")
 * because its module top-level re-registers a global jest `afterEach`,
 * which jest-circus refuses mid-test. TaskCard has no hooks/context, so a
 * plain-element render built from a second `react` copy composes fine with
 * the outer testing-library's `render`/`screen` (React elements are
 * duck-typed via the globally-interned `Symbol.for('react.element')`).
 */
describe('TaskCard overdue rendering — REAL unmocked isTaskOverdue (closes zoe-taskcard-mockonly-1)', () => {
  function renderRealCard(overrides) {
    var task = Object.assign({}, BASE_TASK, overrides);
    var element = null;
    jest.isolateModules(() => {
      jest.dontMock('../../../utils/overdue');
      var RealReact = require('react');
      var RealTaskCard = require('../TaskCard').default;
      element = RealReact.createElement(
        'div',
        { style: { width: 320 } },
        RealReact.createElement(RealTaskCard, {
          task: task,
          status: '',
          onStatusChange: null,
          onDelete: null,
          onExpand: null,
          darkMode: false,
          showDate: false,
          draggable: false,
          isBlocked: false,
          isMobile: false,
          allTasks: [],
          statuses: {},
          todayDate: new Date('2026-05-19'),
        })
      );
    });
    render(element);
  }

  test('real task.overdue=true (non-terminal status), REAL isTaskOverdue (no mock) → Overdue badge renders', () => {
    renderRealCard({ overdue: true, id: 'task-real-overdue' });
    expect(screen.getByText(/Overdue/i)).toBeInTheDocument();
  });

  test('real task.overdue=false, REAL isTaskOverdue (no mock) → Overdue badge does NOT render', () => {
    renderRealCard({ overdue: false, id: 'task-real-not-overdue' });
    expect(screen.queryByText(/Overdue/i)).toBeNull();
  });
});
