/**
 * RED regression tests — jug-sched-rerun-on-settings (999.464)
 *
 * Step 0: FAILING tests that reproduce each scheduling-trigger gap.
 * These must FAIL against current (pre-fix) code and PASS after bert's fix.
 *
 * ACs covered:
 *   AC1 — UpdateConfig: template_defaults / template_overrides missing from SCHED_KEYS
 *   AC2 — ReplaceLocations: no scheduleAfter returned on success; none on 400
 *   AC3 — ImportData: exactly-one trigger on success; none on rollback
 *   AC4 — MCP update_config: template/schedule keys must trigger; non-sched keys must not
 *   AC5 — ReplaceTools: deliberate no-op investigation + documentation
 *   AC6 — Invariant E-1: EventBusTaskEvents does NOT call enqueueScheduleRun
 *
 * Style mirrors configUseCases.test.js: pure unit tests, InMemoryConfigRepository,
 * fake cache + collaborator doubles, no DB needed.
 */

'use strict';

var path = require('path');
var SLICE = path.join(__dirname, '..', '..', '..', '..', 'src', 'slices', 'user-config');
var InMemoryConfigRepository = require(path.join(SLICE, 'adapters', 'InMemoryConfigRepository'));
var App = require(path.join(SLICE, 'application'));

function fakeCache() {
  return {
    _calls: { invalidateConfig: [] },
    invalidateConfig: function (u) { this._calls.invalidateConfig.push(u); return Promise.resolve(true); }
  };
}

var USER = 'sched-rerun-user';

// ── AC1 — UpdateConfig: template_defaults / template_overrides must fire scheduleAfter ─────
describe('AC1: UpdateConfig — template_defaults / template_overrides missing from SCHED_KEYS [BUG-1 / 999.464]', () => {
  /**
   * VALID_KEYS includes 'template_defaults' and 'template_overrides' (UserConfig.js:39).
   * SCHED_KEYS (UpdateConfig.js:47) does NOT include either. Therefore executing
   * UpdateConfig with key='template_defaults' or key='template_overrides' will write
   * the config successfully but return NO scheduleAfter directive, leaving scheduled
   * tasks stale.
   *
   * Expected (after fix): scheduleAfter === { userId, source: 'config:<key>' }
   * Current (pre-fix):    scheduleAfter === undefined   ← RED
   */
  test('AC1a: template_defaults MUST return a scheduleAfter directive (currently absent — RED)', async () => {
    var uc = new App.UpdateConfig({ repo: new InMemoryConfigRepository(), cache: fakeCache() });
    var res = await uc.execute({ userId: USER, key: 'template_defaults', value: { default: 'weekday' } });
    // After the fix this must pass. Pre-fix: scheduleAfter is undefined → test FAILS.
    expect(res.status).toBe(200);
    expect(res.scheduleAfter).toEqual({ userId: USER, source: 'config:template_defaults' });
  });

  test('AC1b: template_overrides MUST return a scheduleAfter directive (currently absent — RED)', async () => {
    var uc = new App.UpdateConfig({ repo: new InMemoryConfigRepository(), cache: fakeCache() });
    var res = await uc.execute({ userId: USER, key: 'template_overrides', value: { '2026-06-14': 'weekend' } });
    // After the fix this must pass. Pre-fix: scheduleAfter is undefined → test FAILS.
    expect(res.status).toBe(200);
    expect(res.scheduleAfter).toEqual({ userId: USER, source: 'config:template_overrides' });
  });

  test('AC1c: existing schedule keys still produce scheduleAfter (non-regression)', async () => {
    // Ensure the fix does not break already-working keys.
    var uc = new App.UpdateConfig({ repo: new InMemoryConfigRepository(), cache: fakeCache() });
    for (var key of ['time_blocks', 'loc_schedules', 'loc_schedule_defaults', 'loc_schedule_overrides',
                     'hour_location_overrides', 'tool_matrix', 'preferences', 'schedule_templates']) {
      var res = await uc.execute({ userId: USER, key: key, value: {} });
      expect(res.scheduleAfter).toEqual({ userId: USER, source: 'config:' + key });
    }
  });

  test('AC1d: non-schedule key (temp_unit_pref) still has NO scheduleAfter (non-regression)', async () => {
    var uc = new App.UpdateConfig({ repo: new InMemoryConfigRepository(), cache: fakeCache() });
    var res = await uc.execute({ userId: USER, key: 'temp_unit_pref', value: 'C' });
    expect(res.scheduleAfter).toBeUndefined();
  });

  test('AC1e: SCHED_KEYS array exported from UpdateConfig includes template_defaults (currently absent — RED)', () => {
    // Belt-and-suspenders: pin the constant itself so a fix that returns scheduleAfter
    // by other means is caught if it forgets to update the array.
    var SCHED_KEYS = App.UpdateConfig.SCHED_KEYS;
    expect(SCHED_KEYS).toContain('template_defaults');
    expect(SCHED_KEYS).toContain('template_overrides');
  });
});

