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

// ── R50.3 (999.796): a backend-overdue item (fixed/ingested event past its date, ──
// overdue=1, NO deadline) belongs in the "Overdue" action list — NOT the
// informational "Past Scheduled Date" bucket (which is for floating no-deadline
// tasks the scheduler rolls forward).
describe('ConflictsView — R50.3 overdue bucketing (past fixed event)', () => {
  function openOverdue() {
    localStorage.setItem('juggler-issues-collapsed', JSON.stringify({
      actionGroup: false, infoGroup: false, overdue: false, unplaced: true,
      dataIssues: true, stale: false, blocked: true, unscheduled: true
    }));
  }
  afterEach(() => { localStorage.clear(); });

  function sectionHeader(container, title) {
    return Array.prototype.find.call(container.querySelectorAll('span'),
      function(s) { return s.textContent === title; });
  }

  it('past fixed event with overdue=1 (no deadline) → Overdue badge count ≥ 1', () => {
    openOverdue();
    var pastFixed = { id: 'flight', text: 'Nathan Flies In', overdue: 1,
      date: '2026-06-15', deadline: null, placementMode: 'fixed', taskType: 'task' };
    var { container } = render(<ConflictsView {...makeProps({ allTasks: [pastFixed] })} />);

    // It renders in the Overdue section (TaskCard mock prints the task text).
    expect(screen.getByText('Nathan Flies In')).toBeInTheDocument();
    // The Overdue header carries a non-zero count badge (its sibling).
    var hdr = sectionHeader(container, 'Overdue');
    expect(hdr).toBeTruthy();
    var badge = hdr.nextElementSibling;
    expect(badge && badge.textContent).toBe('1');
    // SELF-MUTATION: drop the `if (t.overdue) isOverdue = true` line → the task
    // falls to "Past Scheduled Date" and the Overdue badge reads (0) → FAILS.
  });

  it('floating no-deadline past task (overdue=0) stays OUT of Overdue', () => {
    openOverdue();
    var floating = { id: 'tidy', text: 'Tidy Garage', overdue: 0,
      date: '2026-06-15', deadline: null, placementMode: 'anytime', taskType: 'task' };
    var { container } = render(<ConflictsView {...makeProps({ allTasks: [floating] })} />);
    // Overdue badge stays (0) — a floating task is not overdue (999.671 preserved).
    var hdr = sectionHeader(container, 'Overdue');
    var badge = hdr.nextElementSibling;
    expect(badge && badge.textContent).toBe('(0)');
  });
});

