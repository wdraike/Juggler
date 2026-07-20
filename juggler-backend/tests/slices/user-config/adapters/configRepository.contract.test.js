// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../../../src/lib/audit-context').stampInsert(rows);
/**
 * H4 W3 — ConfigRepositoryPort CONTRACT suite (run against BOTH adapters).
 *
 * WBS W3 acceptance (c): the InMemoryConfigRepository passes the SAME port-contract
 * suite as the KnexConfigRepository — proving the test double is faithful and the
 * relocated config reads/writes/counts/transactions behave identically.
 *
 * HOW: one parameterized describe block runs every contract assertion against a
 * fresh repository produced by a per-adapter `setup()`:
 *   - InMemory: a fresh InMemoryConfigRepository (no DB), seeded per-test.
 *   - Knex:     a KnexConfigRepository over the test-bed DB (3407); each test
 *               cleans + seeds real rows for isolated test users.
 *
 * The Knex leg is DB-backed (test-bed @3407) and fail-loud per TEST-FR-001 — it
 * THROWS if the DB is down (never a silent skip). The two legs assert IDENTICAL
 * behavior for the contract surface (config get/set, entity-limit counts, the
 * orphan when-tag read, project/location/tool CRUD + replace, the import wipe,
 * impersonation audit + list queries, transaction commit/rollback, P1 Date
 * discipline, tenancy).
 *
 * Traceability: WBS W3 (a)-(f); P1/ADR-0003; golden-master Surfaces 1/2/5/8.
 */

'use strict';

process.env.NODE_ENV = 'test';

var path = require('path');
var { assertDbAvailable } = require('../../../helpers/requireDB');

var SLICE = path.join(__dirname, '..', '..', '..', '..', 'src', 'slices', 'user-config');
var ConfigRepositoryPort = require(path.join(SLICE, 'domain', 'ports', 'ConfigRepositoryPort'));
var KnexConfigRepository = require(path.join(SLICE, 'adapters', 'KnexConfigRepository'));
var InMemoryConfigRepository = require(path.join(SLICE, 'adapters', 'InMemoryConfigRepository'));
var UserConfig = require(path.join(SLICE, 'domain', 'entities', 'UserConfig'));

var CONFIG_REPOSITORY_PORT_METHODS = ConfigRepositoryPort.CONFIG_REPOSITORY_PORT_METHODS;

// Shared test-bed knex handle for the Knex leg (one pool for the suite).
var knex = require('knex')(require('../../../../knexfile.js').test);
var tasksWrite = require('../../../../src/lib/tasks-write');

var USER = 'cfg-contract-user-A';
var OTHER_USER = 'cfg-contract-user-B';
var USER_A_EMAIL = USER + '@contract.test';
var USER_B_EMAIL = OTHER_USER + '@contract.test';

// ── Per-adapter setup harnesses ──────────────────────────────────────────────

async function knexCleanUsers() {
  for (var u of [USER, OTHER_USER]) {
    await knex('impersonation_log').where('admin_user_id', u).del();
    await knex('impersonation_log').where('target_user_id', u).del();
    await knex('task_instances').where('user_id', u).del();
    await knex('task_masters').where('user_id', u).del();
    await knex('user_config').where('user_id', u).del();
    await knex('projects').where('user_id', u).del();
    await knex('locations').where('user_id', u).del();
    await knex('tools').where('user_id', u).del();
  }
}

