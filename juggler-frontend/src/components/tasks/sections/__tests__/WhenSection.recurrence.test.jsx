/**
 * WhenSection — Monthly and interval recurrence tests (ZOE-JUG-037)
 *
 * TC-MR001: Monthly recurrence — day-of-month selector renders when recurType=monthly.
 * TC-MR002: Monthly recurrence — clicking a day-of-month fires onRecurMonthDaysChange.
 * TC-MR003: Monthly recurrence — special "1st" and "Last" buttons render.
 * TC-MR004: Monthly recurrence — clicking "Last" toggles it on.
 * TC-MR005: Monthly recurrence — multiple selected days show times-per-month selector.
 * TC-MR006: Monthly recurrence — changing times-per-month fires onRecurTpcChange.
 * TC-IV001: Interval recurrence — "Every N" input renders when recurType=interval.
 * TC-IV002: Interval recurrence — unit select renders with days/weeks/months/years options.
 * TC-IV003: Interval recurrence — changing the interval number fires onRecurEveryChange.
 * TC-IV004: Interval recurrence — changing unit to weeks fires onRecurUnitChange with "weeks".
 * TC-IV005: Interval recurrence — changing unit to months fires onRecurUnitChange with "months".
 * TC-IV006: Interval recurrence — interval=1 renders without error.
 * TC-IV007: Interval recurrence — high interval value (365) renders without error.
 * TC-IV008: Interval recurrence — day-of-month selector is NOT rendered when recurType=interval.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WhenSection from '../WhenSection';

// ─── Shared theme ─────────────────────────────────────────────────────────────

const TH = {
  accent: '#4f46e5', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff',
  border: '#ccc', text: '#000', inputBg: '#fff', inputBorder: '#ccc', inputText: '#000',
  amberBg: '#fff3cd', amberText: '#856404', amberBorder: '#ffc107',
  redText: '#dc2626',
};

// ─── Base props ───────────────────────────────────────────────────────────────

var BASE = {
  date: '2026-05-17', time: '14:00', endTime: '14:30', dur: 30,
  recurring: true, rigid: false, timeFlex: 60,
  recurType: 'none', recurDays: 'MTWRF', recurEvery: 1, recurTpc: 1,
  recurUnit: 'days', recurMonthDays: [], recurFillPolicy: 'keep',
  recurStart: '', recurEnd: '',
  deadline: '', earliestStart: '', split: false, splitMin: 15,
  travelBefore: 0, travelAfter: 0, marker: false, flexWhen: false,
  dayReq: 'any', when: '', timeRemaining: '',
  taskTz: 'America/New_York',
  isCreate: false, isMobile: false, scheduleTemplates: [], templateDefaults: {},
  collapse: { when_recurrence: true, when_constraints: false },
  uniqueTags: [],
  placementMode: 'anytime',
  hasPreferredTime: false,
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
  onRecurMonthDaysChange: noop, onEndTimeErrorChange: noop,
};

function buildProps(overrides) {
  return Object.assign({}, BASE, COMMON_HANDLERS, { TH }, overrides);
}

// ─── TC-MR001: Monthly recurrence renders day-of-month selector ───────────────

describe('TC-MR001: monthly recurrence renders day-of-month selector', () => {
  it('shows "Days of month" label when recurType=monthly', () => {
    render(<WhenSection {...buildProps({ recurType: 'monthly', recurMonthDays: [] })} />);
    expect(screen.getByText('Days of month')).toBeInTheDocument();
  });

  it('renders numbered day buttons 1 through 28', () => {
    render(<WhenSection {...buildProps({ recurType: 'monthly', recurMonthDays: [] })} />);
    // Check a sample of them — 1, 15, 28
    var buttons = screen.getAllByRole('button');
    var buttonTexts = buttons.map(function(b) { return b.textContent; });
    expect(buttonTexts).toContain('1');
    expect(buttonTexts).toContain('15');
    expect(buttonTexts).toContain('28');
  });

  it('does NOT show day-of-month selector when recurType=daily', () => {
    render(<WhenSection {...buildProps({ recurType: 'daily', recurMonthDays: [] })} />);
    expect(screen.queryByText('Days of month')).not.toBeInTheDocument();
  });

  it('does NOT show day-of-month selector when recurType=none', () => {
    render(<WhenSection {...buildProps({ recurType: 'none', recurMonthDays: [] })} />);
    expect(screen.queryByText('Days of month')).not.toBeInTheDocument();
  });
});

// ─── TC-MR002: Clicking a day fires onRecurMonthDaysChange ───────────────────

describe('TC-MR002: clicking a day-of-month fires onRecurMonthDaysChange', () => {
  it('clicking day button "5" calls onRecurMonthDaysChange with ["5"] when none selected', () => {
    var called = null;
    render(<WhenSection
      {...buildProps({ recurType: 'monthly', recurMonthDays: [] })}
      onRecurMonthDaysChange={function(v) { called = v; }}
    />);
    // Find the button with text exactly "5"
    var dayButtons = screen.getAllByRole('button');
    var btn5 = dayButtons.find(function(b) { return b.textContent === '5'; });
    expect(btn5).toBeDefined();
    fireEvent.click(btn5);
    expect(called).toEqual(['5']);
  });

  it('clicking an already-selected day removes it from the array', () => {
    var called = null;
    render(<WhenSection
      {...buildProps({ recurType: 'monthly', recurMonthDays: ['5', '10'] })}
      onRecurMonthDaysChange={function(v) { called = v; }}
    />);
    var dayButtons = screen.getAllByRole('button');
    var btn5 = dayButtons.find(function(b) { return b.textContent === '5'; });
    fireEvent.click(btn5);
    // Should remove '5', leaving ['10']
    expect(called).toEqual(['10']);
  });

  it('calls onRecurMonthDaysChange exactly once per click', () => {
    var callCount = 0;
    render(<WhenSection
      {...buildProps({ recurType: 'monthly', recurMonthDays: [] })}
      onRecurMonthDaysChange={function() { callCount++; }}
    />);
    var dayButtons = screen.getAllByRole('button');
    var btn3 = dayButtons.find(function(b) { return b.textContent === '3'; });
    fireEvent.click(btn3);
    expect(callCount).toBe(1);
  });
});

// ─── TC-MR003: Special "1st" and "Last" buttons render ───────────────────────

describe('TC-MR003: monthly recurrence renders special 1st and Last buttons', () => {
  it('renders the "1st" button', () => {
    render(<WhenSection {...buildProps({ recurType: 'monthly', recurMonthDays: [] })} />);
    expect(screen.getByText('1st')).toBeInTheDocument();
  });

  it('renders the "Last" button', () => {
    render(<WhenSection {...buildProps({ recurType: 'monthly', recurMonthDays: [] })} />);
    expect(screen.getByText('Last')).toBeInTheDocument();
  });
});

// ─── TC-MR004: Clicking "Last" toggles it on ─────────────────────────────────

describe('TC-MR004: clicking the Last button fires onRecurMonthDaysChange with "last"', () => {
  it('clicking Last calls onRecurMonthDaysChange containing "last"', () => {
    var called = null;
    render(<WhenSection
      {...buildProps({ recurType: 'monthly', recurMonthDays: [] })}
      onRecurMonthDaysChange={function(v) { called = v; }}
    />);
    fireEvent.click(screen.getByText('Last'));
    expect(called).toContain('last');
  });

  it('clicking Last when already selected removes it from the array', () => {
    var called = null;
    render(<WhenSection
      {...buildProps({ recurType: 'monthly', recurMonthDays: ['last'] })}
      onRecurMonthDaysChange={function(v) { called = v; }}
    />);
    fireEvent.click(screen.getByText('Last'));
    expect(called).not.toContain('last');
  });
});

// ─── TC-MR005: Multiple selected days show times-per-month selector ───────────

describe('TC-MR005: times-per-month selector appears when multiple days are selected', () => {
  it('shows "Times per month:" when two or more days are selected', () => {
    render(<WhenSection {...buildProps({ recurType: 'monthly', recurMonthDays: ['5', '15'], recurTpc: 2 })} />);
    expect(screen.getByText('Times per month:')).toBeInTheDocument();
  });

  it('does NOT show "Times per month:" when only one day is selected', () => {
    render(<WhenSection {...buildProps({ recurType: 'monthly', recurMonthDays: ['5'], recurTpc: 1 })} />);
    expect(screen.queryByText('Times per month:')).not.toBeInTheDocument();
  });

  it('does NOT show "Times per month:" when no days are selected', () => {
    render(<WhenSection {...buildProps({ recurType: 'monthly', recurMonthDays: [], recurTpc: 0 })} />);
    expect(screen.queryByText('Times per month:')).not.toBeInTheDocument();
  });
});

// ─── TC-MR006: Changing times-per-month fires onRecurTpcChange ───────────────

describe('TC-MR006: changing times-per-month fires onRecurTpcChange', () => {
  it('selecting a lower value from the tpc select fires onRecurTpcChange with the integer', () => {
    var called = null;
    render(<WhenSection
      {...buildProps({ recurType: 'monthly', recurMonthDays: ['5', '10', '20'], recurTpc: 3 })}
      onRecurTpcChange={function(v) { called = v; }}
    />);
    var select = screen.getByDisplayValue('3 (all)');
    fireEvent.change(select, { target: { value: '2' } });
    expect(called).toBe(2);
  });
});

// ─── TC-IV001: Interval — "Every N" input renders ────────────────────────────

describe('TC-IV001: interval recurrence renders the Every N number input', () => {
  it('shows an input labelled by "Every" text when recurType=interval', () => {
    render(<WhenSection {...buildProps({ recurType: 'interval', recurEvery: 3, recurUnit: 'days' })} />);
    expect(screen.getByText('Every')).toBeInTheDocument();
  });

  it('the interval number input is present and has the correct value', () => {
    render(<WhenSection {...buildProps({ recurType: 'interval', recurEvery: 3, recurUnit: 'days' })} />);
    // It's a number input inside the Interval label block; value="3"
    var inputs = screen.getAllByRole('spinbutton');
    var intervalInput = inputs.find(function(inp) { return inp.value === '3'; });
    expect(intervalInput).toBeDefined();
  });

  it('does NOT show "Every" label when recurType=daily', () => {
    render(<WhenSection {...buildProps({ recurType: 'daily', recurEvery: 1, recurUnit: 'days' })} />);
    expect(screen.queryByText('Every')).not.toBeInTheDocument();
  });
});

// ─── TC-IV002: Interval — unit select has correct options ────────────────────

describe('TC-IV002: interval recurrence unit select has day/week/month/year options', () => {
  it('renders option "day(s)"', () => {
    render(<WhenSection {...buildProps({ recurType: 'interval', recurEvery: 1, recurUnit: 'days' })} />);
    expect(screen.getByText('day(s)')).toBeInTheDocument();
  });

  it('renders option "week(s)"', () => {
    render(<WhenSection {...buildProps({ recurType: 'interval', recurEvery: 1, recurUnit: 'days' })} />);
    expect(screen.getByText('week(s)')).toBeInTheDocument();
  });

  it('renders option "month(s)"', () => {
    render(<WhenSection {...buildProps({ recurType: 'interval', recurEvery: 1, recurUnit: 'days' })} />);
    expect(screen.getByText('month(s)')).toBeInTheDocument();
  });

  it('renders option "year(s)"', () => {
    render(<WhenSection {...buildProps({ recurType: 'interval', recurEvery: 1, recurUnit: 'days' })} />);
    expect(screen.getByText('year(s)')).toBeInTheDocument();
  });
});

// ─── TC-IV003: Changing interval number fires onRecurEveryChange ──────────────

describe('TC-IV003: changing the interval number fires onRecurEveryChange', () => {
  it('changing input value to 7 calls onRecurEveryChange with "7"', () => {
    var called = null;
    render(<WhenSection
      {...buildProps({ recurType: 'interval', recurEvery: 1, recurUnit: 'days' })}
      onRecurEveryChange={function(v) { called = v; }}
    />);
    var inputs = screen.getAllByRole('spinbutton');
    var intervalInput = inputs.find(function(inp) { return inp.value === '1'; });
    fireEvent.change(intervalInput, { target: { value: '7' } });
    expect(called).toBe('7');
  });

  it('calls onRecurEveryChange exactly once per change event', () => {
    var callCount = 0;
    render(<WhenSection
      {...buildProps({ recurType: 'interval', recurEvery: 1, recurUnit: 'days' })}
      onRecurEveryChange={function() { callCount++; }}
    />);
    var inputs = screen.getAllByRole('spinbutton');
    var intervalInput = inputs.find(function(inp) { return inp.value === '1'; });
    fireEvent.change(intervalInput, { target: { value: '14' } });
    expect(callCount).toBe(1);
  });
});

// ─── TC-IV004: Changing unit to weeks fires onRecurUnitChange ────────────────

describe('TC-IV004: changing interval unit to weeks fires onRecurUnitChange', () => {
  it('selecting "week(s)" calls onRecurUnitChange with "weeks"', () => {
    var called = null;
    render(<WhenSection
      {...buildProps({ recurType: 'interval', recurEvery: 2, recurUnit: 'days' })}
      onRecurUnitChange={function(v) { called = v; }}
    />);
    var select = screen.getByDisplayValue('day(s)');
    fireEvent.change(select, { target: { value: 'weeks' } });
    expect(called).toBe('weeks');
  });

  it('calls onRecurUnitChange exactly once per change', () => {
    var callCount = 0;
    render(<WhenSection
      {...buildProps({ recurType: 'interval', recurEvery: 2, recurUnit: 'days' })}
      onRecurUnitChange={function() { callCount++; }}
    />);
    var select = screen.getByDisplayValue('day(s)');
    fireEvent.change(select, { target: { value: 'weeks' } });
    expect(callCount).toBe(1);
  });
});

// ─── TC-IV005: Changing unit to months fires onRecurUnitChange ───────────────

describe('TC-IV005: changing interval unit to months fires onRecurUnitChange', () => {
  it('selecting "month(s)" calls onRecurUnitChange with "months"', () => {
    var called = null;
    render(<WhenSection
      {...buildProps({ recurType: 'interval', recurEvery: 3, recurUnit: 'weeks' })}
      onRecurUnitChange={function(v) { called = v; }}
    />);
    var select = screen.getByDisplayValue('week(s)');
    fireEvent.change(select, { target: { value: 'months' } });
    expect(called).toBe('months');
  });
});

// ─── TC-IV006: Edge — interval=1 renders without error ───────────────────────

describe('TC-IV006: interval=1 renders without error', () => {
  it('renders cleanly with recurEvery=1 and recurUnit=days', () => {
    render(<WhenSection {...buildProps({ recurType: 'interval', recurEvery: 1, recurUnit: 'days' })} />);
    expect(screen.getByText('Every')).toBeInTheDocument();
  });

  it('the number input shows value 1', () => {
    render(<WhenSection {...buildProps({ recurType: 'interval', recurEvery: 1, recurUnit: 'days' })} />);
    var inputs = screen.getAllByRole('spinbutton');
    var intervalInput = inputs.find(function(inp) { return inp.value === '1'; });
    expect(intervalInput).toBeDefined();
    expect(intervalInput.min).toBe('1');
  });
});

// ─── TC-IV007: Edge — high interval value (365) renders without error ─────────

describe('TC-IV007: high interval value (365) renders without error', () => {
  it('renders cleanly with recurEvery=365 and recurUnit=days', () => {
    render(<WhenSection {...buildProps({ recurType: 'interval', recurEvery: 365, recurUnit: 'days' })} />);
    var inputs = screen.getAllByRole('spinbutton');
    var intervalInput = inputs.find(function(inp) { return inp.value === '365'; });
    expect(intervalInput).toBeDefined();
  });
});

// ─── TC-IV008: Day-of-month selector absent for interval recurrence ───────────

describe('TC-IV008: day-of-month selector is NOT rendered when recurType=interval', () => {
  it('does not show "Days of month" label when recurType=interval', () => {
    render(<WhenSection {...buildProps({ recurType: 'interval', recurEvery: 7, recurUnit: 'days' })} />);
    expect(screen.queryByText('Days of month')).not.toBeInTheDocument();
  });
});
