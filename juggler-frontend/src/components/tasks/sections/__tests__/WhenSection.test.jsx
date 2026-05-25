import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WhenSection from '../WhenSection';

const TH = {
  accent: '#4f46e5', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff',
  border: '#ccc', text: '#000', inputBg: '#fff', inputBorder: '#ccc', inputText: '#000',
  amberBg: '#fff3cd', amberText: '#856404', amberBorder: '#ffc107', purpleBg: '#f3e8ff', purpleText: '#7c3aed'
};

var BASE = {
  date: '2026-05-17', time: '14:00', endTime: '14:30', dur: 30,
  recurring: false, rigid: false, timeFlex: 60,
  recurType: 'none', recurDays: 'MTWRF', recurEvery: 1, recurTpc: 1,
  recurStart: '', recurEnd: '',
  deadline: '', startAfter: '', split: false, splitMin: 15,
  travelBefore: 0, travelAfter: 0, marker: false, flexWhen: false,
  datePinned: false, dayReq: 'any', when: '', timeRemaining: '',
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
  onMarkerChange: noop, onFlexWhenChange: noop, onDatePinnedChange: noop,
  onDayReqChange: noop, onWhenChange: noop, onTimeRemainingChange: noop,
  onChangeTz: noop, toggleCollapse: noop, onModeChange: noop,
  onHasPreferredTimeChange: noop, onRecurUnitChange: noop, onRecurFillPolicyChange: noop,
};

it('renders date field', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} />);
  expect(screen.getByDisplayValue('2026-05-17')).toBeInTheDocument();
});

it('shows Recurrence sub-section collapsed by default', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} />);
  expect(screen.queryByText(/Daily/)).not.toBeInTheDocument();
});

it('expands Recurrence sub-section when collapse.when_recurrence is true', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByText(/Daily/)).toBeInTheDocument();
});

// --- placementMode prop tests (D-24 through D-26) ---

it('non-recurring task shows three-button mode selector (Anytime, Time window, Time blocks)', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} placementMode="anytime"
  />);
  expect(screen.getByTitle(/No time restriction/)).toBeInTheDocument();
  expect(screen.getByTitle(/Schedule near a preferred time/)).toBeInTheDocument();
  expect(screen.getByTitle(/Restrict to named time block windows/)).toBeInTheDocument();
});

it('non-recurring task Anytime button is active when placementMode === anytime', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} placementMode="anytime"
  />);
  var btn = screen.getByTitle(/No time restriction/);
  // Active button has fontWeight 600
  expect(btn.style.fontWeight).toBe('600');
});

it('non-recurring task Time window button is active when placementMode === time_window', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} placementMode="time_window"
  />);
  var btn = screen.getByTitle(/Schedule near a preferred time/);
  expect(btn.style.fontWeight).toBe('600');
});

it('non-recurring task Time blocks button is active when placementMode === time_blocks', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} placementMode="time_blocks"
  />);
  var btn = screen.getByTitle(/Restrict to named time block windows/);
  expect(btn.style.fontWeight).toBe('600');
});

it('clicking Time window button calls onModeChange with time_window', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} placementMode="anytime"
    onModeChange={function(m) { called = m; }}
  />);
  fireEvent.click(screen.getByTitle(/Schedule near a preferred time/));
  expect(called).toBe('time_window');
});

it('clicking Anytime button on non-recurring task calls onModeChange with anytime', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} placementMode="time_window"
    onModeChange={function(m) { called = m; }}
  />);
  fireEvent.click(screen.getByTitle(/No time restriction/));
  expect(called).toBe('anytime');
});

it('time input shown for non-recurring task when placementMode === time_window', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} placementMode="time_window" time="09:00"
  />);
  // Should see a "⏰ Time" label
  expect(screen.getByText('⏰ Time')).toBeInTheDocument();
});

it('time input NOT shown for non-recurring task when placementMode === anytime', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} placementMode="anytime"
  />);
  expect(screen.queryByText('⏰ Time')).not.toBeInTheDocument();
});

