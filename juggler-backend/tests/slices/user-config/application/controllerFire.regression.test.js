/**
 * Controller-fire regression tests — jug-sched-rerun-on-settings (999.464)
 *
 * BUG-2: config.controller.js replaceLocations handler must call enqueueScheduleRun
 *   EXACTLY ONCE on success and NOT AT ALL on the 400/parse-error path.
 *
 * BUG-3: data.controller.js importData handler must call enqueueScheduleRun
 *   EXACTLY ONCE on success and NOT AT ALL on the 400/error path.
 *
 * This is the "controller-fire" coverage that was absent before the fix:
 * the use-case tests (schedRerunOnSettings.regression.test.js) verified the
 * scheduleAfter DIRECTIVE is returned; these tests verify the CONTROLLER actually
 * consumes that directive and calls enqueueScheduleRun — the exactly-once /
 * transaction-rollback-safety Snuffy flagged.
 *
 * Approach: mock the facade and scheduleQueue at the module level, then call the
 * controller handler functions directly with thin req/res fakes. This avoids the
 * full Express+jose stack while still exercising the controller branch logic.
 */

'use strict';

// ── Mock the facade so we can control what use-case result is returned ─────────
jest.mock('../../../../src/slices/user-config/facade', () => ({
  replaceLocations: jest.fn(),
  importData: jest.fn()
}));

