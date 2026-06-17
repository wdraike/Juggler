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
  deadline: '', earliestStart: '', split: false, splitMin: 15,
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
  onDeadlineChange: noop, onEarliestStartChange: noop,
  onSplitChange: noop, onSplitMinChange: noop,
  onTravelBeforeChange: noop, onTravelAfterChange: noop,
  onMarkerChange: noop, onFlexWhenChange: noop,
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
  // ZOE-JUG-038: assert exact computed dates (formatAnchorDate uses en-US short format)
  // rolling_anchor 2026-05-19 → "May 19, 2026"; +7 days → "May 26, 2026"
  expect(screen.getByText('May 19, 2026')).toBeInTheDocument();
  expect(screen.getByText('May 26, 2026')).toBeInTheDocument();
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

// --- Fixed mode button ---

it('shows Fixed button in the mode selector', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} placementMode="anytime" />);
  expect(screen.getByTitle('Exact date and time — immovable')).toBeInTheDocument();
});

it('Fixed button appears active when placementMode is fixed (non-cal-linked)', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} placementMode="fixed" task={{}} />);
  // The Fixed button should be rendered with active toggle style (font-weight 600)
  var btn = screen.getByTitle('Exact date and time — immovable');
  expect(btn).toBeInTheDocument();
  expect(btn.style.fontWeight).toBe('600');
});

it('clicking Fixed button calls onModeChange with fixed', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} placementMode="anytime"
    onModeChange={function(v) { called = v; }}
  />);
  fireEvent.click(screen.getByTitle('Exact date and time — immovable'));
  expect(called).toBe('fixed');
});

it('Pin button no longer present in date row', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} placementMode="anytime" />);
  expect(screen.queryByText('📌 Pin')).not.toBeInTheDocument();
  expect(screen.queryByText('📍 Pinned')).not.toBeInTheDocument();
});

it('Fixed/Float rigid toggle no longer present in time row', () => {
  // The old rigid toggle ('📌 Fixed' / '🔀 Float') next to the timezone selector is gone.
  // '📌 Fixed' now refers only to the mode-selector button (title="Exact date and time — immovable").
  // Verify '🔀 Float' (the rigid-toggle's float label) is absent.
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} placementMode="time_window" />);
  expect(screen.queryByText('🔀 Float')).not.toBeInTheDocument();
  // '📌 Fixed' IS present — it's the new mode-selector button, not the old rigid toggle.
  expect(screen.getByTitle('Exact date and time — immovable')).toBeInTheDocument();
});

// --- lockout explanation banner ---

it('no "Date is pinned" banner — datePinned UI has been removed', () => {
  // datePinned is no longer a prop — the banner case for it is gone
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} placementMode="anytime" />);
  expect(screen.queryByText(/Date is pinned/)).not.toBeInTheDocument();
});

it('shows calendar-managed lockout banner when placementMode is fixed and task is calendar-linked', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{ gcalEventId: 'gcal_x' }} />);
  expect(screen.getByText(/Calendar-managed/)).toBeInTheDocument();
});

it('no lockout banner when placementMode is fixed but task has no calendar link', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" />);
  expect(screen.queryByText(/Calendar-managed/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Date is pinned/)).not.toBeInTheDocument();
});

it('shows Google Calendar source in calendar-managed banner', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{ gcalEventId: 'gcal_123' }} />);
  expect(screen.getByText(/by Google Calendar/)).toBeInTheDocument();
});

it('shows Microsoft Calendar source in calendar-managed banner', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{ msftEventId: 'msft_456' }} />);
  expect(screen.getByText(/by Microsoft Calendar/)).toBeInTheDocument();
});

it('shows Apple Calendar source in calendar-managed banner when no calendar name', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{ appleEventId: 'apple_789' }} />);
  expect(screen.getByText(/by Apple Calendar/)).toBeInTheDocument();
});

it('shows Apple Calendar with calendar name when appleCalendarName provided', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{ appleEventId: 'apple_789', appleCalendarName: 'Home' }} />);
  expect(screen.getByText(/by Apple Calendar: Home/)).toBeInTheDocument();
});