// ── AC2 — ReplaceLocations must return scheduleAfter on success; NOT on 400 ────────────────
describe('AC2: ReplaceLocations — no scheduleAfter directive returned [BUG-2]', () => {
  /**
   * ReplaceLocations writes location rows (location scheduling inputs). Replacing
   * locations changes which weather data the scheduler fetches and which
   * loc_schedule entries apply. The use-case currently returns { status: 200, body }
   * with no scheduleAfter → scheduler never re-runs. After the fix a successful
   * replace must yield scheduleAfter.
   */
  function okParse(body) {
    return { success: true, data: { locations: body.locations } };
  }

  test('AC2a: successful ReplaceLocations MUST return scheduleAfter (currently absent — RED)', async () => {
    var repo = new InMemoryConfigRepository();
    var uc = new App.ReplaceLocations({
      repo: repo,
      cache: fakeCache(),
      parseBody: okParse,
      reverseGeocode: function () { return Promise.resolve('City'); }
    });
    var res = await uc.execute({
      userId: USER,
      body: { locations: [{ id: 'l1', name: 'Home', lat: 37.7, lon: -122.4 }] }
    });
    // After fix: scheduleAfter present. Pre-fix: undefined → RED.
    expect(res.status).toBe(200);
    expect(res.scheduleAfter).toEqual({ userId: USER, source: 'locations:replaced' });
  });

  test('AC2b: 400 (invalid payload) must NOT return scheduleAfter', async () => {
    var uc = new App.ReplaceLocations({
      repo: new InMemoryConfigRepository(),
      cache: fakeCache(),
      parseBody: function () { return { success: false, error: { issues: [{ path: ['name'] }] } }; },
      reverseGeocode: function () { return Promise.resolve('x'); }
    });
    var res = await uc.execute({ userId: USER, body: {} });
    expect(res.status).toBe(400);
    // This must hold both pre-fix and post-fix. Guards must not trigger on error path.
    expect(res.scheduleAfter).toBeUndefined();
  });

  test('AC2c: ReplaceLocations with empty locations array still triggers (scheduling inputs changed)', async () => {
    // Clearing all locations is still a change to scheduling inputs.
    var repo = new InMemoryConfigRepository({
      locations: [{ user_id: USER, location_id: 'l1', name: 'Old', sort_order: 0 }]
    });
    var uc = new App.ReplaceLocations({
      repo: repo,
      cache: fakeCache(),
      parseBody: function () { return { success: true, data: { locations: [] } }; },
      reverseGeocode: function () { return Promise.resolve(''); }
    });
    var res = await uc.execute({ userId: USER, body: { locations: [] } });
    expect(res.status).toBe(200);
    // After fix: scheduleAfter present even for empty-list replace. Pre-fix: undefined → RED.
    expect(res.scheduleAfter).toBeDefined();
    expect(res.scheduleAfter).toMatchObject({ userId: USER });
  });
});

