/**
 * Unit tests for lib/calendar-facade-trigger — the scheduler-adapter ->
 * calendar-facade seam (999.1628, cal-sync-trigger-style inversion).
 *
 * scheduler/adapters/SchedulerCalendarProvider.js used to lazy-require
 * slices/calendar/facade.js directly in its (currently-unused, forward-looking)
 * `_facade()` accessor — a lazy require is STILL a graph edge for
 * check-require-cycles.js. slices/calendar/facade.js's gatherProviderSyncData
 * (999.1025 sub-leg 2) requires slices/scheduler/facade.js (for ConstraintSolver),
 * which pulls in scheduler/adapters/index.js -> SchedulerCalendarProvider.js,
 * closing the cycle
 *   calendar/facade -> scheduler/facade -> adapters/index ->
 *   SchedulerCalendarProvider -> calendar/facade.
 * This module is the dependency-free registry that inverts the edge:
 * calendar/facade.js populates it at ITS load time; SchedulerCalendarProvider
 * reads from it instead of requiring the facade directly.
 *
 * No database required — pure unit tests.
 */

'use strict';

describe('lib/calendar-facade-trigger', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('getCalendarFacade returns null before any registration', () => {
    const { getCalendarFacade } = require('../../../src/lib/calendar-facade-trigger');
    expect(getCalendarFacade()).toBeNull();
  });

  test('registerCalendarFacade makes the facade object available via getCalendarFacade', () => {
    const { registerCalendarFacade, getCalendarFacade } = require('../../../src/lib/calendar-facade-trigger');
    const fakeFacade = { getAdapter: function () {} };
    registerCalendarFacade(fakeFacade);
    expect(getCalendarFacade()).toBe(fakeFacade);
  });

  test('a later registration overwrites the earlier one (last writer wins, same as scheduleTrigger)', () => {
    const { registerCalendarFacade, getCalendarFacade } = require('../../../src/lib/calendar-facade-trigger');
    const facadeA = { tag: 'a' };
    const facadeB = { tag: 'b' };
    registerCalendarFacade(facadeA);
    registerCalendarFacade(facadeB);
    expect(getCalendarFacade()).toBe(facadeB);
  });

  test('unregistered contract: logs loudly (fail-loud, no silent substitution)', () => {
    const errorSpy = jest.fn();
    jest.doMock('@raike/lib-logger', () => ({
      createLogger: () => ({ error: errorSpy, info: jest.fn(), warn: jest.fn(), debug: jest.fn() })
    }));
    const { getCalendarFacade } = require('../../../src/lib/calendar-facade-trigger');

    const result = getCalendarFacade();

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/no calendar facade registered/i);
  });
});