var ADAPTERS = {
  InMemory: {
    available: function () { return Promise.resolve(true); },
    beforeAll: function () { return Promise.resolve(); },
    afterAll: function () { return Promise.resolve(); },
    // Fresh repo seeded with the two users (for impersonation-targets).
    makeRepo: function () {
      var created = {};
      created[USER] = new Date('2026-01-01T00:00:00Z');
      created[OTHER_USER] = new Date('2026-02-01T00:00:00Z');
      var users = {};
      users[USER] = USER_A_EMAIL;
      users[OTHER_USER] = USER_B_EMAIL;
      return Promise.resolve(new InMemoryConfigRepository({ users: users, userCreatedAt: created }));
    },
    // For the InMemory leg, seed tasks_v rows directly (no DB view).
    seedTasks: function (repo, rows) {
      rows.forEach(function (r) { repo._tasks.push(Object.assign({}, r)); });
      return Promise.resolve();
    }
  },
  Knex: {
    available: function () { return assertDbAvailable(); },
    beforeAll: async function () {
      await knexCleanUsers();
      for (var u of [USER, OTHER_USER]) {
        await knex('users').where('id', u).del();
      }
      await knex('users').insert(__stampFixture({
        id: USER, email: USER_A_EMAIL, name: USER,
        timezone: 'America/New_York',
        created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date()
      }));
      await knex('users').insert(__stampFixture({
        id: OTHER_USER, email: USER_B_EMAIL, name: OTHER_USER,
        timezone: 'America/New_York',
        created_at: new Date('2026-02-01T00:00:00Z'), updated_at: new Date()
      }));
    },
    afterAll: async function () {
      await knexCleanUsers();
      for (var u of [USER, OTHER_USER]) {
        await knex('users').where('id', u).del();
      }
      await knex.destroy();
    },
    makeRepo: async function () {
      await knexCleanUsers();
      return new KnexConfigRepository({ db: knex });
    },
    // For the Knex leg, insert real task rows via tasks-write (so tasks_v reflects them).
    seedTasks: async function (_repo, rows) {
      for (var r of rows) {
        await tasksWrite.insertTask(knex, Object.assign({
          created_at: new Date(), updated_at: new Date()
        }, r));
      }
    }
  }
};

function taskRow(overrides) {
  var { v7: uuidv7 } = require('uuid');
  return Object.assign({
    id: uuidv7(),
    user_id: USER,
    text: 'task',
    task_type: 'task',
    dur: 30,
    pri: 'P3',
    status: '',
    recurring: 0
  }, overrides);
}

// ── The parameterized contract ───────────────────────────────────────────────

