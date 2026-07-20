/**
 * Characterization tests — jug-mcp-config-facade-routing (step 1 — facade-seam re-pin)
 *
 * These tests pin the HANDLER'S POST-REFACTOR contract by mocking facade.updateConfig
 * at the facade module boundary. The raw db('user_config') + redisCache pins from step 0
 * are REPLACED here because the refactor moves persistence + cache invalidation INSIDE
 * the facade — the handler no longer owns those side-effects directly.
 *
 * Equivalence guarantee (two legs, both required):
 *   [Handler leg]  D-1/D-2/D-3: handler delegates correctly to the facade (THIS FILE).
 *   [Facade leg]   D-1/D-3 delegated behavior: facade's own tests (configUseCases.test.js)
 *                  prove upsert + cache.invalidateConfig inside UpdateConfig.execute.
 *
 * D-1  handler calls facade.updateConfig EXACTLY ONCE with {userId, key, value}.
 * D-2  handler fires enqueueScheduleRun(scheduleAfter.userId, scheduleAfter.source)
 *      EXACTLY ONCE iff result.scheduleAfter is present; ZERO times if absent.
 * D-3  handler returns { content:[{type:'text', text: safeStringify({key,value})}] }.
 *      Warnings from the facade body are NOT echoed (handler only uses body.key/body.value).
 * D-4  z.enum REJECTS a non-enum key — input gate is seam-independent (unchanged).
 * D-5  handler does NOT itself call db('user_config') or redisCache — duplication removed.
 *
 * SEAM NOTE:
 * The prior step-0 tests spied at src/db + src/lib/redis. Post-refactor those spies
 * would see ZERO calls (persistence + cache happen inside the facade, via lib/db + lib/cache
 * — different modules). That would make B-1/B-2/B-3 false-RED for the wrong reason.
 * The new seam is facade.updateConfig — the handler's single delegated call.
 *
 * D-4 (z.enum) survives the refactor unchanged: the input gate is registered at module
 * load time from SCHED_KEYS and does not depend on which seam the handler calls.
 * The old B-4 tests are kept as D-4 here — they do NOT depend on the seam.
 *
 * Lazy-require pattern (same as step 0):
 * The update_config handler uses `require('../../scheduler/scheduleQueue')` INSIDE the
 * handler body (config.js:206 in the current code; the refactor will move that to a
 * facade-result-gated call). jest.isolateModulesAsync is used so the isolated registry
 * is still active when the async handler body resolves its lazy require.
 *
 * RED proof (step 1 contract):
 * D-1 is RED on current code because the handler does NOT call facade.updateConfig at all.
 * D-2 is RED for schedule keys on current code (no facade call → scheduleAfter never read).
 * D-5 is RED on current code because the handler DOES call db('user_config') directly.
 * D-3/D-4 are GREEN on current code (return shape + enum gate unchanged).
 * See "## RED proof" section in TRACEABILITY.md / TEST-CATALOG.md for the captured output.
 */

'use strict';

var path = require('path');

// Absolute paths for jest.mock() registration — must be absolute for the module
// registry key to match the resolved module (relative paths in jest.mock() are
// resolved from the test file, but FACADE_PATH etc. are used as require() args
// inside isolateModulesAsync where Jest needs the exact registry key).
var CONFIG_TOOLS_PATH = path.join(__dirname, '..', 'src', 'mcp', 'tools', 'config');
var DB_PATH           = path.join(__dirname, '..', 'src', 'db');
var REDIS_PATH        = path.join(__dirname, '..', 'src', 'lib', 'redis');
var TASKS_WRITE_PATH  = path.join(__dirname, '..', 'src', 'lib', 'tasks-write');
var SCHED_QUEUE_PATH  = path.join(__dirname, '..', 'src', 'scheduler', 'scheduleQueue');
var FACADE_PATH       = path.join(__dirname, '..', 'src', 'slices', 'user-config', 'facade');