it('recurring task mode buttons call onModeChange', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" placementMode="anytime"
    onModeChange={function(m) { called = m; }}
  />);
  // The recurring section also has Time window button — find the recurring one
  var btns = screen.getAllByText(/Time window/);
  fireEvent.click(btns[0]);
  expect(called).toBe('time_window');
});

it('All Day button calls onModeChange with all_day', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} placementMode="anytime"
    onModeChange={function(m) { called = m; }}
  />);
  fireEvent.click(screen.getByTitle(/Spans the entire day/));
  expect(called).toBe('all_day');
});

it('day picker label says "Eligible days" for weekly recurrence', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MTWRF"
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByText('Eligible days')).toBeInTheDocument();
});

it('recurrence select has option "Every 2 weeks" not "Biweekly"', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.queryByRole('option', { name: 'Biweekly' })).not.toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Every 2 weeks' })).toBeInTheDocument();
});

// --- Task 2: Sub-mode split toggle for weekly/biweekly flexible quota ---

it('shows "All N days" / "Flexible quota" toggle when selectedCount > 1 for weekly', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={3}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByText('All 3 days')).toBeInTheDocument();
  expect(screen.getByText('Flexible quota')).toBeInTheDocument();
});

it('"All N days" is active when recurTpc === selectedCount', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={3}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  var allBtn = screen.getByText('All 3 days');
  expect(allBtn.style.fontWeight).toBe('600');
});

it('"Flexible quota" is active when recurTpc < selectedCount', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={2}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  var flexBtn = screen.getByText('Flexible quota');
  expect(flexBtn.style.fontWeight).toBe('600');
});

it('clicking "All N days" calls onRecurTpcChange with selectedCount', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={2}
    onRecurTpcChange={function(v) { called = v; }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  fireEvent.click(screen.getByText('All 3 days'));
  expect(called).toBe(3);
});

it('clicking "Flexible quota" when tpc===selectedCount calls onRecurTpcChange with selectedCount-1', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={3}
    onRecurTpcChange={function(v) { called = v; }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  fireEvent.click(screen.getByText('Flexible quota'));
  expect(called).toBe(2);
});

it('tpc select not shown when "All N days" is active', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={3}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  // In All mode the select and its label are not rendered
  expect(screen.queryByText('Complete per cycle')).not.toBeInTheDocument();
});

it('tpc select IS shown when "Flexible quota" is active', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={2}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByText('Complete per cycle')).toBeInTheDocument();
});

it('clicking "Flexible quota" when already in flex-mode does not change recurTpc', () => {
  var called = false;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" recurDays="MWF" recurTpc={1}
    onRecurTpcChange={function() { called = true; }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  fireEvent.click(screen.getByText('Flexible quota'));
  expect(called).toBe(false);
});

// --- Task 3: Rolling recurrence mode UI ---

it('recurrence select has "Rolling (repeats after completion)" option', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByRole('option', { name: 'Rolling (repeats after completion)' })).toBeInTheDocument();
});

it('rolling mode shows interval input', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="rolling" recurEvery={7} recurUnit="days"
    task={{ rolling_anchor: null }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByText('Repeat every')).toBeInTheDocument();
  expect(screen.getByDisplayValue('7')).toBeInTheDocument();
});

it('rolling mode shows unit select with days/weeks/months options', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="rolling" recurEvery={7} recurUnit="days"
    task={{ rolling_anchor: null }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByRole('option', { name: 'days' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'weeks' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'months' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'years' })).not.toBeInTheDocument();
});

it('rolling mode anchor card shows "not yet set" when rolling_anchor is null', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="rolling" recurEvery={7} recurUnit="days"
    task={{ rolling_anchor: null }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByText(/Not yet completed/)).toBeInTheDocument();
});

it('rolling mode anchor card shows last completed and next due when rolling_anchor set', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="rolling" recurEvery={7} recurUnit="days"
    task={{ rolling_anchor: '2026-05-19' }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.getByText('Completed on')).toBeInTheDocument();
  expect(screen.getByText('Next due')).toBeInTheDocument();
});

it('rolling mode hides day picker', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="rolling" recurEvery={7} recurUnit="days"
    task={{ rolling_anchor: null }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.queryByText('Eligible days')).not.toBeInTheDocument();
});

