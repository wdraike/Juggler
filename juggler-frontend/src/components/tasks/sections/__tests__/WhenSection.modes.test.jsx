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

// WhenSection never sets the HTML `disabled` attribute — MUI-style lock is expressed
// via tabIndex=-1 + pointerEvents:none on the wrapper. This helper verifies that
// in unlocked configurations no button is silently keyboard-unreachable (tabIndex=-1
// without an accompanying aria-disabled or calendar-managed context that would justify it).
function hasButtonSilentlyKeyboardLocked(container) {
  var buttons = container.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) {
    var el = buttons[i];
    var ti = el.getAttribute('tabIndex') || el.getAttribute('tabindex');
    if (ti === '-1') {
      // A tabIndex=-1 is only legitimate when the element also signals its locked
      // state to AT: aria-disabled="true", or the parent group has pointerEvents:none
      // with an accompanying visible calendar-managed banner in the document.
      var ariaDisabled = el.getAttribute('aria-disabled');
      var parent = el.closest('[style]');
      var parentLocked = parent && parent.style && parent.style.pointerEvents === 'none';
      if (!ariaDisabled && !parentLocked) return true;
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

            it('mode selector buttons visibility is correct', () => {
              render(<WhenSection {...props} />);
              var btns = queryModeButtons();

              if (recurring && placementMode === 'fixed') {
                // placementMode='fixed' is not supported on recurring tasks (non-cal-managed).
                // The "not available" fallback renders the four valid mode buttons so the
                // user has an exit path. No task prop = no calendar link = fallback path.
                expect(btns.anytime).toBeInTheDocument();
                expect(btns.timeWindow).toBeInTheDocument();
                expect(btns.timeBlocks).toBeInTheDocument();
              } else if (recurring) {
                // Recurring section shows Anytime, Time window, Time blocks, All Day
                expect(btns.anytime).toBeInTheDocument();
                expect(btns.timeWindow).toBeInTheDocument();
                expect(btns.timeBlocks).toBeInTheDocument();
                expect(btns.allDay).toBeInTheDocument(); // ZOE-JUG-033: 4th button was missing
              } else {
                // Non-recurring shows all five buttons regardless of placementMode
                expect(btns.anytime).toBeInTheDocument();
                expect(btns.timeWindow).toBeInTheDocument();
                expect(btns.timeBlocks).toBeInTheDocument();
                expect(btns.allDay).toBeInTheDocument();
              }
            });

            it('isFixed derivation is correct', () => {
              render(<WhenSection {...props} />);
              var isCalManaged = !!(props.task && (props.task.gcalEventId || props.task.msftEventId || props.task.appleEventId));
              // datePinned no longer contributes to isFixed — only cal-linked fixed mode locks the UI
              var expectedIsFixed = placementMode === 'fixed' && isCalManaged;
              var labelEl = screen.queryByText('Scheduling mode');
              // ZOE-JUG-031: "Scheduling mode" label is omitted only when recurring=true (the
              // recurring branch renders its own mode selector without this label). For
              // non-recurring tasks — including all_day — the non-recurring path renders the
              // label unconditionally (component line 303-310: !marker && !isRecurring guard,
              // no all_day exclusion). Assert accordingly so all 40 combos have real assertions.
              if (recurring) {
                expect(labelEl).not.toBeInTheDocument();
              } else {
                // Non-recurring (all modes, including all_day): label must be present
                expect(labelEl).toBeInTheDocument();
                if (expectedIsFixed) {
                  expect(labelEl.style.opacity).toBe('0.4');
                } else {
                  expect(labelEl.style.opacity).toBe('1');
                }
              }
            });

            it('no button is keyboard-locked (tabIndex=-1) without a legitimate a11y context', () => {
              // In the mode matrix task=undefined → isCalManaged=false → isFixed=false.
              // No button should carry tabIndex=-1 without aria-disabled or a pointerEvents:none parent.
              var { container } = render(<WhenSection {...props} />);
              expect(hasButtonSilentlyKeyboardLocked(container)).toBe(false);
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

describe('WhenSection Fixed mode button', () => {
  it('clicking Fixed mode button calls onModeChange with fixed', () => {
    var called = null;
    render(<WhenSection {...buildProps({ placementMode: 'anytime' })} onModeChange={function(v) { called = v; }} />);
    fireEvent.click(screen.getByTitle('Exact date and time — immovable'));
    expect(called).toBe('fixed');
  });

  it('Fixed mode button is active (font-weight 600) when placementMode is fixed and no cal link', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed' })} />);
    var btn = screen.getByTitle('Exact date and time — immovable');
    expect(btn.style.fontWeight).toBe('600');
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

  it('fixed mode without calendar link does not lock the mode selector', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed' })} />);
    var anytimeBtn = screen.getByTitle(/No time restriction/);
    expect(anytimeBtn.closest('div')).not.toHaveStyle({ pointerEvents: 'none' });
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
    var modeCalled = null, whenCalled = null, splitCalled = null, travelBeforeCalled = null, travelAfterCalled = null;
    render(<WhenSection {...buildProps({ placementMode: 'anytime' })}
      onModeChange={function(m) { modeCalled = m; }}
      onWhenChange={function(w) { whenCalled = w; }}
      onSplitChange={function(v) { splitCalled = v; }}
      onTravelBeforeChange={function(v) { travelBeforeCalled = v; }}
      onTravelAfterChange={function(v) { travelAfterCalled = v; }}
    />);
    fireEvent.click(screen.getByTitle(/Spans the entire day/));
    expect(modeCalled).toBe('all_day');
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

  it('cal-managed fixed mode disables mode buttons via pointerEvents and tabIndex', () => {
    render(<WhenSection {...buildProps({ placementMode: 'fixed', task: { gcalEventId: 'gcal_x' } })} />);
    var btn = screen.getByTitle(/No time restriction/);
    expect(btn.closest('div')).toHaveStyle({ pointerEvents: 'none' });
    expect(btn).toHaveAttribute('tabIndex', '-1');
  });

  it('cal-managed fixed + placementMode=fixed locks time-window sub-panel via pointerEvents', () => {
    // Verify that when isFixed=true (cal-linked + fixed mode), the mode selector is locked.
    // datePinned no longer drives locking — only cal-linked fixed mode does.
    render(<WhenSection {...buildProps({ placementMode: 'fixed', task: { gcalEventId: 'gcal_x' } })} />);
    var btn = screen.getByTitle(/No time restriction/);
    expect(btn.closest('div')).toHaveStyle({ pointerEvents: 'none' });
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

  it('no "Date is pinned" banner — datePinned UI removed; only Calendar-managed banner remains', () => {
    // datePinned is no longer a locking signal — only cal-linked fixed mode shows a banner
    render(<WhenSection {...buildProps({ placementMode: 'anytime' })} />);
    expect(screen.queryByText(/Date is pinned/)).not.toBeInTheDocument();
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

  it('Day requirement picker is removed from DOM when isFixed (cal-managed fixed)', () => {
    // isFixed = placementMode==='fixed' && isCalManaged — datePinned no longer drives this
    render(<WhenSection {...buildProps({ placementMode: 'fixed', task: { gcalEventId: 'gcal_x' } })} />);
    expect(screen.queryByText(/Day requirement/)).not.toBeInTheDocument();
  });

  it('Day requirement picker is visible when isFixed is false', () => {
    render(<WhenSection {...buildProps({ placementMode: 'anytime' })} />);
    expect(screen.getByText(/Day requirement/)).toBeInTheDocument();
  });
});

// W-3: mode matrix with a calendar-linked task — exercises isFixed=true from
// placementMode='fixed' + isCalManaged=true, a path the main matrix never hits
// because it always passes task=undefined (so isCalManaged=false).
describe('WhenSection mode matrix — with calendar task', () => {
  var CALENDAR_TASK = { gcalEventId: 'gcal_x' };

  MODES.forEach(function(placementMode) {
    it('mode selector buttons are present for placementMode=' + placementMode + ' with calendar link', () => {
      render(<WhenSection {...buildProps({ placementMode, task: CALENDAR_TASK })} />);
      var btns = queryModeButtons();
      // All modes with a calendar-linked task must still render the mode selector buttons
      // (fixed mode locks them via pointerEvents, but they remain in the DOM)
      expect(btns.anytime).toBeInTheDocument();
      expect(btns.timeWindow).toBeInTheDocument();
      expect(btns.timeBlocks).toBeInTheDocument();
      expect(btns.allDay).toBeInTheDocument();
    });

    it('isFixed derivation is correct for placementMode=' + placementMode + ' + calendar link', () => {
      render(<WhenSection {...buildProps({ placementMode, task: CALENDAR_TASK, datePinned: false })} />);
      // isCalManaged=true because gcalEventId is set; isFixed = placementMode==='fixed' && isCalManaged
      var expectedIsFixed = placementMode === 'fixed';
      var labelEl = screen.queryByText('Scheduling mode');
      if (expectedIsFixed) {
        // fixed + cal-managed: label absent (locked UI) or dimmed at opacity 0.4
        if (labelEl) {
          expect(labelEl.style.opacity).toBe('0.4');
        }
        // mode selector buttons must be keyboard-locked (tabIndex=-1)
        var anytimeBtn = screen.getByTitle(/No time restriction/);
        expect(anytimeBtn).toHaveAttribute('tabIndex', '-1');
      } else {
        // non-fixed: label present and fully opaque
        if (labelEl) {
          expect(labelEl.style.opacity).toBe('1');
        }
        // mode selector wrapper must NOT lock pointer events
        var anytimeBtn = screen.getByTitle(/No time restriction/);
        expect(anytimeBtn.closest('div')).not.toHaveStyle({ pointerEvents: 'none' });
      }
    });
  });
});

// ── W2: Time-blocks clobber guard (juggler-when-display-mismatch, 2026-06-20) ─
// BUG-2 fix (`<=1`→`===0`) lives ONLY in the two RECURRING branches of WhenSection.jsx
// (~line 461 and ~line 492). The non-recurring guard at line ~329 was ALREADY `===0`
// at HEAD before this leg — it was NOT changed by this leg.
//
// Regression pin for BUG-2:
//   ONLY the "recurring: one tag set does NOT clobber" test below is a genuine
//   regression test (RED pre-fix, GREEN post-fix). Confirmed: on pre-fix code,
//   this test fails because the recurring guard was `<=1` — so clicking "Time blocks"
//   with one tag still fired onWhenChange and clobbered it.
//
// Correct-behavior coverage (already held at HEAD before this leg):
//   The non-recurring tests and the "ZERO tags" tests below verify correct component
//   behavior that existed before this leg's diff. They are guard-characterization
//   tests — they ensure we do not accidentally regress the non-recurring path or the
//   empty-input clobber path in future work. They are NOT regression coverage for BUG-2.
//
// WARN-3 note: WhenSection is a controlled component — `placementMode` and `when` props
// don't update in response to a mode-button click (the parent holds state). After clicking
// "Time blocks" (noop onModeChange), effectiveMode stays 'anytime' and the tag buttons do
// not render. The `toBeNull()` callback check proves onWhenChange was not called.
// To additionally verify the stored tag WOULD render selected (selection state proof),
// we render the component directly in time_blocks mode with when='biz' (the state the
// parent would set after the no-clobber mode switch) and assert the Biz button has 2px solid.
var BIZ_TAGS = [
  { tag: 'biz', name: 'Biz', icon: 'B', color: '#2E4A7A' },
  { tag: 'morning', name: 'Morning', icon: 'M', color: '#C8942A' },
];

describe('WhenSection W2 — Time-blocks clobber guard', function() {
  // ── Non-recurring characterization (already correct at HEAD before this leg) ──
  it('non-recurring: clicking Time blocks with one tag already set does NOT call onWhenChange (clobber guard holds)', function() {
    // Correct-behavior coverage — the non-recurring guard (WhenSection.jsx ~line 329) was
    // already `=== 0` at HEAD. This test is a characterization pin against future regression,
    // NOT a BUG-2 regression test for this leg.
    var whenCalled = null;
    var { unmount } = render(<WhenSection {...buildProps({ placementMode: 'anytime', when: 'biz', uniqueTags: BIZ_TAGS })} onWhenChange={function(w) { whenCalled = w; }} />);
    fireEvent.click(screen.getByTitle(/Restrict to named time block windows/));
    // onWhenChange must NOT be called — the stored 'biz' tag is preserved
    expect(whenCalled).toBeNull();
    unmount();
    // Selection-state proof: render in time_blocks mode (the post-switch state the parent would
    // set) and assert Biz block still shows as selected (2px solid border).
    render(<WhenSection {...buildProps({ placementMode: 'time_blocks', when: 'biz', uniqueTags: BIZ_TAGS })} />);
    var bizBtn = screen.getByText(/B Biz/).closest('button');
    expect(/2px solid/.test(bizBtn.getAttribute('style') || '')).toBe(true);
    var morningBtn = screen.getByText(/M Morning/).closest('button');
    expect(/2px solid/.test(morningBtn.getAttribute('style') || '')).toBe(false);
  });

  it('non-recurring: clicking Time blocks with ZERO tags applies the 5-block default (clobber guard correct-behavior)', function() {
    // Correct-behavior coverage — the zero-tags path was already correct at HEAD.
    var whenCalled = null;
    render(<WhenSection {...buildProps({ placementMode: 'anytime', when: '' })} onWhenChange={function(w) { whenCalled = w; }} />);
    fireEvent.click(screen.getByTitle(/Restrict to named time block windows/));
    expect(whenCalled).toBe('morning,lunch,afternoon,evening,night');
  });

  // ── BUG-2 REGRESSION PIN: recurring branch (~line 461 and ~line 492) ──
  // This is the ONLY test in the W2 block that is a genuine regression pin.
  // Pre-fix (<=1 guard): when='biz' (1 tag), clicking "📅 Time blocks" fires
  // onWhenChange → clobbers tag. Post-fix (===0 guard): does NOT fire → tag preserved.
  it('recurring: clicking Time blocks with one tag set does NOT clobber — BUG-2 regression pin (RED pre-fix)', function() {
    // Regression pin for BUG-2: this test FAILS on pre-fix WhenSection.jsx (<=1 guard)
    // and PASSES on post-fix code (===0 guard). Confirmed by /tmp-backup revert.
    var whenCalled = null;
    var { unmount } = render(<WhenSection {...buildProps({ recurring: true, placementMode: 'anytime', when: 'biz', uniqueTags: BIZ_TAGS })} onWhenChange={function(w) { whenCalled = w; }} />);
    // Recurring branch: button text "📅 Time blocks" (no title attribute in recurring buttons)
    fireEvent.click(screen.getByText(/📅 Time blocks/));
    // onWhenChange must NOT be called — the stored 'biz' tag is preserved (proves ===0 guard)
    expect(whenCalled).toBeNull();
    unmount();
    // Selection-state proof: render in time_blocks mode (the post-switch parent state) and
    // assert Biz still renders selected — distinguishes "kept the tag" from "did nothing and
    // something else lost it".
    render(<WhenSection {...buildProps({ recurring: true, placementMode: 'time_blocks', when: 'biz', uniqueTags: BIZ_TAGS })} />);
    var bizBtn = screen.getByText(/B Biz/).closest('button');
    expect(/2px solid/.test(bizBtn.getAttribute('style') || '')).toBe(true);
  });

  it('recurring: clicking Time blocks with ZERO tags applies the 5-block default (correct-behavior coverage)', function() {
    // Correct-behavior coverage — not a BUG-2 regression pin (this path was already correct).
    var whenCalled = null;
    render(<WhenSection {...buildProps({ recurring: true, placementMode: 'anytime', when: '' })} onWhenChange={function(w) { whenCalled = w; }} />);
    fireEvent.click(screen.getByText(/📅 Time blocks/));
    expect(whenCalled).toBe('morning,lunch,afternoon,evening,night');
  });
});

// ── ZOE-JUG-034: mobile-specific block ───────────────────────────────────────
// The main matrix has zero isMobile:true combinations. isMobile only affects
// button sizing (BTN_H/fontSize/padding), not which buttons appear. These tests
// verify button presence is unchanged on mobile.
describe('WhenSection mode matrix — isMobile=true', function() {
  it('non-recurring: all four mode buttons present on mobile', function() {
    render(<WhenSection {...buildProps({ placementMode: 'anytime', isMobile: true })} />);
    var btns = queryModeButtons();
    expect(btns.anytime).toBeInTheDocument();
    expect(btns.timeWindow).toBeInTheDocument();
    expect(btns.timeBlocks).toBeInTheDocument();
    expect(btns.allDay).toBeInTheDocument();
  });

  it('recurring: four mode buttons present on mobile', function() {
    render(<WhenSection {...buildProps({ placementMode: 'anytime', recurring: true, isMobile: true })} />);
    var btns = queryModeButtons();
    expect(btns.anytime).toBeInTheDocument();
    expect(btns.timeWindow).toBeInTheDocument();
    expect(btns.timeBlocks).toBeInTheDocument();
    expect(btns.allDay).toBeInTheDocument();
  });

  it('cal-managed fixed mode locks buttons on mobile (tabIndex=-1)', function() {
    render(<WhenSection
      {...buildProps({ placementMode: 'fixed', datePinned: false, task: { gcalEventId: 'gcal_x' }, isMobile: true })}
    />);
    var btn = screen.getByTitle(/No time restriction/);
    expect(btn).toHaveAttribute('tabIndex', '-1');
  });
});