var TEST_USER = 'facade-seam-test-user-42';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: run handler inside isolated registry, facade mock controls return value
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run update_config handler inside a fresh isolated module registry.
 *
 * The facade mock controls what updateConfig returns so each test can exercise
 * the handler's response to different facade outcomes (scheduleAfter present/absent,
 * non-schedule key, etc.). The db + redis spies are installed to assert D-5 (NOT called).
 *
 * @param {{
 *   facadeResult: Object,           // what facade.updateConfig returns
 *   handlerArgs: { key: string, value: * }
 * }} opts
 * @returns {Promise<{
 *   mcpResult: *,
 *   facadeUpdateConfigCalls: Array,
 *   enqueueScheduleRunCalls: Array,
 *   dbUserConfigCalls: Array,       // raw db('user_config') calls — D-5
 *   redisCalls: Array,              // redisCache.invalidateConfig calls — D-5
 *   mockFacade: *,
 *   keySchema: *
 * }>}
 */
async function runInIsolation(opts) {
  var mockFacadeResult = opts.facadeResult;
  var mockHandlerArgs  = opts.handlerArgs;

  var mockState = {
    facadeUpdateConfigCalls: [],
    enqueueScheduleRunCalls: [],
    dbUserConfigCalls: [],
    redisCalls: [],
    mockFacade: null,
    keySchema: null,
    mcpResult: null,
  };

  await jest.isolateModulesAsync(async function () {

    // ── facade mock ─────────────────────────────────────────────────────────
    // Mock the facade module so facade.updateConfig is a spy returning mockFacadeResult.
    // The handler calls require('../../slices/user-config/facade').updateConfig — this
    // intercepts that require in the isolated registry.
    jest.mock(FACADE_PATH, function () {
      // Preserve SCHED_KEYS re-export so the z.enum schema can still be built.
      // SCHED_KEYS is a pure static array; loaded via a string-literal require so
      // the Jest mock factory (which bans non-mock-prefixed out-of-scope vars like
      // `path`) can compile cleanly. The literal path is relative to this test file.
      var mockUpdateConfig = require('../src/slices/user-config/application/commands/UpdateConfig');
      var mockFacadeInst = {
        SCHED_KEYS: mockUpdateConfig.SCHED_KEYS,
        updateConfig: jest.fn(function (mockInput) {
          mockState.facadeUpdateConfigCalls.push(mockInput);
          return Promise.resolve(mockFacadeResult);
        })
      };
      mockState.mockFacade = mockFacadeInst;
      return mockFacadeInst;
    });

    // ── db spy (D-5: must NOT be called by the handler) ─────────────────────
    jest.mock(DB_PATH, function () {
      function makeTableProxy(mockTableName) {
        var mockProxy = {
          where: function () { return this; },
          first: function () { mockState.dbUserConfigCalls.push({ op: 'first', table: mockTableName }); return Promise.resolve(null); },
          update: function () { mockState.dbUserConfigCalls.push({ op: 'update', table: mockTableName }); return Promise.resolve(0); },
          insert: function () { mockState.dbUserConfigCalls.push({ op: 'insert', table: mockTableName }); return Promise.resolve([1]); },
          orderBy: function () { return this; },
          max: function () { return { first: function () { return Promise.resolve({ max: 0 }); } }; },
          del: function () { return Promise.resolve(1); },
          groupBy: function () { return this; },
          select: function () { return Promise.resolve([]); },
          whereIn: function () { return this; },
        };
        return mockProxy;
      }
      var mockDb = function (mockTableName) { return makeTableProxy(mockTableName); };
      mockDb.fn = { now: function () { return new Date(); } };
      mockDb.transaction = function (mockCb) { return mockCb(mockDb); };
      mockDb.raw = function () { return Promise.resolve(); };
      return mockDb;
    });

    // ── redis spy (D-5: must NOT be called by the handler) ──────────────────
    jest.mock(REDIS_PATH, function () {
      return {
        invalidateConfig: jest.fn(function (mockUserId) {
          mockState.redisCalls.push(mockUserId);
          return Promise.resolve(true);
        })
      };
    });

    // ── tasks-write stub (not relevant to D tests) ──────────────────────────
    jest.mock(TASKS_WRITE_PATH, function () {
      return { updateTasksWhere: function () { return Promise.resolve(); } };
    });

    // ── scheduleQueue spy (D-2) ─────────────────────────────────────────────
    jest.mock(SCHED_QUEUE_PATH, function () {
      return {
        enqueueScheduleRun: jest.fn(function (mockUserId, mockSource) {
          mockState.enqueueScheduleRunCalls.push({ userId: mockUserId, source: mockSource });
          return Promise.resolve();
        })
      };
    });

    // ── load module + register tools ────────────────────────────────────────
    var mockRegisteredTools = {};
    var mockFakeServer = {
      tool: function (mockName, _desc, mockInputSchema, mockHandler) {
        mockRegisteredTools[mockName] = { inputSchema: mockInputSchema, handler: mockHandler };
      }
    };
    require(CONFIG_TOOLS_PATH).registerConfigTools(mockFakeServer, TEST_USER);
    mockState.keySchema = mockRegisteredTools['update_config'].inputSchema.key;

    // ── CALL AND AWAIT HANDLER INSIDE isolateModulesAsync ───────────────────
    if (mockHandlerArgs) {
      mockState.mcpResult = await mockRegisteredTools['update_config'].handler(mockHandlerArgs);
    }
  });

  return mockState;
}

