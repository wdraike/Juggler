/**
 * H3 W3 — KnexTaskRepository adapter tests.
 *
 * Two layers:
 *
 *  1. DB-backed characterization (test-bed @3407, fail-loud per TEST-FR-001):
 *     CRUD + batch + transaction commit/rollback against REAL task_masters /
 *     task_instances / tasks_v / cal_sync_ledger rows, asserting the repository's
 *     read/write results match the legacy controller behavior for representative
 *     fixtures (the read helpers were lifted verbatim from the controller).
 *
 *  2. P1 PROOF (pure, stub-knex — INVARIANT P1 / ADR-0003):
 *     Using a sentinel stub whose `db.fn.now()` returns a tagged raw, the test
 *     proves the repository passes JS `Date` objects to the write layer and
 *     NEVER a Knex `fn.now()` raw — the one human-approved in-scope behavior
 *     change (WBS "In-scope decision — P1 correction").
 *
 * Traceability: WBS W3 (b) lib/db connection, (c) P1, (e) characterization,
 * (f) transaction boundaries.
 */

'use strict';

process.env.NODE_ENV = 'test';

var path = require('path');
var { v7: uuidv7 } = require('uuid');
var { assertDbAvailable } = require('../../../helpers/requireDB');

var SLICE = path.join(__dirname, '..', '..', '..', '..', 'src', 'slices', 'task');
var KnexTaskRepository = require(path.join(SLICE, 'adapters', 'KnexTaskRepository'));
var TaskRepositoryPort = require(path.join(SLICE, 'domain', 'ports', 'TaskRepositoryPort'));

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — P1 PROOF (no live DB; sentinel stub)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capturing stub for the master/instance write module — records exactly what the
 * repository hands to lib/tasks-write so we can assert P1 (JS Dates, never the
 * tagged fn.now() raw).
 */
function makeWriteSpy() {
  var calls = { insertTask: [], insertTasksBatch: [], updateTaskById: [], updateTasksWhere: [], updateInstancesWhere: [] };
  return {
    calls: calls,
    insertTask: function (db, row) { calls.insertTask.push(row); return Promise.resolve(); },
    insertTasksBatch: function (db, rows) { calls.insertTasksBatch.push(rows); return Promise.resolve(); },
    updateTaskById: function (db, id, changes, userId) { calls.updateTaskById.push({ id: id, changes: changes, userId: userId }); return Promise.resolve({ masterUpdated: 1, instanceUpdated: 1 }); },
    deleteTaskById: function () { return Promise.resolve(1); },
    updateTasksWhere: function (db, userId, applyWhere, changes) { calls.updateTasksWhere.push({ userId: userId, changes: changes }); return Promise.resolve({ masterUpdated: 1, instanceUpdated: 1 }); },
    deleteTasksWhere: function () { return Promise.resolve({ instanceDeleted: 1, masterDeleted: 1 }); },
    updateInstancesWhere: function (db, userId, applyWhere, changes) { calls.updateInstancesWhere.push({ userId: userId, changes: changes }); return Promise.resolve(1); },
    deleteInstancesWhere: function () { return Promise.resolve(1); }
  };
}

// A stub knex whose fn.now() returns a TAGGED raw — if the repository ever leaked
// a fn.now() into a write payload, the assertions below would catch the tag.
function makeStubDb() {
  var db = function () { return db; };
  db.fn = { now: function () { return { __knexRawNow: true }; } };
  return db;
}