// ── AC3 — ImportData: exactly-one trigger on success; none on rollback ───────────────────
describe('AC3: ImportData — no scheduleAfter and no trigger on success or rollback [BUG-3]', () => {
  /**
   * ImportData wipes and re-inserts tool_matrix, time_blocks, loc_schedules,
   * loc_schedule_defaults, loc_schedule_overrides, hour_location_overrides, and
   * locations — ALL schedule-affecting keys — in a single transaction. No
   * scheduleAfter directive is returned. After the fix:
   *   - success: exactly ONE scheduleAfter (not one per config key; the entire
   *     import is one logical mutation).
   *   - rollback: NO scheduleAfter.
   */
  function deps(repo, calls) {
    return {
      repo: repo,
      wipeTasks: function (trxRepo, uid) { calls.wipe.push(uid); return Promise.resolve(); },
      insertTask: function (trxRepo, row) { calls.tasks.push(row); return Promise.resolve(); },
      buildTaskRow: function (t, uid) { return { id: t.id, user_id: uid }; }
    };
  }

  test('AC3a: successful import MUST return exactly one scheduleAfter (currently absent — RED)', async () => {
    var calls = { wipe: [], tasks: [] };
    var repo = new InMemoryConfigRepository();
    var uc = new App.ImportData(deps(repo, calls));
    var res = await uc.execute({
      userId: USER,
      confirm: 'delete_all',
      data: {
        extraTasks: [{ id: 't1', text: 'Task 1' }],
        locations: [{ id: 'l1', name: 'Home' }],
        timeBlocks: { morning: { start: 480, end: 720 } },
        toolMatrix: { 'l1': ['t1'] }
      }
    });
    expect(res.status).toBe(200);
    // After fix: exactly one scheduleAfter. Pre-fix: undefined → RED.
    expect(res.scheduleAfter).toBeDefined();
    expect(res.scheduleAfter).toMatchObject({ userId: USER });
    // Must be exactly ONE directive (not one per config key written)
    // The directive itself is a single object, not an array.
    expect(Array.isArray(res.scheduleAfter)).toBe(false);
  });

  test('AC3b: failed import (insertTask throws) rejects — transaction rolls back (no-trigger-on-rollback proved at controller layer by CF-ID-4)', async () => {
    /**
     * This test proves the USE-CASE rejects when insertTask throws (transaction rolled back).
     * It does NOT inspect scheduleAfter because the promise rejects before any directive
     * can be returned — the rejection IS the proof that no trigger occurs at the use-case level.
     *
     * The no-trigger-on-rollback invariant at the CONTROLLER layer is proved separately by
     * CF-ID-4 (controllerFire.regression.test.js), which is mutation-verified and carries
     * the explicit `enqueueScheduleRun` call-count assertion. Do not rely on this test for
     * the controller-fire guarantee — see CF-ID-4.
     */
    var repo = new InMemoryConfigRepository({
      config: [{ user_id: USER, config_key: 'preferences', config_value: '{"gridZoom":60}' }]
    });
    var d = {
      repo: repo,
      wipeTasks: function () { return Promise.resolve(); },
      insertTask: function () { return Promise.reject(new Error('insert boom')); },
      buildTaskRow: function (t) { return { id: t.id }; }
    };
    var uc = new App.ImportData(d);
    // The import rejects (transaction rolled back) — rejection propagation is the assertion.
    await expect(uc.execute({
      userId: USER,
      confirm: 'delete_all',
      data: { extraTasks: [{ id: 't1' }] }
    })).rejects.toThrow(/insert boom/);
  });

  test('AC3c: 400 invalid shape must NOT return scheduleAfter', async () => {
    var calls = { wipe: [], tasks: [] };
    var repo = new InMemoryConfigRepository();
    var res = await new App.ImportData(deps(repo, calls)).execute({
      userId: USER,
      confirm: 'delete_all',
      data: { notExtraTasks: [] }
    });
    expect(res.status).toBe(400);
    expect(res.scheduleAfter).toBeUndefined();
  });

  test('AC3d: 400 missing confirm must NOT return scheduleAfter', async () => {
    var calls = { wipe: [], tasks: [] };
    var repo = new InMemoryConfigRepository();
    var res = await new App.ImportData(deps(repo, calls)).execute({
      userId: USER,
      confirm: undefined,
      data: { extraTasks: [] }
    });
    expect(res.status).toBe(400);
    expect(res.scheduleAfter).toBeUndefined();
  });
});