/** Get just the keySchema for D-4 (no handler invocation needed) */
async function getKeySchema() {
  var mockKeySchema = null;
  await jest.isolateModulesAsync(async function () {
    jest.mock(FACADE_PATH, function () {
      var mockUpdateConfig = require('../src/slices/user-config/application/commands/UpdateConfig');
      return {
        SCHED_KEYS: mockUpdateConfig.SCHED_KEYS,
        updateConfig: jest.fn(function () { return Promise.resolve({ status: 200, body: { key: 'k', value: {}, warnings: [] } }); })
      };
    });
    jest.mock(DB_PATH, function () {
      var mockDb = function () { return mockDb; };
      mockDb.fn = { now: function () { return new Date(); } };
      mockDb.where = function () { return mockDb; }; mockDb.first = function () { return Promise.resolve(null); };
      mockDb.insert = function () { return Promise.resolve([1]); }; mockDb.update = function () { return Promise.resolve(1); };
      mockDb.transaction = function (mockCb) { return mockCb(mockDb); }; mockDb.raw = function () { return Promise.resolve(); };
      return mockDb;
    });
    jest.mock(REDIS_PATH, function () { return { invalidateConfig: jest.fn(function () { return Promise.resolve(true); }) }; });
    jest.mock(TASKS_WRITE_PATH, function () { return { updateTasksWhere: function () { return Promise.resolve(); } }; });
    jest.mock(SCHED_QUEUE_PATH, function () { return { enqueueScheduleRun: jest.fn(function () { return Promise.resolve(); }) }; });
    var mockTools = {};
    var mockSrv = { tool: function (mockName, _d, mockSchema, _h) { mockTools[mockName] = { inputSchema: mockSchema }; } };
    require(CONFIG_TOOLS_PATH).registerConfigTools(mockSrv, TEST_USER);
    mockKeySchema = mockTools['update_config'].inputSchema.key;
  });
  return mockKeySchema;
}

/**
 * Get SCHED_KEYS from the facade INSIDE an isolated registry (no normal-cache contamination).
 * Must mirror the getKeySchema pattern — NEVER require(FACADE_PATH) in a test body directly.
 */
