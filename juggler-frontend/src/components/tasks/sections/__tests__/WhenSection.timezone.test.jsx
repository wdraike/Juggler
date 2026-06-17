/**
 * WhenSection — TimezoneSelector interaction tests (ZOE-JUG-035)
 *
 * TC-TZ001: Timezone button renders with the default timezone abbreviation.
 * TC-TZ002: Clicking the button opens the dropdown with a search input.
 * TC-TZ003: Selecting a timezone calls onChangeTz with the correct IANA value.
 * TC-TZ004: Clicking outside the dropdown closes it without firing onChangeTz.
 * TC-TZ005: Searching filters the timezone list.
 * TC-TZ006: Empty search result shows "No timezones match" message.
 * TC-TZ007: Selected timezone is visually highlighted in the dropdown.
 * TC-TZ008: Timezone selector does NOT render when placementMode === 'all_day'.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import WhenSection from '../WhenSection';

// ─── Shared theme ────────────────────────────────────────────────────────────

const TH = {
  accent: '#4f46e5', btnBorder: '#ccc', textMuted: '#888', bgCard: '#fff',
  border: '#ccc', text: '#000', inputBg: '#fff', inputBorder: '#ccc', inputText: '#000',
  amberBg: '#fff3cd', amberText: '#856404', amberBorder: '#ffc107',
  redText: '#dc2626',
  purpleBg: '#f3e8ff', purpleText: '#7c3aed',
};

// ─── Base props ───────────────────────────────────────────────────────────────

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
  onRecurMonthDaysChange: noop, onEndTimeErrorChange: noop,
};

function buildProps(overrides) {
  return Object.assign({}, BASE, COMMON_HANDLERS, { TH }, overrides);
}

// ─── TC-TZ001: Renders with default timezone ──────────────────────────────────

describe('TC-TZ001: timezone button renders with default timezone', () => {
  it('renders a button containing the 🌐 globe icon', () => {
    render(<WhenSection {...buildProps({ taskTz: 'America/New_York' })} />);
    // The button contains 🌐 and the tz abbreviation text
    var btn = screen.getByText(/🌐/);
    expect(btn).toBeInTheDocument();
  });

  it('renders the ▾ chevron indicating it is a dropdown trigger', () => {
    render(<WhenSection {...buildProps({ taskTz: 'America/New_York' })} />);
    expect(screen.getByText(/▾/)).toBeInTheDocument();
  });

  it('renders without crashing for America/Los_Angeles', () => {
    render(<WhenSection {...buildProps({ taskTz: 'America/Los_Angeles' })} />);
    expect(screen.getByText(/🌐/)).toBeInTheDocument();
  });

  it('renders without crashing for Europe/London', () => {
    render(<WhenSection {...buildProps({ taskTz: 'Europe/London' })} />);
    expect(screen.getByText(/🌐/)).toBeInTheDocument();
  });
});

// ─── TC-TZ002: Opening the dropdown ──────────────────────────────────────────

describe('TC-TZ002: clicking the timezone button opens the dropdown', () => {
  it('dropdown is not visible before button is clicked', () => {
    render(<WhenSection {...buildProps({})} />);
    expect(screen.queryByPlaceholderText('Search timezones...')).not.toBeInTheDocument();
  });

  it('clicking the timezone button shows the search input', () => {
    render(<WhenSection {...buildProps({})} />);
    fireEvent.click(screen.getByText(/🌐/));
    expect(screen.getByPlaceholderText('Search timezones...')).toBeInTheDocument();
  });

  it('clicking the timezone button shows timezone options in the list', () => {
    render(<WhenSection {...buildProps({})} />);
    fireEvent.click(screen.getByText(/🌐/));
    // Africa/Cairo is in the first 50 of the full IANA list and always appears unfiltered
    expect(screen.getByText('Africa/Cairo')).toBeInTheDocument();
  });

  it('clicking the button a second time toggles the dropdown closed', () => {
    render(<WhenSection {...buildProps({})} />);
    var btn = screen.getByText(/🌐/);
    fireEvent.click(btn);
    expect(screen.getByPlaceholderText('Search timezones...')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByPlaceholderText('Search timezones...')).not.toBeInTheDocument();
  });
});

// ─── TC-TZ003: Selecting a timezone calls onChangeTz ─────────────────────────

describe('TC-TZ003: selecting a timezone fires onChangeTz with correct IANA value', () => {
  it('clicking a timezone option calls onChangeTz with the IANA name', () => {
    var called = null;
    render(<WhenSection {...buildProps({ taskTz: 'America/New_York' })}
      onChangeTz={function(tz) { called = tz; }}
    />);
    fireEvent.click(screen.getByText(/🌐/));
    // Search to bring Africa/Cairo into view, then click it
    var searchInput = screen.getByPlaceholderText('Search timezones...');
    fireEvent.change(searchInput, { target: { value: 'Cairo' } });
    fireEvent.click(screen.getByText('Africa/Cairo'));
    expect(called).toBe('Africa/Cairo');
  });

  it('after selecting, the dropdown closes', () => {
    render(<WhenSection {...buildProps({})} />);
    fireEvent.click(screen.getByText(/🌐/));
    var searchInput = screen.getByPlaceholderText('Search timezones...');
    fireEvent.change(searchInput, { target: { value: 'Lagos' } });
    fireEvent.click(screen.getByText('Africa/Lagos'));
    expect(screen.queryByPlaceholderText('Search timezones...')).not.toBeInTheDocument();
  });

  it('selecting a different timezone calls onChangeTz exactly once', () => {
    var callCount = 0;
    render(<WhenSection {...buildProps({})} onChangeTz={function() { callCount++; }} />);
    fireEvent.click(screen.getByText(/🌐/));
    var searchInput = screen.getByPlaceholderText('Search timezones...');
    fireEvent.change(searchInput, { target: { value: 'Lagos' } });
    fireEvent.click(screen.getByText('Africa/Lagos'));
    expect(callCount).toBe(1);
  });

  it('clicking a timezone in a filtered search result calls onChangeTz with correct value', () => {
    var called = null;
    render(<WhenSection {...buildProps({})} onChangeTz={function(tz) { called = tz; }} />);
    fireEvent.click(screen.getByText(/🌐/));
    var searchInput = screen.getByPlaceholderText('Search timezones...');
    fireEvent.change(searchInput, { target: { value: 'Tokyo' } });
    fireEvent.click(screen.getByText('Asia/Tokyo'));
    expect(called).toBe('Asia/Tokyo');
  });
});

// ─── TC-TZ004: Clicking outside closes the dropdown ──────────────────────────

describe('TC-TZ004: clicking outside the dropdown closes it', () => {
  it('mousedown outside the dropdown ref closes it', () => {
    render(
      <div>
        <div data-testid="outside">outside</div>
        <WhenSection {...buildProps({})} />
      </div>
    );
    fireEvent.click(screen.getByText(/🌐/));
    expect(screen.getByPlaceholderText('Search timezones...')).toBeInTheDocument();
    // Fire mousedown on an element outside the dropdown
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByPlaceholderText('Search timezones...')).not.toBeInTheDocument();
  });
});

// ─── TC-TZ005: Search filtering ──────────────────────────────────────────────

describe('TC-TZ005: typing in the search input filters timezone list', () => {
  it('typing "Tokyo" shows Asia/Tokyo', () => {
    render(<WhenSection {...buildProps({})} />);
    fireEvent.click(screen.getByText(/🌐/));
    fireEvent.change(screen.getByPlaceholderText('Search timezones...'), { target: { value: 'Tokyo' } });
    expect(screen.getByText('Asia/Tokyo')).toBeInTheDocument();
  });

  it('typing "Tokyo" hides America/New York from the list', () => {
    render(<WhenSection {...buildProps({})} />);
    fireEvent.click(screen.getByText(/🌐/));
    fireEvent.change(screen.getByPlaceholderText('Search timezones...'), { target: { value: 'Tokyo' } });
    expect(screen.queryByText('America/New York')).not.toBeInTheDocument();
  });

  it('search is case-insensitive: "tokyo" (lowercase) still shows Asia/Tokyo', () => {
    render(<WhenSection {...buildProps({})} />);
    fireEvent.click(screen.getByText(/🌐/));
    fireEvent.change(screen.getByPlaceholderText('Search timezones...'), { target: { value: 'tokyo' } });
    expect(screen.getByText('Asia/Tokyo')).toBeInTheDocument();
  });

  it('clearing the search input restores the full list', () => {
    render(<WhenSection {...buildProps({})} />);
    fireEvent.click(screen.getByText(/🌐/));
    var input = screen.getByPlaceholderText('Search timezones...');
    fireEvent.change(input, { target: { value: 'Tokyo' } });
    expect(screen.getByText('Asia/Tokyo')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '' } });
    // Unfiltered list: Africa/Cairo is in the first 50 and should reappear
    expect(screen.getByText('Africa/Cairo')).toBeInTheDocument();
  });
});

// ─── TC-TZ006: Empty search result ───────────────────────────────────────────

describe('TC-TZ006: empty search result shows "No timezones match"', () => {
  it('shows "No timezones match" when search finds nothing', () => {
    render(<WhenSection {...buildProps({})} />);
    fireEvent.click(screen.getByText(/🌐/));
    fireEvent.change(screen.getByPlaceholderText('Search timezones...'), {
      target: { value: 'zzz_not_a_real_timezone_xyz' }
    });
    expect(screen.getByText('No timezones match')).toBeInTheDocument();
  });

  it('no timezone rows rendered when search finds nothing', () => {
    render(<WhenSection {...buildProps({})} />);
    fireEvent.click(screen.getByText(/🌐/));
    fireEvent.change(screen.getByPlaceholderText('Search timezones...'), {
      target: { value: 'zzz_not_a_real_timezone_xyz' }
    });
    // America/New_York should not appear
    expect(screen.queryByText('America/New York')).not.toBeInTheDocument();
  });
});

// ─── TC-TZ007: Selected timezone is highlighted ───────────────────────────────

describe('TC-TZ007: selected timezone is visually highlighted in the dropdown', () => {
  it('the option matching taskTz has font-weight 600', () => {
    // Search for Cairo so it's visible in the list; set taskTz to Africa/Cairo
    render(<WhenSection {...buildProps({ taskTz: 'Africa/Cairo' })} />);
    fireEvent.click(screen.getByText(/🌐/));
    fireEvent.change(screen.getByPlaceholderText('Search timezones...'), { target: { value: 'Cairo' } });
    var cairoOption = screen.getByText('Africa/Cairo');
    expect(cairoOption.style.fontWeight).toBe('600');
  });

  it('non-selected options do not have font-weight 600', () => {
    // taskTz is Africa/Cairo; Africa/Lagos should appear unselected (font-weight 400)
    render(<WhenSection {...buildProps({ taskTz: 'Africa/Cairo' })} />);
    fireEvent.click(screen.getByText(/🌐/));
    fireEvent.change(screen.getByPlaceholderText('Search timezones...'), { target: { value: 'Africa' } });
    var lagosOption = screen.getByText('Africa/Lagos');
    expect(lagosOption.style.fontWeight).toBe('400');
  });
});

// ─── TC-TZ008: Timezone selector hidden in all_day mode ──────────────────────

describe('TC-TZ008: timezone selector is not rendered when placementMode === all_day', () => {
  it('globe icon not present in all_day mode', () => {
    render(<WhenSection {...buildProps({ placementMode: 'all_day' })} />);
    expect(screen.queryByText(/🌐/)).not.toBeInTheDocument();
  });

  it('search input not accessible in all_day mode (dropdown cannot be opened)', () => {
    render(<WhenSection {...buildProps({ placementMode: 'all_day' })} />);
    expect(screen.queryByPlaceholderText('Search timezones...')).not.toBeInTheDocument();
  });
});