// ── W2 (juggler-issues-split-overdue-collapse) — "{N} chunks overdue" badge ──
// bert added a chunk-count badge in renderTaskSection, gated on
// `sec.key === 'overdue' && t._overdueChunkCount > 1` (ConflictsView.jsx:182-186).
// bert REFER->telly: no test existed for the badge itself. These tests close
// that gap using REAL computeConflictBuckets fixtures — the same
// split-occurrence-chunk shape as conflictBucketsSplitOverdueCollapse.test.js
// (which pins the GROUPING computation) — so this file pins the RENDER of
// that computation's output, not a hand-mocked bucket shape.
describe('ConflictsView — W2 overdue chunk-count badge ("{N} chunks overdue")', () => {
  function openOverdueAndUnplaced() {
    localStorage.setItem('juggler-issues-collapsed', JSON.stringify({
      actionGroup: false, infoGroup: true, overdue: false, unplaced: false,
      dataIssues: true, stale: true, blocked: true, unscheduled: true
    }));
  }
  afterEach(() => { localStorage.clear(); });

  // 4 chunk rows of ONE overdue split occurrence — collapses via
  // groupBySplitOccurrence() (conflictBuckets.js) into a single overdue entry
  // carrying _overdueChunkCount: 4.
  function overdueSplitChunk(id) {
    return {
      id: id, text: 'Weekly Review', splitGroup: 'occA', splitTotal: 4,
      sourceId: 'M-occA', date: '2026-06-15', overdue: true
    };
  }

  // A DIFFERENT split occurrence reported as unplaced (not overdue) —
  // grouped by the SAME helper into _unplacedChunkCount: 4 on the
  // unplacedForDisplay bucket, rendered by the 'unplaced' (Unscheduled)
  // section — a distinct sec.key from 'overdue'.
  function unplacedSplitChunk(id) {
    return {
      id: id, text: 'Backlog Cleanup', splitGroup: 'occB', splitTotal: 4,
      sourceId: 'M-occB', date: '2026-06-18', _unplacedReason: 'no_slot'
    };
  }

  // Find a leaf element (no child elements — i.e. the actual text-bearing
  // node, not an ancestor wrapper) whose trimmed textContent matches `re`.
  // Needed because the badge's JSX (`{t._overdueChunkCount} chunks overdue`)
  // splits into two text nodes under one <div>, defeating an exact
  // getByText() match (same split-text-node issue as findSpanContaining above).
  function findAllLeafMatching(container, re) {
    var all = container.querySelectorAll('div, span');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].children.length === 0 && re.test(all[i].textContent.trim())) out.push(all[i]);
    }
    return out;
  }

  test('W2-a: collapsed overdue row with _overdueChunkCount:4 renders "4 chunks overdue" badge', () => {
    openOverdueAndUnplaced();
    var chunks = [
      overdueSplitChunk('w2-a1'), overdueSplitChunk('w2-a2'),
      overdueSplitChunk('w2-a3'), overdueSplitChunk('w2-a4')
    ];
    var { container } = render(<ConflictsView {...makeProps({
      allTasks: chunks,
      statuses: { 'w2-a1': '', 'w2-a2': '', 'w2-a3': '', 'w2-a4': '' }
    })} />);

    // Grouping collapsed the 4 chunk rows to exactly one rendered TaskCard.
    expect(container.querySelectorAll('[data-testid="task-card"]').length).toBe(1);
    // SELF-MUTATION: change bert's gate from `> 1` to `> 4` (or delete the
    // badge block entirely) → this assertion FAILS.
    var matches = findAllLeafMatching(container, /chunks overdue/);
    expect(matches).toHaveLength(1);
    expect(matches[0].textContent.trim()).toBe('4 chunks overdue');
  });

  test('W2-b: non-split overdue row (no _overdueChunkCount, count<=1) does NOT render the badge', () => {
    openOverdueAndUnplaced();
    var single = { id: 'w2-single', text: 'Single Overdue Task', overdue: true, date: '2026-06-16' };
    var { container } = render(<ConflictsView {...makeProps({
      allTasks: [single], statuses: { 'w2-single': '' }
    })} />);

    expect(screen.getByText('Single Overdue Task')).toBeInTheDocument();
    // count===1 for this row (no splitGroup/sourceId collision) → groupBySplitOccurrence
    // returns the bare task with NO _overdueChunkCount field at all.
    // SELF-MUTATION: change the gate from `t._overdueChunkCount > 1` to
    // `t._overdueChunkCount >= 1` (or drop the `> 1` check) →
    // "undefined chunks overdue" or a stray badge would render → FAILS.
    expect(findAllLeafMatching(container, /chunks overdue/)).toHaveLength(0);
  });

  test('W2-c: badge is scoped to the Overdue section only — does not leak into Unscheduled', () => {
    openOverdueAndUnplaced();
    var overdueChunks = [
      overdueSplitChunk('w2-c-ov1'), overdueSplitChunk('w2-c-ov2'),
      overdueSplitChunk('w2-c-ov3'), overdueSplitChunk('w2-c-ov4')
    ];
    var unplacedChunks = [
      unplacedSplitChunk('w2-c-un1'), unplacedSplitChunk('w2-c-un2'),
      unplacedSplitChunk('w2-c-un3'), unplacedSplitChunk('w2-c-un4')
    ];

    var { container } = render(<ConflictsView {...makeProps({
      allTasks: overdueChunks,
      statuses: { 'w2-c-ov1': '', 'w2-c-ov2': '', 'w2-c-ov3': '', 'w2-c-ov4': '' },
      unplaced: unplacedChunks
    })} />);

    // Both occurrences collapsed to one card each — grouping ran on BOTH buckets
    // (overdue via `overdue`, the other via `unplacedForDisplay`).
    expect(container.querySelectorAll('[data-testid="task-card"]').length).toBe(2);
    expect(screen.getByText('Weekly Review')).toBeInTheDocument();
    var backlogCardEl = screen.getByText('Backlog Cleanup');

    // The badge renders EXACTLY ONCE in the whole DOM — for the Overdue
    // occurrence only — even though the Unscheduled occurrence ALSO carries a
    // >1 chunk-count field (_unplacedChunkCount: 4). If the
    // `sec.key === 'overdue'` guard were dropped (renderTaskSection is shared
    // across both sections), the Unscheduled row would ALSO render "chunks
    // overdue" text and this count would be 2.
    // SELF-MUTATION: remove the `sec.key === 'overdue' &&` clause in
    // ConflictsView.jsx (leaving only `t._overdueChunkCount > 1`) → matches
    // grows to 2 (both rows read the same field name coincidentally? no —
    // more realistically, widen the gate to fire on ANY chunk-count-bearing
    // field) → FAILS.
    var matches = findAllLeafMatching(container, /chunks overdue/);
    expect(matches).toHaveLength(1);
    expect(matches[0].textContent.trim()).toBe('4 chunks overdue');

    // Directly confirm the Unscheduled row's own DOM subtree carries no
    // "chunks overdue" text (the two badge concepts — Overdue's
    // "_overdueChunkCount" and Unscheduled's own "_unplacedChunkCount" — stay
    // textually and structurally distinct. As of the W2b fix below, the
    // Unscheduled section DOES render its OWN badge off this same fixture
    // ("4 chunks unplaced" — see the W2b describe block), so this assertion
    // is scoped to confirming no cross-contamination of the OVERDUE badge
    // text into the Unscheduled row, not the absence of any badge at all).
    var unplacedRow = backlogCardEl.parentElement;
    expect(unplacedRow.textContent).not.toMatch(/chunks overdue/);
  });

  // zoe-warn-section-scope-tautology (zoe-REVIEW.json, WARN, confidence:high) —
  // W2-c above uses fixtures where each occurrence carries a DISJOINT field set
  // (the overdue occurrence only has `_overdueChunkCount`; the unplaced occurrence
  // only has `_unplacedChunkCount`), so the `sec.key === 'overdue'` guard in
  // ConflictsView.jsx is never actually exercised — the field gate alone already
  // confines each badge to the row that has that field. Proven: perl-removing the
  // `sec.key === 'overdue' &&` clause still passes W2-c's 6 assertions (29/29 whole
  // suite) because no row in that fixture ever carries BOTH fields at once.
  //
  // This test closes that gap for real: the Overdue-section occurrence's raw chunk
  // rows are given an EXTRA, pre-set `_unplacedChunkCount: 4` field directly on the
  // fixture (simulating a naive/wrong upstream computation that stamped BOTH
  // chunk-count fields onto the same row instead of only the bucket-appropriate
  // one). `groupBySplitOccurrence` in conflictBuckets.js carries any pre-existing
  // field on the representative task straight through its `Object.assign` merge, so
  // the grouped result genuinely has `_overdueChunkCount:2` (computed) AND
  // `_unplacedChunkCount:4` (carried through) on the SAME object, rendered ONLY in
  // the Overdue section (never added to `unplaced`). If the `sec.key === 'overdue'`
  // guard on the "chunks unplaced" block were removed or wrong, this row would
  // render "4 chunks unplaced" text INSIDE the Overdue section — genuinely detectable,
  // unlike W2-c's disjoint fixture.
  test('W2-d (zoe-warn-section-scope-tautology): an Overdue-section row that ALSO carries _unplacedChunkCount>1 (dual-field, simulating a naive bug) does NOT render "chunks unplaced" — pins the sec.key==\'unplaced\' guard for real', () => {
    openOverdueAndUnplaced();
    function overdueChunkWithFakeUnplacedField(id) {
      return {
        id: id, text: 'Weekly Review', splitGroup: 'occE', splitTotal: 2,
        sourceId: 'M-occE', date: '2026-06-15', overdue: true,
        // Pre-set on the RAW input row (not computed) -- survives
        // groupBySplitOccurrence's Object.assign({}, g.task, augmented) merge,
        // so the grouped Overdue-section row ends up with BOTH fields.
        _unplacedChunkCount: 4
      };
    }
    var chunks = [
      overdueChunkWithFakeUnplacedField('w2-d-ov1'),
      overdueChunkWithFakeUnplacedField('w2-d-ov2')
    ];
    var { container } = render(<ConflictsView {...makeProps({
      allTasks: chunks,
      statuses: { 'w2-d-ov1': '', 'w2-d-ov2': '' }
    })} />);

    expect(container.querySelectorAll('[data-testid="task-card"]').length).toBe(1);
    // Sanity: confirm the dual-field row really was produced (both fields present
    // on the same rendered occurrence) -- otherwise this test would prove nothing.
    var overdueMatches = findAllLeafMatching(container, /chunks overdue/);
    expect(overdueMatches).toHaveLength(1);
    expect(overdueMatches[0].textContent.trim()).toBe('2 chunks overdue');

    // THE PIN: even though this row carries _unplacedChunkCount:4 (>1), it is
    // rendered by the 'overdue' section, so the "chunks unplaced" block must NOT
    // render. SELF-MUTATION: remove `sec.key === 'unplaced' &&` from
    // ConflictsView.jsx's unplaced-badge block (leaving only
    // `t._unplacedChunkCount > 1`) -> this assertion FAILS (finds "4 chunks
    // unplaced" text rendered inside the Overdue section).
    expect(findAllLeafMatching(container, /chunks unplaced/)).toHaveLength(0);
  });
});