// ── AC4 — MCP update_config key enum vs REST SCHED_KEYS parity ───────────────────────────
//
// Helper: call registerConfigTools against a fake server that captures every registered
// tool's name + inputSchema. Returns a map { toolName → { inputSchema, handler } }.
// Mocks db/redis/tasks-write so the module loads without real infrastructure.
//
// The original AC4a/b/c/d tests asserted on SOURCE TEXT via regex against a hardcoded
// z.enum([...]) literal. After bert's refactor the enum is COMPUTED from
// UpdateConfig.SCHED_KEYS (z.enum(schedKeys.slice())), so the literal no longer exists
// and the regex found null — causing false failures. These rewrites assert RUNTIME
// BEHAVIOR via safeParse: the tool actually ACCEPTS the key or REJECTS it at runtime,
// regardless of how the enum is constructed in source.
function buildFakeMcpServer() {
  var registeredTools = {};
  return {
    _tools: registeredTools,
    tool: function(name, _description, inputSchema, handler) {
      registeredTools[name] = { inputSchema: inputSchema, handler: handler };
    }
  };
}

// Returns the Zod schema for the 'key' parameter of update_config by loading
// registerConfigTools with a fake server (mocking DB/redis/tasks-write with no-ops).
function getUpdateConfigKeySchema() {
  // Jest module registry isolation: use jest.isolateModules so each call gets
  // a fresh require without cross-test caching, and without polluting the global registry.
  var keySchema = null;
  jest.isolateModules(function() {
    // Provide minimal stubs for the I/O modules config.js requires at load time.
    // These stubs never execute (we only register tools, not call handlers).
    jest.mock(path.join(__dirname, '..', '..', '..', '..', 'src', 'db'), function() {
      var knexStub = function() { return knexStub; };
      knexStub.fn = { now: function() { return new Date(); } };
      knexStub.transaction = function() { return Promise.resolve(); };
      return knexStub;
    });
    jest.mock(path.join(__dirname, '..', '..', '..', '..', 'src', 'lib', 'redis'), function() {
      return { invalidateConfig: function() { return Promise.resolve(true); } };
    });
    jest.mock(path.join(__dirname, '..', '..', '..', '..', 'src', 'lib', 'tasks-write'), function() {
      return { updateTasksWhere: function() { return Promise.resolve(); } };
    });
    jest.mock(path.join(__dirname, '..', '..', '..', '..', 'src', 'scheduler', 'scheduleQueue'), function() {
      return { enqueueScheduleRun: function() { return Promise.resolve(); } };
    });
    var registerConfigTools = require(path.join(
      __dirname, '..', '..', '..', '..', 'src', 'mcp', 'tools', 'config'
    )).registerConfigTools;
    var fakeServer = buildFakeMcpServer();
    registerConfigTools(fakeServer, 'ac4-test-user');
    keySchema = fakeServer._tools['update_config'].inputSchema.key;
  });
  return keySchema;
}