describe('KnexTaskRepository — P1 (new Date(), never db.fn.now())', function () {
  test('updateTaskById passes a JS Date updated_at to tasks-write, NOT a fn.now() raw', async function () {
    var writeSpy = makeWriteSpy();
    var stubDb = makeStubDb();
    var repo = new KnexTaskRepository({ db: stubDb, tasksWrite: writeSpy });

    await repo.updateTaskById('t1', { text: 'x' }, 'u1');

    var changes = writeSpy.calls.updateTaskById[0].changes;
    expect(changes.updated_at).toBeInstanceOf(Date);
    expect(changes.updated_at.__knexRawNow).toBeUndefined();
    // Hard P1 proof: it is NOT the tagged fn.now() raw.
    expect(changes.updated_at).not.toEqual(stubDb.fn.now());
  });

  test('updateTasksWhere + updateInstancesWhere stamp a JS Date updated_at', async function () {
    var writeSpy = makeWriteSpy();
    var repo = new KnexTaskRepository({ db: makeStubDb(), tasksWrite: writeSpy });

    await repo.updateTasksWhere('u1', function (q) { return q; }, { project: 'p' });
    await repo.updateInstancesWhere('u1', function (q) { return q; }, { status: 'wip' });

    expect(writeSpy.calls.updateTasksWhere[0].changes.updated_at).toBeInstanceOf(Date);
    expect(writeSpy.calls.updateInstancesWhere[0].changes.updated_at).toBeInstanceOf(Date);
  });

  test('a caller-supplied JS Date updated_at is preserved (not overwritten)', async function () {
    var writeSpy = makeWriteSpy();
    var repo = new KnexTaskRepository({ db: makeStubDb(), tasksWrite: writeSpy });
    var when = new Date('2026-06-10T12:00:00Z');

    await repo.updateTaskById('t1', { text: 'x', updated_at: when }, 'u1');

    expect(writeSpy.calls.updateTaskById[0].changes.updated_at).toBe(when);
  });

  test('insertTask rejects a non-Date created_at (fail-loud P1 guard)', function () {
    var repo = new KnexTaskRepository({ db: makeStubDb(), tasksWrite: makeWriteSpy() });
    return expect(Promise.resolve().then(function () {
      return repo.insertTask({ id: 't1', user_id: 'u1', created_at: 'MOCK_NOW' });
    })).rejects.toThrow(/INVARIANT P1/);
  });

  test('updateTaskById rejects a non-Date updated_at (rejects a leaked fn.now()-shaped string)', function () {
    var repo = new KnexTaskRepository({ db: makeStubDb(), tasksWrite: makeWriteSpy() });
    return expect(Promise.resolve().then(function () {
      return repo.updateTaskById('t1', { updated_at: 'MOCK_NOW' }, 'u1');
    })).rejects.toThrow(/INVARIANT P1/);
  });

  // B-Fix P1: completed_at and scheduled_at are in P1_DATE_COLUMNS — guard must
  // reject non-Date values for them too. These tests FAIL against the pre-bert
  // code where only created_at/updated_at were in P1_DATE_COLUMNS (i.e. completed_at
  // and scheduled_at were not guarded and would silently pass a non-Date through).
  test('insertTask rejects a non-Date completed_at (P1 guard — bert fix column-completeness)', function () {
    var repo = new KnexTaskRepository({ db: makeStubDb(), tasksWrite: makeWriteSpy() });
    return expect(Promise.resolve().then(function () {
      return repo.insertTask({ id: 't1', user_id: 'u1', created_at: new Date(), updated_at: new Date(), completed_at: 'MOCK_NOW' });
    })).rejects.toThrow(/INVARIANT P1/);
  });

  test('insertTask rejects a non-Date scheduled_at (P1 guard — bert fix column-completeness)', function () {
    var repo = new KnexTaskRepository({ db: makeStubDb(), tasksWrite: makeWriteSpy() });
    return expect(Promise.resolve().then(function () {
      return repo.insertTask({ id: 't1', user_id: 'u1', created_at: new Date(), updated_at: new Date(), scheduled_at: 'fn.now()-string' });
    })).rejects.toThrow(/INVARIANT P1/);
  });

  test('updateTaskById rejects a non-Date completed_at (P1 guard — bert fix column-completeness)', function () {
    var repo = new KnexTaskRepository({ db: makeStubDb(), tasksWrite: makeWriteSpy() });
    return expect(Promise.resolve().then(function () {
      return repo.updateTaskById('t1', { completed_at: 'not-a-date' }, 'u1');
    })).rejects.toThrow(/INVARIANT P1/);
  });

  test('updateTaskById rejects a non-Date scheduled_at (P1 guard — bert fix column-completeness)', function () {
    var repo = new KnexTaskRepository({ db: makeStubDb(), tasksWrite: makeWriteSpy() });
    return expect(Promise.resolve().then(function () {
      return repo.updateTaskById('t1', { scheduled_at: 42 }, 'u1');
    })).rejects.toThrow(/INVARIANT P1/);
  });

  // ── PIN (H3-W6 FIX-4.1): assertDate null-allow branch ──────────────────────
  // zoe proved that TIGHTENING assertDate to reject null (i.e. dropping the
  // `v !== null` clause) left every existing test green → the null-ALLOW branch
  // (the reopen/clear path that writes completed_at=null / scheduled_at=null —
  // KnexTaskRepository.js L108-112) was UNTESTED. These two pins lock the branch
  // BOTH ways: null is allowed through, a non-Date string/raw is still rejected.
  // If a future edit removes the `v !== null` allowance, the first pin FAILS.
  test('PIN null-allow: updateTaskById ALLOWS null completed_at + scheduled_at (reopen/clear path)', async function () {
    var writeSpy = makeWriteSpy();
    var repo = new KnexTaskRepository({ db: makeStubDb(), tasksWrite: writeSpy });

    // The reopen path: completed_at + scheduled_at cleared to null. Must NOT throw.
    await repo.updateTaskById('t1', { status: '', completed_at: null, scheduled_at: null }, 'u1');

    var changes = writeSpy.calls.updateTaskById[0].changes;
    expect(changes.completed_at).toBeNull();
    expect(changes.scheduled_at).toBeNull();
  });

  test('PIN null-allow (paired): a non-Date string in completed_at is STILL rejected', function () {
    // The other half of the branch — proves null-allow did NOT loosen the guard
    // into accepting arbitrary non-Date values (a leaked fn.now() raw / string).
    var repo = new KnexTaskRepository({ db: makeStubDb(), tasksWrite: makeWriteSpy() });
    return expect(Promise.resolve().then(function () {
      return repo.updateTaskById('t1', { completed_at: 'MOCK_NOW' }, 'u1');
    })).rejects.toThrow(/INVARIANT P1/);
  });

  // Strip block comments, line comments, AND single-quoted string literals so a
  // DOC mention or an ERROR-MESSAGE mention of "db.fn.now()" / "require('../../../db')"
  // never trips the source proofs — only EXECUTABLE code is asserted against.
  function stripCommentsAndStrings(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments (incl. JSDoc)
      .replace(/\/\/[^\n]*/g, '')          // line comments
      .replace(/'(?:[^'\\]|\\.)*'/g, "''") // single-quoted string literals
      .replace(/"(?:[^"\\]|\\.)*"/g, '""');// double-quoted string literals
  }

  test('SOURCE PROOF: KnexTaskRepository.js contains zero EXECUTABLE fn.now() calls', function () {
    var fs = require('fs');
    var src = fs.readFileSync(path.join(SLICE, 'adapters', 'KnexTaskRepository.js'), 'utf8');
    var codeOnly = stripCommentsAndStrings(src);
    expect(codeOnly).not.toMatch(/\.fn\.now\s*\(/);
  });

  test('SOURCE PROOF: KnexTaskRepository obtains knex via lib/db, never src/db.js', function () {
    var fs = require('fs');
    var src = fs.readFileSync(path.join(SLICE, 'adapters', 'KnexTaskRepository.js'), 'utf8');
    var codeOnly = stripCommentsAndStrings(src);
    // The executable require is lib/db (ADR-0002).
    expect(src).toMatch(/require\(['"]\.\.\/\.\.\/\.\.\/lib\/db['"]\)/);
    // Never the src/db.js singleton (ADR-0002) — check executable code only.
    expect(codeOnly).not.toMatch(/require\(\s*['"]?\.\.\/\.\.\/\.\.\/db['"]?\s*\)/);
  });

  test('port conformance: implements every TASK_REPOSITORY_PORT_METHODS member', function () {
    var repo = new KnexTaskRepository({ db: makeStubDb(), tasksWrite: makeWriteSpy() });
    TaskRepositoryPort.TASK_REPOSITORY_PORT_METHODS.forEach(function (m) {
      expect(typeof repo[m]).toBe('function');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — DB-backed characterization (test-bed @3407)
// ─────────────────────────────────────────────────────────────────────────────

var knex = require('knex')(require('../../../../knexfile.js').test);
var USER = 'knexrepo-user-A';
var OTHER = 'knexrepo-user-B';

describe('KnexTaskRepository — DB-backed characterization (test-bed @3407)', function () {
  beforeAll(async function () {
    await assertDbAvailable();
    for (var u of [USER, OTHER]) {
      await knex('task_instances').where('user_id', u).del();
      await knex('task_masters').where('user_id', u).del();
      await knex('users').where('id', u).del();
      await knex('users').insert({
        id: u, email: u + '@knexrepo.test', name: u,
        timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
      });
    }
  }, 20000);

  afterAll(async function () {
    for (var u of [USER, OTHER]) {
      await knex('task_instances').where('user_id', u).del();
      await knex('task_masters').where('user_id', u).del();
      await knex('users').where('id', u).del();
    }
    await knex.destroy();
  }, 20000);

  beforeEach(async function () {
    for (var u of [USER, OTHER]) {
      await knex('task_instances').where('user_id', u).del();
      await knex('task_masters').where('user_id', u).del();
      await knex('cal_sync_ledger').where('user_id', u).del();
    }
  });

  function repo() { return new KnexTaskRepository({ db: knex }); }

  function plainRow(overrides) {
    var now = new Date();
    return Object.assign({
      id: uuidv7(), user_id: USER, text: 'k-task', task_type: 'task',
      dur: 30, pri: 'P3', status: '', recurring: 0,
      created_at: now, updated_at: now
    }, overrides);
  }

  test('insertTask writes both master + instance, readable via tasks_v fetch', async function () {
    var r = repo();
    var row = plainRow({ text: 'persisted' });
    await r.insertTask(row);

    // Direct table assertions: master + instance both exist (master/instance routing).
    expect(await knex('task_masters').where('id', row.id).first()).toBeTruthy();
    expect(await knex('task_instances').where('id', row.id).first()).toBeTruthy();

    // Repository read returns the merged tasks_v row with null event ids.
    var fetched = await r.fetchTaskWithEventIds(row.id, USER);
    expect(fetched).not.toBeNull();
    expect(fetched.id).toBe(row.id);
    expect(fetched.text).toBe('persisted');
    expect(fetched.gcal_event_id).toBeNull();
  });

  test('fetchTaskWithEventIds folds cal_sync_ledger gcal/msft ids onto the row', async function () {
    var r = repo();
    var row = plainRow({ text: 'cal-linked' });
    await r.insertTask(row);
    // cal_sync_ledger.id is an auto-increment integer — do NOT supply it.
    await knex('cal_sync_ledger').insert({
      user_id: USER, task_id: row.id, provider: 'gcal',
      provider_event_id: 'gcal-evt-xyz', status: 'active', origin: 'juggler',
      created_at: new Date(), updated_at: new Date()
    });

    var fetched = await r.fetchTaskWithEventIds(row.id, USER);
    expect(fetched.gcal_event_id).toBe('gcal-evt-xyz');
    expect(fetched.msft_event_id).toBeNull();
  });

  test('fetchTaskWithEventIds folds msft provider_event_id onto the row', async function () {
    var r = repo();
    var row = plainRow({ text: 'msft-linked' });
    await r.insertTask(row);
    await knex('cal_sync_ledger').insert({
      user_id: USER, task_id: row.id, provider: 'msft',
      provider_event_id: 'msft-evt-abc', status: 'active', origin: 'msft',
      created_at: new Date(), updated_at: new Date()
    });

    var fetched = await r.fetchTaskWithEventIds(row.id, USER);
    expect(fetched.msft_event_id).toBe('msft-evt-abc');
    expect(fetched.gcal_event_id).toBeNull();
  });

  test('fetchTasksWithEventIds returns rows with null event ids (no ledger rows)', async function () {
    var r = repo();
    await r.insertTask(plainRow({ text: 'no-cal-a' }));
    await r.insertTask(plainRow({ text: 'no-cal-b' }));
    var rows = await r.fetchTasksWithEventIds(USER);
    expect(rows.length).toBe(2);
    rows.forEach(function (row) {
      expect(row.msft_event_id).toBeNull();
      expect(row.apple_event_id).toBeNull();
    });
  });

  test('updateTaskById changes fields with field routing (text→master, status→instance)', async function () {
    var r = repo();
    var row = plainRow({ text: 'before', status: '' });
    await r.insertTask(row);

    var res = await r.updateTaskById(row.id, { text: 'after', status: 'wip', dur: 60 }, USER);
    expect(res.masterUpdated).toBe(1);
    expect(res.instanceUpdated).toBe(1);

    var m = await knex('task_masters').where('id', row.id).first();
    var i = await knex('task_instances').where('id', row.id).first();
    expect(m.text).toBe('after');
    expect(m.dur).toBe(60);
    expect(i.status).toBe('wip');
  });

  test('P1 (DB): updated_at is stored as a real timestamp, not the string "MOCK_NOW"', async function () {
    var r = repo();
    var row = plainRow();
    await r.insertTask(row);
    await r.updateTaskById(row.id, { text: 'p1-db' }, USER);

    var m = await knex('task_masters').where('id', row.id).first();
    // A real DATETIME column round-trips to a parseable timestamp — proof the
    // write was a JS Date, never a leaked raw / literal string.
    var parsed = new Date(m.updated_at);
    expect(isNaN(parsed.getTime())).toBe(false);
  });

  test('deleteTaskById removes both rows; tenancy-scoped (other user cannot delete)', async function () {
    var r = repo();
    var row = plainRow({ text: 'del-me' });
    await r.insertTask(row);

    await r.deleteTaskById(row.id, OTHER);
    expect(await knex('task_masters').where('id', row.id).first()).toBeTruthy();

    await r.deleteTaskById(row.id, USER);
    expect(await knex('task_masters').where('id', row.id).first()).toBeUndefined();
    expect(await knex('task_instances').where('id', row.id).first()).toBeUndefined();
  });

  test('insertTasksBatch persists every row', async function () {
    var r = repo();
    var rows = [plainRow({ text: 'b1' }), plainRow({ text: 'b2' })];
    await r.insertTasksBatch(rows);
    var fetched = await r.fetchTasksWithEventIds(USER);
    var texts = fetched.map(function (x) { return x.text; }).sort();
    expect(texts).toEqual(['b1', 'b2']);
  });

  test('getTasksVersion reflects count over tasks_v', async function () {
    var r = repo();
    expect((await r.getTasksVersion(USER)).split(':').pop()).toBe('0');
    await r.insertTask(plainRow());
    await r.insertTask(plainRow());
    expect((await r.getTasksVersion(USER)).split(':').pop()).toBe('2');
  });

  test('runInTransaction COMMITS on resolve', async function () {
    var r = repo();
    var row = plainRow({ text: 'tx-commit' });
    await r.runInTransaction(function (trxRepo) { return trxRepo.insertTask(row); });
    expect(await knex('task_masters').where('id', row.id).first()).toBeTruthy();
  });

  test('runInTransaction ROLLS BACK on reject (no row persists)', async function () {
    var r = repo();
    var row = plainRow({ text: 'tx-rollback' });
    var threw = false;
    try {
      await r.runInTransaction(async function (trxRepo) {
        await trxRepo.insertTask(row);
        throw new Error('force rollback');
      });
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    // The transaction rolled back — neither table has the row.
    expect(await knex('task_masters').where('id', row.id).first()).toBeUndefined();
    expect(await knex('task_instances').where('id', row.id).first()).toBeUndefined();
  });

  // JUG-FACADE-DB-VIOLATIONS stage 4: countDisabledInstances moved from
  // facade.js's getDb()('tasks_v') read into this repository method — new
  // db-backed pin (the site was previously exercised only through mocked
  // ReEnableTask use-case tests, never against a real tasks_v read).
  test('countDisabledInstances counts only status=disabled instances under the source, scoped to the user', async function () {
    var r = repo();
    var now = new Date();
    var masterId = uuidv7();
    await knex('task_masters').insert({
      id: masterId, user_id: USER, text: 'recur-master', dur: 30, pri: 'P3',
      recurring: 1, status: '', created_at: now, updated_at: now
    });
    await knex('task_instances').insert([
      { id: uuidv7(), master_id: masterId, user_id: USER, status: 'disabled',
        occurrence_ordinal: 1, split_ordinal: 1, split_total: 1, dur: 30, created_at: now, updated_at: now },
      { id: uuidv7(), master_id: masterId, user_id: USER, status: 'disabled',
        occurrence_ordinal: 2, split_ordinal: 1, split_total: 1, dur: 30, created_at: now, updated_at: now },
      { id: uuidv7(), master_id: masterId, user_id: USER, status: '',
        occurrence_ordinal: 3, split_ordinal: 1, split_total: 1, dur: 30, created_at: now, updated_at: now }
    ]);

    expect(await r.countDisabledInstances(USER, masterId)).toBe(2);
    expect(await r.countDisabledInstances(OTHER, masterId)).toBe(0);
  });
});