it('apple calendar name ignored when appleEventId absent — gcal provider wins instead', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{ gcalEventId: 'g1', appleCalendarName: 'Home' }} />);
  expect(screen.getByText(/by Google Calendar/)).toBeInTheDocument();
  expect(screen.queryByText(/Apple Calendar/)).not.toBeInTheDocument();
});

it('gcal wins over msft when both event ids present', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{ gcalEventId: 'g1', msftEventId: 'm1' }} />);
  expect(screen.getByText(/by Google Calendar/)).toBeInTheDocument();
  expect(screen.queryByText(/by Microsoft/)).not.toBeInTheDocument();
});

it('empty-string gcalEventId means task is not calendar-managed — no lock banner', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{ gcalEventId: '' }} />);
  expect(screen.queryByText(/Calendar-managed/)).not.toBeInTheDocument();
  expect(screen.queryByText(/by Google/)).not.toBeInTheDocument();
});

it('no calendar-managed banner when placementMode=fixed but task has no event IDs', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="fixed" task={{}} />);
  expect(screen.queryByText(/Calendar-managed/)).not.toBeInTheDocument();
  expect(screen.queryByText(/by Google/)).not.toBeInTheDocument();
  expect(screen.queryByText(/by Microsoft/)).not.toBeInTheDocument();
  expect(screen.queryByText(/by Apple/)).not.toBeInTheDocument();
});

it('does not show lockout banner when isFixed is false', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} datePinned={false} placementMode="anytime" />);
  expect(screen.queryByText(/Date is pinned/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Calendar-managed/)).not.toBeInTheDocument();
});

// --- ZOE-JUG-040: ± Window select atomicity ---

it('selecting exact in ± Window select calls onRigidChange(true) AND onTimeFlexChange(0) atomically', () => {
  var rigidCalled = null;
  var timeFlexCalled = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    placementMode="time_window" rigid={false} timeFlex={60}
    onRigidChange={function(v) { rigidCalled = v; }}
    onTimeFlexChange={function(v) { timeFlexCalled = v; }}
  />);
  var windowSelect = screen.getByDisplayValue(/exact|±/);
  fireEvent.change(windowSelect, { target: { value: '0' } });
  expect(rigidCalled).toBe(true);
  expect(timeFlexCalled).toBe(0);
});

it('selecting a non-zero window in ± Window select calls onRigidChange(false) AND onTimeFlexChange(v)', () => {
  var rigidCalled = null;
  var timeFlexCalled = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    placementMode="time_window" rigid={true} timeFlex={0}
    onRigidChange={function(v) { rigidCalled = v; }}
    onTimeFlexChange={function(v) { timeFlexCalled = v; }}
  />);
  var windowSelect = screen.getByDisplayValue('exact');
  fireEvent.change(windowSelect, { target: { value: '30' } });
  expect(rigidCalled).toBe(false);
  expect(timeFlexCalled).toBe(30);
});

it('± Window select shows "exact" option when rigid=true', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    placementMode="time_window" rigid={true} timeFlex={0}
  />);
  expect(screen.getByDisplayValue('exact')).toBeInTheDocument();
});

it('± Window select value reflects rigid state: shows "exact" when rigid=true, timeFlex=0', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    placementMode="time_window" rigid={true} timeFlex={0}
  />);
  // When rigid=true, the select is controlled to value 0 (maps to "exact" option)
  var windowSelect = screen.getByDisplayValue('exact');
  expect(windowSelect.value).toBe('0');
});

// --- endTime ↔ dur ↔ endTimeError three-way binding (ZOE-JUG-036) ---

it('changing endTime to valid value calls onDurChange with correct duration', () => {
  var durCalled = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    time="14:00" endTime="14:30" dur={30}
    onDurChange={function(v) { durCalled = v; }}
  />);
  var endInput = screen.getByDisplayValue('14:30');
  fireEvent.change(endInput, { target: { value: '15:00' } });
  // 15:00 - 14:00 = 60 minutes
  expect(durCalled).toBe(60);
});