describe('AC4: MCP update_config — runtime key acceptance must match REST SCHED_KEYS [BUG-4]', () => {
  /**
   * BUG-4: the MCP update_config tool's accepted key set was hardcoded and diverged
   * from UpdateConfig.SCHED_KEYS. After bert's fix the enum is COMPUTED from
   * UpdateConfig.SCHED_KEYS (z.enum(schedKeys.slice())), so the accepted set cannot
   * drift from the REST path without a code change.
   *
   * These tests assert RUNTIME BEHAVIOR — the tool's zod schema actually accepts or
   * rejects a key when called — not source-text structure. AC4a/b/c confirm the three
   * previously-missing keys are accepted at runtime; AC4d confirms the full accepted set
   * equals UpdateConfig.SCHED_KEYS (the drift-prevention pin).
   *
   * A non-schedule config key ('some_other_key') must be rejected — this prevents
   * over-acceptance (a tool that accepts everything would make AC4a/b/c trivially pass).
   */

  test('AC4a: update_config tool ACCEPTS template_defaults at runtime (was rejected pre-fix)', function() {
    var keySchema = getUpdateConfigKeySchema();
    // Runtime accept: safeParse must succeed for template_defaults
    var result = keySchema.safeParse('template_defaults');
    expect(result.success).toBe(true);
  });

  test('AC4b: update_config tool ACCEPTS template_overrides at runtime (was rejected pre-fix)', function() {
    var keySchema = getUpdateConfigKeySchema();
    var result = keySchema.safeParse('template_overrides');
    expect(result.success).toBe(true);
  });

  test('AC4c: update_config tool ACCEPTS schedule_templates at runtime (was rejected pre-fix)', function() {
    var keySchema = getUpdateConfigKeySchema();
    var result = keySchema.safeParse('schedule_templates');
    expect(result.success).toBe(true);
  });

  test('AC4d: update_config accepted key set equals UpdateConfig.SCHED_KEYS exactly (parity completeness)', function() {
    /**
     * Parity completeness: the MCP tool must accept exactly the same keys as
     * UpdateConfig.SCHED_KEYS — no more, no less. This catches both omissions
     * (keys missing from MCP) and over-acceptance (non-schedule keys sneaking in).
     * A non-schedule sentinel key must be REJECTED, proving the enum is not open.
     *
     * NOTE — same-source tautology boundary (zoe ADVERSARIAL-REVIEW INFO-1):
     * Both sides of this assertion (the MCP keySchema and UpdateConfig.SCHED_KEYS)
     * derive from the SAME array object (facade re-exports UpdateConfig.SCHED_KEYS;
     * config.js uses facade.SCHED_KEYS). This test CAN catch "config.js stops
     * deriving from SCHED_KEYS" (re-hardcode drift — the BUG-4 class, confirmed
     * mutation-killed by Mutation B). It CANNOT catch "SCHED_KEYS itself is wrong"
     * — if SCHED_KEYS changes, both sides move together and the test stays GREEN.
     * SCHED_KEYS-correctness is proved by AC1a/AC1b/AC1e (behavioral directives)
     * and AC4a/AC4b/AC4c (runtime accept for each new key). Do not rely on AC4d
     * alone as a SCHED_KEYS-correctness pin.
     */
    var keySchema = getUpdateConfigKeySchema();
    var UpdateConfigMod = require(path.join(
      __dirname, '..', '..', '..', '..', 'src', 'slices', 'user-config', 'application', 'commands', 'UpdateConfig'
    ));
    var SCHED_KEYS = UpdateConfigMod.SCHED_KEYS;

    // Every SCHED_KEY must be accepted at runtime
    SCHED_KEYS.forEach(function(key) {
      var r = keySchema.safeParse(key);
      expect(r.success).toBe(true); // SCHED_KEY rejected → parity broken
    });

    // A key that is NOT in SCHED_KEYS must be rejected — proves the enum is not open
    var nonSchedSentinel = 'some_unknown_key_not_in_sched_keys';
    var sentinelResult = keySchema.safeParse(nonSchedSentinel);
    expect(sentinelResult.success).toBe(false); // rejected → enum is bounded

    // The accepted entry count must equal SCHED_KEYS.length — no extra keys accepted
    // (We derive accepted count from the zod enum's entries object)
    var enumEntries = keySchema._def.entries;
    var acceptedKeys = Object.keys(enumEntries);
    expect(acceptedKeys.sort()).toEqual(SCHED_KEYS.slice().sort());
  });
});