Object.keys(ADAPTERS).forEach(function (name) {
  var A = ADAPTERS[name];

  describe('ConfigRepositoryPort contract — ' + name, function () {
    beforeAll(async function () {
      await A.available();   // fail-loud if the Knex DB is down (TEST-FR-001)
      await A.beforeAll();
    }, 20000);

    afterAll(async function () {
      await A.afterAll();
    }, 20000);

    // ── Port conformance ──────────────────────────────────────────────────────
    test('implements every CONFIG_REPOSITORY_PORT_METHODS member', async function () {
      var repo = await A.makeRepo();
      CONFIG_REPOSITORY_PORT_METHODS.forEach(function (m) {
        expect(typeof repo[m]).toBe('function');
      });
    });

    // ── user_config: upsert → get round-trip ─────────────────────────────────
    test('upsertConfig inserts then getUserConfig returns a UserConfig entity', async function () {
      var repo = await A.makeRepo();
      await repo.upsertConfig(USER, 'preferences', JSON.stringify({ gridZoom: 60 }));

      var cfg = await repo.getUserConfig(USER, 'preferences');
      expect(cfg).not.toBeNull();
      expect(cfg instanceof UserConfig).toBe(true);
      expect(cfg.userId).toBe(USER);
      expect(cfg.configKey).toBe('preferences');
      expect(cfg.parsedValue()).toEqual({ gridZoom: 60 });
    });

    test('getUserConfig resolves null for an unknown key', async function () {
      var repo = await A.makeRepo();
      expect(await repo.getUserConfig(USER, 'time_blocks')).toBeNull();
    });

    test('getConfigRow resolves null for an unknown key, raw row otherwise', async function () {
      var repo = await A.makeRepo();
      expect(await repo.getConfigRow(USER, 'time_blocks')).toBeNull();
      await repo.upsertConfig(USER, 'time_blocks', JSON.stringify({ Mon: [1] }));
      var row = await repo.getConfigRow(USER, 'time_blocks');
      expect(row).not.toBeNull();
      expect(row.config_key).toBe('time_blocks');
      // config_value is a JSON string (InMemory) or a parsed object (MySQL json
      // column) — both round-trip to the same value via the legacy passthrough.
      expect(UserConfig.fromRow(row).parsedValue()).toEqual({ Mon: [1] });
    });

    test('upsertConfig UPDATEs an existing row (not a duplicate)', async function () {
      var repo = await A.makeRepo();
      await repo.upsertConfig(USER, 'preferences', JSON.stringify({ a: 1 }));
      await repo.upsertConfig(USER, 'preferences', JSON.stringify({ a: 2 }));
      var rows = await repo.getConfigRows(USER);
      var prefs = rows.filter(function (r) { return r.config_key === 'preferences'; });
      expect(prefs.length).toBe(1);
      // config_value may be a JSON string (InMemory / legacy write) OR an already-
      // parsed object (MySQL `json` column round-trip). UserConfig.parsedValue()
      // reproduces the legacy `typeof === 'string' ? JSON.parse : value` passthrough,
      // so the assertion is adapter-agnostic.
      expect(UserConfig.fromRow(prefs[0]).parsedValue()).toEqual({ a: 2 });
    });

    test('getConfigRows is tenancy-scoped', async function () {
      var repo = await A.makeRepo();
      await repo.upsertConfig(USER, 'preferences', JSON.stringify({ a: 1 }));
      await repo.upsertConfig(OTHER_USER, 'preferences', JSON.stringify({ a: 9 }));
      var rows = await repo.getConfigRows(USER);
      expect(rows.length).toBe(1);
      expect(rows[0].user_id).toBe(USER);
    });

    // ── P1: upsertConfig UPDATE stamps a JS Date updated_at ───────────────────
    test('P1: upsertConfig UPDATE stamps updated_at as a real JS Date (never fn.now())', async function () {
      var repo = await A.makeRepo();
      await repo.upsertConfig(USER, 'preferences', JSON.stringify({ a: 1 }));
      await repo.upsertConfig(USER, 'preferences', JSON.stringify({ a: 2 })); // UPDATE path
      var row = await repo.getConfigRow(USER, 'preferences');
      // updated_at round-trips to a parseable real timestamp (a fn.now() raw would not store a real value here).
      var parsed = new Date(row.updated_at);
      expect(isNaN(parsed.getTime())).toBe(false);
    });

    // ── P1: updateProjectById rejects a non-Date updated_at (fail-loud) ───────
    test('P1: updateProjectById rejects a non-Date updated_at (fail-loud guard)', async function () {
      var repo = await A.makeRepo();
      var id = await repo.insertProject(USER, { name: 'P', color: null, icon: null, sort_order: 1 });
      await expect(Promise.resolve().then(function () {
        return repo.updateProjectById(USER, id, { name: 'P2', updated_at: 'MOCK_NOW' });
      })).rejects.toThrow(/INVARIANT P1/);
    });

    test('P1: insertImpersonationLog rejects a non-Date created_at (fail-loud guard)', async function () {
      var repo = await A.makeRepo();
      await expect(Promise.resolve().then(function () {
        return repo.insertImpersonationLog({
          admin_user_id: USER, target_user_id: OTHER_USER, action: 'start_impersonation',
          ip_address: '127.0.0.1', user_agent: 'jest',
          created_at: 'not-a-date', updated_at: new Date()
        });
      })).rejects.toThrow(/INVARIANT P1/);
    });

    // ── PROJECTS CRUD ─────────────────────────────────────────────────────────
    test('insertProject returns an id; getProjects orders by sort_order', async function () {
      var repo = await A.makeRepo();
      var id2 = await repo.insertProject(USER, { name: 'B', color: null, icon: null, sort_order: 2 });
      var id1 = await repo.insertProject(USER, { name: 'A', color: 'red', icon: null, sort_order: 1 });
      expect(id1 != null).toBe(true);
      expect(id2 != null).toBe(true);
      var projects = await repo.getProjects(USER);
      expect(projects.map(function (p) { return p.name; })).toEqual(['A', 'B']);
    });

    test('getMaxProjectSortOrder returns the max (null when none)', async function () {
      var repo = await A.makeRepo();
      expect(await repo.getMaxProjectSortOrder(USER)).toBeNull();
      await repo.insertProject(USER, { name: 'A', color: null, icon: null, sort_order: 3 });
      await repo.insertProject(USER, { name: 'B', color: null, icon: null, sort_order: 7 });
      expect(await repo.getMaxProjectSortOrder(USER)).toBe(7);
    });

    test('updateProjectById updates only the owner row; deleteProjectById removes it', async function () {
      var repo = await A.makeRepo();
      var id = await repo.insertProject(USER, { name: 'orig', color: null, icon: null, sort_order: 1 });

      // Wrong user cannot update.
      var n0 = await repo.updateProjectById(OTHER_USER, id, { name: 'hacked' });
      expect(n0).toBe(0);

      var n1 = await repo.updateProjectById(USER, id, { name: 'renamed', color: 'blue', icon: 'x' });
      expect(n1).toBe(1);
      var projects = await repo.getProjects(USER);
      expect(projects[0].name).toBe('renamed');

      // Wrong user cannot delete.
      expect(await repo.deleteProjectById(OTHER_USER, id)).toBe(0);
      expect(await repo.deleteProjectById(USER, id)).toBe(1);
      expect((await repo.getProjects(USER)).length).toBe(0);
    });

    // ── F2: P1 auto-stamp direct read-back ───────────────────────────────────
    // updateProjectById omits updated_at from `changes` → the adapter auto-stamps
    // it as new Date(). This test reads the row back and asserts the stamp is a real
    // parseable timestamp on BOTH adapters.
    //
    // NOTE: Knex is configured with `dateStrings: true` globally, so MySQL returns
    // date columns as strings (e.g. "2026-06-10 23:00:00"). The InMemory adapter
    // stores a JS Date. The test uses `new Date(value)` + isNaN to remain
    // adapter-agnostic — a missing/undefined/fn.now()-raw would fail to parse.
    //
    // Self-mutation proof: disabling the auto-stamp line (`c.updated_at = new Date()`
    // in InMemory / `withTimestamp` in Knex) makes updated_at undefined (no column
    // default for the UPDATE path in Knex, none set in InMemory either), causing
    // `new Date(undefined)` = Invalid Date → isNaN → test FAILS.
    test('P1: updateProjectById auto-stamps updated_at as a parseable timestamp when omitted from changes', async function () {
      var repo = await A.makeRepo();
      var id = await repo.insertProject(USER, { name: 'P1-stamp-test', color: null, icon: null, sort_order: 99 });
      // Pass changes WITHOUT updated_at — auto-stamp path.
      await repo.updateProjectById(USER, id, { name: 'P1-stamp-renamed' });
      var projects = await repo.getProjects(USER);
      var found = projects.find(function (p) { return String(p.id) === String(id); });
      expect(found).toBeDefined();
      expect(found.name).toBe('P1-stamp-renamed');
      // updated_at must be a real parseable timestamp (not undefined, not null, not a Knex raw).
      // dateStrings:true → Knex returns a string; InMemory returns a Date — both parse to a valid Date.
      expect(found.updated_at).not.toBeUndefined();
      expect(found.updated_at).not.toBeNull();
      var parsed = new Date(found.updated_at);
      expect(isNaN(parsed.getTime())).toBe(false);
    });

    test('reorderProjects applies new sort_order via CASE over the id set', async function () {
      var repo = await A.makeRepo();
      var idA = await repo.insertProject(USER, { name: 'A', color: null, icon: null, sort_order: 0 });
      var idB = await repo.insertProject(USER, { name: 'B', color: null, icon: null, sort_order: 1 });
      var idC = await repo.insertProject(USER, { name: 'C', color: null, icon: null, sort_order: 2 });
      // New order: C(0), A(1), B(2)
      await repo.reorderProjects(USER, [[idC, 0], [idA, 1], [idB, 2]]);
      var projects = await repo.getProjects(USER);
      expect(projects.map(function (p) { return p.name; })).toEqual(['C', 'A', 'B']);
    });

    // ── LOCATIONS replace-all ─────────────────────────────────────────────────
    test('replaceLocations replaces the whole set (inside a transaction)', async function () {
      var repo = await A.makeRepo();
      await repo.runInTransaction(function (trxRepo) {
        return trxRepo.replaceLocations(USER, [
          { user_id: USER, location_id: 'home', name: 'Home', icon: '', sort_order: 0 },
          { user_id: USER, location_id: 'work', name: 'Work', icon: '', sort_order: 1 }
        ]);
      });
      var locs = await repo.getLocations(USER);
      expect(locs.map(function (l) { return l.location_id; })).toEqual(['home', 'work']);

      // Replace again with fewer — the old set is gone.
      await repo.runInTransaction(function (trxRepo) {
        return trxRepo.replaceLocations(USER, [
          { user_id: USER, location_id: 'gym', name: 'Gym', icon: '', sort_order: 0 }
        ]);
      });
      var locs2 = await repo.getLocations(USER);
      expect(locs2.map(function (l) { return l.location_id; })).toEqual(['gym']);
    });

    test('replaceLocations with empty array clears the set', async function () {
      var repo = await A.makeRepo();
      await repo.runInTransaction(function (trxRepo) {
        return trxRepo.replaceLocations(USER, [
          { user_id: USER, location_id: 'home', name: 'Home', icon: '', sort_order: 0 }
        ]);
      });
      await repo.runInTransaction(function (trxRepo) {
        return trxRepo.replaceLocations(USER, []);
      });
      expect((await repo.getLocations(USER)).length).toBe(0);
    });

    // ── TOOLS replace-all ─────────────────────────────────────────────────────
    test('replaceTools replaces the whole set (inside a transaction)', async function () {
      var repo = await A.makeRepo();
      await repo.runInTransaction(function (trxRepo) {
        return trxRepo.replaceTools(USER, [
          { user_id: USER, tool_id: 'laptop', name: 'Laptop', icon: '', sort_order: 0 }
        ]);
      });
      var tools = await repo.getTools(USER);
      expect(tools.map(function (t) { return t.tool_id; })).toEqual(['laptop']);
    });

    // ── ENTITY-LIMIT COUNTS ───────────────────────────────────────────────────
    test('countActiveTasks counts active, non-recurring_template tasks', async function () {
      var repo = await A.makeRepo();
      await A.seedTasks(repo, [
        taskRow({ status: '', task_type: 'task' }),                 // active
        taskRow({ status: 'wip', task_type: 'task' }),              // active
        taskRow({ status: 'done', task_type: 'task', scheduled_at: '2026-04-01 10:00:00' }),             // inactive — excluded
        taskRow({ status: '', task_type: 'recurring_template' }),   // excluded (template)
        taskRow({ status: '', task_type: 'task', user_id: OTHER_USER }) // other tenant
      ]);
      expect(await repo.countActiveTasks(USER)).toBe(2);
    });

    test('countRecurringTemplates reproduces the legacy 0-count (tasks_v nulls template status)', async function () {
      var repo = await A.makeRepo();
      // CHARACTERIZED LEGACY QUIRK (byte-identical, NOT a fix): the tasks_v view's
      // recurring_template branch hardcodes status to NULL (CONVERT(NULL ...) AS status).
      // The legacy countRecurringTemplates does whereNotIn('status', INACTIVE), and
      // `NULL NOT IN (…)` evaluates to NULL → the row is EXCLUDED. So the count is
      // ALWAYS 0 for templates regardless of their stored status. Verified against
      // test-bed tasks_v. Both adapters must agree on this 0.
      await A.seedTasks(repo, [
        taskRow({ status: 'wip', task_type: 'recurring_template', recurring: 1 }),
        taskRow({ status: 'wip', task_type: 'recurring_template', recurring: 1 }),
        taskRow({ status: 'cancel', task_type: 'recurring_template', recurring: 1 }),
        taskRow({ status: 'wip', task_type: 'task' }) // not a template
      ]);
      expect(await repo.countRecurringTemplates(USER)).toBe(0);
    });

    test('countProjects / countLocations are tenancy-scoped row counts', async function () {
      var repo = await A.makeRepo();
      await repo.insertProject(USER, { name: 'A', color: null, icon: null, sort_order: 0 });
      await repo.insertProject(USER, { name: 'B', color: null, icon: null, sort_order: 1 });
      await repo.insertProject(OTHER_USER, { name: 'X', color: null, icon: null, sort_order: 0 });
      expect(await repo.countProjects(USER)).toBe(2);

      await repo.replaceLocations(USER, [
        { user_id: USER, location_id: 'home', name: 'Home', icon: '', sort_order: 0 }
      ]);
      expect(await repo.countLocations(USER)).toBe(1);
    });

    // ── ORPHAN WHEN-TAGS read ─────────────────────────────────────────────────
    test('getActiveWhenTaggedTasks returns active tasks with a real when tag only', async function () {
      var repo = await A.makeRepo();
      await A.seedTasks(repo, [
        taskRow({ status: '', when: 'morning' }),       // included
        taskRow({ status: 'wip', when: 'evening' }),    // included
        taskRow({ status: 'done', when: 'morning', scheduled_at: '2026-04-01 10:00:00' }),   // excluded (done)
        taskRow({ status: '', when: 'anytime' }),       // excluded (anytime)
        taskRow({ status: '', when: '' }),              // excluded (empty)
        taskRow({ status: '', when: null })             // excluded (null)
      ]);
      var rows = await repo.getActiveWhenTaggedTasks(USER);
      expect(rows.length).toBe(2);
      rows.forEach(function (r) {
        expect(r).toHaveProperty('id');
        expect(r).toHaveProperty('text');
        expect(r).toHaveProperty('when');
      });
      expect(rows.map(function (r) { return r.when; }).sort()).toEqual(['evening', 'morning']);
    });

    // ── DATA IMPORT: clearUserConfigTables ────────────────────────────────────
    test('clearUserConfigTables wipes user_config/tools/locations/projects for the user only', async function () {
      var repo = await A.makeRepo();
      await repo.upsertConfig(USER, 'preferences', JSON.stringify({ a: 1 }));
      await repo.insertProject(USER, { name: 'A', color: null, icon: null, sort_order: 0 });
      await repo.replaceLocations(USER, [{ user_id: USER, location_id: 'home', name: 'Home', icon: '', sort_order: 0 }]);
      await repo.replaceTools(USER, [{ user_id: USER, tool_id: 'laptop', name: 'Laptop', icon: '', sort_order: 0 }]);
      // Other tenant has its own config that must survive.
      await repo.upsertConfig(OTHER_USER, 'preferences', JSON.stringify({ a: 9 }));

      await repo.runInTransaction(function (trxRepo) {
        return trxRepo.clearUserConfigTables(USER);
      });

      expect((await repo.getConfigRows(USER)).length).toBe(0);
      expect((await repo.getProjects(USER)).length).toBe(0);
      expect((await repo.getLocations(USER)).length).toBe(0);
      expect((await repo.getTools(USER)).length).toBe(0);
      // Other tenant untouched.
      expect((await repo.getConfigRows(OTHER_USER)).length).toBe(1);
    });

    test('insertConfigRows / insertLocations / insertTools / insertProjects bulk-insert', async function () {
      var repo = await A.makeRepo();
      await repo.insertConfigRows(USER, [
        { user_id: USER, config_key: 'tool_matrix', config_value: JSON.stringify({}) },
        { user_id: USER, config_key: 'time_blocks', config_value: JSON.stringify({}) }
      ]);
      await repo.insertLocations(USER, [{ user_id: USER, location_id: 'home', name: 'Home', icon: '', sort_order: 0 }]);
      await repo.insertTools(USER, [{ user_id: USER, tool_id: 'laptop', name: 'Laptop', icon: '', sort_order: 0 }]);
      await repo.insertProjects(USER, [{ user_id: USER, name: 'Imported', color: null, icon: null, sort_order: 0 }]);

      expect((await repo.getConfigRows(USER)).length).toBe(2);
      expect((await repo.getLocations(USER)).length).toBe(1);
      expect((await repo.getTools(USER)).length).toBe(1);
      expect((await repo.getProjects(USER)).length).toBe(1);
    });

    // ── IMPERSONATION ─────────────────────────────────────────────────────────
    test('insertImpersonationLog + listImpersonationLog (admin-email join, desc order)', async function () {
      var repo = await A.makeRepo();
      await repo.insertImpersonationLog({
        admin_user_id: USER, target_user_id: OTHER_USER, action: 'start_impersonation',
        ip_address: '127.0.0.1', user_agent: 'jest',
        created_at: new Date('2026-06-01T00:00:00Z'), updated_at: new Date('2026-06-01T00:00:00Z')
      });
      await repo.insertImpersonationLog({
        admin_user_id: USER, target_user_id: null, action: 'stop_impersonation',
        ip_address: '127.0.0.1', user_agent: 'jest',
        created_at: new Date('2026-06-02T00:00:00Z'), updated_at: new Date('2026-06-02T00:00:00Z')
      });

      var res = await repo.listImpersonationLog({ limit: 50, offset: 0 });
      expect(res.total).toBe(2);
      expect(res.logs.length).toBe(2);
      // created_at desc — stop (Jun 2) before start (Jun 1).
      expect(res.logs[0].action).toBe('stop_impersonation');
      expect(res.logs[1].action).toBe('start_impersonation');
      // admin email joined.
      expect(res.logs[0].admin_email).toBe(USER_A_EMAIL);
    });

    test('listImpersonationLog filters by adminUserId / targetUserId', async function () {
      var repo = await A.makeRepo();
      await repo.insertImpersonationLog({
        admin_user_id: USER, target_user_id: OTHER_USER, action: 'start_impersonation',
        ip_address: '1.1.1.1', user_agent: 'jest', created_at: new Date(), updated_at: new Date()
      });
      await repo.insertImpersonationLog({
        admin_user_id: OTHER_USER, target_user_id: USER, action: 'start_impersonation',
        ip_address: '1.1.1.1', user_agent: 'jest', created_at: new Date(), updated_at: new Date()
      });
      var byAdmin = await repo.listImpersonationLog({ limit: 50, offset: 0, adminUserId: USER });
      expect(byAdmin.total).toBe(1);
      expect(byAdmin.logs[0].admin_user_id).toBe(USER);

      var byTarget = await repo.listImpersonationLog({ limit: 50, offset: 0, targetUserId: USER });
      expect(byTarget.total).toBe(1);
      expect(byTarget.logs[0].target_user_id).toBe(USER);
    });

    test('listImpersonationTargets searches email + paginates with a total', async function () {
      var repo = await A.makeRepo();
      var all = await repo.listImpersonationTargets({ limit: 50, offset: 0 });
      expect(all.total).toBeGreaterThanOrEqual(2);
      expect(all.users.some(function (u) { return u.email === USER_A_EMAIL; })).toBe(true);

      // Search narrows to user A's email.
      var searched = await repo.listImpersonationTargets({ search: USER, limit: 50, offset: 0 });
      expect(searched.total).toBe(1);
      expect(searched.users[0].email).toBe(USER_A_EMAIL);
    });

    // ── TRANSACTIONS: commit / rollback ───────────────────────────────────────
    test('runInTransaction COMMITS when work resolves', async function () {
      var repo = await A.makeRepo();
      await repo.runInTransaction(function (trxRepo) {
        return trxRepo.upsertConfig(USER, 'preferences', JSON.stringify({ committed: true }));
      });
      var cfg = await repo.getUserConfig(USER, 'preferences');
      expect(cfg).not.toBeNull();
      expect(cfg.parsedValue()).toEqual({ committed: true });
    });

    test('runInTransaction ROLLS BACK when work rejects', async function () {
      var repo = await A.makeRepo();
      var err = null;
      try {
        await repo.runInTransaction(async function (trxRepo) {
          await trxRepo.upsertConfig(USER, 'preferences', JSON.stringify({ rolled: 'back' }));
          await trxRepo.insertProject(USER, { name: 'ghost', color: null, icon: null, sort_order: 0 });
          throw new Error('boom — force rollback');
        });
      } catch (e) { err = e; }
      expect(err).not.toBeNull();
      expect(err.message).toMatch(/boom/);
      // Neither the config write nor the project insert is visible after rollback.
      expect(await repo.getUserConfig(USER, 'preferences')).toBeNull();
      expect((await repo.getProjects(USER)).length).toBe(0);
    });

    test('runInTransaction trxRepo sees its own uncommitted writes (read-after-write in trx)', async function () {
      var repo = await A.makeRepo();
      var seenInside = await repo.runInTransaction(async function (trxRepo) {
        await trxRepo.upsertConfig(USER, 'preferences', JSON.stringify({ x: 1 }));
        return trxRepo.getUserConfig(USER, 'preferences');
      });
      expect(seenInside).not.toBeNull();
      expect(seenInside.parsedValue()).toEqual({ x: 1 });
    });
  });
});
