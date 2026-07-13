/**
 * W4 facade unit test — pure, no DB/Redis.
 *
 * Asserts the calendar slice facade exposes the full W5 repoint surface and
 * that re-exported functions are the SAME references as their sources (no
 * wrapping = guaranteed zero behavior change).
 */

const facade = require('../../src/slices/calendar/facade');
const sliceIndex = require('../../src/slices/calendar');
const syncLock = require('../../src/lib/sync-lock');
const registry = require('../../src/lib/cal-adapters');
const dateHelpers = require('../../src/scheduler/dateHelpers');

describe('calendar facade — registry surface', () => {
  test.each(['getAdapter', 'getConnectedAdapters', 'getAllAdapters', 'registerAdapter'])(
    'exposes registry fn %s as same reference as lib/cal-adapters',
    (fn) => {
      expect(typeof facade[fn]).toBe('function');
      expect(facade[fn]).toBe(registry[fn]);
    }
  );
});

describe('calendar facade — sync-lock surface (by reference)', () => {
  test.each(['acquireLock', 'releaseLock', 'refreshLock', 'withSyncLock', 'withLock', 'isLocked'])(
    'exposes sync-lock fn %s as same reference as lib/sync-lock',
    (fn) => {
      expect(typeof facade[fn]).toBe('function');
      expect(facade[fn]).toBe(syncLock[fn]);
    }
  );
});

describe('calendar facade — 60d window date helpers (by reference)', () => {
  test.each(['localToUtc', 'utcToLocal'])(
    'exposes window helper %s as same reference as scheduler/dateHelpers',
    (fn) => {
      expect(typeof facade[fn]).toBe('function');
      expect(facade[fn]).toBe(dateHelpers[fn]);
    }
  );

  test('exposes the full dateHelpers module by reference', () => {
    expect(facade.dateHelpers).toBe(dateHelpers);
  });
});

describe('calendar facade — ports / entities / VOs / adapters', () => {
  const expectedFns = [
    'CalendarPort',
    'SyncStateRepositoryPort',
    'CalendarAccountRepositoryPort',
    'CalendarEvent',
    'SyncState',
    'EventId',
    'ProviderType',
    'GoogleCalendarAdapter',
    'MicrosoftCalendarAdapter',
    'AppleCalendarAdapter',
    'InMemoryCalendarAdapter',
    'KnexSyncStateRepository',
    'KnexCalendarAccountRepository',
    'InMemoryCalendarAccountRepository',
  ];

  test.each(expectedFns)('exposes %s', (name) => {
    expect(facade[name]).toBeDefined();
  });

  test('adapters are the slice adapters with correct providerId', () => {
    expect(facade.GoogleCalendarAdapter.providerId).toBe('gcal');
    expect(facade.MicrosoftCalendarAdapter.providerId).toBe('msft');
    expect(facade.AppleCalendarAdapter.providerId).toBe('apple');
    expect(facade.InMemoryCalendarAdapter.providerId).toBe('memory');
  });
});

describe('calendar facade — initialize() is thin + side-effect-free', () => {
  test('initialize() returns the facade itself', () => {
    expect(facade.initialize()).toBe(facade);
  });

  test('initialize(deps) ignores deps and still returns the facade', () => {
    expect(facade.initialize({ anything: true })).toBe(facade);
  });
});

describe('calendar slice index — both README shapes', () => {
  test('namespaced: { calendar } maps to the facade', () => {
    expect(sliceIndex.calendar).toBe(facade);
  });

  test('direct named: InMemoryCalendarAdapter is re-exported', () => {
    expect(sliceIndex.InMemoryCalendarAdapter).toBe(facade.InMemoryCalendarAdapter);
  });
});
