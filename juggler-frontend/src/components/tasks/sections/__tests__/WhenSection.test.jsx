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
};

function noop() {}

it('renders date field', () => {
  render(<WhenSection {...BASE} TH={TH}
    onDateChange={noop} onTimeChange={noop} onEndTimeChange={noop} onDurChange={noop}
    onRigidChange={noop} onTimeFlexChange={noop} onRecurTypeChange={noop}
    onRecurDaysChange={noop} onRecurEveryChange={noop} onRecurTpcChange={noop}
    onRecurStartChange={noop} onRecurEndChange={noop}
    onDeadlineChange={noop} onStartAfterChange={noop}
    onSplitChange={noop} onSplitMinChange={noop}
    onTravelBeforeChange={noop} onTravelAfterChange={noop}
    onMarkerChange={noop} onFlexWhenChange={noop} onDatePinnedChange={noop}
    onDayReqChange={noop} onWhenChange={noop} onTimeRemainingChange={noop}
    onChangeTz={noop} toggleCollapse={noop}
  />);
  expect(screen.getByDisplayValue('2026-05-17')).toBeInTheDocument();
});

it('shows Recurrence sub-section collapsed by default', () => {
  render(<WhenSection {...BASE} TH={TH}
    onDateChange={noop} onTimeChange={noop} onEndTimeChange={noop} onDurChange={noop}
    onRigidChange={noop} onTimeFlexChange={noop} onRecurTypeChange={noop}
    onRecurDaysChange={noop} onRecurEveryChange={noop} onRecurTpcChange={noop}
    onRecurStartChange={noop} onRecurEndChange={noop}
    onDeadlineChange={noop} onStartAfterChange={noop}
    onSplitChange={noop} onSplitMinChange={noop}
    onTravelBeforeChange={noop} onTravelAfterChange={noop}
    onMarkerChange={noop} onFlexWhenChange={noop} onDatePinnedChange={noop}
    onDayReqChange={noop} onWhenChange={noop} onTimeRemainingChange={noop}
    onChangeTz={noop} toggleCollapse={noop}
  />);
  expect(screen.queryByText(/Daily/)).not.toBeInTheDocument();
});

it('expands Recurrence sub-section when collapse.when_recurrence is true', () => {
  render(<WhenSection {...BASE} collapse={{ when_recurrence: true, when_constraints: false }} TH={TH}
    onDateChange={noop} onTimeChange={noop} onEndTimeChange={noop} onDurChange={noop}
    onRigidChange={noop} onTimeFlexChange={noop} onRecurTypeChange={noop}
    onRecurDaysChange={noop} onRecurEveryChange={noop} onRecurTpcChange={noop}
    onRecurStartChange={noop} onRecurEndChange={noop}
    onDeadlineChange={noop} onStartAfterChange={noop}
    onSplitChange={noop} onSplitMinChange={noop}
    onTravelBeforeChange={noop} onTravelAfterChange={noop}
    onMarkerChange={noop} onFlexWhenChange={noop} onDatePinnedChange={noop}
    onDayReqChange={noop} onWhenChange={noop} onTimeRemainingChange={noop}
    onChangeTz={noop} toggleCollapse={noop}
  />);
  expect(screen.getByText(/Daily/)).toBeInTheDocument();
});
