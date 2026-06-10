/**
 * Unit tests for KnexSyncStateRepository (Wave 3 / W3).
 *
 * Pure unit — the Knex instance is a hand-rolled stub builder, so these tests
 * pass with NO live DB / test-bed. Asserts:
 *   1. Conforms to SYNC_STATE_REPOSITORY_PORT_METHODS.
 *   2. Reads/writes the correct per-provider column (gcal / msft / apple).
 *   3. INVARIANT P1 (ADR-0003): setLastSyncedAt writes a JS `new Date()`
 *      instance — NOT a knex.fn.now() raw.
 *   4. Read path maps columns back onto a SyncState entity.
 */

var path = require('path');

var SLICE = path.join(__dirname, '..', '..', 'src', 'slices', 'calendar');
var SyncStateRepositoryPort = require(path.join(SLICE, 'domain', 'ports', 'SyncStateRepositoryPort'));
var SyncState = require(path.join(SLICE, 'domain', 'entities', 'SyncState'));
var KnexSyncStateRepository = require(path.join(SLICE, 'adapters', 'KnexSyncStateRepository'));

/**
 * Builds a stub Knex instance that records every call. Calling the stub like
 * `db('users')` returns a chainable query builder whose terminal `.first()` /
 * `.update()` resolve with configurable values and capture their arguments.
 *
 * @param {Object} [opts]
 * @param {?Object} [opts.firstRow] value resolved by `.first()`
 * @returns {Object} stub with `.db` (the callable) and `.calls` (recorded data)
 */
function makeKnexStub(opts) {
  var o = opts || {};
  var calls = {
    table: null,
    where: null,
    firstColumns: null,
    updatePayload: null
  };

  function builder() {
    return {
      where: function (col, val) {
        calls.where = { col: col, val: val };
        return this;
      },
      first: function () {
        calls.firstColumns = Array.prototype.slice.call(arguments);
        return Promise.resolve(Object.prototype.hasOwnProperty.call(o, 'firstRow') ? o.firstRow : null);
      },
      update: function (payload) {
        calls.updatePayload = payload;
        return Promise.resolve(1);
      }
    };
  }

  function db(table) {
    calls.table = table;
    return builder();
  }

  // Mirror the real knex.fn.now() surface so a test can prove we did NOT use it.
  db.fn = {
    now: function () {
      return { __knexRawNow: true };
    }
  };

  return { db: db, calls: calls };
}

describe('KnexSyncStateRepository — port conformance', function () {
  test('implements every SYNC_STATE_REPOSITORY_PORT_METHODS member', function () {
    var repo = new KnexSyncStateRepository({ db: makeKnexStub().db });
    SyncStateRepositoryPort.SYNC_STATE_REPOSITORY_PORT_METHODS.forEach(function (name) {
      expect(typeof repo[name]).toBe('function');
    });
  });
});

describe('KnexSyncStateRepository — provider→column mapping', function () {
  var cases = [
    { provider: 'gcal', lastSynced: 'gcal_last_synced_at', eventId: 'gcal_event_id', syncToken: 'gcal_sync_token' },
    { provider: 'msft', lastSynced: 'msft_cal_last_synced_at', eventId: 'msft_event_id', syncToken: 'msft_cal_delta_link' },
    { provider: 'apple', lastSynced: 'apple_cal_last_synced_at', eventId: 'apple_event_id', syncToken: 'apple_cal_sync_token' }
  ];

  cases.forEach(function (c) {
    test(c.provider + ' maps to its live columns', function () {
      var repo = new KnexSyncStateRepository({ db: makeKnexStub().db });
      var cols = repo.columnsFor(c.provider);
      expect(cols.lastSynced).toBe(c.lastSynced);
      expect(cols.eventId).toBe(c.eventId);
      expect(cols.syncToken).toBe(c.syncToken);
    });
  });

  test('unknown provider throws', function () {
    var repo = new KnexSyncStateRepository({ db: makeKnexStub().db });
    expect(function () { repo.columnsFor('yahoo'); }).toThrow(/unknown provider/i);
  });
});

