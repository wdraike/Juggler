/**
 * Unit tests for KnexCalendarAccountRepository / InMemoryCalendarAccountRepository
 * (JUG-FACADE-DB-VIOLATIONS stage 3).
 *
 * Pure unit — the Knex instance is a hand-rolled stub builder for the Knex
 * adapter's tests, so these pass with NO live DB / test-bed. Asserts:
 *   1. Both adapters conform to CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS.
 *   2. The Knex adapter's `now()` returns the raw db.fn.now() value (never
 *      pre-computed) and every write method is a pure passthrough (no
 *      timestamp injected by the repo itself — callers own that, per the
 *      byte-identical-relocation discipline documented in the adapter file).
 *   3. The InMemory adapter's replay-guard / tri-state config semantics
 *      match the Knex adapter's documented contract (INSERT IGNORE /
 *      upsert-by-existence), for use by future application-layer unit tests
 *      with no live DB.
 */

'use strict';

var path = require('path');

var SLICE = path.join(__dirname, '..', '..', 'src', 'slices', 'calendar');
var CalendarAccountRepositoryPort = require(path.join(SLICE, 'domain', 'ports', 'CalendarAccountRepositoryPort'));
var KnexCalendarAccountRepository = require(path.join(SLICE, 'adapters', 'KnexCalendarAccountRepository'));
var InMemoryCalendarAccountRepository = require(path.join(SLICE, 'adapters', 'InMemoryCalendarAccountRepository'));

function makeKnexStub() {
  var calls = { table: null, where: null, insertPayload: null, updatePayload: null, rawCalls: [] };

  function builder() {
    return {
      where: function (arg) { calls.where = arg; return this; },
      first: function () { return Promise.resolve(undefined); },
      insert: function (payload) { calls.insertPayload = payload; return Promise.resolve([1]); },
      update: function (payload) { calls.updatePayload = payload; return Promise.resolve(1); },
      del: function () { return Promise.resolve(0); }
    };
  }

  function db(table) {
    calls.table = table;
    return builder();
  }
  db.fn = { now: function () { return { __knexRawNow: true }; } };
  db.raw = function (sql, bindings) {
    calls.rawCalls.push({ sql: sql, bindings: bindings });
    return Promise.resolve([{ affectedRows: 1 }]);
  };

  return { db: db, calls: calls };
}

describe('CalendarAccountRepositoryPort — port conformance', function () {
  test('KnexCalendarAccountRepository implements every CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS member', function () {
    var repo = new KnexCalendarAccountRepository({ db: makeKnexStub().db });
    CalendarAccountRepositoryPort.CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS.forEach(function (name) {
      expect(typeof repo[name]).toBe('function');
    });
  });

  test('InMemoryCalendarAccountRepository implements every CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS member', function () {
    var repo = new InMemoryCalendarAccountRepository();
    CalendarAccountRepositoryPort.CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS.forEach(function (name) {
      expect(typeof repo[name]).toBe('function');
    });
  });

  test('CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS is frozen', function () {
    expect(Object.isFrozen(CalendarAccountRepositoryPort.CALENDAR_ACCOUNT_REPOSITORY_PORT_METHODS)).toBe(true);
  });
});

describe('KnexCalendarAccountRepository — thin passthrough (no repo-injected timestamps)', function () {
  test('now() returns the raw db.fn.now() value verbatim', function () {
    var stub = makeKnexStub();
    var repo = new KnexCalendarAccountRepository({ db: stub.db });
    expect(repo.now()).toEqual({ __knexRawNow: true });
  });

  test('updateUser writes exactly the fields object passed — no timestamp injected by the repo', function () {
    var stub = makeKnexStub();
    var repo = new KnexCalendarAccountRepository({ db: stub.db });
    repo.updateUser(7, { gcal_access_token: 'x' });
    expect(stub.calls.table).toBe('users');
    expect(stub.calls.updatePayload).toEqual({ gcal_access_token: 'x' }); // no injected updated_at
  });

  test('deleteExpiredOAuthNonces / insertOAuthNonceIgnoreDuplicate issue the exact verbatim SQL', function () {
    var stub = makeKnexStub();
    var repo = new KnexCalendarAccountRepository({ db: stub.db });
    repo.deleteExpiredOAuthNonces();
    repo.insertOAuthNonceIgnoreDuplicate('hash-abc');
    expect(stub.calls.rawCalls[0].sql).toBe('DELETE FROM oauth_code_nonces WHERE expires_at < NOW()');
    expect(stub.calls.rawCalls[1].sql).toBe(
      'INSERT IGNORE INTO oauth_code_nonces (code_hash, expires_at) VALUES (?, DATE_ADD(NOW(), INTERVAL 2 MINUTE))'
    );
    expect(stub.calls.rawCalls[1].bindings).toEqual(['hash-abc']);
  });
});

describe('InMemoryCalendarAccountRepository — replay guard + tri-state config semantics', function () {
  test('insertOAuthNonceIgnoreDuplicate: first call affectedRows 1, replay affectedRows 0', async function () {
    var repo = new InMemoryCalendarAccountRepository();
    var first = await repo.insertOAuthNonceIgnoreDuplicate('h1');
    var second = await repo.insertOAuthNonceIgnoreDuplicate('h1');
    expect(first[0].affectedRows).toBe(1);
    expect(second[0].affectedRows).toBe(0);
  });

  test('getUserConfig/insertUserConfig/updateUserConfig: fresh insert then in-place update (one row)', async function () {
    var repo = new InMemoryCalendarAccountRepository();
    await repo.insertUserConfig({ user_id: 1, config_key: 'gcal_auto_sync', config_value: 'true' });
    var row = await repo.getUserConfig(1, 'gcal_auto_sync');
    expect(row.config_value).toBe('true');

    await repo.updateUserConfig(1, 'gcal_auto_sync', { config_value: 'false' });
    var updated = await repo.getUserConfig(1, 'gcal_auto_sync');
    expect(updated.config_value).toBe('false');
  });

  test('findUserCalendarByCalendarId / updateUserCalendarById / insertUserCalendar round-trip', async function () {
    var repo = new InMemoryCalendarAccountRepository();
    await repo.insertUserCalendar({ user_id: 1, provider: 'apple', calendar_id: 'u1', enabled: false });
    var found = await repo.findUserCalendarByCalendarId(1, 'apple', 'u1');
    expect(found).toBeDefined();

    await repo.updateUserCalendarById(found.id, { enabled: true });
    var refetched = await repo.findUserCalendarById(found.id);
    expect(refetched.enabled).toBe(true);
  });

  test('deleteUserCalendars removes only the matching user+provider rows', async function () {
    var repo = new InMemoryCalendarAccountRepository();
    await repo.insertUserCalendar({ user_id: 1, provider: 'apple', calendar_id: 'u1' });
    await repo.insertUserCalendar({ user_id: 1, provider: 'gcal', calendar_id: 'u2' });
    var deleted = await repo.deleteUserCalendars(1, 'apple');
    expect(deleted).toBe(1);
    var remaining = await repo.findUserCalendars(1, 'gcal');
    expect(remaining.length).toBe(1);
  });
});