it('changing endTime to a different valid value computes correct duration', () => {
  var durCalled = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    time="09:00" endTime="10:00" dur={60}
    onDurChange={function(v) { durCalled = v; }}
  />);
  var endInput = screen.getByDisplayValue('10:00');
  fireEvent.change(endInput, { target: { value: '09:15' } });
  // 09:15 - 09:00 = 15 minutes
  expect(durCalled).toBe(15);
});

it('changing endTime to time before start calls onEndTimeErrorChange with error message', () => {
  var errorCalled = undefined;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    time="14:00" endTime="14:30" dur={30}
    onEndTimeErrorChange={function(v) { errorCalled = v; }}
  />);
  var endInput = screen.getByDisplayValue('14:30');
  fireEvent.change(endInput, { target: { value: '13:00' } });
  expect(errorCalled).toBe('Finish must be after start');
});

it('changing endTime to time equal to start calls onEndTimeErrorChange with error message', () => {
  var errorCalled = undefined;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    time="14:00" endTime="14:30" dur={30}
    onEndTimeErrorChange={function(v) { errorCalled = v; }}
  />);
  var endInput = screen.getByDisplayValue('14:30');
  fireEvent.change(endInput, { target: { value: '14:00' } });
  expect(errorCalled).toBe('Finish must be after start');
});

it('changing endTime to valid value calls onEndTimeErrorChange(null) to clear error', () => {
  var errorCalled = 'sentinel';
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    time="14:00" endTime="13:00" dur={30} endTimeError="Finish must be after start"
    onEndTimeErrorChange={function(v) { errorCalled = v; }}
  />);
  var endInput = screen.getByDisplayValue('13:00');
  fireEvent.change(endInput, { target: { value: '15:00' } });
  expect(errorCalled).toBe(null);
});

it('changing dur calls onEndTimeChange with correctly computed end time', () => {
  var endTimeCalled = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    time="14:00" endTime="14:30" dur={30}
    onEndTimeChange={function(v) { endTimeCalled = v; }}
  />);
  var durInput = screen.getByDisplayValue('30');
  fireEvent.change(durInput, { target: { value: '60' } });
  // 14:00 + 60min = 15:00
  expect(endTimeCalled).toBe('15:00');
});

it('changing dur to a small value computes correct end time', () => {
  var endTimeCalled = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    time="09:00" endTime="10:00" dur={60}
    onEndTimeChange={function(v) { endTimeCalled = v; }}
  />);
  var durInput = screen.getByDisplayValue('60');
  fireEvent.change(durInput, { target: { value: '15' } });
  // 09:00 + 15min = 09:15
  expect(endTimeCalled).toBe('09:15');
});

it('changing dur calls onDurChange with validated positive value', () => {
  var durCalled = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    time="14:00" endTime="14:30" dur={30}
    onDurChange={function(v) { durCalled = v; }}
  />);
  var durInput = screen.getByDisplayValue('30');
  fireEvent.change(durInput, { target: { value: '45' } });
  expect(durCalled).toBe(45);
});

it('changing start time updates endTime via onEndTimeChange when dur is set', () => {
  var endTimeCalled = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    time="14:00" endTime="14:30" dur={30}
    onEndTimeChange={function(v) { endTimeCalled = v; }}
  />);
  var startInput = screen.getByDisplayValue('14:00');
  fireEvent.change(startInput, { target: { value: '10:00' } });
  // 10:00 + 30min = 10:30
  expect(endTimeCalled).toBe('10:30');
});

it('changing start time calls onEndTimeErrorChange(null) to clear any existing error', () => {
  var errorCalled = 'sentinel';
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    time="14:00" endTime="13:00" dur={30} endTimeError="Finish must be after start"
    onEndTimeErrorChange={function(v) { errorCalled = v; }}
  />);
  var startInput = screen.getByDisplayValue('14:00');
  fireEvent.change(startInput, { target: { value: '12:00' } });
  expect(errorCalled).toBe(null);
});

