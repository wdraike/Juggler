// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../../../src/lib/audit-context').stampInsert(rows);
/**
 * H3 W3 — TaskRepositoryPort CONTRACT suite (run against BOTH adapters).
 *
 * WBS W3 acceptance (d): the InMemoryTaskRepository passes the SAME port-contract
 * suite as the KnexTaskRepository — proving the test double is faithful.
 *
 * HOW: one parameterized describe block runs every contract assertion against a
 * fresh repository produced by a per-adapter `setup()`:
 *   - InMemory: a fresh InMemoryTaskRepository (no DB).
 *   - Knex:     a KnexTaskRepository over the test-bed DB (3407); each test
 *               cleans + seeds real rows for an isolated test user.
 *
 * The Knex leg is DB-backed (test-bed @3407) and fail-loud per TEST-FR-001 — it
 * THROWS if the DB is down (never a silent skip). The two legs assert IDENTICAL
 * behavior for the contract surface (CRUD round-trip, version token shape, batch,
 * transaction commit/rollback, P1 Date discipline, tenancy).
 *
 * Traceability: WBS W3 (d), (f), (g); P1/ADR-0003.
 */

'use strict';

process.env.NODE_ENV = 'test';

var path = require('path');
var { v7: uuidv7 } = require('uuid');
var { assertDbAvailable } = require('../../../helpers/requireDB');

var SLICE = path.join(__dirname, '..', '..', '..', '..', 'src', 'slices', 'task');
var TaskRepositoryPort = require(path.join(SLICE, 'domain', 'ports', 'TaskRepositoryPort'));
var KnexTaskRepository = require(path.join(SLICE, 'adapters', 'KnexTaskRepository'));
var InMemoryTaskRepository = require(path.join(SLICE, 'adapters', 'InMemoryTaskRepository'));

var TASK_REPOSITORY_PORT_METHODS = TaskRepositoryPort.TASK_REPOSITORY_PORT_METHODS;

// Shared test-bed knex handle for the Knex leg (one pool for the suite).
var knex = require('knex')(require('../../../../knexfile.js').test);

var USER = 'contract-user-A';
var OTHER_USER = 'contract-user-B';

/**
 * Build a legacy tasks-shape row for a plain non-recurring task.
 * created_at/updated_at are JS Dates (P1).
 */
function makeRow(overrides) {
  var now = new Date();
  return Object.assign({
    id: uuidv7(),
    user_id: USER,
    text: 'contract task',
    task_type: 'task',
    dur: 30,
    pri: 'P3',
    status: '',
    recurring: 0,
    created_at: now,
    updated_at: now
  }, overrides);
}

// ── Per-adapter setup harnesses ──────────────────────────────────────────────

var ADAPTERS = {
  InMemory: {
    available: function () { return Promise.resolve(true); },
    beforeAll: function () { return Promise.resolve(); },
    afterAll: function () { return Promise.resolve(); },
    // Fresh repo, no seed — tests insert their own rows through the port.
    makeRepo: function () { return Promise.resolve(new InMemoryTaskRepository()); },
    cleanup: function () { return Promise.resolve(); }
  },
  Knex: {
    available: function () { return assertDbAvailable(); },
    beforeAll: async function () {
      // Ensure the two test users exist (FK target for task rows).
      for (var u of [USER, OTHER_USER]) {
        await knex('task_instances').where('user_id', u).del();
        await knex('task_masters').where('user_id', u).del();
        await knex('users').where('id', u).del();
        await knex('users').insert(__stampFixture({
          id: u, email: u + '@contract.test', name: u,
          timezone: 'America/New_York', created_at: new Date(), updated_at: new Date()
        }));
      }
    },
    afterAll: async function () {
      for (var u of [USER, OTHER_USER]) {
        await knex('task_instances').where('user_id', u).del();
        await knex('task_masters').where('user_id', u).del();
        await knex('users').where('id', u).del();
      }
      await knex.destroy();
    },
    makeRepo: async function () {
      // Clean both users' task rows before each test for isolation.
      for (var u of [USER, OTHER_USER]) {
        await knex('task_instances').where('user_id', u).del();
        await knex('task_masters').where('user_id', u).del();
      }
      return new KnexTaskRepository({ db: knex });
    },
    cleanup: function () { return Promise.resolve(); }
  }
};

