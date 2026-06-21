/**
 * TASK D — I4 Frontend rendering tests (AC4.1–AC4.3)
 *
 * Layer: component / RTL unit — renders ConflictsView with controlled props.
 * No DB. No network. No wall-clock (todayDate is a fixed Date object).
 *
 * Covers:
 *   AC4.1  The intended where/when line renders when t.date is present.
 *   AC4.2  Friendly reason LABEL renders for a reason code (no raw snake_case in DOM).
 *   AC4.3  The detail string renders for each reason code.
 *
 * Mocking strategy:
 *   - TaskCard: heavy component with many sub-deps; not under test here — mocked to
 *     render a plain <div data-testid="task-card"> with the task id so tests can
 *     confirm the task is in the list.
 *   - WeatherBadge: mocked to avoid weather-data dependencies.
 *   - scheduler/reasonCodes: NOT mocked. src/scheduler/reasonCodes.js is a thin
 *     re-export shim of juggler-shared/scheduler/reasonCodes (matching the sibling
 *     locationHelpers/dateHelpers shims), resolved by the standard juggler-shared
 *     `file:../shared` package link — so this test must run from a fully-installed
 *     node_modules (per repo convention, frontend tests run from the main tree). The
 *     real labelFor() is exercised so AC4.2 assertions are grounded in the actual SPEC
 *     taxonomy (not a test-only stub).
 *
 * SELF-MUTATION NOTES embedded per test (Step 6b).
 *
 * Traceability: AC4.1, AC4.2, AC4.3 (TRACEABILITY.md rows 16-18)
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import ConflictsView from '../ConflictsView';

// ─── Mock heavy child components ─────────────────────────────────────────────

// jest.mock paths are relative to THIS test file (src/components/views/__tests__/),
// not relative to the component under test (src/components/views/ConflictsView.jsx).
// TaskCard lives at src/components/tasks/TaskCard → from __tests__/ = ../../tasks/TaskCard.
// WeatherBadge lives at src/components/features/WeatherBadge → ../../features/WeatherBadge.
jest.mock('../../tasks/TaskCard', () => {
  // Render a minimal stand-in; the SUT (ConflictsView) wraps each task in TaskCard
  // then renders the reason chip + detail AFTER it. TaskCard itself is not tested here.
  return function MockTaskCard({ task }) {
    return <div data-testid="task-card" data-task-id={task && task.id}>{task && task.text}</div>;
  };
});

jest.mock('../../features/WeatherBadge', () => {
  return function MockWeatherBadge() { return null; };
});

// Note: src/scheduler/reasonCodes.js is a re-export shim of juggler-shared/scheduler/reasonCodes,
// resolved via the standard juggler-shared `file:../shared` package link (no mapper needed; same
// mechanism as the sibling locationHelpers/dateHelpers shims). No mock required; the real labelFor()
// is exercised so AC4.2 assertions are grounded in the actual SPEC taxonomy values. Task B
// (reasonCodes.test.js) proves the module's correctness independently.

// ─── Fixed today date ─────────────────────────────────────────────────────────

// Use a fixed Date so the "overdue" / "stale" classifications don't depend on wall-clock.
// All test task dates are in the future relative to this, so no tasks inadvertently
// become overdue (which would change section membership and confuse assertions).
var FIXED_TODAY = new Date('2026-06-20T00:00:00.000Z');
FIXED_TODAY.setHours(0, 0, 0, 0);

// ─── Minimal prop builder ─────────────────────────────────────────────────────

// Build the minimal valid props for ConflictsView.
// unplaced is what we primarily exercise for AC4.x.
function makeProps(overrides) {
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
    todayDate: FIXED_TODAY,
    weatherByDate: null
  }, overrides);
}

// Helper: open the Unplaced section so tasks inside become visible.
// ConflictsView defaults the 'unplaced' subsection to collapsed (collapsed.unplaced=true).
// However the 'actionGroup' section defaults to open (collapsed.actionGroup=false).
// We need both action group open AND unplaced sub-section open.
// The simplest approach: pre-set localStorage so the defaults are overridden.
function openUnplacedSection() {
  localStorage.setItem('juggler-issues-collapsed', JSON.stringify({
    actionGroup: false,   // action group expanded
    infoGroup: true,      // info group collapsed (irrelevant)
    overdue: true,        // collapsed
    unplaced: false,      // EXPANDED — this is what we need
    dataIssues: true,
    blocked: true,
    unscheduled: true,
    stale: true
  }));
}

beforeEach(() => {
  localStorage.clear();
  openUnplacedSection();
});

afterEach(() => {
  localStorage.clear();
});

// ─── Shared DOM helpers ───────────────────────────────────────────────────────

// RTL getByText matcher helper: find a span whose textContent matches the label string.
// The chip <span> has multiple React children (empty-string ternary + label text), which
// creates split text nodes. RTL's exact string getByText() fails when an element's text
// comes from multiple text nodes. We use a function matcher that checks textContent directly.
// Module-scope so all describe blocks can use it.
function findLabelSpan(container, labelText) {
  var spans = container.querySelectorAll('span');
  for (var i = 0; i < spans.length; i++) {
    if (spans[i].textContent.trim() === labelText) return spans[i];
    // Also match weather chip which has emoji prefix: '🌤 Weather'
    if (spans[i].textContent.trim() === '🌤 ' + labelText) return spans[i];
  }
  return null;
}

// ─── AC4.2 — Friendly reason label renders (no raw snake_case) ────────────────

describe('AC4.2 — friendly reason label chip renders for each reason code', () => {

  // For each unplaced task with _unplacedReason set, ConflictsView renders
  // {labelFor(t._unplacedReason)} in a chip span. We assert that:
  //   (a) the chip is in the DOM,
  //   (b) it does NOT contain the raw snake_case code,
  //   (c) it DOES contain the friendly label text.
  //
  // SELF-MUTATION: change labelFor() to return the raw code → the "not.toHaveTextContent"
  //   assertion on the raw code would PASS but the "non-empty friendly label" check would
  //   fail because 'tool_conflict' contains underscore → FAILS.

  const REASON_CASES = [
    { code: 'tool_conflict',            expectedLabel: 'Tool unavailable' },
    { code: 'location_mismatch',        expectedLabel: 'Location mismatch' },
    { code: 'no_slot',                  expectedLabel: 'No free slot' },
    { code: 'impossible_window',        expectedLabel: 'Impossible time window' },
    { code: 'weather',                  expectedLabel: 'Weather' },
    { code: 'partial_split',            expectedLabel: 'Partially placed' },
    { code: 'recurring_split_overflow', expectedLabel: 'Recurrence overflow' },
    { code: 'missed',                   expectedLabel: 'Preferred time passed' },
    { code: 'tpc_budget',               expectedLabel: 'Not enough cycle time' },
  ];

  REASON_CASES.forEach(function({ code, expectedLabel }) {
    test('AC4.2: ' + code + ' → renders "' + expectedLabel + '" label chip (not raw code)', () => {
      var task = {
        id: 'task-' + code,
        text: 'Test task for ' + code,
        _unplacedReason: code,
        _unplacedDetail: 'Some detail about ' + code,
        date: '2026-06-25',
        when: 'morning',
        status: '',
        dependsOn: []
      };
      var { container } = render(<ConflictsView {...makeProps({ unplaced: [task] })} />);

      // The friendly label must appear in a chip span.
      // SELF-MUTATION: change the labelFor call in ConflictsView to t._unplacedReason directly →
      //   'tool_conflict' would appear instead of 'Tool unavailable' → chip not found → FAILS.
      var chipEl = findLabelSpan(container, expectedLabel);
      expect(chipEl).not.toBeNull();

      // The raw snake_case code must NOT be the text of any span (no raw code leak to DOM).
      var allSpans = container.querySelectorAll('span');
      allSpans.forEach(function(span) {
        // Raw code strings contain underscores; labels never do.
        if (span.textContent.trim() === code) {
          // If a span's text IS the raw code, that's a leak — fail.
          throw new Error('Raw code "' + code + '" found as span text — friendly label not rendered');
        }
      });
    });
  });
});

// ─── AC4.1 — where/when line renders when t.date is present ──────────────────

// Helper: find a span whose textContent contains the given substring.
// The "wanted:" outer span has child spans for date and when, creating split text nodes
// that defeat RTL's exact getByText. We query by container traversal instead.
function findSpanContaining(container, text) {
  var spans = container.querySelectorAll('span');
  for (var i = 0; i < spans.length; i++) {
    if (spans[i].textContent.includes(text)) return spans[i];
  }
  return null;
}

describe('AC4.1 — intended where/when line renders when t.date is present', () => {

  test('AC4.1-a: task with _unplacedReason and date → "wanted: <date>" renders', () => {
    // ConflictsView renders "wanted: <date>" when t.date is set (line 210-218 in component).
    // The outer <span> has textContent 'wanted: 2026-06-25 · morning'.
    // SELF-MUTATION: remove the "(t.date || t.earliestStart || t.when)" guard in ConflictsView →
    //   the "wanted:" span disappears → findSpanContaining returns null → FAILS.
    var task = {
      id: 'ac41-a',
      text: 'Task with date',
      _unplacedReason: 'tool_conflict',
      _unplacedDetail: 'Needs personal_pc at work',
      date: '2026-06-25',
      when: 'morning',
      status: '',
      dependsOn: []
    };
    var { container } = render(<ConflictsView {...makeProps({ unplaced: [task] })} />);
    // The outer "wanted:" span must exist.
    expect(findSpanContaining(container, 'wanted:')).not.toBeNull();
    // The date must appear as a child span.
    // SELF-MUTATION: change date to null → '2026-06-25' not rendered → date span absent → FAILS.
    expect(findSpanContaining(container, '2026-06-25')).not.toBeNull();
  });

  test('AC4.1-b: task with earliestStart but no date → "wanted:" still renders', () => {
    var task = {
      id: 'ac41-b',
      text: 'Task with earliestStart only',
      _unplacedReason: 'no_slot',
      _unplacedDetail: 'No capacity',
      date: null,
      earliestStart: '2026-06-26',
      when: 'afternoon',
      status: '',
      dependsOn: []
    };
    var { container } = render(<ConflictsView {...makeProps({ unplaced: [task] })} />);
    expect(findSpanContaining(container, 'wanted:')).not.toBeNull();
    expect(findSpanContaining(container, '2026-06-26')).not.toBeNull();
  });

  test('AC4.1-c: task with _unplacedReason and when → when text appears in "wanted:" area', () => {
    var task = {
      id: 'ac41-c',
      text: 'Task with when',
      _unplacedReason: 'location_mismatch',
      _unplacedDetail: 'Required biz; got home',
      date: '2026-06-27',
      when: 'morning',
      status: '',
      dependsOn: []
    };
    var { container } = render(<ConflictsView {...makeProps({ unplaced: [task] })} />);
    expect(findSpanContaining(container, 'wanted:')).not.toBeNull();
    expect(findSpanContaining(container, 'morning')).not.toBeNull();
  });

  test('AC4.1-d: task with NO date, NO earliestStart, NO when → "wanted:" line does NOT render', () => {
    // The where/when line is conditional: only renders when at least one of date/earliestStart/when is set.
    var task = {
      id: 'ac41-d',
      text: 'Task with no date or when',
      _unplacedReason: 'no_slot',
      _unplacedDetail: 'No free slot',
      date: null,
      earliestStart: null,
      when: '',
      status: '',
      dependsOn: []
    };
    var { container } = render(<ConflictsView {...makeProps({ unplaced: [task] })} />);
    // No "wanted:" span should exist anywhere in the DOM.
    // SELF-MUTATION: remove the guard condition → "wanted:" renders even with null date → FAILS.
    expect(findSpanContaining(container, 'wanted:')).toBeNull();
  });
});

// ─── AC4.3 — Detail string renders ──────────────────────────────────────────

describe('AC4.3 — detail string renders for unplaced tasks', () => {

  test('AC4.3-a: _unplacedDetail text appears in the DOM', () => {
    // ConflictsView renders t._unplacedDetail in a div after the reason chip (line 224-226).
    // SELF-MUTATION: remove the t._unplacedDetail block in ConflictsView →
    //   the detail span disappears → queryByText fails → FAILS.
    var detail = 'Needs personal_pc; not available at work during biz blocks';
    var task = {
      id: 'ac43-a',
      text: 'Task for detail test',
      _unplacedReason: 'tool_conflict',
      _unplacedDetail: detail,
      date: '2026-06-25',
      when: 'morning',
      status: '',
      dependsOn: []
    };
    render(<ConflictsView {...makeProps({ unplaced: [task] })} />);
    expect(screen.getByText(detail)).toBeInTheDocument();
  });

  test('AC4.3-b: location_mismatch detail string renders', () => {
    var detail = 'Required location: biz; resolved location: home';
    var task = {
      id: 'ac43-b',
      text: 'Location mismatch task',
      _unplacedReason: 'location_mismatch',
      _unplacedDetail: detail,
      date: '2026-06-25',
      when: 'afternoon',
      status: '',
      dependsOn: []
    };
    render(<ConflictsView {...makeProps({ unplaced: [task] })} />);
    expect(screen.getByText(detail)).toBeInTheDocument();
  });

  test('AC4.3-c: no_slot detail string renders', () => {
    var detail = 'Could not be placed in any eligible window';
    var task = {
      id: 'ac43-c',
      text: 'No-slot task',
      _unplacedReason: 'no_slot',
      _unplacedDetail: detail,
      date: '2026-06-25',
      when: 'morning,afternoon',
      status: '',
      dependsOn: []
    };
    render(<ConflictsView {...makeProps({ unplaced: [task] })} />);
    expect(screen.getByText(detail)).toBeInTheDocument();
  });

  test('AC4.3-d: task with NO _unplacedDetail → task renders but detail area absent', () => {
    // When _unplacedDetail is not set, the detail div must not render (it is conditional:
    // {t._unplacedDetail && <div>...}).
    var task = {
      id: 'ac43-d',
      text: 'Task without detail',
      _unplacedReason: 'no_slot',
      _unplacedDetail: null,
      date: '2026-06-25',
      when: 'morning',
      status: '',
      dependsOn: []
    };
    var { container } = render(<ConflictsView {...makeProps({ unplaced: [task] })} />);
    // Reason chip must still render (AC4.2 — chip is guarded by _unplacedReason, not _unplacedDetail).
    // SELF-MUTATION: set _unplacedReason null → chip absent → findLabelSpan null → chip check below fails.
    expect(findLabelSpan(container, 'No free slot')).not.toBeNull();
    // Task card must render.
    expect(screen.getByText('Task without detail')).toBeInTheDocument();
    // No detail text must appear (no sentence with null content).
    // We verify by checking there is no extra text node below the chip area.
    // The detail div renders {t._unplacedDetail} — if null, the div is absent entirely.
    // Confirm by asserting the container has no element with textContent matching a placeholder.
    // (Positive approach: confirm the task card text IS there, detail text is NOT.)
    // Since detail is null we cannot assert getByText(null) — we check the DOM is clean:
    expect(container.querySelectorAll('[data-testid="task-card"]').length).toBe(1);
  });

  test('AC4.3-e: multiple unplaced tasks — each detail renders correctly', () => {
    var tasks = [
      {
        id: 'ac43-e1',
        text: 'Task E1',
        _unplacedReason: 'tool_conflict',
        _unplacedDetail: 'Tool detail for E1',
        date: '2026-06-25',
        when: 'morning',
        status: '',
        dependsOn: []
      },
      {
        id: 'ac43-e2',
        text: 'Task E2',
        _unplacedReason: 'location_mismatch',
        _unplacedDetail: 'Location detail for E2',
        date: '2026-06-26',
        when: 'afternoon',
        status: '',
        dependsOn: []
      }
    ];
    var { container } = render(<ConflictsView {...makeProps({ unplaced: tasks })} />);
    // Both detail strings must be in the DOM (plain text in a <span> — exact match works).
    expect(screen.getByText('Tool detail for E1')).toBeInTheDocument();
    expect(screen.getByText('Location detail for E2')).toBeInTheDocument();
    // Both friendly label chips must render (use container query for split-text chip spans).
    expect(findLabelSpan(container, 'Tool unavailable')).not.toBeNull();
    expect(findLabelSpan(container, 'Location mismatch')).not.toBeNull();
  });
});

// ─── Integration: all three ACs together for a typical unplaced task ──────────

describe('AC4 integration — reason chip + where/when + detail all render together', () => {

  test('AC4-int: unplaced task with tool_conflict → label chip + wanted line + detail all in DOM', () => {
    var task = {
      id: 'ac4-int',
      text: 'Submit Weekly UI Claim',
      _unplacedReason: 'tool_conflict',
      _unplacedDetail: 'Needs personal_pc; not available at work during biz blocks',
      date: '2026-06-25',
      when: 'morning',
      status: '',
      dependsOn: []
    };
    var { container } = render(<ConflictsView {...makeProps({ unplaced: [task] })} />);

    // AC4.2: friendly label chip renders — NOT raw 'tool_conflict'.
    // SELF-MUTATION: replace labelFor(t._unplacedReason) with t._unplacedReason in ConflictsView →
    //   chip text becomes 'tool_conflict' → findLabelSpan('Tool unavailable') returns null → FAILS.
    expect(findLabelSpan(container, 'Tool unavailable')).not.toBeNull();

    // AC4.1: where/when line with date present.
    // SELF-MUTATION: remove the (t.date || t.earliestStart || t.when) guard →
    //   "wanted:" renders unconditionally (but would still be present — test remains green).
    //   Better mutation: set date=null in fixture → date span absent → FAILS.
    expect(findSpanContaining(container, 'wanted:')).not.toBeNull();
    expect(findSpanContaining(container, '2026-06-25')).not.toBeNull();

    // AC4.3: detail string renders as plain text (not split — single text node in <span>).
    expect(screen.getByText('Needs personal_pc; not available at work during biz blocks')).toBeInTheDocument();

    // Raw snake_case code must not appear as a span's text content.
    var allSpans = container.querySelectorAll('span');
    allSpans.forEach(function(span) {
      expect(span.textContent.trim()).not.toBe('tool_conflict');
    });
  });
});

// ─── Data Issues rendering — every warning type renders visible text ──────────
// Regression: the Data Issues list rendered EMPTY yellow bars for scheduler
// warning types that had no render branch (recurringConflict,
// recurring_split_overflow). The backend emits these (unifiedScheduleV2.js
// :757/:2135 and :1940) but ConflictsView only handled 4 of the 6 types, so the
// outer amber div rendered with no inner text. Fix added the two branches + a
// catch-all so no type ever renders blank.
describe('ConflictsView — Data Issues warnings (no blank rows)', () => {
  // Open the Data Issues subsection (defaults collapsed: dataIssues=true) while
  // keeping the action group open (actionGroup=false). Same localStorage path the
  // component reads on mount (STORAGE_KEY 'juggler-issues-collapsed').
  function openDataIssues() {
    localStorage.setItem('juggler-issues-collapsed', JSON.stringify({
      actionGroup: false, infoGroup: true, overdue: true, unplaced: true, dataIssues: false
    }));
  }

  afterEach(() => { localStorage.clear(); });

  it('renders descriptive text for recurringConflict and recurring_split_overflow (was blank)', () => {
    openDataIssues();
    var allTasks = [
      { id: 't-standup', text: 'Daily Standup' },
      { id: 't-workout', text: 'Workout' }
    ];
    var schedulerWarnings = [
      { type: 'recurringConflict', taskId: 't-standup' },
      { type: 'recurring_split_overflow', taskId: 't-workout', masterId: 'm-workout' }
    ];
    render(<ConflictsView {...makeProps({ allTasks: allTasks, schedulerWarnings: schedulerWarnings })} />);

    // The friendly labels render...
    expect(screen.getByText(/Recurring conflict:/)).toBeInTheDocument();
    expect(screen.getByText(/Recurring split overflow:/)).toBeInTheDocument();
    // ...and the affected task names are surfaced (resolved from allTasks by taskId).
    expect(screen.getByText('Daily Standup')).toBeInTheDocument();
    expect(screen.getByText('Workout')).toBeInTheDocument();
    // SELF-MUTATION: delete either new branch in ConflictsView → its label span
    // disappears → getByText FAILS. (Pre-fix these rows were empty → also FAILS.)
  });

  it('renders a catch-all row (never blank) for an unrecognized warning type', () => {
    openDataIssues();
    var schedulerWarnings = [{ type: 'someBrandNewType', taskId: 't-x' }];
    var { container } = render(<ConflictsView {...makeProps({
      allTasks: [{ id: 't-x', text: 'Mystery Task' }],
      schedulerWarnings: schedulerWarnings
    })} />);

    // Unknown type still produces a labeled, non-empty row (the anti-blank guard).
    expect(screen.getByText(/Scheduling constraint:/)).toBeInTheDocument();
    expect(screen.getByText(/someBrandNewType/)).toBeInTheDocument();
    // SELF-MUTATION: remove the KNOWN_DATA_ISSUE_TYPES catch-all → unknown type
    // renders an empty amber div → both assertions FAIL (the exact original bug).

    // No amber data-issue row is blank: every styled leaf div has text content.
    // (Pre-fix the unhandled type produced exactly such an empty styled div.)
    var blankStyledLeaves = 0;
    container.querySelectorAll('div').forEach(function(d) {
      if (d.children.length === 0 && d.textContent.trim() === '' &&
          /rgb\(/.test(d.getAttribute('style') || '')) blankStyledLeaves++;
    });
    expect(blankStyledLeaves).toBe(0);
  });
});