it('endTimeError message is displayed when endTimeError prop is set', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    endTimeError="Finish must be after start"
  />);
  expect(screen.getByText('Finish must be after start')).toBeInTheDocument();
});

it('endTimeError message is NOT displayed when endTimeError prop is absent', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} />);
  expect(screen.queryByText('Finish must be after start')).not.toBeInTheDocument();
});

it('endTimeError message is NOT displayed when endTimeError prop is null', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} endTimeError={null} />);
  expect(screen.queryByText('Finish must be after start')).not.toBeInTheDocument();
});

it('endTime field displays the current endTime prop value', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    time="09:00" endTime="10:30" dur={90}
  />);
  expect(screen.getByDisplayValue('10:30')).toBeInTheDocument();
});

it('changing endTime when start time is absent does not call onDurChange', () => {
  var durCalled = false;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    time="" endTime="14:30" dur={30}
    onDurChange={function() { durCalled = true; }}
  />);
  var endInput = screen.getByDisplayValue('14:30');
  fireEvent.change(endInput, { target: { value: '15:00' } });
  expect(durCalled).toBe(false);
});

// --- ZOE-JUG-039: Constraint panel open/close and interaction tests ---

it('Constraints panel is collapsed by default — Deadline and Start after labels absent', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH} />);
  expect(screen.queryByText('Deadline')).not.toBeInTheDocument();
  expect(screen.queryByText('Start after')).not.toBeInTheDocument();
});

it('Constraints panel shows Deadline and Start after inputs when when_constraints is true', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    collapse={{ when_recurrence: false, when_constraints: true }}
  />);
  expect(screen.getByText('Deadline')).toBeInTheDocument();
  expect(screen.getByText('Start after')).toBeInTheDocument();
});

it('clicking Constraints toggle button calls toggleCollapse with "when_constraints"', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    toggleCollapse={function(id) { called = id; }}
  />);
  var constraintsBtn = screen.getByRole('button', { name: /Constraints/ });
  fireEvent.click(constraintsBtn);
  expect(called).toBe('when_constraints');
});

it('Constraints toggle button shows collapsed arrow when panel is closed', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    collapse={{ when_recurrence: false, when_constraints: false }}
  />);
  var btn = screen.getByRole('button', { name: /Constraints/ });
  expect(btn.textContent).toMatch(/▶/);
});

it('Constraints toggle button shows expanded arrow when panel is open', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    collapse={{ when_recurrence: false, when_constraints: true }}
  />);
  var btn = screen.getByRole('button', { name: /Constraints/ });
  expect(btn.textContent).toMatch(/▼/);
});

it('Constraints badge shows "deadline set" when deadline is provided', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    deadline="2026-06-15"
    collapse={{ when_recurrence: false, when_constraints: false }}
  />);
  expect(screen.getByText('deadline set')).toBeInTheDocument();
});

it('Constraints badge absent when deadline is empty', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    deadline=""
    collapse={{ when_recurrence: false, when_constraints: false }}
  />);
  expect(screen.queryByText('deadline set')).not.toBeInTheDocument();
});

it('onDeadlineChange called when deadline input changes', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    deadline=""
    collapse={{ when_recurrence: false, when_constraints: true }}
    onDeadlineChange={function(v) { called = v; }}
  />);
  var deadlineLabel = screen.getByText('Deadline').closest('label');
  var deadlineInput = deadlineLabel.querySelector('input');
  fireEvent.change(deadlineInput, { target: { value: '2026-07-01' } });
  expect(called).toBe('2026-07-01');
});

it('onEarliestStartChange called when start after input changes', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    earliestStart=""
    collapse={{ when_recurrence: false, when_constraints: true }}
    onEarliestStartChange={function(v) { called = v; }}
  />);
  var earliestStartLabel = screen.getByText('Start after').closest('label');
  var earliestStartInput = earliestStartLabel.querySelector('input');
  fireEvent.change(earliestStartInput, { target: { value: '2026-06-10' } });
  expect(called).toBe('2026-06-10');
});