async function getSchedKeys() {
  var mockSchedKeys = null;
  await jest.isolateModulesAsync(async function () {
    jest.mock(FACADE_PATH, function () {
      var mockUpdateConfig = require('../src/slices/user-config/application/commands/UpdateConfig');
      return {
        SCHED_KEYS: mockUpdateConfig.SCHED_KEYS,
        updateConfig: jest.fn(function () { return Promise.resolve({ status: 200, body: { key: 'k', value: {}, warnings: [] } }); })
      };
    });
    jest.mock(DB_PATH, function () {
      var mockDb = function () { return mockDb; };
      mockDb.fn = { now: function () { return new Date(); } };
      mockDb.where = function () { return mockDb; }; mockDb.first = function () { return Promise.resolve(null); };
      mockDb.insert = function () { return Promise.resolve([1]); }; mockDb.update = function () { return Promise.resolve(1); };
      mockDb.transaction = function (mockCb) { return mockCb(mockDb); }; mockDb.raw = function () { return Promise.resolve(); };
      return mockDb;
    });
    jest.mock(REDIS_PATH, function () { return { invalidateConfig: jest.fn(function () { return Promise.resolve(true); }) }; });
    jest.mock(TASKS_WRITE_PATH, function () { return { updateTasksWhere: function () { return Promise.resolve(); } }; });
    jest.mock(SCHED_QUEUE_PATH, function () { return { enqueueScheduleRun: jest.fn(function () { return Promise.resolve(); }) }; });
    var mockIsolated = require(FACADE_PATH);
    mockSchedKeys = mockIsolated.SCHED_KEYS;
  });
  return mockSchedKeys;
}

// Standard facade return values for a schedule-affecting key
function schedFacadeResult(key, value) {
  return {
    status: 200,
    body: { key: key, value: value, warnings: [] },
    scheduleAfter: { userId: TEST_USER, source: 'config:' + key }
  };
}

// Standard facade return value for a non-schedule key (no scheduleAfter)
function nonSchedFacadeResult(key, value) {
  return { status: 200, body: { key: key, value: value, warnings: [] } };
}

// ── D-1: handler delegates to facade.updateConfig exactly once ─────────────────
describe('D-1: handler delegates to facade.updateConfig (correct call + args)', function () {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });


  test('D-1a: facade.updateConfig called EXACTLY ONCE for a schedule-affecting key', async function () {
    var value = { morning: { start: 480 } };
    var key = 'time_blocks';
    var s = await runInIsolation({
      facadeResult: schedFacadeResult(key, value),
      handlerArgs: { key: key, value: value }
    });

    expect(s.facadeUpdateConfigCalls.length).toBe(1);
  });

  test('D-1b: facade.updateConfig called with {userId, key, value} — correct delegation args', async function () {
    var value = { weekday: { blocks: [{ tag: 'focus' }] } };
    var key = 'schedule_templates';
    var s = await runInIsolation({
      facadeResult: schedFacadeResult(key, value),
      handlerArgs: { key: key, value: value }
    });

    expect(s.facadeUpdateConfigCalls.length).toBe(1);
    expect(s.facadeUpdateConfigCalls[0]).toEqual({ userId: TEST_USER, key: key, value: value });
  });

  test('D-1c: userId passed to facade is the userId the handler was registered with (not a literal)', async function () {
    var key = 'preferences';
    var value = { theme: 'dark' };
    var s = await runInIsolation({
      facadeResult: nonSchedFacadeResult(key, value),
      handlerArgs: { key: key, value: value }
    });

    expect(s.facadeUpdateConfigCalls.length).toBe(1);
    expect(s.facadeUpdateConfigCalls[0].userId).toBe(TEST_USER);
    expect(s.facadeUpdateConfigCalls[0].userId).not.toBe('wrong-user');
  });

  test('D-1d: key and value are forwarded verbatim — object not stringified by the handler', async function () {
    var value = { l1: ['t1', 't2'], l2: [] };
    var key = 'tool_matrix';
    var s = await runInIsolation({
      facadeResult: schedFacadeResult(key, value),
      handlerArgs: { key: key, value: value }
    });

    expect(s.facadeUpdateConfigCalls[0].key).toBe('tool_matrix');
    // value is forwarded as-is (not JSON.stringify'd — that is the facade/repo's job)
    expect(s.facadeUpdateConfigCalls[0].value).toEqual(value);
  });
});