// ── Mock scheduleQueue so we can assert enqueueScheduleRun call counts ─────────
jest.mock('../../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

// ── Mock loggers so the controllers don't blow up ─────────────────────────────
jest.mock('@raike/lib-logger', () => {
  const noop = jest.fn();
  const fakeLogger = { error: noop, warn: noop, info: noop, debug: noop, trace: noop };
  return { createLogger: jest.fn(() => fakeLogger) };
});
jest.mock('../../../../src/lib/logger', () => {
  const noop = jest.fn();
  const fakeLogger = { error: noop, warn: noop, info: noop, debug: noop, trace: noop };
  return {
    createLogger: jest.fn(() => fakeLogger),
    dataControllerLogger: fakeLogger
  };
});

// Load the controllers AFTER mocks are registered
const configCtrl = require('../../../../src/controllers/config.controller');
const dataCtrl = require('../../../../src/controllers/data.controller');
const facade = require('../../../../src/slices/user-config/facade');
const { enqueueScheduleRun } = require('../../../../src/scheduler/scheduleQueue');

const USER_ID = 'ctrl-fire-user';

/** Minimal Express-like req/res fakes */
function fakeReq(overrides) {
  // is(): Express content-type matcher. The data.controller importData CSV path
  // (data.controller.js:50 `req.is('text/csv')`) calls it; these regression cases
  // all send JSON bodies, so the stub returns false → JSON import path. (999.746)
  return Object.assign({ user: { id: USER_ID }, body: {}, query: {}, headers: {}, params: {}, is: function () { return false; } }, overrides);
}

function fakeRes() {
  const res = {
    _status: null,
    _body: null,
    status: function (s) { this._status = s; return this; },
    json: function (b) { this._body = b; return this; }
  };
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── BUG-2: config.controller.js replaceLocations handler ──────────────────────

describe('BUG-2: config.controller replaceLocations — controller-fire (exactly-once + no-fire-on-error)', () => {
  /**
   * The controller must:
   *   SUCCESS path: facade returns scheduleAfter → enqueueScheduleRun called exactly once
   *                 with the userId and source from the directive.
   *   ERROR path:   facade returns a 400 (no scheduleAfter) → enqueueScheduleRun NOT called.
   */

  test('CF-RL-1: success path — enqueueScheduleRun called exactly once with correct args', async () => {
    // Arrange: facade returns a 200 with a scheduleAfter directive (post-fix behavior)
    facade.replaceLocations.mockResolvedValueOnce({
      status: 200,
      body: { locations: [{ id: 'l1', name: 'Home' }] },
      scheduleAfter: { userId: USER_ID, source: 'locations:replaced' }
    });

    const req = fakeReq({ body: { locations: [{ id: 'l1', name: 'Home' }] } });
    const res = fakeRes();

    await configCtrl.replaceLocations(req, res);

    // Response sent
    expect(res._status).toBe(200);
    // enqueueScheduleRun called exactly once with the directive values
    expect(enqueueScheduleRun).toHaveBeenCalledTimes(1);
    expect(enqueueScheduleRun).toHaveBeenCalledWith(USER_ID, 'locations:replaced');
  });

  test('CF-RL-2: 400 (parse error) path — enqueueScheduleRun NOT called', async () => {
    // Arrange: facade returns a 400 (invalid payload — no scheduleAfter)
    facade.replaceLocations.mockResolvedValueOnce({
      status: 400,
      body: { error: 'Invalid locations payload', details: [] }
      // No scheduleAfter on error path
    });

    const req = fakeReq({ body: {} });
    const res = fakeRes();

    await configCtrl.replaceLocations(req, res);

    // Response sent with 400
    expect(res._status).toBe(400);
    // enqueueScheduleRun must NOT have been called — no trigger on failed write
    expect(enqueueScheduleRun).toHaveBeenCalledTimes(0);
  });

  test('CF-RL-3: facade throws (unexpected error) — enqueueScheduleRun NOT called', async () => {
    // Arrange: facade throws (simulates DB failure or unexpected exception)
    facade.replaceLocations.mockRejectedValueOnce(new Error('DB exploded'));

    const req = fakeReq({ body: { locations: [] } });
    const res = fakeRes();

    await configCtrl.replaceLocations(req, res);

    // Controller catches and returns 500
    expect(res._status).toBe(500);
    // enqueueScheduleRun must NOT have been called on exception path
    expect(enqueueScheduleRun).toHaveBeenCalledTimes(0);
  });

  test('CF-RL-4: success with empty locations array — enqueueScheduleRun still called (clearing locations is a scheduling change)', async () => {
    // Mirrors AC2c: clearing all locations still changes scheduling inputs
    facade.replaceLocations.mockResolvedValueOnce({
      status: 200,
      body: { locations: [] },
      scheduleAfter: { userId: USER_ID, source: 'locations:replaced' }
    });

    const req = fakeReq({ body: { locations: [] } });
    const res = fakeRes();

    await configCtrl.replaceLocations(req, res);

    expect(res._status).toBe(200);
    expect(enqueueScheduleRun).toHaveBeenCalledTimes(1);
    expect(enqueueScheduleRun).toHaveBeenCalledWith(USER_ID, 'locations:replaced');
  });
});

// ── BUG-3: data.controller.js importData handler ─────────────────────────────

describe('BUG-3: data.controller importData — controller-fire (exactly-once + no-fire-on-error)', () => {
  /**
   * The controller must:
   *   SUCCESS path: facade returns scheduleAfter → enqueueScheduleRun called exactly once
   *                 with the userId and source from the directive.
   *   INVALID-SHAPE path: facade returns a 400 (no scheduleAfter) → NOT called.
   *   MISSING-CONFIRM path: facade returns a 400 (no scheduleAfter) → NOT called.
   *   EXCEPTION path: facade throws (rollback) → NOT called.
   */

  test('CF-ID-1: success path — enqueueScheduleRun called exactly once with correct args', async () => {
    // Arrange: facade returns a 200 with a scheduleAfter directive (post-fix behavior)
    facade.importData.mockResolvedValueOnce({
      status: 200,
      body: {
        message: 'Import successful',
        counts: { tasks: 1, duplicatesRemoved: 0, locations: 0, tools: 0, projects: 0 }
      },
      scheduleAfter: { userId: USER_ID, source: 'import' }
    });

    const req = fakeReq({
      body: { extraTasks: [{ id: 't1', text: 'Task 1' }] },
      query: { confirm: 'delete_all' },
      headers: {}
    });
    const res = fakeRes();

    await dataCtrl.importData(req, res);

    // Response sent
    expect(res._status).toBe(200);
    // enqueueScheduleRun called exactly once with the directive values
    expect(enqueueScheduleRun).toHaveBeenCalledTimes(1);
    expect(enqueueScheduleRun).toHaveBeenCalledWith(USER_ID, 'import');
  });

  test('CF-ID-2: 400 (missing confirm) — enqueueScheduleRun NOT called', async () => {
    // Arrange: facade returns 400 for missing confirm guard (no scheduleAfter)
    facade.importData.mockResolvedValueOnce({
      status: 400,
      body: { error: 'Import will DELETE all existing tasks, config, and projects. Pass ?confirm=delete_all to proceed.' }
    });

    const req = fakeReq({
      body: { extraTasks: [] },
      query: {},
      headers: {}
    });
    const res = fakeRes();

    await dataCtrl.importData(req, res);

    expect(res._status).toBe(400);
    // Must NOT fire on the confirm-guard rejection path
    expect(enqueueScheduleRun).toHaveBeenCalledTimes(0);
  });

  test('CF-ID-3: 400 (invalid shape) — enqueueScheduleRun NOT called', async () => {
    // Arrange: facade returns 400 for invalid payload shape (no scheduleAfter)
    facade.importData.mockResolvedValueOnce({
      status: 400,
      body: { error: 'Invalid import data — expected v7 format with extraTasks' }
    });

    const req = fakeReq({
      body: { notExtraTasks: [] },
      query: { confirm: 'delete_all' },
      headers: {}
    });
    const res = fakeRes();

    await dataCtrl.importData(req, res);

    expect(res._status).toBe(400);
    expect(enqueueScheduleRun).toHaveBeenCalledTimes(0);
  });

  test('CF-ID-4: facade throws (transaction rollback) — enqueueScheduleRun NOT called', async () => {
    // Arrange: facade throws (simulates a failed transaction / DB exception)
    facade.importData.mockRejectedValueOnce(new Error('insert boom — transaction rolled back'));

    const req = fakeReq({
      body: { extraTasks: [{ id: 't1' }] },
      query: { confirm: 'delete_all' },
      headers: {}
    });
    const res = fakeRes();

    await dataCtrl.importData(req, res);

    // Controller catches and returns 500
    expect(res._status).toBe(500);
    // enqueueScheduleRun must NOT be called — write failed, do not trigger scheduler
    expect(enqueueScheduleRun).toHaveBeenCalledTimes(0);
  });

  test('CF-ID-5: controller consumes a single scheduleAfter directive — exactly ONE enqueueScheduleRun call regardless of request body size', async () => {
    /**
     * The controller consumes the facade's scheduleAfter directive object (one object,
     * one trigger). It is structurally incapable of firing per-key: the facade returns
     * a single directive regardless of how many config keys the import wrote internally.
     * The one-directive-per-import collapse is the USE-CASE / facade's responsibility
     * (proved by AC3a at the use-case layer) — this test confirms the controller
     * consumes that single directive correctly even with a large multi-field request body.
     *
     * NOTE: the facade is mocked here; the controller never writes any config keys.
     * The request body below is realistic but has no effect on the assertion — the
     * trigger count depends solely on the facade's returned scheduleAfter, not on the
     * body fields. This test is distinct from CF-ID-1 only in body shape (broader
     * realistic payload). The one-per-import collapse proof belongs to AC3a.
     */
    facade.importData.mockResolvedValueOnce({
      status: 200,
      body: {
        message: 'Import successful',
        counts: { tasks: 0, duplicatesRemoved: 0, locations: 2, tools: 1, projects: 0 }
      },
      scheduleAfter: { userId: USER_ID, source: 'import' }
    });

    const req = fakeReq({
      body: {
        extraTasks: [],
        locations: [{ id: 'l1', name: 'Home' }, { id: 'l2', name: 'Work' }],
        tools: [{ id: 't1', name: 'Phone' }],
        timeBlocks: { morning: { start: 480, end: 720 } },
        toolMatrix: { l1: ['t1'] },
        locSchedules: {},
        locScheduleDefaults: {},
        locScheduleOverrides: {},
        hourLocationOverrides: {}
      },
      query: { confirm: 'delete_all' },
      headers: {}
    });
    const res = fakeRes();

    await dataCtrl.importData(req, res);

    expect(res._status).toBe(200);
    // Exactly ONE trigger — controller consumed the single directive.
    expect(enqueueScheduleRun).toHaveBeenCalledTimes(1);
    expect(enqueueScheduleRun).toHaveBeenCalledWith(USER_ID, 'import');
  });
});
