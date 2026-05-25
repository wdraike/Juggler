/**
 * WhenSection fixed-mode behaviour tests
 *
 * TC-W002: Fixed button renders and is active when placementMode='fixed', no calendar link.
 *          All mode buttons are interactive (not locked).
 * TC-W003: Fixed + calendar-managed (gcalEventId set) → mode selector locked, calendar banner visible.
 * TC-W004: Fixed + non-calendar-managed → all mode buttons interactive, no banner.
 * TC-W005: "Date is pinned" banner does NOT render under any prop combination (regression guard).
 * TC-W006: Fixed mode with no date/time → clicking Save blocked, validation message visible.
 *          (Tested via TaskEditForm since the guard and error rendering live there.)
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WhenSection from '../WhenSection';

// TC-W006 requires TaskEditForm to exercise the save-guard path.
jest.mock('../../../../services/apiClient');
import TaskEditForm from '../../TaskEditForm';

// ─── Shared TH theme ───────────────────────────────────────────────────────────

const TH = {
  accent: '#4f46e5', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff',
  border: '#ccc', text: '#000', inputBg: '#fff', inputBorder: '#ccc', inputText: '#000',
  amberBg: '#fff3cd', amberText: '#856404', amberBorder: '#ffc107',
  purpleBg: '#f3e8ff', purpleText: '#7c3aed',
};

// ─── WhenSection base props ────────────────────────────────────────────────────

var BASE = {
  date: '2026-05-17', time: '14:00', endTime: '14:30', dur: 30,
  recurring: false, rigid: false, timeFlex: 60,
  recurType: 'none', recurDays: 'MTWRF', recurEvery: 1, recurTpc: 1,
  recurStart: '', recurEnd: '',
  deadline: '', startAfter: '', split: false, splitMin: 15,
  travelBefore: 0, travelAfter: 0, marker: false, flexWhen: false,
  dayReq: 'any', when: '', timeRemaining: '',
  taskTz: 'America/New_York',
  isCreate: false, isMobile: false, scheduleTemplates: [], templateDefaults: {},
  collapse: { when_recurrence: false, when_constraints: false },
  uniqueTags: [],
  placementMode: 'anytime',
};

function noop() {}

var COMMON_HANDLERS = {
  onDateChange: noop, onTimeChange: noop, onEndTimeChange: noop, onDurChange: noop,
  onRigidChange: noop, onTimeFlexChange: noop, onRecurTypeChange: noop,
  onRecurDaysChange: noop, onRecurEveryChange: noop, onRecurTpcChange: noop,
  onRecurStartChange: noop, onRecurEndChange: noop,
  onDeadlineChange: noop, onStartAfterChange: noop,
  onSplitChange: noop, onSplitMinChange: noop,
  onTravelBeforeChange: noop, onTravelAfterChange: noop,
  onMarkerChange: noop, onFlexWhenChange: noop,
  onDayReqChange: noop, onWhenChange: noop, onTimeRemainingChange: noop,
  onChangeTz: noop, toggleCollapse: noop, onModeChange: noop,
  onHasPreferredTimeChange: noop, onRecurUnitChange: noop, onRecurFillPolicyChange: noop,
};

function buildProps(overrides) {
  return Object.assign({}, BASE, COMMON_HANDLERS, { TH }, overrides);
}

// ─── TC-W002 ───────────────────────────────────────────────────────────────────

describe('TC-W002: Fixed button active when placementMode=fixed, no calendar link', () => {
  it('Fixed button renders', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed' })} />);
    expect(screen.getByTitle('Exact date and time — immovable')).toBeInTheDocument();
  });

  it('Fixed button is active (font-weight 600) when placementMode=fixed', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed' })} />);
    var btn = screen.getByTitle('Exact date and time — immovable');
    expect(btn.style.fontWeight).toBe('600');
  });

  it('Fixed button has aria-pressed=true when placementMode=fixed', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed' })} />);
    var btn = screen.getByTitle('Exact date and time — immovable');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('All other mode buttons have aria-pressed=false when placementMode=fixed', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed' })} />);
    expect(screen.getByTitle(/No time restriction/)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTitle(/Schedule near a preferred time/)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTitle(/Restrict to named time block windows/)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTitle(/Spans the entire day/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('Mode selector NOT locked (no pointerEvents:none) when no calendar link', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed' })} />);
    var btn = screen.getByTitle(/No time restriction/);
    expect(btn.closest('[role="group"]')).not.toHaveStyle({ pointerEvents: 'none' });
  });

  it('Mode selector group has correct role and aria-label', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed' })} />);
    var group = screen.getByRole('group', { name: 'Scheduling mode' });
    expect(group).toBeInTheDocument();
  });
});

// ─── TC-W003 ───────────────────────────────────────────────────────────────────

describe('TC-W003: Fixed + calendar-managed → mode selector locked, calendar banner visible', () => {
  it('shows Calendar-managed banner when gcalEventId is set', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed', task: { gcalEventId: 'gcal_x' } })} />);
    expect(screen.getByText(/Calendar-managed/)).toBeInTheDocument();
  });

  it('mode selector is locked via pointerEvents:none when calendar-managed', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed', task: { gcalEventId: 'gcal_x' } })} />);
    var btn = screen.getByTitle(/No time restriction/);
    expect(btn.closest('div')).toHaveStyle({ pointerEvents: 'none' });
  });

  it('mode buttons have tabIndex=-1 when calendar-managed', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed', task: { gcalEventId: 'gcal_x' } })} />);
    expect(screen.getByTitle(/No time restriction/)).toHaveAttribute('tabIndex', '-1');
    expect(screen.getByTitle(/Schedule near a preferred time/)).toHaveAttribute('tabIndex', '-1');
    expect(screen.getByTitle(/Restrict to named time block windows/)).toHaveAttribute('tabIndex', '-1');
    expect(screen.getByTitle(/Spans the entire day/)).toHaveAttribute('tabIndex', '-1');
    expect(screen.getByTitle('Exact date and time — immovable')).toHaveAttribute('tabIndex', '-1');
  });
});

// ─── TC-W004 ───────────────────────────────────────────────────────────────────

describe('TC-W004: Fixed + non-calendar-managed → all mode buttons interactive, no banner', () => {
  it('does NOT show Calendar-managed banner when no calendar link', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed' })} />);
    expect(screen.queryByText(/Calendar-managed/)).not.toBeInTheDocument();
  });

  it('mode buttons have tabIndex=0 (interactive) when no calendar link', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed' })} />);
    expect(screen.getByTitle(/No time restriction/)).toHaveAttribute('tabIndex', '0');
    expect(screen.getByTitle(/Schedule near a preferred time/)).toHaveAttribute('tabIndex', '0');
    expect(screen.getByTitle(/Restrict to named time block windows/)).toHaveAttribute('tabIndex', '0');
    expect(screen.getByTitle(/Spans the entire day/)).toHaveAttribute('tabIndex', '0');
    expect(screen.getByTitle('Exact date and time — immovable')).toHaveAttribute('tabIndex', '0');
  });

  it('clicking a mode button fires onModeChange (not blocked) when no calendar link', () => {
    var called = null;
    render(<WhenSection {...buildProps({ placementMode: 'fixed' })} onModeChange={function(m) { called = m; }} />);
    fireEvent.click(screen.getByTitle(/No time restriction/));
    expect(called).toBe('anytime');
  });
});

// ─── TC-W005 ───────────────────────────────────────────────────────────────────

describe('TC-W005: "Date is pinned" banner never renders (regression guard)', () => {
  var propVariants = [
    { label: 'anytime, no datePinned', props: { placementMode: 'anytime' } },
    { label: 'fixed, no cal link', props: { placementMode: 'fixed' } },
    { label: 'fixed, cal-managed', props: { placementMode: 'fixed', task: { gcalEventId: 'x' } } },
    { label: 'fixed, datePinned=true', props: { placementMode: 'fixed', datePinned: true } },
    { label: 'anytime, datePinned=true', props: { placementMode: 'anytime', datePinned: true } },
    { label: 'time_window, datePinned=true', props: { placementMode: 'time_window', datePinned: true } },
  ];

  propVariants.forEach(function(variant) {
    it('no "Date is pinned" banner for: ' + variant.label, () => {
      render(<WhenSection {...buildProps(variant.props)} />);
      expect(screen.queryByText(/Date is pinned/)).not.toBeInTheDocument();
    });
  });
});

// ─── TC-W006 ───────────────────────────────────────────────────────────────────
// Save guard and error message live in TaskEditForm (not WhenSection).
// These tests render TaskEditForm to verify the full client-side validation path.

var BASE_TASK_FIXED = {
  id: 't-fixed-test', text: 'Fixed task', pri: 'P3', dur: 30, project: '', notes: '', url: '',
  location: [], tools: [], dependsOn: [], recurring: false, marker: false,
  slackMins: null, createdAt: '2026-01-01T00:00:00Z',
  weatherPrecip: 'any', weatherCloud: 'any',
  weatherTempMin: null, weatherTempMax: null,
  weatherHumidityMin: null, weatherHumidityMax: null,
  // Fixed mode with no date or time
  placementMode: 'fixed', date: null, time: null,
};

function renderFixedForm(taskOverrides, onUpdate) {
  localStorage.clear();
  var task = Object.assign({}, BASE_TASK_FIXED, taskOverrides);
  return render(
    <TaskEditForm
      task={task}
      status="todo"
      onUpdate={onUpdate || function() {}}
      onStatusChange={function() {}}
      onDelete={function() {}}
      onClose={function() {}}
      darkMode={false}
      isMobile={false}
      locations={[]}
      tools={[]}
      uniqueTags={[]}
      allProjectNames={[]}
      scheduleTemplates={[]}
      templateDefaults={{}}
      tempUnitPref="F"
    />
  );
}

// ─── TC-W007 ───────────────────────────────────────────────────────────────────
// UX-2: recurring task with placementMode='fixed' and no calendar link must show
// "not available" message + 4 valid mode buttons, NOT the calendar-managed banner.

describe('TC-W007: Recurring + fixed + no calendar link → shows "not available" message + 4 mode buttons', () => {
  function buildRecurringFixedProps(extraOverrides) {
    return buildProps(Object.assign({ recurring: true, placementMode: 'fixed' }, extraOverrides));
  }

  it('shows "not available" message, not "Calendar-managed" banner', () => {
    render(<WhenSection {...buildRecurringFixedProps()} />);
    expect(screen.getByText(/Fixed mode is not available for recurring tasks/)).toBeInTheDocument();
    expect(screen.queryByText(/Calendar-managed/)).not.toBeInTheDocument();
  });

  it('renders all four valid recurring mode buttons', () => {
    render(<WhenSection {...buildRecurringFixedProps()} />);
    expect(screen.getByText(/Anytime/)).toBeInTheDocument();
    expect(screen.getByText(/Time window/)).toBeInTheDocument();
    expect(screen.getByText(/Time blocks/)).toBeInTheDocument();
    expect(screen.getByText(/All Day/)).toBeInTheDocument();
  });

  it('none of the four mode buttons is aria-pressed=true', () => {
    render(<WhenSection {...buildRecurringFixedProps()} />);
    var group = screen.getByRole('group', { name: 'Scheduling mode' });
    var buttons = group.querySelectorAll('button');
    buttons.forEach(function(btn) {
      expect(btn).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('clicking Anytime fires onModeChange("anytime")', () => {
    var called = null;
    render(<WhenSection {...buildRecurringFixedProps()} onModeChange={function(m) { called = m; }} />);
    fireEvent.click(screen.getByText(/Anytime/));
    expect(called).toBe('anytime');
  });

  it('with calendar link present → shows "Calendar-managed" banner, not "not available" message', () => {
    render(<WhenSection {...buildRecurringFixedProps({ task: { gcalEventId: 'gcal_x' } })} />);
    expect(screen.getByText(/Calendar-managed/)).toBeInTheDocument();
    expect(screen.queryByText(/Fixed mode is not available/)).not.toBeInTheDocument();
  });
});

// ─── TC-W006 ───────────────────────────────────────────────────────────────────
// Save guard and error message live in TaskEditForm (not WhenSection).
// These tests render TaskEditForm to verify the full client-side validation path.

describe('TC-W006: Fixed mode with no date/time → Save blocked, validation message visible', () => {
  it('validation message appears when Save is clicked with fixed mode and no date', () => {
    renderFixedForm({ date: null, time: null });
    // Make the form dirty by changing the text so Save becomes available
    var textInput = screen.getByDisplayValue('Fixed task');
    fireEvent.change(textInput, { target: { value: 'Fixed task edited' } });
    // Click Save
    var saveBtn = screen.queryByTitle(/Save/i) || screen.queryByText(/Save/i);
    if (saveBtn) fireEvent.click(saveBtn);
    // Validation error must be visible
    expect(screen.getByText(/Fixed mode requires a date and time/i)).toBeInTheDocument();
  });

  it('onUpdate is NOT called when fixed mode has no date/time', () => {
    var updateCalled = false;
    renderFixedForm({ date: null, time: null }, function() { updateCalled = true; });
    var textInput = screen.getByDisplayValue('Fixed task');
    fireEvent.change(textInput, { target: { value: 'Fixed task edited' } });
    var saveBtn = screen.queryByTitle(/Save/i) || screen.queryByText(/Save/i);
    if (saveBtn) fireEvent.click(saveBtn);
    expect(updateCalled).toBe(false);
  });

  it('validation message does NOT appear when fixed mode has both date and time', () => {
    renderFixedForm({ date: '2026-05-20', time: '14:00' });
    var textInput = screen.getByDisplayValue('Fixed task');
    fireEvent.change(textInput, { target: { value: 'Fixed task edited' } });
    expect(screen.queryByText(/Fixed mode requires a date and time/i)).not.toBeInTheDocument();
  });
});