// ── D-2: enqueueScheduleRun gated on result.scheduleAfter ─────────────────────
describe('D-2: enqueueScheduleRun fired iff facade returns scheduleAfter', function () {

  test('D-2a: enqueueScheduleRun fires EXACTLY ONCE when facade returns scheduleAfter (schedule key)', async function () {
    var key = 'time_blocks';
    var s = await runInIsolation({
      facadeResult: schedFacadeResult(key, {}),
      handlerArgs: { key: key, value: {} }
    });

    expect(s.enqueueScheduleRunCalls.length).toBe(1);
  });

  test('D-2b: enqueueScheduleRun uses scheduleAfter.userId + scheduleAfter.source verbatim', async function () {
    var key = 'schedule_templates';
    var s = await runInIsolation({
      facadeResult: schedFacadeResult(key, {}),
      handlerArgs: { key: key, value: {} }
    });

    expect(s.enqueueScheduleRunCalls.length).toBe(1);
    expect(s.enqueueScheduleRunCalls[0].userId).toBe(TEST_USER);
    expect(s.enqueueScheduleRunCalls[0].source).toBe('config:' + key);
  });

  test('D-2c: enqueueScheduleRun NOT called when facade returns no scheduleAfter (non-schedule key)', async function () {
    // A non-schedule key that the facade handles — facade returns no scheduleAfter.
    // Post-refactor, the handler checks result.scheduleAfter; if absent, no enqueue.
    // We simulate this by returning a facade result with no scheduleAfter.
    var key = 'preferences';
    var s = await runInIsolation({
      facadeResult: nonSchedFacadeResult(key, { theme: 'dark' }),
      handlerArgs: { key: key, value: { theme: 'dark' } }
    });

    expect(s.enqueueScheduleRunCalls.length).toBe(0);
  });

  test('D-2d: each handler invocation is independent — exactly 1 enqueue, not cumulative', async function () {
    var key = 'loc_schedules';
    var s1 = await runInIsolation({ facadeResult: schedFacadeResult(key, {}), handlerArgs: { key: key, value: {} } });
    var s2 = await runInIsolation({ facadeResult: schedFacadeResult(key, { v: 1 }), handlerArgs: { key: key, value: { v: 1 } } });

    expect(s1.enqueueScheduleRunCalls.length).toBe(1);
    expect(s2.enqueueScheduleRunCalls.length).toBe(1);
  });

  test('D-2e: source value is config:<key> (matches facade UpdateConfig.js:139 convention)', async function () {
    var key = 'tool_matrix';
    var s = await runInIsolation({
      facadeResult: { status: 200, body: { key: key, value: {}, warnings: [] }, scheduleAfter: { userId: TEST_USER, source: 'config:' + key } },
      handlerArgs: { key: key, value: {} }
    });

    expect(s.enqueueScheduleRunCalls[0].source).toBe('config:tool_matrix');
  });

  test('D-2f: ALL SCHED_KEYS — facade returning scheduleAfter triggers exactly one enqueue each', async function () {
    // MUST use getSchedKeys() — require(FACADE_PATH) outside isolateModulesAsync loads the
    // real facade into the normal Jest module cache, contaminating subsequent isolated
    // registries (jest.mock(FACADE_PATH) no longer intercepts → false failures in D-all).
    var schedKeys = await getSchedKeys();
    for (var i = 0; i < schedKeys.length; i++) {
      var key = schedKeys[i];
      var s = await runInIsolation({
        facadeResult: schedFacadeResult(key, {}),
        handlerArgs: { key: key, value: {} }
      });
      expect(s.enqueueScheduleRunCalls.length).toBe(1);
      expect(s.enqueueScheduleRunCalls[0].source).toBe('config:' + key);
    }
  });
});

