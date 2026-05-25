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

var MODES = ['anytime', 'time_window', 'time_blocks', 'fixed', 'all_day'];

function buildProps(overrides) {
  return Object.assign({}, BASE, COMMON_HANDLERS, { TH }, overrides);
}

// Helpers to query mode selector buttons
function queryModeButtons() {
  return {
    anytime: screen.queryByText(/Anytime/),
    timeWindow: screen.queryByText(/Time window/),
    timeBlocks: screen.queryByText(/Time blocks/),
    allDay: screen.queryByText(/All Day/),
  };
}

function hasDisabledWithoutIndicator(container) {
  var inputs = container.querySelectorAll('input, select, button');
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    if (el.disabled) {
      // Check for a nearby visible indicator (title, aria-label, or helper text)
      var title = el.getAttribute('title');
      var aria = el.getAttribute('aria-label');
      var parent = el.closest('[title]');
      var sibling = el.nextElementSibling;
      var hasIndicator = !!(title || aria || parent || (sibling && sibling.textContent));
      if (!hasIndicator) return true;
    }
  }
  return false;
}

describe('WhenSection mode matrix', () => {
  MODES.forEach(function(placementMode) {
    [true, false].forEach(function(datePinned) {
      [true, false].forEach(function(rigid) {
        [true, false].forEach(function(recurring) {
          var label = 'placementMode=' + placementMode + ' datePinned=' + datePinned + ' rigid=' + rigid + ' recurring=' + recurring;

          describe(label, () => {
            var props = buildProps({ placementMode, datePinned, rigid, recurring });

            it('renders without crashing', () => {
              render(<WhenSection {...props} />);
            });

            it('mode selector buttons visibility is correct', () => {
              render(<WhenSection {...props} />);
              var btns = queryModeButtons();

              if (recurring) {
                // Recurring section shows Anytime, Time window, Time blocks
                expect(btns.anytime).toBeInTheDocument();
                expect(btns.timeWindow).toBeInTheDocument();
                expect(btns.timeBlocks).toBeInTheDocument();
              } else {
                // Non-recurring shows all four buttons regardless of placementMode
                expect(btns.anytime).toBeInTheDocument();
                expect(btns.timeWindow).toBeInTheDocument();
                expect(btns.timeBlocks).toBeInTheDocument();
                expect(btns.allDay).toBeInTheDocument();
              }
            });

            it('isFixed derivation is correct', () => {
              render(<WhenSection {...props} />);
              var isCalManaged = !!(props.task && (props.task.gcalEventId || props.task.msftEventId || props.task.appleEventId));
              var expectedIsFixed = !!datePinned || (placementMode === 'fixed' && isCalManaged);
              // When isFixed is true, the Scheduling mode label opacity drops to 0.4
              // (label is absent in all_day mode, so skip assertion there)
              var labelEl = screen.queryByText('Scheduling mode');
              if (labelEl) {
                var opacity = labelEl.style.opacity;
                if (expectedIsFixed) {
                  expect(opacity).toBe('0.4');
                } else {
                  expect(opacity).toBe('1');
                }
              }
            });

            it('no control is disabled without a visible indicator', () => {
              var { container } = render(<WhenSection {...props} />);
              expect(hasDisabledWithoutIndicator(container)).toBe(false);
            });

            it('All Day mode hides time inputs', () => {
              render(<WhenSection {...props} />);
              var timeLabel = screen.queryByText('Time');
              if (placementMode === 'all_day') {
                expect(timeLabel).not.toBeInTheDocument();
              }
              // For other modes time may or may not be shown; we only assert the all_day case
            });
          });
        });
      });
    });
  });
});

describe('WhenSection pin toggle', () => {
  it('clicking Pin calls onDatePinnedChange with true', () => {
    var called = null;
    render(<WhenSection {...buildProps({ datePinned: false })} onDatePinnedChange={function(v) { called = v; }} />);
    fireEvent.click(screen.getByText(/Pin/));
    expect(called).toBe(true);
  });

  it('clicking Pinned calls onDatePinnedChange with false', () => {
    var called = null;
    render(<WhenSection {...buildProps({ datePinned: true })} onDatePinnedChange={function(v) { called = v; }} />);
    fireEvent.click(screen.getByText(/Pinned/));
    expect(called).toBe(false);
  });
});

describe('WhenSection fixed mode specifics', () => {
  it('fixed mode dims mode selector and disables pointer events when calendar-managed', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed', task: { gcalEventId: 'gcal_x' } })} />);
    var anytimeBtn = screen.getByText(/Anytime/);
    expect(anytimeBtn).toBeInTheDocument();
    expect(anytimeBtn.closest('div')).toHaveStyle({ pointerEvents: 'none' });
  });

  it('fixed mode does NOT lock controls when task has no calendar link', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed', datePinned: false })} />);
    var anytimeBtn = screen.getByTitle(/No time restriction/);
    expect(anytimeBtn.closest('div')).not.toHaveStyle({ pointerEvents: 'none' });
  });

  it('fixed mode still shows Pin toggle', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed', datePinned: false })} />);
    expect(screen.getByText(/Pin/)).toBeInTheDocument();
  });
});

