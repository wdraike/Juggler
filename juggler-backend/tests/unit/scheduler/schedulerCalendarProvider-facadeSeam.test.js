/**
 * SchedulerCalendarProvider._facade() — calendar-facade-trigger seam (999.1628).
 *
 * scheduler/adapters/SchedulerCalendarProvider.js's `_facade()` default
 * resolution used to lazy-require slices/calendar/facade.js directly — a
 * lazy require is STILL a graph edge for check-require-cycles.js, and closed
 * the cycle calendar/facade -> scheduler/facade -> adapters/index ->
 * SchedulerCalendarProvider -> calendar/facade (gatherProviderSyncData
 * requires scheduler/facade for ConstraintSolver, pulling in the adapter
 * barrel). `_facade()` now reads from the dependency-free
 * lib/calendar-facade-trigger seam instead.
 *
 * Isolated in its OWN test file (not the shared scheduleAdapters.contract.test.js)
 * because jest.resetModules() here would otherwise desync that file's top-level
 * `require()`d SchedulerTaskProvider/taskFacade module identities from any
 * later lazy `require()`s inside those modules' own methods, breaking the
 * "SAME mapper function objects" identity assertions there.
 *
 * No database required — pure unit test.
 */

'use strict';

describe('999.1628 — SchedulerCalendarProvider._facade() reads the calendar-facade-trigger seam', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('default resolution returns whatever is registered in the seam (not a direct require)', () => {
    const { registerCalendarFacade } = require('../../../src/lib/calendar-facade-trigger');
    const fakeFacade = { getAdapter: function () {} };
    registerCalendarFacade(fakeFacade);

    const FreshSchedulerCalendarProvider = require('../../../src/slices/scheduler/adapters/SchedulerCalendarProvider');
    const provider = new FreshSchedulerCalendarProvider();

    expect(provider._facade()).toBe(fakeFacade);
  });

  test('an explicitly injected calendarFacade dep bypasses the seam entirely', () => {
    const FreshSchedulerCalendarProvider = require('../../../src/slices/scheduler/adapters/SchedulerCalendarProvider');
    const injectedFacade = { getAdapter: function () {} };
    const provider = new FreshSchedulerCalendarProvider({ calendarFacade: injectedFacade });

    expect(provider._facade()).toBe(injectedFacade);
  });

  test('the real slices/calendar/facade registers itself when loaded (end-to-end wiring)', () => {
    const realCalendarFacade = require('../../../src/slices/calendar/facade');
    const FreshSchedulerCalendarProvider = require('../../../src/slices/scheduler/adapters/SchedulerCalendarProvider');
    const provider = new FreshSchedulerCalendarProvider();

    expect(provider._facade()).toBe(realCalendarFacade);
  });
});