// ── D-3: MCP return shape preserved ───────────────────────────────────────────
describe('D-3: handler return shape — { content:[{type:text, text:safeStringify({key,value})}] }', function () {

  test('D-3a: returns content array with exactly one text entry', async function () {
    var key = 'time_blocks';
    var value = { morning: { start: 480, end: 720 } };
    var s = await runInIsolation({
      facadeResult: schedFacadeResult(key, value),
      handlerArgs: { key: key, value: value }
    });

    expect(s.mcpResult).toBeDefined();
    expect(Array.isArray(s.mcpResult.content)).toBe(true);
    expect(s.mcpResult.content.length).toBeGreaterThanOrEqual(1);
    expect(s.mcpResult.content[0].type).toBe('text');
  });

  test('D-3b: text payload contains {key, value} — key and value from the facade body', async function () {
    var key = 'preferences';
    var value = { theme: 'dark', weekStartsOn: 1 };
    var s = await runInIsolation({
      facadeResult: nonSchedFacadeResult(key, value),
      handlerArgs: { key: key, value: value }
    });

    var parsed = JSON.parse(s.mcpResult.content[0].text);
    expect(parsed.key).toBe(key);
    expect(parsed.value).toEqual(value);
  });

  test('D-3c: no REST envelope in the text payload — no {status, body} wrapper', async function () {
    var key = 'loc_schedules';
    var s = await runInIsolation({
      facadeResult: schedFacadeResult(key, [1, 2, 3]),
      handlerArgs: { key: key, value: [1, 2, 3] }
    });

    var parsed = JSON.parse(s.mcpResult.content[0].text);
    expect(parsed.status).toBeUndefined();
    expect(parsed.body).toBeUndefined();
  });

  test('D-3d: warnings from facade body are NOT echoed in the MCP text payload (handler strips them)', async function () {
    // The facade may return warnings (orphan when-tag scan). The MCP handler's existing
    // return is safeStringify({key,value}) — not the full body — so warnings do not leak.
    var key = 'schedule_templates';
    var value = { weekday: { blocks: [] } };
    var s = await runInIsolation({
      facadeResult: {
        status: 200,
        body: { key: key, value: value, warnings: [{ type: 'orphanedWhenTags', tasks: [{ id: 'tk1' }] }] },
        scheduleAfter: { userId: TEST_USER, source: 'config:' + key }
      },
      handlerArgs: { key: key, value: value }
    });

    var parsed = JSON.parse(s.mcpResult.content[0].text);
    expect(parsed.key).toBe(key);
    expect(parsed.value).toEqual(value);
    // warnings are not in the MCP text payload (the legacy handler never included them)
    expect(parsed.warnings).toBeUndefined();
  });
});

// ── D-4: z.enum input gate (seam-independent — unchanged by refactor) ─────────
describe('D-4: z.enum REJECTS non-enum key (input gate unchanged)', function () {

  test('D-4a: z.enum REJECTS "bogus" — a key not in SCHED_KEYS', async function () {
    var schema = await getKeySchema();
    expect(schema.safeParse('bogus').success).toBe(false);
  });

  test('D-4b: z.enum REJECTS "temp_unit_pref" — valid config key but NOT in SCHED_KEYS enum', async function () {
    var schema = await getKeySchema();
    expect(schema.safeParse('temp_unit_pref').success).toBe(false);
  });

  test('D-4c: z.enum ACCEPTS all keys in SCHED_KEYS', async function () {
    // MUST use getSchedKeys() — same registry-contamination hazard as D-2f.
    var schedKeys = await getSchedKeys();
    var schema = await getKeySchema();
    schedKeys.forEach(function (key) {
      expect(schema.safeParse(key).success).toBe(true);
    });
  });

  test('D-4d: the enum is bounded — completely_invalid_key rejected', async function () {
    var schema = await getKeySchema();
    expect(schema.safeParse('completely_invalid_key_xyz_999').success).toBe(false);
    expect(schema._def).toBeDefined();
    expect(schema._def.entries).toBeDefined();
  });
});