it('rolling mode hides fill policy', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="rolling" recurEvery={7} recurUnit="days"
    task={{ rolling_anchor: null }}
    collapse={{ when_recurrence: true, when_constraints: false }}
  />);
  expect(screen.queryByText(/Keep the schedule/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Backfill missed/)).not.toBeInTheDocument();
});

// --- datePinned toggle ---

it('shows Pin button when datePinned is false', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} />);
  expect(screen.getByText('📌 Pin')).toBeInTheDocument();
});

it('shows Pinned button when datePinned is true', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={true} />);
  expect(screen.getByText('📍 Pinned')).toBeInTheDocument();
});

it('clicking Pin button calls onDatePinnedChange with true', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false}
    onDatePinnedChange={function(v) { called = v; }}
  />);
  fireEvent.click(screen.getByText('📌 Pin'));
  expect(called).toBe(true);
});

it('clicking Pinned button calls onDatePinnedChange with false', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={true}
    onDatePinnedChange={function(v) { called = v; }}
  />);
  fireEvent.click(screen.getByText('📍 Pinned'));
  expect(called).toBe(false);
});

// --- marker calendar source banner ---

it('shows calendar source for marker task with gcalEventId', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} marker={true} placementMode="reminder" task={{ gcalEventId: 'g1' }} />);
  expect(screen.getByText(/Calendar reminder from Google Calendar/)).toBeInTheDocument();
});

it('shows calendar source for marker task with appleEventId', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} marker={true} placementMode="reminder" task={{ appleEventId: 'a1' }} />);
  expect(screen.getByText(/Calendar reminder from Apple Calendar/)).toBeInTheDocument();
});

it('shows no marker banner when marker task has no event id', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} marker={true} placementMode="reminder" task={{}} />);
  expect(screen.queryByText(/Calendar reminder/)).not.toBeInTheDocument();
});

// --- lockout explanation banner ---

it('shows pinned lockout banner when datePinned is true', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={true} placementMode="anytime" />);
  expect(screen.getByText(/Date is pinned/)).toBeInTheDocument();
});

it('shows calendar-managed lockout banner when placementMode is fixed', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" />);
  expect(screen.getByText(/Calendar-managed/)).toBeInTheDocument();
});

it('shows Google Calendar source in calendar-managed banner', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{ gcalEventId: 'gcal_123' }} />);
  expect(screen.getByText(/by Google Calendar/)).toBeInTheDocument();
});

it('shows Microsoft Calendar source in calendar-managed banner', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{ msftEventId: 'msft_456' }} />);
  expect(screen.getByText(/by Microsoft Calendar/)).toBeInTheDocument();
});

it('shows Apple Calendar source in calendar-managed banner', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{ appleEventId: 'apple_789' }} />);
  expect(screen.getByText(/by Apple Calendar/)).toBeInTheDocument();
});

it('gcal wins over msft when both event ids present', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{ gcalEventId: 'g1', msftEventId: 'm1' }} />);
  expect(screen.getByText(/by Google Calendar/)).toBeInTheDocument();
  expect(screen.queryByText(/by Microsoft/)).not.toBeInTheDocument();
});

it('empty-string gcalEventId treated as no source — falls back to generic banner', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{ gcalEventId: '' }} />);
  expect(screen.getByText(/Calendar-managed/)).toBeInTheDocument();
  expect(screen.queryByText(/by Google/)).not.toBeInTheDocument();
});

it('shows generic calendar-managed banner when no event id available', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{}} />);
  expect(screen.getByText(/Calendar-managed/)).toBeInTheDocument();
  expect(screen.queryByText(/by Google/)).not.toBeInTheDocument();
  expect(screen.queryByText(/by Microsoft/)).not.toBeInTheDocument();
  expect(screen.queryByText(/by Apple/)).not.toBeInTheDocument();
});

it('does not show lockout banner when isFixed is false', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="anytime" />);
  expect(screen.queryByText(/Date is pinned/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Calendar-managed/)).not.toBeInTheDocument();
});
