import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AllDayBanner from '../AllDayBanner';

// Task fixtures use placement_mode-based contract (Phase 15+).
// Legacy when='allday' fallback was removed; tests use placement_mode='all_day'.
var TASKS = [
  { id: 't1', text: 'Morning run', when: 'morning', date: '2026-05-18' },
  { id: 't2', text: 'All-day meditation', placementMode: 'all_day', date: '2026-05-18' },
  { id: 't3', text: 'Hospital appt', isAllDay: true, date: '2026-05-18' },
  { id: 't4', text: 'Other day task', placementMode: 'all_day', date: '2026-05-19' },
];

var STATUSES = {};

test('renders only all-day tasks for the given dateKey', () => {
  render(
    <AllDayBanner
      allTasks={TASKS}
      dateKey="2026-05-18"
      statuses={STATUSES}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  expect(screen.getByText('All-day meditation')).toBeInTheDocument();
  expect(screen.getByText('Hospital appt')).toBeInTheDocument();
  expect(screen.queryByText('Morning run')).not.toBeInTheDocument();
  expect(screen.queryByText('Other day task')).not.toBeInTheDocument();
});

test('returns null when no all-day items for dateKey', () => {
  var { container } = render(
    <AllDayBanner
      allTasks={TASKS}
      dateKey="2026-05-20"
      statuses={STATUSES}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  expect(container.firstChild).toBeNull();
});

test('shows done glyph and line-through for done status', () => {
  render(
    <AllDayBanner
      allTasks={[{ id: 't2', text: 'All-day meditation', placementMode: 'all_day', date: '2026-05-18' }]}
      dateKey="2026-05-18"
      statuses={{ t2: 'done' }}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  var chip = screen.getByText('All-day meditation').closest('[data-testid="all-day-chip"]');
  expect(chip).not.toBeNull();
  expect(chip.style.textDecoration).toMatch(/line-through/);
});

test('shows skip glyph for skip status', () => {
  render(
    <AllDayBanner
      allTasks={[{ id: 't2', text: 'All-day meditation', placementMode: 'all_day', date: '2026-05-18' }]}
      dateKey="2026-05-18"
      statuses={{ t2: 'skip' }}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  // The skip glyph ⏭ should be present
  expect(screen.getByText('⏭')).toBeInTheDocument();
});

test('applies reduced opacity on past day done items when isPastDay=true', () => {
  render(
    <AllDayBanner
      allTasks={[{ id: 't2', text: 'All-day meditation', placementMode: 'all_day', date: '2026-05-18' }]}
      dateKey="2026-05-18"
      statuses={{ t2: 'done' }}
      onExpand={() => {}}
      darkMode={false}
      isPastDay={true}
    />
  );
  var chip = screen.getByText('All-day meditation').closest('[data-testid="all-day-chip"]');
  // PAST_OPACITY is 0.35 — opacity should be < 1
  var opacity = parseFloat(chip.style.opacity);
  expect(opacity).toBeLessThan(1);
});

test('banner container has data-testid=all-day-banner', () => {
  render(
    <AllDayBanner
      allTasks={TASKS}
      dateKey="2026-05-18"
      statuses={STATUSES}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  expect(screen.getByTestId('all-day-banner')).toBeInTheDocument();
});

test('shows fixed pin indicator for placementMode=fixed all-day tasks', () => {
  // Fixed all-day: placementMode='fixed' drives the pin; isAllDay=true drives banner inclusion.
  // (Legacy when='allday' removed — must use isAllDay or placement_mode='all_day'.)
  render(
    <AllDayBanner
      allTasks={[
        { id: 't1', text: 'Fixed meeting', isAllDay: true, date: '2026-05-18', placementMode: 'fixed' },
        { id: 't2', text: 'Regular all-day', placementMode: 'all_day', date: '2026-05-18' }
      ]}
      dateKey="2026-05-18"
      statuses={{}}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  var chips = screen.getAllByTestId('all-day-chip');
  expect(chips[0].textContent).toContain('📌');
  expect(chips[1].textContent).not.toContain('📌');
});

test('shows fixed pin indicator for placement_mode=fixed all-day tasks (snake_case)', () => {
  // Fixed all-day snake_case: placement_mode='fixed' for pin; isAllDay=true for banner inclusion.
  render(
    <AllDayBanner
      allTasks={[
        { id: 't1', text: 'Fixed via snake', isAllDay: true, date: '2026-05-18', placement_mode: 'fixed' }
      ]}
      dateKey="2026-05-18"
      statuses={{}}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  var chip = screen.getByText('Fixed via snake').closest('[data-testid="all-day-chip"]');
  expect(chip.textContent).toContain('📌');
});

// --- bird-003 target-size regression guard (zoe-004, UX-REVIEW WARN, WCAG 2.5.8) ---
// bird-003 bumped the chip's vertical padding 3px->5px (AllDayBanner.jsx:92) so
// the ~20px click target clears the 24px CSS px AA minimum (5px + ~14.4px
// line-box + 5px ~= 24.4px). zoe-004 found this fix had ZERO regression
// coverage: reverting to the pre-fix 3px value left the full banner suite
// (34/34) green. Pin the padding value directly, consistent with the suite's
// existing chip.style.* inline-style assertions (opacity, textDecoration).
test('chip vertical padding is >=5px to meet the WCAG 2.5.8 24px target-size minimum (bird-003/zoe-004)', () => {
  render(
    <AllDayBanner
      allTasks={[{ id: 't2', text: 'All-day meditation', placementMode: 'all_day', date: '2026-05-18' }]}
      dateKey="2026-05-18"
      statuses={{}}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  var chip = screen.getByTestId('all-day-chip');
  expect(chip.style.padding).toBe('5px 8px');
});

// --- bird-002 keyboard operability (UX-REVIEW WARN, WCAG 2.1.1 Keyboard) ---
// bert wired role="button" + tabIndex={0} + onKeyDown (Enter/Space -> onExpand,
// Space preventDefault) onto the chip div at AllDayBanner.jsx:84-87. This is a
// whole-component gap fixed identically for every chip variant (done/multiday/
// default/overdue), not overdue-specific, so it belongs in the base suite
// rather than allDayBannerOverdue.test.jsx. Zero regression coverage existed
// for this fix prior to this pass (bert's own dispatch note flagged it).
test('all-day chip has role=button and tabIndex=0 for keyboard operability (bird-002)', () => {
  render(
    <AllDayBanner
      allTasks={[{ id: 't2', text: 'All-day meditation', placementMode: 'all_day', date: '2026-05-18' }]}
      dateKey="2026-05-18"
      statuses={{}}
      onExpand={() => {}}
      darkMode={false}
    />
  );
  var chip = screen.getByTestId('all-day-chip');
  expect(chip.getAttribute('role')).toBe('button');
  expect(chip.getAttribute('tabIndex')).toBe('0');
});

test('pressing Enter on the chip fires onExpand with the task id (bird-002 keyboard operability)', () => {
  var onExpand = jest.fn();
  render(
    <AllDayBanner
      allTasks={[{ id: 't2', text: 'All-day meditation', placementMode: 'all_day', date: '2026-05-18' }]}
      dateKey="2026-05-18"
      statuses={{}}
      onExpand={onExpand}
      darkMode={false}
    />
  );
  var chip = screen.getByTestId('all-day-chip');
  fireEvent.keyDown(chip, { key: 'Enter' });
  expect(onExpand).toHaveBeenCalledTimes(1);
  expect(onExpand).toHaveBeenCalledWith('t2');
});

test('pressing Space on the chip fires onExpand with the task id and prevents the page-scroll default (bird-002 keyboard operability)', () => {
  var onExpand = jest.fn();
  render(
    <AllDayBanner
      allTasks={[{ id: 't2', text: 'All-day meditation', placementMode: 'all_day', date: '2026-05-18' }]}
      dateKey="2026-05-18"
      statuses={{}}
      onExpand={onExpand}
      darkMode={false}
    />
  );
  var chip = screen.getByTestId('all-day-chip');
  // fireEvent.keyDown returns the DOM dispatchEvent result: `true` if the
  // event's default action was NOT prevented, `false` if preventDefault()
  // ran. Space defaults to scrolling the page — the handler must call
  // preventDefault() to suppress that, so we assert the return is `false`,
  // not just that onExpand fired (a handler that fires onExpand but forgets
  // preventDefault would still pass an onExpand-only assertion).
  var notPrevented = fireEvent.keyDown(chip, { key: ' ' });
  expect(onExpand).toHaveBeenCalledTimes(1);
  expect(onExpand).toHaveBeenCalledWith('t2');
  expect(notPrevented).toBe(false);
});

test('pressing an unrelated key on the chip does not fire onExpand (bird-002 keyboard operability)', () => {
  var onExpand = jest.fn();
  render(
    <AllDayBanner
      allTasks={[{ id: 't2', text: 'All-day meditation', placementMode: 'all_day', date: '2026-05-18' }]}
      dateKey="2026-05-18"
      statuses={{}}
      onExpand={onExpand}
      darkMode={false}
    />
  );
  var chip = screen.getByTestId('all-day-chip');
  fireEvent.keyDown(chip, { key: 'Tab' });
  expect(onExpand).not.toHaveBeenCalled();
});