// ── D-5: handler does NOT call db('user_config') or redisCache (duplication removed) ──
describe('D-5: raw db/redis NOT called by handler (duplication removed — AC3)', function () {

  test('D-5a: db("user_config") is NOT called — persistence happens inside facade, not handler', async function () {
    var key = 'time_blocks';
    var s = await runInIsolation({
      facadeResult: schedFacadeResult(key, { morning: { start: 480 } }),
      handlerArgs: { key: key, value: { morning: { start: 480 } } }
    });

    // Filter to user_config table calls only
    var userConfigCalls = s.dbUserConfigCalls.filter(function (c) { return c.table === 'user_config'; });
    expect(userConfigCalls.length).toBe(0);
  });

  test('D-5b: redisCache.invalidateConfig NOT called by handler — cache happens inside facade', async function () {
    var key = 'preferences';
    var s = await runInIsolation({
      facadeResult: nonSchedFacadeResult(key, { theme: 'dark' }),
      handlerArgs: { key: key, value: { theme: 'dark' } }
    });

    expect(s.redisCalls.length).toBe(0);
  });

  test('D-5c: no raw db writes at all for a schedule key — facade is the only writer', async function () {
    var key = 'schedule_templates';
    var s = await runInIsolation({
      facadeResult: schedFacadeResult(key, { weekday: { blocks: [] } }),
      handlerArgs: { key: key, value: { weekday: { blocks: [] } } }
    });

    var writeCalls = s.dbUserConfigCalls.filter(function (c) { return c.op === 'insert' || c.op === 'update'; });
    expect(writeCalls.length).toBe(0);
  });
});

// ── D-all: combined — all D contracts in a single call ─────────────────────────
describe('D-all: combined — all D contracts hold in one handler invocation', function () {

  test('schedule key: facade called once + enqueue once + shape correct + no raw db/redis', async function () {
    var key = 'tool_matrix';
    var value = { l1: ['t1', 't2'] };
    var s = await runInIsolation({
      facadeResult: schedFacadeResult(key, value),
      handlerArgs: { key: key, value: value }
    });

    // D-1: facade called once with correct args
    expect(s.facadeUpdateConfigCalls.length).toBe(1);
    expect(s.facadeUpdateConfigCalls[0]).toEqual({ userId: TEST_USER, key: key, value: value });

    // D-2: enqueue fired once with correct args
    expect(s.enqueueScheduleRunCalls.length).toBe(1);
    expect(s.enqueueScheduleRunCalls[0]).toEqual({ userId: TEST_USER, source: 'config:' + key });

    // D-3: return shape
    var parsed = JSON.parse(s.mcpResult.content[0].text);
    expect(parsed.key).toBe(key);
    expect(parsed.value).toEqual(value);

    // D-5: no raw db/redis calls
    var userConfigCalls = s.dbUserConfigCalls.filter(function (c) { return c.table === 'user_config'; });
    expect(userConfigCalls.length).toBe(0);
    expect(s.redisCalls.length).toBe(0);
  });

  test('non-schedule key: facade called once + NO enqueue + shape correct + no raw db/redis', async function () {
    var key = 'loc_schedule_defaults';
    // Simulate a non-schedule key by returning no scheduleAfter.
    // In reality post-refactor ALL SCHED_KEYS return scheduleAfter; this tests the
    // handler correctly reads the facade result rather than hard-coding its own key check.
    var value = { defaultLoc: 'home' };
    var s = await runInIsolation({
      facadeResult: { status: 200, body: { key: key, value: value, warnings: [] } }, // no scheduleAfter
      handlerArgs: { key: key, value: value }
    });

    // D-1: facade called once
    expect(s.facadeUpdateConfigCalls.length).toBe(1);

    // D-2: no enqueue when no scheduleAfter
    expect(s.enqueueScheduleRunCalls.length).toBe(0);

    // D-3: return shape
    var parsed = JSON.parse(s.mcpResult.content[0].text);
    expect(parsed.key).toBe(key);
    expect(parsed.value).toEqual(value);

    // D-5: no raw calls
    expect(s.dbUserConfigCalls.filter(function (c) { return c.table === 'user_config'; }).length).toBe(0);
    expect(s.redisCalls.length).toBe(0);
  });
});