it('Travel before and after inputs shown for non-recurring non-marker tasks', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} marker={false}
    collapse={{ when_recurrence: false, when_constraints: true }}
  />);
  expect(screen.getByText('Travel before (min)')).toBeInTheDocument();
  expect(screen.getByText('Travel after (min)')).toBeInTheDocument();
});

it('Travel inputs not shown for recurring tasks', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" marker={false}
    collapse={{ when_recurrence: false, when_constraints: true }}
  />);
  expect(screen.queryByText('Travel before (min)')).not.toBeInTheDocument();
  expect(screen.queryByText('Travel after (min)')).not.toBeInTheDocument();
});

it('Travel inputs not shown for marker tasks', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} marker={true}
    collapse={{ when_recurrence: false, when_constraints: true }}
  />);
  expect(screen.queryByText('Travel before (min)')).not.toBeInTheDocument();
  expect(screen.queryByText('Travel after (min)')).not.toBeInTheDocument();
});

it('onTravelBeforeChange called when travel before input changes', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} marker={false} travelBefore={0}
    collapse={{ when_recurrence: false, when_constraints: true }}
    onTravelBeforeChange={function(v) { called = v; }}
  />);
  var label = screen.getByText('Travel before (min)').closest('label');
  var input = label.querySelector('input');
  fireEvent.change(input, { target: { value: '15' } });
  expect(called).toBe(15);
});

it('onTravelAfterChange called when travel after input changes', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} marker={false} travelAfter={0}
    collapse={{ when_recurrence: false, when_constraints: true }}
    onTravelAfterChange={function(v) { called = v; }}
  />);
  var label = screen.getByText('Travel after (min)').closest('label');
  var input = label.querySelector('input');
  fireEvent.change(input, { target: { value: '10' } });
  expect(called).toBe(10);
});

it('Allow split checkbox present for non-recurring non-marker task', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} marker={false} split={false}
    collapse={{ when_recurrence: false, when_constraints: true }}
  />);
  expect(screen.getByText(/Allow split/)).toBeInTheDocument();
  expect(screen.getByRole('checkbox').checked).toBe(false);
});

it('Allow split checkbox not shown for recurring tasks', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={true} recurType="weekly" marker={false} split={false}
    collapse={{ when_recurrence: false, when_constraints: true }}
  />);
  expect(screen.queryByText(/Allow split/)).not.toBeInTheDocument();
});

it('Allow split checkbox not shown for marker tasks', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} marker={true} split={false}
    collapse={{ when_recurrence: false, when_constraints: true }}
  />);
  expect(screen.queryByText(/Allow split/)).not.toBeInTheDocument();
});

it('onSplitChange called with true when split checkbox is clicked', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} marker={false} split={false}
    collapse={{ when_recurrence: false, when_constraints: true }}
    onSplitChange={function(v) { called = v; }}
  />);
  fireEvent.click(screen.getByRole('checkbox'));
  expect(called).toBe(true);
});

it('Min chunk input appears when split is true', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} marker={false} split={true} splitMin={15}
    collapse={{ when_recurrence: false, when_constraints: true }}
  />);
  expect(screen.getByText('Min chunk (min)')).toBeInTheDocument();
});

it('Min chunk input absent when split is false', () => {
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} marker={false} split={false}
    collapse={{ when_recurrence: false, when_constraints: true }}
  />);
  expect(screen.queryByText('Min chunk (min)')).not.toBeInTheDocument();
});

it('onSplitMinChange called when min chunk input changes', () => {
  var called = null;
  render(<WhenSection {...BASE} {...COMMON_HANDLERS} TH={TH}
    recurring={false} marker={false} split={true} splitMin={15}
    collapse={{ when_recurrence: false, when_constraints: true }}
    onSplitMinChange={function(v) { called = v; }}
  />);
  var label = screen.getByText('Min chunk (min)').closest('label');
  var input = label.querySelector('input');
  fireEvent.change(input, { target: { value: '20' } });
  expect(called).toBe(20);
});
