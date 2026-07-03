/**
 * sched-audit-l3.test.jsx — RED tests for the L3 UI-defect cluster
 * (sched-audit leg, AUDIT-REGISTER.md REG-42/43/44/45/49 = A2 findings F1/F2/F3/F4/F10).
 *
 * David's 2026-07-02 ruling (D-B): unscheduled-lane items ARE resolvable in place
 * (done/skip/cancel enabled for scheduled_at=null rows).
 *
 * Every test below asserts the CORRECT (post-fix) contract and is proven RED against
 * today's code (see L3-TEST-REVIEW.md for the 2x verbatim run). NO production files are
 * touched by this leg step — that is bert's job on a follow-up dispatch.
 *
 * F6 (wrong reason chip for missed occurrences) and F7 (dep-blocked reason code) are
 * backend-emitted — owned by the backend chain, not tested here. F8 (where do
 * yesterday's misses show) is a pending David design question — not tested here.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import DailyView from '../DailyView';
import UnschedEntry from '../DailyViewUnschedEntry';
import TaskBlock from '../DailyViewTaskBlock';
import ConflictsView from '../ConflictsView';
import { getTheme } from '../../../theme/colors';
import { computeConflictBuckets } from '../../../scheduler/conflictBuckets';

// ConflictsView's own child mock, mirroring ConflictsView.test.jsx's established
// convention exactly (same mock shape/testid) — TaskCard is heavy/irrelevant to
// the badge==page invariant under test here; a plain marker div lets us count
// rendered rows and locate them by section.
jest.mock('../../tasks/TaskCard', () => {
  return function MockTaskCard({ task }) {
    return <div data-testid="task-card" data-task-id={task && task.id}>{task && task.text}</div>;
  };
});

// ---------------------------------------------------------------------------
// Mocks — mirrors DailyView.test.jsx's established conventions exactly (see
// that file's inline comments for the hoist-related "why" of each choice).
// ---------------------------------------------------------------------------
jest.mock('../../../theme/colors', () => jest.requireActual('../../../theme/colors'));
jest.mock('../../../state/constants', () => jest.requireActual('../../../state/constants'));
jest.mock('../../../shared/task-status', () => jest.requireActual('../../../shared/task-status'));

jest.mock('../../../scheduler/dateHelpers', () => ({
  formatHour: (h) => `${h}:00`,
  formatDateKey: (date) => {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  },
  parseDate: (str) => new Date(str)
}));

jest.mock('../../../scheduler/timeBlockHelpers', () => ({
  getBlocksForDate: () => [],
  parseWhen: () => []
}));

jest.mock('../../../scheduler/locationHelpers', () => ({
  resolveLocationId: () => 'home',
  getLocationForDatePure: () => ({ icon: '🏠', name: 'Home' })
}));

jest.mock('../../../utils/taskIcon', () => ({
  getTaskIcon: () => null
}));

jest.mock('../../../utils/weatherMatch', () => ({
  checkWeatherMatch: () => ({ ok: true }),
  hasWeatherRestrictions: () => false
}));

jest.mock('../../../utils/weatherIcons', () => ({
  weatherIconUrl: () => ''
}));

jest.mock('../../../utils/isAllDayTask', () => ({
  isAllDayTask: () => false
}));

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (children) => children
}));

var theme = getTheme(false);
var mockSchedCfg = {
  locScheduleDefaults: {},
  locScheduleOverrides: {},
  scheduleTemplates: { weekday: { blocks: [] }, weekend: { blocks: [] } }
};

function baseDailyViewProps(overrides) {
  return Object.assign({
    onStatusChange: () => {},
    onExpand: () => {},
    onDelete: () => {},
    darkMode: false,
    schedCfg: mockSchedCfg,
    nowMins: 0,
    isToday: false,
    blockedTaskIds: new Set(),
    unplacedIds: new Set(),
    pastDueIds: new Set(),
    fixedIds: new Set(),
    isMobile: false,
    weatherByDate: {}
  }, overrides);
}

// ===========================================================================
// F1 (REG-42) — unscheduled-lane entry (scheduled_at=null) status controls.
// David D-B: these ARE resolvable in place. Currently blocked by
// StatusToggle.jsx:79-86 ("Schedule task before resolving") driven by
// DailyViewUnschedEntry.jsx:79 disableTerminal={!task.scheduledAt}.
// ===========================================================================
describe('F1 — unscheduled-lane entry status controls enabled (David D-B)', () => {
  test('done button is ENABLED and fires onStatusChange for a scheduled_at=null unplaced task (RED)', () => {
    var onStatusChange = jest.fn();
    var task = {
      id: 'missed1', text: 'Missed recurring instance', scheduledAt: null,
      pri: 'P2', dur: 30, recurring: true, _unplacedReason: 'missed', unscheduled: true
    };

    render(
      <UnschedEntry
        task={task} status="" onExpand={() => {}} onStatusChange={onStatusChange}
        onDelete={() => {}} theme={theme} darkMode={false} isMobile={false} canDrag={false}
      />
    );

    var doneButton = screen.queryByTitle('Complete');
    expect(doneButton).not.toBeNull();
    expect(doneButton).not.toBeDisabled();

    fireEvent.click(doneButton);
    expect(onStatusChange).toHaveBeenCalledWith('done');
  });

  test('control: a task WITH scheduled_at can already be marked done from the lane (adjacent correct behavior)', () => {
    var onStatusChange = jest.fn();
    var task = {
      id: 'sched1', text: 'Has a slot but off the grid', scheduledAt: '2030-06-15T08:00:00Z',
      pri: 'P2', dur: 30
    };

    render(
      <UnschedEntry
        task={task} status="" onExpand={() => {}} onStatusChange={onStatusChange}
        onDelete={() => {}} theme={theme} darkMode={false} isMobile={false} canDrag={false}
      />
    );

    var doneButton = screen.queryByTitle('Complete');
    expect(doneButton).not.toBeNull();
    expect(doneButton).not.toBeDisabled();
    fireEvent.click(doneButton);
    expect(onStatusChange).toHaveBeenCalledWith('done');
  });
});

// ===========================================================================
// TaskCard z-2 pin (sched-audit L23 zoe WARN z-2, L23-ZOE-REVIEW.md finding #2)
// — bert iteration-2 removed `disableTerminal` from TaskCard.jsx (implements
// David's D-B ruling globally for ListView/ConflictsView/PriorityView, not
// just the DailyView unscheduled lane covered by F1 above), but no test
// asserted the new enabled behavior at a TaskCard call site itself — F1 only
// covers DailyViewUnschedEntry, a DIFFERENT component. A one-line regression
// (re-adding `disableTerminal={!task.scheduledAt}` to the StatusToggle call
// in TaskCard.jsx:126) would re-disable done/skip/cancel across all 3 views
// with ZERO test failure before this pin. Renders the REAL (unmocked)
// TaskCard — this file's top-level `jest.mock('../../tasks/TaskCard', ...)`
// replaces TaskCard for every OTHER test here (ConflictsView's own child), so
// this test must reach around that mock via `jest.requireActual` to exercise
// the actual component. Props mirror ConflictsView.jsx's unplaced-section
// call site exactly (task, status, onStatusChange, onDelete, onExpand,
// darkMode, showDate, isMobile, allTasks, statuses, todayDate).
// ===========================================================================
describe('TaskCard z-2 pin — terminal actions enabled for an unscheduled row via the REAL TaskCard call site (David D-B, TaskCard.jsx:126)', () => {
  test('unscheduled (scheduled_at=null) row rendered through TaskCard with ConflictsView\'s real props: done action is ENABLED and fires onStatusChange(taskId, "done")', () => {
    var RealTaskCard = jest.requireActual('../../tasks/TaskCard').default;
    var onStatusChange = jest.fn();
    var task = {
      id: 'unplaced-tc-1', text: 'Unplaced via TaskCard', scheduledAt: null,
      pri: 'P2', dur: 30, _unplacedReason: 'no_slot', unscheduled: true
    };

    render(
      <RealTaskCard
        task={task} status="" onStatusChange={onStatusChange} onDelete={() => {}}
        onExpand={() => {}} darkMode={false} showDate isMobile={false}
        allTasks={[task]} statuses={{}} todayDate={new Date('2031-01-01T12:00:00')}
      />
    );

    var doneButton = screen.queryByTitle('Complete');
    expect(doneButton).not.toBeNull();
    expect(doneButton).not.toBeDisabled();

    fireEvent.click(doneButton);
    expect(onStatusChange).toHaveBeenCalledWith('unplaced-tc-1', 'done');
  });
});

// ===========================================================================
// F2 (REG-43) — overdue unscheduled-lane entries must render overdue styling/
// badge. DailyViewUnschedEntry.jsx never reads task.overdue today.
// ===========================================================================
describe('F2 — unscheduled entry with task.overdue=true renders an overdue indicator', () => {
  test('overdue unplaced task shows a visible "overdue" indicator (RED)', () => {
    var task = {
      id: 'overdue1', text: 'Missed recurring instance', scheduledAt: null, overdue: true,
      pri: 'P2', dur: 30, recurring: true, _unplacedReason: 'missed'
    };

    render(
      <UnschedEntry
        task={task} status="" onExpand={() => {}} onStatusChange={() => {}}
        onDelete={() => {}} theme={theme} darkMode={false} isMobile={false} canDrag={false}
      />
    );

    // Sanity: row itself rendered (proves the fixture is wired correctly).
    expect(screen.getByText('Missed recurring instance')).toBeInTheDocument();
    // Contract: mirrors the grid tile's OVERDUE badge (DailyViewTaskBlock.jsx:138-148) —
    // some visible "overdue" text must render for an overdue unplaced row.
    expect(screen.queryByText(/overdue/i)).not.toBeNull();
  });

  test('control: a NON-overdue unplaced task shows NO overdue indicator (adjacent correct behavior)', () => {
    var task = {
      id: 'benign1', text: 'Could not fit today', scheduledAt: null, overdue: false,
      pri: 'P2', dur: 30, _unplacedReason: 'no_slot'
    };

    render(
      <UnschedEntry
        task={task} status="" onExpand={() => {}} onStatusChange={() => {}}
        onDelete={() => {}} theme={theme} darkMode={false} isMobile={false} canDrag={false}
      />
    );

    expect(screen.getByText('Could not fit today')).toBeInTheDocument();
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });
});

// ===========================================================================
// F3 (REG-44) — rejected drag must not toast success and must roll back the
// optimistic move; a calLocked task must render a lock indicator.
// ===========================================================================
describe('F3 — rejected drag: no false success toast, optimistic state rolled back', () => {
  var FUTURE_KEY = '2031-03-10';
  var FUTURE_DATE = new Date('2031-03-10T12:00:00');

  function renderGridWithDrop(task, onUpdate, showToast) {
    return render(
      <DailyView
        {...baseDailyViewProps({
          selectedDate: FUTURE_DATE,
          selectedDateKey: FUTURE_KEY,
          placements: [{ start: 480, end: 510, task: task }],
          allTasks: [task],
          statuses: {},
          onUpdate: onUpdate,
          showToast: showToast
        })}
      />
    );
  }

  function fireDrop(container, taskId) {
    var gridArea = container.querySelector('[data-grid-area="1"]');
    var dropTarget = gridArea.parentElement;
    var dataTransfer = { getData: function () { return taskId; }, setData: function () {}, effectAllowed: '' };
    fireEvent.drop(dropTarget, { dataTransfer: dataTransfer, clientY: 100 });
  }

  test('backend-rejected update (e.g. calLocked 403) shows NO success toast (RED — DailyView.jsx:424-445 toasts unconditionally)', async () => {
    var task = { id: 'calTask1', text: 'Synced Standup', date: FUTURE_KEY, dur: 30, calLocked: true };
    var onUpdate = jest.fn(function () { return Promise.resolve('Cannot edit a calendar-synced event'); });
    var showToast = jest.fn();

    var { container } = renderGridWithDrop(task, onUpdate, showToast);
    fireDrop(container, 'calTask1');

    // Give a promise-based fix a microtask tick to settle before the final assertion.
    await waitFor(function () { expect(onUpdate).toHaveBeenCalled(); });

    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('Moved'), 'success');
  });

  test('control: an accepted update DOES show a success toast (adjacent correct behavior)', async () => {
    var task = { id: 'openTask1', text: 'Flexible task', date: FUTURE_KEY, dur: 30 };
    var onUpdate = jest.fn(function () { return Promise.resolve(true); });
    var showToast = jest.fn();

    var { container } = renderGridWithDrop(task, onUpdate, showToast);
    fireDrop(container, 'openTask1');

    await waitFor(function () {
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Moved to'), 'success');
    });
  });
});

describe('F3b — cal-locked task tile renders a lock indicator', () => {
  function renderTile(task) {
    return render(
      <TaskBlock
        item={{ task: task, start: 480, end: 510 }}
        status="" top={0} height={40} col={0} totalCols={1}
        onExpand={() => {}} onStatusChange={() => {}} onDelete={() => {}}
        theme={theme} darkMode={false} isMobile={false} isBlocked={false}
        canDrag={true} gutterW={40} hourHeight={60} weatherDay={null}
      />
    );
  }

  test('calLocked task renders a lock indicator (RED — no calLocked handling anywhere in DailyViewTaskBlock.jsx)', () => {
    var task = { id: 'locked1', text: 'Synced Standup', dur: 30, calLocked: true, scheduledAt: '2030-06-15T08:00:00Z' };
    renderTile(task);

    expect(screen.getByText('Synced Standup')).toBeInTheDocument();
    // Padlock glyph — the natural rendering of "locked" per the audit's own
    // proposed UX (AUDIT-REGISTER.md Q8: "Should they show a padlock...").
    expect(screen.queryByText('🔒')).not.toBeNull();
  });

  test('control: a normal (non-locked) task tile shows NO lock indicator (adjacent correct behavior)', () => {
    var task = { id: 'open2', text: 'Ordinary task', dur: 30, scheduledAt: '2030-06-15T08:00:00Z' };
    renderTile(task);

    expect(screen.getByText('Ordinary task')).toBeInTheDocument();
    expect(screen.queryByText('🔒')).toBeNull();
  });
});

// ===========================================================================
// F4 (REG-45) — partially-placed split: unplaced remainder must stay visible
// in the Unscheduled lane. Currently `scheduledByOccurrence` in DailyView.jsx
// (:243-245, :270) hides EVERY sibling row once ANY sibling is placed —
// contract per the audit: hide only when the placed siblings already fully
// cover the occurrence; an incomplete unplaced chunk of a partially-placed
// split must show.
// ===========================================================================
describe('F4 — partially-placed split keeps the unplaced remainder visible', () => {
  var FUTURE_KEY = '2031-04-02';
  var FUTURE_DATE = new Date('2031-04-02T12:00:00');

  test('1 placed + 1 unplaced chunk of the same split occurrence: unplaced sibling still shows in the lane (RED)', () => {
    var placedChunk = { id: 'chunkA', sourceId: 'SPLIT-1', date: FUTURE_KEY, text: 'Write report', dur: 30, splitTotal: 2 };
    var unplacedChunk = {
      id: 'chunkB', sourceId: 'SPLIT-1', date: FUTURE_KEY, text: 'Write report', dur: 45,
      splitTotal: 2, _unplacedReason: 'partial_split', unscheduled: true
    };

    render(
      <DailyView
        {...baseDailyViewProps({
          selectedDate: FUTURE_DATE,
          selectedDateKey: FUTURE_KEY,
          placements: [{ start: 480, end: 510, task: placedChunk }],
          allTasks: [placedChunk, unplacedChunk],
          statuses: {},
          unplacedIds: new Set(['chunkB'])
        })}
      />
    );

    // Grid shows the placed chunk; the leftover unplaced chunk of the SAME
    // occurrence (identical text) must ALSO surface in the Unscheduled lane —
    // total occurrences of the text must be 2, not 1.
    var occurrences = screen.getAllByText('Write report');
    expect(occurrences.length).toBe(2);
  });

  test('control: a fully-placed split (both chunks scheduled+adjacent) merges into ONE grid block, no lane row (adjacent correct behavior)', () => {
    var chunkC = { id: 'chunkC', sourceId: 'SPLIT-2', date: FUTURE_KEY, text: 'Clean garage', dur: 30, splitTotal: 2 };
    var chunkD = { id: 'chunkD', sourceId: 'SPLIT-2', date: FUTURE_KEY, text: 'Clean garage', dur: 30, splitTotal: 2 };

    render(
      <DailyView
        {...baseDailyViewProps({
          selectedDate: FUTURE_DATE,
          selectedDateKey: FUTURE_KEY,
          placements: [
            { start: 480, end: 510, task: chunkC },
            { start: 510, end: 540, task: chunkD }
          ],
          allTasks: [chunkC, chunkD],
          statuses: {}
        })}
      />
    );

    var occurrences = screen.getAllByText('Clean garage');
    expect(occurrences.length).toBe(1);
  });
});

// ===========================================================================
// F10 (REG-49) — Issues badge must not double-count a row that is BOTH
// overdue AND unplaced. conflictBuckets.js sums bucket lengths, so a row
// present in both `overdue` and the `unplaced` list is counted twice.
// ===========================================================================
describe('F10 — Issues badge does not double-count an overdue+unplaced row', () => {
  var TODAY = new Date('2031-05-01T12:00:00');

  test('a row that is overdue AND present in the unplaced list counts ONCE toward actionCount (RED — conflictBuckets.js:57 sums overdue.length + unplacedList.length)', () => {
    var doubleTask = {
      id: 'dup1', text: 'Missed daily standup', overdue: true,
      taskType: 'recurring_instance', generated: true
    };

    var buckets = computeConflictBuckets({
      allTasks: [doubleTask],
      statuses: {},
      unplaced: [doubleTask], // same row ALSO reported unplaced by the scheduler
      backlog: [],
      schedulerWarnings: [],
      today: TODAY
    });

    expect(buckets.overdue.map(function (t) { return t.id; })).toEqual(['dup1']);
    expect(buckets.unplaced.map(function (t) { return t.id; })).toEqual(['dup1']);
    expect(buckets.actionCount).toBe(1);
  });

  test('control: two DISTINCT rows (one overdue-only, one unplaced-only) both count (actionCount=2, adjacent correct behavior)', () => {
    var overdueOnly = { id: 'ov1', text: 'Overdue one-off', overdue: true, taskType: 'one-off' };
    var unplacedOnly = { id: 'up1', text: 'Weather-blocked task', overdue: false, taskType: 'one-off' };

    var buckets = computeConflictBuckets({
      allTasks: [overdueOnly, unplacedOnly],
      statuses: {},
      unplaced: [unplacedOnly],
      backlog: [],
      schedulerWarnings: [],
      today: TODAY
    });

    expect(buckets.actionCount).toBe(2);
  });
});

// ===========================================================================
// F10-INTEGRATION (l3-ernie-8, REFER->telly carried BERT-LOG.md/L3-CODE-REVIEW.md)
// — ernie's BLOCK (l3-ernie-1, fixed by bert iteration 1) was that the F10 unit
// test above only asserted computeConflictBuckets(...).actionCount, never that
// AppLayout's badge and the ConflictsView PAGE agree for a dual-shape row
// (overdue AND unplaced). bert moved the dedupe to bucket construction
// (conflictBuckets.js: `unplacedForDisplay`, canonical bucket for a dual-shape
// row = Overdue) and ConflictsView.jsx now renders `unplacedForDisplay` instead
// of the raw `unplaced` prop. This block pins that INTEGRATION contract so a
// future change can't quietly re-diverge badge vs. page (999.862).
// ===========================================================================
describe('F10-integration (l3-ernie-8) — badge==page invariant for a dual-shape row (999.862)', () => {
  var TODAY = new Date('2031-06-01T12:00:00');

  function makeConflictsProps(overrides) {
    return Object.assign({
      allTasks: [],
      statuses: {},
      unplaced: [],
      backlog: [],
      schedulerWarnings: [],
      onStatusChange: () => {},
      onExpand: () => {},
      onUpdateTask: null,
      onDelete: null,
      darkMode: false,
      isMobile: false,
      todayDate: TODAY,
      weatherByDate: null
    }, overrides);
  }

  // Expand the Action Required group + both its Overdue/Unplaced subsections so
  // rendered rows are actually in the DOM (both default collapsed).
  function openActionSections() {
    localStorage.setItem('juggler-issues-collapsed', JSON.stringify({
      actionGroup: false, infoGroup: true,
      overdue: false, unplaced: false, dataIssues: true,
      blocked: true, unscheduled: true, stale: true
    }));
  }

  beforeEach(() => { localStorage.clear(); openActionSections(); });
  afterEach(() => { localStorage.clear(); });

  // Finds the section container (the outer div wrapping a section's header
  // button + its task list) by its visible header title span, so we can scope
  // a task-card lookup to ONE section (Overdue vs Unplaced) rather than the
  // whole page.
  function findSectionContainer(container, title) {
    var spans = container.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].textContent === title) {
        var btn = spans[i].closest('button');
        return btn ? btn.parentElement : null;
      }
    }
    return null;
  }

  var dualTask = {
    id: 'dual1', text: 'Missed daily standup (dual-shape)', overdue: true,
    taskType: 'recurring_instance', generated: true
  };
  var overdueOnly = { id: 'ov-only', text: 'Overdue one-off', overdue: true, taskType: 'one-off' };
  var unplacedOnly = { id: 'up-only', text: 'Weather-blocked task', overdue: false, taskType: 'one-off' };

  test('(a) badge (actionCount) equals total rows rendered on the Issues page for a dual-shape row', () => {
    var allTasks = [dualTask, overdueOnly, unplacedOnly];
    var unplacedList = [dualTask, unplacedOnly];

    // The "badge" is the EXACT computation AppLayout.jsx:704 uses for the Issues
    // tab indicator (computeConflictBuckets(...).actionCount) — not a re-derived
    // or mocked stand-in for it.
    var badge = computeConflictBuckets({
      allTasks: allTasks, statuses: {}, unplaced: unplacedList,
      backlog: [], schedulerWarnings: [], today: TODAY
    }).actionCount;

    var { container } = render(
      <ConflictsView {...makeConflictsProps({ allTasks: allTasks, unplaced: unplacedList })} />
    );

    // Total rows actually rendered on the PAGE across the Action Required
    // sections (Overdue + Unplaced) — counts DOM elements, so a row rendered
    // twice (the pre-fix bug) inflates this above the badge.
    var renderedCards = container.querySelectorAll('[data-testid="task-card"]');
    // SELF-MUTATION (verified against the pre-fix shape — see L3-TEST-REVIEW.md):
    // reverting ConflictsView.jsx to render the raw `unplaced` prop instead of
    // `issues.unplacedForDisplay` makes renderedCards.length go to 4 (dual1
    // rendered twice) while badge stays 3 -> this assertion FAILS.
    expect(renderedCards.length).toBe(badge);
    // Sanity anchor: 3 DISTINCT logical action items (dual1 counted once).
    expect(badge).toBe(3);
  });

  test('(b) the dual-shape row appears EXACTLY ONCE on the page, in the Overdue section (not Unplaced)', () => {
    var allTasks = [dualTask];
    var unplacedList = [dualTask];

    var { container } = render(
      <ConflictsView {...makeConflictsProps({ allTasks: allTasks, unplaced: unplacedList })} />
    );

    // Exactly one row for dual1 anywhere on the page.
    // SELF-MUTATION: pre-fix (raw `unplaced` rendered), this element count is 2
    // (one under Overdue, one under Unplaced) -> FAILS.
    var allMatches = container.querySelectorAll('[data-testid="task-card"][data-task-id="dual1"]');
    expect(allMatches.length).toBe(1);

    var overdueSection = findSectionContainer(container, 'Overdue');
    var unplacedSection = findSectionContainer(container, 'Unplaced');
    expect(overdueSection).not.toBeNull();
    expect(unplacedSection).not.toBeNull();

    // It must live under Overdue (the canonical bucket for a dual-shape row)...
    expect(overdueSection.querySelectorAll('[data-testid="task-card"][data-task-id="dual1"]').length).toBe(1);
    // ...and NOT be duplicated into Unplaced.
    // SELF-MUTATION: pre-fix, this is 1 (rendered again under Unplaced) -> FAILS.
    expect(unplacedSection.querySelectorAll('[data-testid="task-card"][data-task-id="dual1"]').length).toBe(0);
  });

  test('(c) module contract: unplaced stays UNCHANGED (raw, still includes the dual row); unplacedForDisplay is deduped (excludes it, canonical bucket = Overdue)', () => {
    var buckets = computeConflictBuckets({
      allTasks: [dualTask], statuses: {}, unplaced: [dualTask],
      backlog: [], schedulerWarnings: [], today: TODAY
    });

    // `unplaced` (raw) is an EXISTING module contract other/older callers may
    // still rely on — it must NOT be mutated by the display-dedupe fix.
    expect(buckets.unplaced.map(function(t) { return t.id; })).toEqual(['dual1']);

    // `unplacedForDisplay` is the NEW field ConflictsView.jsx renders from — it
    // must exist and must have removed the dual-shape row (already surfaced
    // under `overdue`, the canonical bucket for a dual-shape row).
    // SELF-MUTATION: revert conflictBuckets.js to the version with no
    // `unplacedForDisplay` export -> `buckets.unplacedForDisplay` is `undefined`,
    // `.map` throws -> FAILS (verified against the pre-fix module, see
    // L3-TEST-REVIEW.md).
    expect(buckets.unplacedForDisplay).toBeDefined();
    expect(buckets.unplacedForDisplay.map(function(t) { return t.id; })).toEqual([]);
    expect(buckets.overdue.map(function(t) { return t.id; })).toEqual(['dual1']);
  });
});