describe('KnexSyncStateRepository — setLastSyncedAt (INVARIANT P1 / ADR-0003)', function () {
  test('writes a JS Date instance, NOT a knex.fn.now() raw', async function () {
    var stub = makeKnexStub();
    var repo = new KnexSyncStateRepository({ db: stub.db });
    var when = new Date('2026-05-28T10:00:00Z');

    await repo.setLastSyncedAt(7, 'gcal', when);

    var written = stub.calls.updatePayload.gcal_last_synced_at;
    // P1 assertion: the written last-synced value is a JS Date, never a raw NOW().
    expect(written).toBeInstanceOf(Date);
    expect(written).toBe(when);
    expect(written).not.toEqual(stub.db.fn.now());
    expect(written.__knexRawNow).toBeUndefined();
  });

  test('defaults to new Date() (a JS Date) when no timestamp is supplied', async function () {
    var stub = makeKnexStub();
    var repo = new KnexSyncStateRepository({ db: stub.db });

    await repo.setLastSyncedAt(7, 'msft');

    var written = stub.calls.updatePayload.msft_cal_last_synced_at;
    expect(written).toBeInstanceOf(Date);
    expect(written.__knexRawNow).toBeUndefined();
  });

  test('targets the correct per-provider column and user id', async function () {
    var stub = makeKnexStub();
    var repo = new KnexSyncStateRepository({ db: stub.db });
    await repo.setLastSyncedAt(99, 'apple', new Date());
    expect(stub.calls.table).toBe('users');
    expect(stub.calls.where).toEqual({ col: 'id', val: 99 });
    expect(Object.keys(stub.calls.updatePayload)).toEqual(['apple_cal_last_synced_at']);
  });
});

describe('KnexSyncStateRepository — read path → SyncState', function () {
  test('getSyncState maps columns onto a SyncState entity', async function () {
    var syncedAt = new Date('2026-05-28T10:00:00Z');
    var stub = makeKnexStub({
      firstRow: { msft_cal_last_synced_at: syncedAt, msft_cal_delta_link: 'delta-xyz' }
    });
    var repo = new KnexSyncStateRepository({ db: stub.db });

    var state = await repo.getSyncState(7, 'msft');

    expect(state).toBeInstanceOf(SyncState);
    expect(state.userId).toBe(7);
    expect(state.providerId).toBe('msft');
    expect(state.lastSyncedAt).toBe(syncedAt);
    expect(state.syncToken).toBe('delta-xyz');
    expect(state.eventIdColumn).toBe('msft_event_id');
    expect(state.needsFullSync()).toBe(false);
    // Selected exactly the last-synced + sync-token columns.
    expect(stub.calls.firstColumns).toEqual(['msft_cal_last_synced_at', 'msft_cal_delta_link']);
  });

  test('getSyncState resolves null when the user row is absent', async function () {
    var stub = makeKnexStub({ firstRow: null });
    var repo = new KnexSyncStateRepository({ db: stub.db });
    var state = await repo.getSyncState(123, 'gcal');
    expect(state).toBeNull();
  });

  test('getLastSyncedAt returns the column value', async function () {
    var when = new Date('2026-05-28T10:00:00Z');
    var stub = makeKnexStub({ firstRow: { gcal_last_synced_at: when } });
    var repo = new KnexSyncStateRepository({ db: stub.db });
    var got = await repo.getLastSyncedAt(7, 'gcal');
    expect(got).toBe(when);
    expect(stub.calls.firstColumns).toEqual(['gcal_last_synced_at']);
  });

  test('getSyncToken reads the provider sync-token column', async function () {
    var stub = makeKnexStub({ firstRow: { apple_cal_sync_token: 'sync-tok-1' } });
    var repo = new KnexSyncStateRepository({ db: stub.db });
    var tok = await repo.getSyncToken(7, 'apple');
    expect(tok).toBe('sync-tok-1');
    expect(stub.calls.firstColumns).toEqual(['apple_cal_sync_token']);
  });
});

describe('KnexSyncStateRepository — sync token writes', function () {
  test('setSyncToken writes to the provider token column', async function () {
    var stub = makeKnexStub();
    var repo = new KnexSyncStateRepository({ db: stub.db });
    await repo.setSyncToken(7, 'gcal', 'new-token');
    expect(stub.calls.updatePayload).toEqual({ gcal_sync_token: 'new-token' });
  });

  test('clearSyncToken nulls the provider token column', async function () {
    var stub = makeKnexStub();
    var repo = new KnexSyncStateRepository({ db: stub.db });
    await repo.clearSyncToken(7, 'msft');
    expect(stub.calls.updatePayload).toEqual({ msft_cal_delta_link: null });
  });
});