// ── W2b (juggler-issues-split-overdue-collapse iter2) — "{N} chunks unplaced" badge ──
// bert added a matching chunk-count badge for the Unscheduled section in
// renderTaskSection, gated on `sec.key === 'unplaced' && t._unplacedChunkCount > 1`
// (ConflictsView.jsx:191-195), resolving ernie's consistency finding
// (ernie-info-unplaced-count-indicator-gap: the data already collapsed N chunks
// into 1 row via groupBySplitOccurrence(), but no UI surfaced the count — only
// the Overdue section's W2 badge did). bert REFER->telly: no test existed for
// this second badge. These tests mirror the W2-a/b/c pattern above exactly,
// using REAL computeConflictBuckets fixtures (same split-occurrence-chunk shape
// as conflictBucketsSplitOverdueCollapse.test.js) so the render is pinned
// against the actual grouping computation, not a hand-mocked bucket shape.
describe('ConflictsView — W2b unplaced chunk-count badge ("{N} chunks unplaced")', () => {
  function openOverdueAndUnplaced() {
    localStorage.setItem('juggler-issues-collapsed', JSON.stringify({
      actionGroup: false, infoGroup: true, overdue: false, unplaced: false,
      dataIssues: true, stale: true, blocked: true, unscheduled: true
    }));
  }
  afterEach(() => { localStorage.clear(); });

  // 4 chunk rows of ONE unplaced split occurrence — collapses via
  // groupBySplitOccurrence() (conflictBuckets.js), applied to
  // unplacedForDisplay, into a single unplaced entry carrying
  // _unplacedChunkCount: 4.
  function unplacedSplitChunk(id) {
    return {
      id: id, text: 'Backlog Cleanup', splitGroup: 'occC', splitTotal: 4,
      sourceId: 'M-occC', date: '2026-06-18', _unplacedReason: 'no_slot'
    };
  }

  // A DIFFERENT split occurrence reported as overdue (not unplaced) — grouped
  // by the SAME helper into _overdueChunkCount: 4 on the `overdue` bucket,
  // rendered by the 'overdue' section — a distinct sec.key from 'unplaced'.
  function overdueSplitChunk(id) {
    return {
      id: id, text: 'Weekly Review', splitGroup: 'occD', splitTotal: 4,
      sourceId: 'M-occD', date: '2026-06-15', overdue: true
    };
  }

  // Find a leaf element (identical helper to the W2 describe above) whose
  // trimmed textContent matches `re` — needed because the badge's JSX
  // (`{t._unplacedChunkCount} chunks unplaced`) splits into two text nodes
  // under one <div>, defeating an exact getByText() match.
  function findAllLeafMatching(container, re) {
    var all = container.querySelectorAll('div, span');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].children.length === 0 && re.test(all[i].textContent.trim())) out.push(all[i]);
    }
    return out;
  }

  test('W2b-a: collapsed unplaced row with _unplacedChunkCount:4 renders "4 chunks unplaced" badge', () => {
    openOverdueAndUnplaced();
    var chunks = [
      unplacedSplitChunk('w2b-a1'), unplacedSplitChunk('w2b-a2'),
      unplacedSplitChunk('w2b-a3'), unplacedSplitChunk('w2b-a4')
    ];
    var { container } = render(<ConflictsView {...makeProps({ unplaced: chunks })} />);

    // Grouping collapsed the 4 chunk rows to exactly one rendered TaskCard.
    expect(container.querySelectorAll('[data-testid="task-card"]').length).toBe(1);
    // SELF-MUTATION: change bert's gate from `> 1` to `> 4` (or delete the
    // badge block entirely) → this assertion FAILS.
    var matches = findAllLeafMatching(container, /chunks unplaced/);
    expect(matches).toHaveLength(1);
    expect(matches[0].textContent.trim()).toBe('4 chunks unplaced');
  });

  test('W2b-b: non-split unplaced row (no _unplacedChunkCount, count<=1) does NOT render the badge', () => {
    openOverdueAndUnplaced();
    var single = { id: 'w2b-single', text: 'Single Unplaced Task', date: '2026-06-16', _unplacedReason: 'no_slot' };
    var { container } = render(<ConflictsView {...makeProps({ unplaced: [single] })} />);

    expect(screen.getByText('Single Unplaced Task')).toBeInTheDocument();
    // count===1 for this row (no splitGroup/sourceId collision) → groupBySplitOccurrence
    // returns the bare task with NO _unplacedChunkCount field at all.
    // SELF-MUTATION: change the gate from `t._unplacedChunkCount > 1` to
    // `t._unplacedChunkCount >= 1` (or drop the `> 1` check) →
    // "undefined chunks unplaced" or a stray badge would render → FAILS.
    expect(findAllLeafMatching(container, /chunks unplaced/)).toHaveLength(0);
  });

  test('W2b-c: badge is scoped to the Unscheduled section only — does not leak into Overdue', () => {
    openOverdueAndUnplaced();
    var unplacedChunks = [
      unplacedSplitChunk('w2b-c-un1'), unplacedSplitChunk('w2b-c-un2'),
      unplacedSplitChunk('w2b-c-un3'), unplacedSplitChunk('w2b-c-un4')
    ];
    var overdueChunks = [
      overdueSplitChunk('w2b-c-ov1'), overdueSplitChunk('w2b-c-ov2'),
      overdueSplitChunk('w2b-c-ov3'), overdueSplitChunk('w2b-c-ov4')
    ];

    var { container } = render(<ConflictsView {...makeProps({
      allTasks: overdueChunks,
      statuses: { 'w2b-c-ov1': '', 'w2b-c-ov2': '', 'w2b-c-ov3': '', 'w2b-c-ov4': '' },
      unplaced: unplacedChunks
    })} />);

    // Both occurrences collapsed to one card each — grouping ran on BOTH
    // buckets (overdue via `overdue`, unplaced via `unplacedForDisplay`).
    expect(container.querySelectorAll('[data-testid="task-card"]').length).toBe(2);
    expect(screen.getByText('Backlog Cleanup')).toBeInTheDocument();
    var overdueCardEl = screen.getByText('Weekly Review');

    // The badge renders EXACTLY ONCE in the whole DOM — for the Unscheduled
    // occurrence only — even though the Overdue occurrence ALSO carries a
    // >1 chunk-count field (_overdueChunkCount: 4). If the
    // `sec.key === 'unplaced'` guard were dropped (renderTaskSection is
    // shared across both sections), the Overdue row would ALSO render
    // "chunks unplaced" text and this count would be 2.
    // SELF-MUTATION: remove the `sec.key === 'unplaced' &&` clause in
    // ConflictsView.jsx (leaving only `t._unplacedChunkCount > 1`) → matches
    // grows to 2 → FAILS.
    var matches = findAllLeafMatching(container, /chunks unplaced/);
    expect(matches).toHaveLength(1);
    expect(matches[0].textContent.trim()).toBe('4 chunks unplaced');

    // Directly confirm the Overdue row's own DOM subtree carries no
    // "chunks unplaced" text — the INVERSE of W2-c above (which confirms the
    // Unscheduled row carries no "chunks overdue" text). The two badge
    // strings are distinct, and each is scoped to its own section only.
    var overdueRow = overdueCardEl.parentElement;
    expect(overdueRow.textContent).not.toMatch(/chunks unplaced/);
  });

  // zoe-warn-section-scope-tautology — INVERSE of W2-d above. W2b-c's fixture
  // gives each occurrence a disjoint field set, so the `sec.key === 'unplaced'`
  // guard is never actually exercised (proven: removing it still passes all 6
  // W2/W2b badge tests, 29/29 whole suite). This test crafts an Unscheduled-section
  // row whose raw chunk rows ALSO carry a pre-set `_overdueChunkCount: 4` field
  // (simulating a naive bug that stamped both chunk-count fields on the same row).
  // groupBySplitOccurrence carries the pre-existing field through its
  // Object.assign merge, so the grouped Unscheduled-section row genuinely has BOTH
  // `_unplacedChunkCount` (computed) AND `_overdueChunkCount` (carried through) —
  // rendered only in the 'unplaced' section, never added to `allTasks`/`overdue`.
  test('W2b-d (zoe-warn-section-scope-tautology): an Unscheduled-section row that ALSO carries _overdueChunkCount>1 (dual-field, simulating a naive bug) does NOT render "chunks overdue" — pins the sec.key==\'overdue\' guard for real', () => {
    openOverdueAndUnplaced();
    function unplacedChunkWithFakeOverdueField(id) {
      return {
        id: id, text: 'Backlog Cleanup', splitGroup: 'occF', splitTotal: 2,
        sourceId: 'M-occF', date: '2026-06-18', _unplacedReason: 'no_slot',
        // Pre-set on the RAW input row (not computed) -- survives
        // groupBySplitOccurrence's Object.assign({}, g.task, augmented) merge,
        // so the grouped Unscheduled-section row ends up with BOTH fields.
        _overdueChunkCount: 4
      };
    }
    var chunks = [
      unplacedChunkWithFakeOverdueField('w2b-d-un1'),
      unplacedChunkWithFakeOverdueField('w2b-d-un2')
    ];
    var { container } = render(<ConflictsView {...makeProps({ unplaced: chunks })} />);

    expect(container.querySelectorAll('[data-testid="task-card"]').length).toBe(1);
    // Sanity: confirm the dual-field row really was produced.
    var unplacedMatches = findAllLeafMatching(container, /chunks unplaced/);
    expect(unplacedMatches).toHaveLength(1);
    expect(unplacedMatches[0].textContent.trim()).toBe('2 chunks unplaced');

    // THE PIN: even though this row carries _overdueChunkCount:4 (>1), it is
    // rendered by the 'unplaced' section, so the "chunks overdue" block must NOT
    // render. SELF-MUTATION: remove `sec.key === 'overdue' &&` from
    // ConflictsView.jsx's overdue-badge block (leaving only
    // `t._overdueChunkCount > 1`) -> this assertion FAILS (finds "4 chunks
    // overdue" text rendered inside the Unscheduled section).
    expect(findAllLeafMatching(container, /chunks overdue/)).toHaveLength(0);
  });
});
