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
  onHasPreferredTimeChange: noop,
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