// ── The parameterized contract ───────────────────────────────────────────────

Object.keys(ADAPTERS).forEach(function (name) {
  var A = ADAPTERS[name];

  describe('TaskRepositoryPort contract — ' + name, function () {
    beforeAll(async function () {
      // Date-only fake timers (999.2157): Date frozen, every timer API real — no hangs
      installDateOnlyFakeTimers(new Date('2026-01-15T12:00:00Z'));
      await A.available();   // fail-loud if the Knex DB is down (TEST-FR-001)
      await A.beforeAll();
    }, 20000);

    afterAll(async function () {
      jest.useRealTimers();
      await A.afterAll();
    }, 20000);

    // ── Port conformance ──────────────────────────────────────────────────────
    test('implements every TASK_REPOSITORY_PORT_METHODS member', async function () {
      var repo = await A.makeRepo();
      TASK_REPOSITORY_PORT_METHODS.forEach(function (m) {
        expect(typeof repo[m]).toBe('function');
      });
    });

    // ── Insert → fetch round-trip ─────────────────────────────────────────────
    test('insertTask then fetchTaskWithEventIds returns the row with null event ids', async function () {
      var repo = await A.makeRepo();
      var row = makeRow({ text: 'round-trip' });
      await repo.insertTask(row);

      var fetched = await repo.fetchTaskWithEventIds(row.id, USER);
      expect(fetched).not.toBeNull();
      expect(fetched.id).toBe(row.id);
      expect(fetched.text).toBe('round-trip');
      // No active ledger → event ids null (fold shape).
      expect(fetched.gcal_event_id).toBeNull();
      expect(fetched.msft_event_id).toBeNull();
      expect(fetched.apple_event_id).toBeNull();
      expect(fetched.cal_sync_origin).toBeNull();
    });

    test('fetchTaskWithEventIds returns null for an unknown id', async function () {
      var repo = await A.makeRepo();
      var fetched = await repo.fetchTaskWithEventIds('does-not-exist', USER);
      expect(fetched).toBeNull();
    });

    test('fetchTaskWithEventIds is tenancy-scoped (other user cannot read)', async function () {
      var repo = await A.makeRepo();
      var row = makeRow({ text: 'tenant' });
      await repo.insertTask(row);
      var fetched = await repo.fetchTaskWithEventIds(row.id, OTHER_USER);
      expect(fetched).toBeNull();
    });

    // ── fetchTasksWithEventIds ────────────────────────────────────────────────
    test('fetchTasksWithEventIds returns all of the user rows', async function () {
      var repo = await A.makeRepo();
      await repo.insertTask(makeRow({ text: 'a' }));
      await repo.insertTask(makeRow({ text: 'b' }));
      var rows = await repo.fetchTasksWithEventIds(USER);
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBe(2);
      var texts = rows.map(function (r) { return r.text; }).sort();
      expect(texts).toEqual(['a', 'b']);
    });

    // ── updateTaskById (+ P1 + exact per-table counts) ───────────────────────
    test('updateTaskById applies field changes and reports row counts', async function () {
      var repo = await A.makeRepo();
      var row = makeRow({ text: 'before', status: '' });
      await repo.insertTask(row);

      var res = await repo.updateTaskById(row.id, { text: 'after', status: 'wip' }, USER);
      // text ∈ MASTER_UPDATE_FIELDS; status ∈ both MASTER and INSTANCE — both tables updated.
      expect(res.masterUpdated).toBeGreaterThanOrEqual(1);
      expect(res.instanceUpdated).toBeGreaterThanOrEqual(1);

      var fetched = await repo.fetchTaskWithEventIds(row.id, USER);
      expect(fetched.text).toBe('after');
      expect(fetched.status).toBe('wip');
    });

    // B-Fix per-table counts (zoe W3z-2 — weak toBeGreaterThanOrEqual masked divergence).
    // These tests FAIL against the pre-bert InMemory that always returned {1,1} regardless
    // of which fields were in the change set.
    //
    // updated_at mirrors to BOTH tables via splitUpdateFields (tasks-write.js:140-143) — so
    // any updateTaskById call automatically writes updated_at to both master and instance.
    // The per-table count is therefore determined by which application fields are present:
    //
    //   text only (master field)      → split.master has {text, updated_at} → masterUpdated=1
    //                                    split.instance has {updated_at}     → instanceUpdated=1
    //   scheduled_at only (instance)  → split.instance has {scheduled_at, updated_at} → instanceUpdated=1
    //                                    split.master has {updated_at} only  → masterUpdated=1
    //
    // Both cases produce {masterUpdated:1, instanceUpdated:1} because updated_at always
    // mirrors. The TRUE divergence the pre-bert InMemory had was returning {1,1} even when
    // the row did NOT MATCH (i.e. wrong userId) — it never returned {0,0} for a no-op.
    // The exact-count contract that distinguishes the two adapters:
    //   - no-match (wrong userId): must return {masterUpdated:0, instanceUpdated:0}
    //   - match: returns {masterUpdated:1, instanceUpdated:1} (updated_at mirrors to both)
    test('updateTaskById — no-match (wrong userId) → {masterUpdated:0, instanceUpdated:0}', async function () {
      var repo = await A.makeRepo();
      var row = makeRow({ text: 'original' });
      await repo.insertTask(row);

      var res = await repo.updateTaskById(row.id, { text: 'updated' }, OTHER_USER);
      // Wrong user — no rows should be touched.
      expect(res.masterUpdated).toBe(0);
      expect(res.instanceUpdated).toBe(0);
    });

    test('updateTaskById — master+instance change → exact {masterUpdated:1, instanceUpdated:1}', async function () {
      var repo = await A.makeRepo();
      var row = makeRow({ text: 'original', status: '' });
      await repo.insertTask(row);

      // text ∈ MASTER_UPDATE_FIELDS; status ∈ both; scheduled_at ∈ INSTANCE_UPDATE_FIELDS.
      // All three are routed: master gets {text, status, updated_at}, instance gets {status, scheduled_at, updated_at}.
      var res = await repo.updateTaskById(row.id, { text: 'upd', status: 'wip', scheduled_at: new Date() }, USER);
      expect(res.masterUpdated).toBe(1);
      expect(res.instanceUpdated).toBe(1);
    });

    // ── deleteTaskById ────────────────────────────────────────────────────────
    test('deleteTaskById removes the row (tenancy-scoped)', async function () {
      var repo = await A.makeRepo();
      var row = makeRow({ text: 'to-delete' });
      await repo.insertTask(row);

      // Other user cannot delete it.
      await repo.deleteTaskById(row.id, OTHER_USER);
      expect(await repo.fetchTaskWithEventIds(row.id, USER)).not.toBeNull();

      // Owner deletes it.
      await repo.deleteTaskById(row.id, USER);
      expect(await repo.fetchTaskWithEventIds(row.id, USER)).toBeNull();
    });

    // ── insertTasksBatch ──────────────────────────────────────────────────────
    test('insertTasksBatch inserts every row', async function () {
      var repo = await A.makeRepo();
      var rows = [makeRow({ text: 'batch-1' }), makeRow({ text: 'batch-2' }), makeRow({ text: 'batch-3' })];
      await repo.insertTasksBatch(rows);
      var fetched = await repo.fetchTasksWithEventIds(USER);
      expect(fetched.length).toBe(3);
    });

    // ── getTasksVersion ───────────────────────────────────────────────────────
    test('getTasksVersion is "<timestamp>:<count>" and tracks count', async function () {
      var repo = await A.makeRepo();
      var v0 = await repo.getTasksVersion(USER);
      expect(typeof v0).toBe('string');
      expect(v0).toMatch(/:/);
      expect(v0.split(':').pop()).toBe('0');

      await repo.insertTask(makeRow());
      await repo.insertTask(makeRow());
      var v2 = await repo.getTasksVersion(USER);
      expect(v2.split(':').pop()).toBe('2');
    });

    // B-Fix version token format (zoe W3z-3 — only count suffix was asserted;
    // the timestamp prefix format and chronological-max correctness were unchecked).
    // This test FAILS against the pre-bert InMemory that used String(Date) for the
    // max — which produces "Tue Jun 10 2026 12:00:00 GMT+0000" (locale string) rather
    // than "YYYY-MM-DD HH:MM:SS" (MySQL datetime string format).
    test('getTasksVersion prefix is "YYYY-MM-DD HH:MM:SS" format and tracks the chronological MAX updated_at', async function () {
      var repo = await A.makeRepo();
      // Insert three rows with out-of-order updated_at so the max is NOT the last inserted.
      var early  = new Date('2026-01-01T00:00:00Z');
      var latest = new Date('2026-06-10T12:00:00Z');
      var middle = new Date('2026-03-15T06:00:00Z');

      var r1 = makeRow({ updated_at: early,  created_at: early  });
      var r2 = makeRow({ updated_at: latest, created_at: latest });
      var r3 = makeRow({ updated_at: middle, created_at: middle });
      await repo.insertTask(r1);
      await repo.insertTask(r2);
      await repo.insertTask(r3);

      var v = await repo.getTasksVersion(USER);
      var parts = v.split(':');
      // Format: "YYYY-MM-DD HH:MM:SS:count"  (the timestamp itself may contain no colons,
      // but MySQL datetime "YYYY-MM-DD HH:MM:SS" has two colons internally, so split gives
      // ["YYYY-MM-DD HH", "MM", "SS", count]).  Reassemble everything except the last segment.
      var countPart = parts[parts.length - 1];
      var tsPart = parts.slice(0, parts.length - 1).join(':');

      expect(countPart).toBe('3');
      // Must match "YYYY-MM-DD HH:MM:SS" — the format MySQL MAX(updated_at) produces.
      expect(tsPart).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      // The timestamp must be the chronological MAX — "2026-06-10 12:00:00" (UTC), not
      // the earliest or middle date. Verify the year/month/day prefix.
      expect(tsPart.startsWith('2026-06-10')).toBe(true);
    });

    // ── getUserSplitPreference (null path) ────────────────────────────────────
    test('getUserSplitPreference resolves null when no preference row exists', async function () {
      var repo = await A.makeRepo();
      var pref = await repo.getUserSplitPreference(USER);
      expect(pref).toBeNull();
    });

    // ── Bulk where helpers ────────────────────────────────────────────────────
    test('updateTasksWhere updates only matching rows', async function () {
      var repo = await A.makeRepo();
      var keep = makeRow({ text: 'keep', project: 'other' });
      var hit1 = makeRow({ text: 'hit1', project: 'shared' });
      var hit2 = makeRow({ text: 'hit2', project: 'shared' });
      await repo.insertTask(keep);
      await repo.insertTask(hit1);
      await repo.insertTask(hit2);

      await repo.updateTasksWhere(USER, function (q) { return q.where('project', 'shared'); }, { project: 'renamed' });

      expect((await repo.fetchTaskWithEventIds(hit1.id, USER)).project).toBe('renamed');
      expect((await repo.fetchTaskWithEventIds(hit2.id, USER)).project).toBe('renamed');
      expect((await repo.fetchTaskWithEventIds(keep.id, USER)).project).toBe('other');
    });

    test('updateTasksWhere throws without a userId (tenancy guard)', async function () {
      var repo = await A.makeRepo();
      await expect(repo.updateTasksWhere(null, function (q) { return q; }, { text: 'x' }))
        .rejects.toThrow(/userId is required/);
    });

    test('deleteTasksWhere removes only matching rows', async function () {
      var repo = await A.makeRepo();
      var a = makeRow({ text: 'del-a' });
      var b = makeRow({ text: 'keep-b' });
      await repo.insertTask(a);
      await repo.insertTask(b);
      // Filter on `id` — a column BOTH task_masters and task_instances share, so
      // the legacy deleteTasksWhere (which applies the where to both tables) is
      // valid. A master-only filter column (e.g. `project`) is not valid here
      // because deleteTasksWhere deletes from task_instances first.
      await repo.deleteTasksWhere(USER, function (q) { return q.whereIn('id', [a.id]); });
      expect(await repo.fetchTaskWithEventIds(a.id, USER)).toBeNull();
      expect(await repo.fetchTaskWithEventIds(b.id, USER)).not.toBeNull();
    });

    // ── getRecurringTemplateRows ──────────────────────────────────────────────
    // Fix A: these 3 tests had ZERO coverage. They FAIL on any adapter that does
    // not implement getRecurringTemplateRows at all (pre-W3 or mis-filtered).
    test('getRecurringTemplateRows returns only recurring_template and recurring=1 rows for the user', async function () {
      var repo = await A.makeRepo();
      var plain = makeRow({ text: 'plain', task_type: 'task', recurring: 0 });
      var tmpl  = makeRow({ text: 'tmpl',  task_type: 'recurring_template', recurring: 1 });
      var rec1  = makeRow({ text: 'rec1',  task_type: 'task', recurring: 1 });
      var otherTmpl = makeRow({ text: 'other-tmpl', task_type: 'recurring_template', recurring: 1, user_id: OTHER_USER });
      await repo.insertTask(plain);
      await repo.insertTask(tmpl);
      await repo.insertTask(rec1);
      await repo.insertTask(otherTmpl);

      var rows = await repo.getRecurringTemplateRows(USER);
      expect(Array.isArray(rows)).toBe(true);
      var ids = rows.map(function (r) { return r.id; }).sort();
      // Must include tmpl and rec1; must NOT include plain or otherTmpl.
      expect(ids).toContain(tmpl.id);
      expect(ids).toContain(rec1.id);
      expect(ids).not.toContain(plain.id);
      expect(ids).not.toContain(otherTmpl.id);
    });

    test('getRecurringTemplateRows returns empty array when user has no recurring rows', async function () {
      var repo = await A.makeRepo();
      await repo.insertTask(makeRow({ text: 'nope', task_type: 'task', recurring: 0 }));
      var rows = await repo.getRecurringTemplateRows(USER);
      expect(rows).toEqual([]);
    });

    // ── expandToAllInstanceIds ────────────────────────────────────────────────
    // Fix A: zero coverage pre-W3. Fails if the method is absent or mis-routes.
    test('expandToAllInstanceIds — non-recurring ids returned as-is (no master found)', async function () {
      var repo = await A.makeRepo();
      var a = makeRow({ text: 'a', recurring: 0 });
      var b = makeRow({ text: 'b', recurring: 0 });
      await repo.insertTask(a);
      await repo.insertTask(b);

      var out = await repo.expandToAllInstanceIds(USER, [a.id, b.id]);
      // No recurring masters involved — output is the same id set.
      expect(Array.isArray(out)).toBe(true);
      var sorted = out.slice().sort();
      expect(sorted).toEqual([a.id, b.id].sort());
    });

    test('expandToAllInstanceIds — empty ids input returns empty array', async function () {
      var repo = await A.makeRepo();
      var out = await repo.expandToAllInstanceIds(USER, []);
      expect(Array.isArray(out)).toBe(true);
      expect(out.length).toBe(0);
    });

    // ── deleteInstancesWhere ──────────────────────────────────────────────────
    // Fix A: zero coverage pre-W3. Fails if the method is absent or deletes
    // from the wrong table / ignores tenancy.
    test('deleteInstancesWhere removes matching rows and returns a count', async function () {
      var repo = await A.makeRepo();
      var a = makeRow({ text: 'del-inst-a', status: 'wip' });
      var b = makeRow({ text: 'keep-inst-b', status: '' });
      await repo.insertTask(a);
      await repo.insertTask(b);

      var n = await repo.deleteInstancesWhere(USER, function (q) { return q.where('id', a.id); });
      expect(typeof n).toBe('number');
      expect(n).toBe(1);
      // Row a is gone from the readable surface; row b survives.
      expect(await repo.fetchTaskWithEventIds(a.id, USER)).toBeNull();
      expect(await repo.fetchTaskWithEventIds(b.id, USER)).not.toBeNull();
    });

    test('deleteInstancesWhere with no matching rows returns 0', async function () {
      var repo = await A.makeRepo();
      var n = await repo.deleteInstancesWhere(USER, function (q) { return q.where('id', 'does-not-exist'); });
      expect(n).toBe(0);
    });

    test('deleteInstancesWhere throws without a userId (tenancy guard)', async function () {
      var repo = await A.makeRepo();
      await expect(repo.deleteInstancesWhere(null, function (q) { return q; }))
        .rejects.toThrow(/userId is required/);
    });

    // ── updateInstancesWhere (DB characterization + contract) ────────────────
    // Fix A: previously had only a P1 spy in KnexTaskRepository.test.js — no
    // DB characterization or contract assertions. Fails if method is absent or
    // field-routing wrong (e.g. if it accidentally writes master columns).
    test('updateInstancesWhere updates matching instance rows and returns count', async function () {
      var repo = await A.makeRepo();
      // The DB CHECK constraint chk_task_instances_terminal_scheduled (migration
      // 20260527213906) enforces, on EVERY write path, that an instance with a terminal
      // status (done/skip/cancel/missed) has a non-null scheduled_at. (The HTTP app-layer
      // UpdateTaskStatus additionally turns this into a graceful 400, but the constraint
      // is the universal enforcer.) This raw repo path has no app guard, so a row marked
      // 'done' must already be scheduled — seed scheduled_at to make the row valid.
      var a = makeRow({ text: 'inst-a', status: 'wip', scheduled_at: new Date('2026-06-10T08:00:00Z') });
      var b = makeRow({ text: 'inst-b', status: '' });
      await repo.insertTask(a);
      await repo.insertTask(b);
      var completedAt = new Date('2026-06-10T12:00:00Z');

      var n = await repo.updateInstancesWhere(
        USER,
        function (q) { return q.where('id', a.id); },
        { completed_at: completedAt, status: 'done' }
      );
      expect(typeof n).toBe('number');
      expect(n).toBe(1);
      // Row a should reflect the update; row b unchanged.
      var fetchedA = await repo.fetchTaskWithEventIds(a.id, USER);
      expect(fetchedA.status).toBe('done');
      // Row b not changed.
      var fetchedB = await repo.fetchTaskWithEventIds(b.id, USER);
      expect(fetchedB.status).toBe('');
    });

    test('updateInstancesWhere throws without a userId (tenancy guard)', async function () {
      var repo = await A.makeRepo();
      await expect(repo.updateInstancesWhere(null, function (q) { return q; }, { status: 'done' }))
        .rejects.toThrow(/userId is required/);
    });

    // ── P1: timestamps are JS Dates, never fn.now() ───────────────────────────
    test('P1: updateTaskById stamps updated_at as a JS Date (never a fn.now() raw)', async function () {
      var repo = await A.makeRepo();
      var row = makeRow();
      await repo.insertTask(row);
      // No updated_at supplied → repo must stamp new Date(), not a Knex raw.
      await repo.updateTaskById(row.id, { text: 'p1' }, USER);
      var fetched = await repo.fetchTaskWithEventIds(row.id, USER);
      // The stored updated_at round-trips to a parseable real timestamp.
      var parsed = new Date(fetched.updated_at);
      expect(isNaN(parsed.getTime())).toBe(false);
    });

    test('P1: insertTask rejects a non-Date created_at (fail-loud guard)', async function () {
      var repo = await A.makeRepo();
      var bad = makeRow({ created_at: 'not-a-date' });
      await expect(Promise.resolve().then(function () { return repo.insertTask(bad); }))
        .rejects.toThrow(/INVARIANT P1/);
    });

    test('P1: updateTaskById rejects a non-Date updated_at (fail-loud guard)', async function () {
      var repo = await A.makeRepo();
      var row = makeRow();
      await repo.insertTask(row);
      await expect(Promise.resolve().then(function () {
        return repo.updateTaskById(row.id, { updated_at: 'MOCK_NOW' }, USER);
      })).rejects.toThrow(/INVARIANT P1/);
    });

    // B-Fix P1 guard completeness (bert fix — completed_at and scheduled_at added
    // to P1_DATE_COLUMNS). These tests FAIL against pre-bert code where those columns
    // were not guarded — a non-Date value would silently pass through to the DB write.
    test('P1: insertTask rejects a non-Date completed_at (bert fix — column-complete guard)', async function () {
      var repo = await A.makeRepo();
      var bad = makeRow({ completed_at: 'fn.now()-string' });
      await expect(Promise.resolve().then(function () { return repo.insertTask(bad); }))
        .rejects.toThrow(/INVARIANT P1/);
    });

    test('P1: insertTask rejects a non-Date scheduled_at (bert fix — column-complete guard)', async function () {
      var repo = await A.makeRepo();
      var bad = makeRow({ scheduled_at: 'not-a-date' });
      await expect(Promise.resolve().then(function () { return repo.insertTask(bad); }))
        .rejects.toThrow(/INVARIANT P1/);
    });

    test('P1: updateTaskById rejects a non-Date completed_at (bert fix — column-complete guard)', async function () {
      var repo = await A.makeRepo();
      var row = makeRow();
      await repo.insertTask(row);
      await expect(Promise.resolve().then(function () {
        return repo.updateTaskById(row.id, { completed_at: 'MOCK_NOW' }, USER);
      })).rejects.toThrow(/INVARIANT P1/);
    });

    test('P1: updateTaskById rejects a non-Date scheduled_at (bert fix — column-complete guard)', async function () {
      var repo = await A.makeRepo();
      var row = makeRow();
      await repo.insertTask(row);
      await expect(Promise.resolve().then(function () {
        return repo.updateTaskById(row.id, { scheduled_at: 42 }, USER);
      })).rejects.toThrow(/INVARIANT P1/);
    });

    // ── Transactions: commit / rollback ───────────────────────────────────────
    test('runInTransaction COMMITS when work resolves', async function () {
      var repo = await A.makeRepo();
      var row = makeRow({ text: 'committed' });
      await repo.runInTransaction(function (trxRepo) {
        return trxRepo.insertTask(row);
      });
      var fetched = await repo.fetchTaskWithEventIds(row.id, USER);
      expect(fetched).not.toBeNull();
      expect(fetched.text).toBe('committed');
    });

    test('runInTransaction ROLLS BACK when work rejects', async function () {
      var repo = await A.makeRepo();
      var row = makeRow({ text: 'rolled-back' });
      var err = null;
      try {
        await repo.runInTransaction(async function (trxRepo) {
          await trxRepo.insertTask(row);
          throw new Error('boom — force rollback');
        });
      } catch (e) { err = e; }
      expect(err).not.toBeNull();
      expect(err.message).toMatch(/boom/);
      // The insert inside the rolled-back trx must NOT be visible.
      var fetched = await repo.fetchTaskWithEventIds(row.id, USER);
      expect(fetched).toBeNull();
    });

    test('runInTransaction trxRepo sees its own uncommitted writes (read-after-write in trx)', async function () {
      var repo = await A.makeRepo();
      var row = makeRow({ text: 'in-trx-read' });
      var seenInside = await repo.runInTransaction(async function (trxRepo) {
        await trxRepo.insertTask(row);
        return trxRepo.fetchTaskWithEventIds(row.id, USER);
      });
      expect(seenInside).not.toBeNull();
      expect(seenInside.text).toBe('in-trx-read');
    });
  });
});