// ── AC5 — ReplaceTools: deliberate no-op investigation ───────────────────────────────────
describe('AC5: ReplaceTools — scheduling impact investigation', () => {
  /**
   * ReplaceTools replaces the `tools` table rows (names/icons/ids). The `tool_matrix`
   * config key (which IS in SCHED_KEYS) maps tool_ids to location_ids for scheduling.
   * ReplaceTools writes ONLY tool names/icons/ids — it does NOT write tool_matrix.
   *
   * Decision: ReplaceTools is a deliberate no-op for scheduler triggering because:
   *   1. Tool identity rows (name/icon) are display data only.
   *   2. The scheduling-relevant data is tool_matrix (which tools go to which location
   *      at which times), updated separately via UpdateConfig(key='tool_matrix').
   *   3. Changing tool names does not alter the scheduler's inputs — the matrix
   *      references tool_id, not tool name.
   *
   * These tests ASSERT the no-op is deliberate and pin it as documented behavior.
   * They are GREEN on current code (no-op already) and must remain GREEN post-fix.
   */
  function okParse(body) {
    return { success: true, data: { tools: body.tools } };
  }

  test('AC5a: ReplaceTools success does NOT return scheduleAfter (deliberate no-op — documented)', async () => {
    var repo = new InMemoryConfigRepository();
    var uc = new App.ReplaceTools({
      repo: repo,
      cache: fakeCache(),
      parseBody: okParse
    });
    var res = await uc.execute({
      userId: USER,
      body: { tools: [{ id: 't1', name: 'Laptop' }, { id: 't2', name: 'Phone' }] }
    });
    expect(res.status).toBe(200);
    // No scheduleAfter — tool name/icon changes are display data only.
    // The tool_matrix (scheduling inputs) is a separate config key updated via UpdateConfig.
    expect(res.scheduleAfter).toBeUndefined();
  });

  test('AC5b: ReplaceTools 400 (invalid payload) also has no scheduleAfter', async () => {
    var uc = new App.ReplaceTools({
      repo: new InMemoryConfigRepository(),
      cache: fakeCache(),
      parseBody: function () { return { success: false, error: { issues: [] } }; }
    });
    var res = await uc.execute({ userId: USER, body: {} });
    expect(res.status).toBe(400);
    expect(res.scheduleAfter).toBeUndefined();
  });

  test('AC5c: ReplaceTools writes ONLY tool rows — does NOT write tool_matrix config', async () => {
    // Confirm that ReplaceTools does not touch user_config table (which holds tool_matrix).
    // If it did, we'd need a trigger. This pins the separation.
    var repo = new InMemoryConfigRepository({
      config: [{ user_id: USER, config_key: 'tool_matrix', config_value: JSON.stringify({ 'l1': ['t1'] }) }]
    });
    var uc = new App.ReplaceTools({
      repo: repo,
      cache: fakeCache(),
      parseBody: okParse
    });
    await uc.execute({
      userId: USER,
      body: { tools: [{ id: 't1', name: 'Renamed Laptop' }] }
    });
    // The tool_matrix config row must be UNCHANGED — ReplaceTools doesn't touch it.
    var row = await repo.getConfigRow(USER, 'tool_matrix');
    expect(row).not.toBeNull();
    expect(JSON.parse(row.config_value)).toEqual({ 'l1': ['t1'] });
  });
});