describe('WhenSection all_day mode specifics', () => {
  it('all_day hides time input even when time prop is provided', () => {
    render(<WhenSection {...buildProps({ placementMode: 'all_day', time: '14:00' })} />);
    expect(screen.queryByDisplayValue('14:00')).not.toBeInTheDocument();
    expect(screen.queryByText('Time')).not.toBeInTheDocument();
  });

  it('all_day mode shows date input', () => {
    render(<WhenSection {...buildProps({ placementMode: 'all_day', date: '2026-05-20' })} />);
    expect(screen.getByDisplayValue('2026-05-20')).toBeInTheDocument();
  });
});

describe('WhenSection deep interactions — no silent lockouts', () => {
  it('clicking Anytime calls onModeChange with anytime', () => {
    var called = null;
    render(<WhenSection {...buildProps({ placementMode: 'time_window' })} onModeChange={function(m) { called = m; }} />);
    fireEvent.click(screen.getByTitle(/No time restriction/));
    expect(called).toBe('anytime');
  });

  it('clicking Time window calls onModeChange with time_window', () => {
    var called = null;
    render(<WhenSection {...buildProps({ placementMode: 'anytime' })} onModeChange={function(m) { called = m; }} />);
    fireEvent.click(screen.getByTitle(/Schedule near a preferred time/));
    expect(called).toBe('time_window');
  });

  it('clicking Time blocks calls onModeChange with time_blocks and prefills when', () => {
    var modeCalled = null, whenCalled = null;
    render(<WhenSection {...buildProps({ placementMode: 'anytime', when: '' })} onModeChange={function(m) { modeCalled = m; }} onWhenChange={function(w) { whenCalled = w; }} />);
    fireEvent.click(screen.getByTitle(/Restrict to named time block windows/));
    expect(modeCalled).toBe('time_blocks');
    expect(whenCalled).toBe('morning,lunch,afternoon,evening,night');
  });

  it('clicking All Day calls onModeChange with all_day and clears constraints', () => {
    var modeCalled = null, pinCalled = null, whenCalled = null, splitCalled = null, travelBeforeCalled = null, travelAfterCalled = null;
    render(<WhenSection {...buildProps({ placementMode: 'anytime' })}
      onModeChange={function(m) { modeCalled = m; }}
      onDatePinnedChange={function(v) { pinCalled = v; }}
      onWhenChange={function(w) { whenCalled = w; }}
      onSplitChange={function(v) { splitCalled = v; }}
      onTravelBeforeChange={function(v) { travelBeforeCalled = v; }}
      onTravelAfterChange={function(v) { travelAfterCalled = v; }}
    />);
    fireEvent.click(screen.getByTitle(/Spans the entire day/));
    expect(modeCalled).toBe('all_day');
    expect(pinCalled).toBe(false);
    expect(whenCalled).toBe('');
    expect(splitCalled).toBe(false);
    expect(travelBeforeCalled).toBe(0);
    expect(travelAfterCalled).toBe(0);
  });

  it('recurring task All Day button calls onModeChange with all_day', () => {
    var called = null;
    render(<WhenSection {...buildProps({ recurring: true, placementMode: 'anytime' })} onModeChange={function(m) { called = m; }} />);
    fireEvent.click(screen.getByTitle(/Spans the entire day/));
    expect(called).toBe('all_day');
  });

  it('Time window mode shows time input and ± window select', () => {
    render(<WhenSection {...buildProps({ placementMode: 'time_window', time: '09:00' })} />);
    expect(screen.getByText('⏰ Time')).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('09:00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/± Window/)).toBeInTheDocument();
  });

  it('Time blocks mode shows block tag buttons', () => {
    render(<WhenSection {...buildProps({ placementMode: 'time_blocks', when: 'morning,afternoon', uniqueTags: [
      { tag: 'morning', name: 'Morning', icon: '🌅', color: '#F59E0B' },
      { tag: 'afternoon', name: 'Afternoon', icon: '☀️', color: '#F59E0B' }
    ] })} />);
    expect(screen.getByText(/Morning/)).toBeInTheDocument();
    expect(screen.getByText(/Afternoon/)).toBeInTheDocument();
  });

  it('datePinned=true disables mode buttons via pointerEvents and tabIndex', () => {
    render(<WhenSection {...buildProps({ placementMode: 'anytime', datePinned: true })} />);
    var btn = screen.getByTitle(/No time restriction/);
    expect(btn.closest('div')).toHaveStyle({ pointerEvents: 'none' });
    expect(btn).toHaveAttribute('tabIndex', '-1');
  });

  it('datePinned=true + placementMode=time_window locks time-window sub-panel via pointerEvents', () => {
    var { container } = render(<WhenSection {...buildProps({ placementMode: 'time_window', datePinned: true, time: '09:00' })} />);
    // The ⏰ Time label must be present (sub-panel is rendered), but its container must be non-interactive
    var timeLabel = screen.getByText('⏰ Time');
    expect(timeLabel).toBeInTheDocument();
    var subPanel = timeLabel.closest('div[style*="opacity"]');
    expect(subPanel).not.toBeNull();
    expect(subPanel).toHaveStyle({ pointerEvents: 'none' });
    // W-2: locked sub-panel must also be visually dimmed
    expect(subPanel).toHaveStyle({ opacity: '0.35' });
  });

  it('placementMode=fixed + calendar link disables mode buttons via pointerEvents and tabIndex', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed', task: { gcalEventId: 'gcal_x' } })} />);
    var btn = screen.getByTitle(/No time restriction/);
    expect(btn.closest('div')).toHaveStyle({ pointerEvents: 'none' });
    expect(btn).toHaveAttribute('tabIndex', '-1');
  });

  it('isFixed=false sets tabIndex=0 on mode buttons', () => {
    render(<WhenSection {...buildProps({ placementMode: 'anytime', datePinned: false })} />);
    expect(screen.getByTitle(/No time restriction/)).toHaveAttribute('tabIndex', '0');
    expect(screen.getByTitle(/Schedule near a preferred time/)).toHaveAttribute('tabIndex', '0');
    expect(screen.getByTitle(/Restrict to named time block windows/)).toHaveAttribute('tabIndex', '0');
    expect(screen.getByTitle(/Spans the entire day/)).toHaveAttribute('tabIndex', '0');
  });

  it('shows correct banner text for datePinned lockout', () => {
    render(<WhenSection {...buildProps({ placementMode: 'anytime', datePinned: true })} />);
    expect(screen.getByText(/Date is pinned/)).toBeInTheDocument();
    expect(screen.queryByText(/Calendar-managed/)).not.toBeInTheDocument();
  });

  it('shows correct banner text for fixed-mode lockout when calendar-managed', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed', datePinned: false, task: { gcalEventId: 'gcal_x' } })} />);
    expect(screen.getByText(/Calendar-managed/)).toBeInTheDocument();
    expect(screen.queryByText(/Date is pinned/)).not.toBeInTheDocument();
  });

  it('no banner shown when placementMode=fixed but no calendar link (post-unpin stale state)', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed', datePinned: false })} />);
    expect(screen.queryByText(/Calendar-managed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Date is pinned/)).not.toBeInTheDocument();
  });

  it('no banner shown when isFixed is false', () => {
    render(<WhenSection {...buildProps({ placementMode: 'anytime', datePinned: false })} />);
    expect(screen.queryByText(/Date is pinned/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Calendar-managed/)).not.toBeInTheDocument();
  });

  it('Day requirement picker is removed from DOM when isFixed', () => {
    render(<WhenSection {...buildProps({ placementMode: 'anytime', datePinned: true })} />);
    expect(screen.queryByText(/Day requirement/)).not.toBeInTheDocument();
  });

  it('Day requirement picker is visible when isFixed is false', () => {
    render(<WhenSection {...buildProps({ placementMode: 'anytime', datePinned: false })} />);
    expect(screen.getByText(/Day requirement/)).toBeInTheDocument();
  });
});

// W-3: mode matrix with a calendar-linked task — exercises isFixed=true from
// placementMode='fixed' + isCalManaged=true, a path the main matrix never hits
// because it always passes task=undefined (so isCalManaged=false).
describe('WhenSection mode matrix — with calendar task', () => {
  var CALENDAR_TASK = { gcalEventId: 'gcal_x' };

  MODES.forEach(function(placementMode) {
    it('renders without crashing for placementMode=' + placementMode + ' with calendar link', () => {
      render(<WhenSection {...buildProps({ placementMode, task: CALENDAR_TASK })} />);
    });

    it('isFixed derivation is correct for placementMode=' + placementMode + ' + calendar link', () => {
      render(<WhenSection {...buildProps({ placementMode, task: CALENDAR_TASK, datePinned: false })} />);
      // isCalManaged=true because gcalEventId is set; isFixed = placementMode==='fixed' && isCalManaged
      var expectedIsFixed = placementMode === 'fixed';
      var labelEl = screen.queryByText('Scheduling mode');
      if (labelEl) {
        var opacity = labelEl.style.opacity;
        if (expectedIsFixed) {
          expect(opacity).toBe('0.4');
        } else {
          expect(opacity).toBe('1');
        }
      }
    });
  });
});