// ── AC6 — Invariant E-1: EventBusTaskEvents must NOT call enqueueScheduleRun ────────────
describe('AC6: Invariant E-1 — EventBusTaskEvents must not import or call enqueueScheduleRun', () => {
  /**
   * ADR-0001 / INVARIANT E-1 / INVARIANT S4/S6:
   * The task event bus (EventBusTaskEvents) MUST NOT trigger the scheduler.
   * The direct enqueueScheduleRun call in the use-case / controller is the
   * SOLE scheduler trigger. The fix must not add any scheduler wiring through
   * the event bus.
   *
   * These tests assert the structural invariant. They are GREEN on current code
   * (event bus has no scheduler imports) and must remain GREEN after the fix.
   */
  var EVENT_BUS_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'slices', 'task', 'adapters', 'EventBusTaskEvents.js'
  );
  var TASK_EVENTS_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'lib', 'events', 'taskEvents.js'
  );

  test('AC6a: EventBusTaskEvents must not have a require() call for scheduleQueue', () => {
    var src = require('fs').readFileSync(EVENT_BUS_PATH, 'utf8');
    // Only reject an actual require() import — the JSDoc comment mentions the word
    // as an invariant statement ("MUST NOT … scheduleQueue") which is correct.
    // We check that there is no live require(...scheduleQueue...) call.
    expect(src).not.toMatch(/require\([^)]*scheduleQueue/);
    expect(src).not.toMatch(/require\([^)]*enqueueScheduleRun/);
  });

  test('AC6b: EventBusTaskEvents source must not import runSchedule', () => {
    var src = require('fs').readFileSync(EVENT_BUS_PATH, 'utf8');
    expect(src).not.toMatch(/runSchedule/);
    expect(src).not.toMatch(/runScheduleAndPersist/);
  });

  test('AC6c: lib/events/taskEvents must not have a require() call for scheduleQueue (the wrapped publisher)', () => {
    var src = require('fs').readFileSync(TASK_EVENTS_PATH, 'utf8');
    // The JSDoc says "never imports or calls enqueueScheduleRun / scheduleQueue" — the
    // word appears legitimately in that comment. Reject only a live require() import.
    expect(src).not.toMatch(/require\([^)]*scheduleQueue/);
    expect(src).not.toMatch(/require\([^)]*enqueueScheduleRun/);
  });

  test('AC6d: EventBusTaskEvents publishTaskCreated does not enqueue a schedule run (behavioral — spy on real scheduleQueue module)', () => {
    /**
     * Behavioral test for INVARIANT E-1: the adapter's publishTaskCreated MUST NOT
     * call enqueueScheduleRun. We spy on the real scheduleQueue module inside
     * jest.isolateModules so any require() the adapter's publishTaskCreated adds —
     * whether at load time OR lazily at call time — goes through the fresh mocked
     * registry. The adapter is loaded AND called INSIDE isolateModules so the lazy
     * require() in a potential violation hits the spy, not the global require cache.
     *
     * Why inside isolateModules: Jest module caching means a require() called inside
     * a prototype method at runtime goes through the cache that was active when the
     * module was loaded. Loading and calling the adapter in the same isolated registry
     * guarantees the violation's lazy require() resolves to our spy.
     *
     * Proof-of-RED: with enqueueScheduleRun injected into publishTaskCreated (a
     * direct INVARIANT E-1 violation), this test FAILS — enqueueScheduleRunSpy
     * records 1 call. (zoe confirmed: the previous tautological version PASSED with
     * the same violation. See ADVERSARIAL-REVIEW.md BLOCK-1.)
     */
    var capturedCallCount = null;

    jest.isolateModules(function () {
      // Register the scheduleQueue mock FIRST so the adapter's lazy require()
      // (if added by a violation) resolves to our spy in this registry.
      jest.mock(path.join(__dirname, '..', '..', '..', '..', 'src', 'scheduler', 'scheduleQueue'), function () {
        return { enqueueScheduleRun: jest.fn(), stopPollLoop: jest.fn() };
      });
      // Mock lib-logger to prevent indirect requires from throwing.
      jest.mock('@raike/lib-logger', function () {
        var noop = jest.fn();
        return { createLogger: jest.fn(function () { return { error: noop, warn: noop, info: noop, debug: noop, trace: noop }; }) };
      });

      // Load the adapter inside the isolated registry (same registry as the mock).
      var IsolatedEventBusTaskEvents = require(EVENT_BUS_PATH);
      var schedMock = require(path.join(__dirname, '..', '..', '..', '..', 'src', 'scheduler', 'scheduleQueue'));

      // Use an injected publisher double that just returns a plausible result.
      var mockPublisher = {
        publishTaskCreated: function () { return { delivered: 1 }; },
        publishTaskUpdated: function () { return { delivered: 1 }; },
        publishTaskCompleted: function () { return { delivered: 1 }; }
      };

      // Call publishTaskCreated INSIDE isolateModules so any lazy require() in
      // the method body resolves through this isolated registry (and hits our spy).
      var adapter = new IsolatedEventBusTaskEvents(mockPublisher);
      adapter.publishTaskCreated({ id: 't1', userId: USER, status: 'active' });

      // Capture the call count while still inside the isolated registry.
      capturedCallCount = schedMock.enqueueScheduleRun.mock.calls.length;
    });

    // INVARIANT E-1: enqueueScheduleRun must NEVER have been called.
    // A violation wired into publishTaskCreated calls the spy → capturedCallCount > 0 → FAIL.
    expect(capturedCallCount).toBe(0);
  });

  test('AC6e: EventBusTaskEvents does not add any scheduler require at runtime', () => {
    // Load the module cleanly and verify the loaded module's prototype methods
    // do not reference enqueueScheduleRun in their stringified form.
    var EventBusTaskEvents = require(path.join(
      __dirname, '..', '..', '..', '..', 'src', 'slices', 'task', 'adapters', 'EventBusTaskEvents.js'
    ));
    var proto = EventBusTaskEvents.prototype;
    var methodSrc = [
      proto.publishTaskCreated.toString(),
      proto.publishTaskUpdated.toString(),
      proto.publishTaskCompleted.toString()
    ].join('\n');
    expect(methodSrc).not.toMatch(/enqueueScheduleRun/);
    expect(methodSrc).not.toMatch(/scheduleQueue/);
  });
});

// ── DRIFT-GUARD — MCP enum must always be derived from UpdateConfig.SCHED_KEYS ──────────
describe('DRIFT-GUARD: MCP update_config key set must be derived from UpdateConfig.SCHED_KEYS', () => {
  /**
   * This test is the durable prevention for the EXACT drift class this leg fixes (BUG-4):
   * the MCP update_config tool's accepted key set drifted from REST SCHED_KEYS because
   * the MCP enum was hardcoded. After bert's fix the enum is computed from SCHED_KEYS.
   *
   * If someone later re-hardcodes a divergent literal enum in mcp/tools/config.js,
   * this test fails CI — the accepted key set at runtime must remain a SUBSET OF
   * UpdateConfig.SCHED_KEYS and must include all SCHED_KEYS (i.e., exact parity).
   *
   * Assertion strategy (BASE-TESTING §2a — behavioral, not source-grep):
   *   - Introspect the zod enum entries from the registered MCP tool at runtime.
   *   - Assert: accepted_keys ⊆ SCHED_KEYS (no rogue extra keys accepted by MCP).
   *   - Assert: SCHED_KEYS ⊆ accepted_keys (no SCHED_KEY silently omitted from MCP).
   *   Together these prove accepted_keys === SCHED_KEYS (exact set equality).
   *
   * This test does NOT depend on how config.js constructs the enum (computed vs literal)
   * — it only cares about the runtime result. That makes it refactor-safe: the test
   * stays GREEN as long as the accepted key set remains correct, regardless of the
   * implementation strategy used to produce it.
   */
  test('DRIFT-GUARD: MCP update_config accepted keys are exactly UpdateConfig.SCHED_KEYS — no divergence permitted', function() {
    var keySchema = getUpdateConfigKeySchema();
    var UpdateConfigMod = require(path.join(
      __dirname, '..', '..', '..', '..', 'src', 'slices', 'user-config', 'application', 'commands', 'UpdateConfig'
    ));
    var SCHED_KEYS = UpdateConfigMod.SCHED_KEYS;

    // Extract the accepted key set from the registered zod enum at runtime.
    // zod enum stores entries as { keyName: keyName } in _def.entries.
    var enumEntries = keySchema._def.entries;
    expect(enumEntries).not.toBeNull(); // schema must be a zod enum (not z.string() or z.any())
    var acceptedKeys = Object.keys(enumEntries).sort();
    var expectedKeys = SCHED_KEYS.slice().sort();

    // Subset check A: every SCHED_KEY must appear in the MCP accepted set.
    // Failure here = a SCHED_KEY was omitted from the MCP tool (the BUG-4 class).
    expectedKeys.forEach(function(key) {
      expect(acceptedKeys).toContain(key);
    });

    // Subset check B: no key accepted by MCP is outside SCHED_KEYS.
    // Failure here = the MCP tool accepts a non-schedule key (over-acceptance).
    acceptedKeys.forEach(function(key) {
      expect(expectedKeys).toContain(key);
    });

    // Set equality: lengths must match (catches duplicates or extra entries).
    expect(acceptedKeys.length).toBe(expectedKeys.length);
  });
});
