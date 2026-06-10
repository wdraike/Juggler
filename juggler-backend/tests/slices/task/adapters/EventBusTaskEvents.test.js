/**
 * H3 W4 — EventBusTaskEvents adapter suite (TaskEventPort over lib/events).
 *
 * WBS W4 acceptance (b): emits the correct `TASK_*` EventTypes with a
 * SERIALIZABLE payload matching the H2 `taskEvents` publisher.
 * WBS W4 acceptance (c): NO scheduler self-trigger (S4) / NO cascade (S6) —
 * publishing is decoupled from the schedule trigger.
 *
 * APPROACH (mirrors tests/taskEvents.test.js S4/S6 guard):
 *   - The adapter delegates to the H2 `taskEvents` publisher, which resolves the
 *     lib/events singleton bus via getEventBus(). We `resetEventBus()` for a
 *     clean singleton, then subscribe CAPTURING SPIES on that real bus; the spy
 *     call-args ARE the published payloads (the enriched payload the bus passes
 *     to handlers). This avoids monkey-patching the publisher's bound
 *     getEventBus reference (which is destructured at require-time).
 *   - The scheduler queue (`scheduleQueue.enqueueScheduleRun`) is mocked; the
 *     S4/S6 test asserts publishing NEVER calls it, plus STATIC + TRANSITIVE
 *     import-graph proofs that the adapter + the H2 publisher carry zero
 *     scheduler coupling.
 *
 * Traceability: WBS W4 (b), (c), (d), (e); TaskEventPort E-1/E-2/E-3; ADR-0001;
 * S4/S6; P1 (no new fallbacks).
 */

'use strict';

process.env.NODE_ENV = 'test';

var path = require('path');
var fs = require('fs');

// CRITICAL (S4/S6): mock the scheduler queue BEFORE anything could import it, so
// the guard can assert publishing never reaches the scheduler.
var mockEnqueueScheduleRun = jest.fn();
jest.mock('../../../../src/scheduler/scheduleQueue', function () {
  return { enqueueScheduleRun: mockEnqueueScheduleRun, stopPollLoop: jest.fn() };
});

var libEvents = require('../../../../src/lib/events');
var EventTypes = libEvents.EventTypes;
var getEventBus = libEvents.getEventBus;
var resetEventBus = libEvents.resetEventBus;

var SLICE = path.join(__dirname, '..', '..', '..', '..', 'src', 'slices', 'task');
var EventBusTaskEvents = require(path.join(SLICE, 'adapters', 'EventBusTaskEvents'));
var TaskEventPort = require(path.join(SLICE, 'domain', 'ports', 'TaskEventPort'));
var TASK_EVENT_PORT_METHODS = TaskEventPort.TASK_EVENT_PORT_METHODS;

/**
 * Reset the singleton bus and subscribe a capturing spy on each TASK_* type.
 * The spy receives the enriched payload the bus delivers to handlers — so
 * `spy.mock.calls[i][0]` is the published payload (plus _eventMeta).
 * @returns {{ created: jest.Mock, updated: jest.Mock, completed: jest.Mock }}
 */
function captureBus() {
  resetEventBus();
  var bus = getEventBus();
  var created = jest.fn();
  var updated = jest.fn();
  var completed = jest.fn();
  bus.subscribe(EventTypes.TASK_CREATED, created);
  bus.subscribe(EventTypes.TASK_UPDATED, updated);
  bus.subscribe(EventTypes.TASK_COMPLETED, completed);
  return { created: created, updated: updated, completed: completed };
}

/** Extract just the identity fields from a captured payload. */
function identity(pl) {
  return { taskId: pl.taskId, userId: pl.userId, status: pl.status };
}

beforeEach(function () {
  jest.clearAllMocks();
  resetEventBus();
});

afterEach(function () {
  resetEventBus();
});

// ── conformance ──────────────────────────────────────────────────────────────
describe('EventBusTaskEvents — TaskEventPort conformance', function () {
  test('abstract TaskEventPort base throws on every method', function () {
    var base = new TaskEventPort();
    TASK_EVENT_PORT_METHODS.forEach(function (m) {
      expect(function () { base[m](); }).toThrow(/not implemented/);
    });
  });

  test('EventBusTaskEvents exposes exactly the TASK_EVENT_PORT_METHODS surface', function () {
    var adapter = new EventBusTaskEvents();
    TASK_EVENT_PORT_METHODS.forEach(function (m) {
      expect(typeof adapter[m]).toBe('function');
    });
  });

  test('EventBusTaskEvents is a TaskEventPort (prototype chain)', function () {
    expect(new EventBusTaskEvents() instanceof TaskEventPort).toBe(true);
  });
});

// ── publishing: correct EventTypes + payload (matches H2 publisher) ──────────
describe('EventBusTaskEvents — publishes the H2 EventTypes + payload', function () {
  test('publishTaskCreated emits TASK_CREATED with { taskId, userId, status, timestamp }', function () {
    var caps = captureBus();
    var adapter = new EventBusTaskEvents();

    var before = Date.now();
    adapter.publishTaskCreated({ id: 'task-1', userId: 'user-9', status: '' });
    var after = Date.now();

    expect(caps.created).toHaveBeenCalledTimes(1);
    var p = caps.created.mock.calls[0][0];
    expect(p.taskId).toBe('task-1');
    expect(p.userId).toBe('user-9');
    expect(p.status).toBe('');
    expect(typeof p.timestamp).toBe('number');
    expect(p.timestamp).toBeGreaterThanOrEqual(before);
    expect(p.timestamp).toBeLessThanOrEqual(after);
  });

  test('publishTaskUpdated emits TASK_UPDATED', function () {
    var caps = captureBus();
    new EventBusTaskEvents().publishTaskUpdated({ id: 'task-2', userId: 'u', status: 'pending' });
    expect(caps.updated).toHaveBeenCalledTimes(1);
    var p = caps.updated.mock.calls[0][0];
    expect(p.taskId).toBe('task-2');
    expect(p.status).toBe('pending');
  });

  test('publishTaskCompleted emits TASK_COMPLETED with status default "done"', function () {
    var caps = captureBus();
    new EventBusTaskEvents().publishTaskCompleted({ id: 'task-3', userId: 'u' });
    expect(caps.completed).toHaveBeenCalledTimes(1);
    var p = caps.completed.mock.calls[0][0];
    expect(p.taskId).toBe('task-3');
    expect(p.status).toBe('done'); // H2 parity default
  });

  test('nullish-id / nullish-userId guard: no-op (returns null, nothing published)', function () {
    var caps = captureBus();
    var adapter = new EventBusTaskEvents();
    expect(adapter.publishTaskCreated({ id: null, userId: 'u' })).toBeNull();
    expect(adapter.publishTaskCreated({ id: 't', userId: null })).toBeNull();
    expect(adapter.publishTaskCreated(null)).toBeNull();
    expect(caps.created).not.toHaveBeenCalled();
  });

  test('emitted EventTypes are the exact H2 string constants', function () {
    expect(EventTypes.TASK_CREATED).toBe('task.created');
    expect(EventTypes.TASK_UPDATED).toBe('task.updated');
    expect(EventTypes.TASK_COMPLETED).toBe('task.completed');
  });

  test('adapter payload is IDENTICAL to calling the H2 taskEvents publisher directly', function () {
    var caps = captureBus();
    var taskEvents = require('../../../../src/lib/events/taskEvents');
    var adapter = new EventBusTaskEvents();
    var task = { id: 'parity-1', userId: 'pu', status: 'x' };

    adapter.publishTaskCreated(task);
    taskEvents.publishTaskCreated(task);

    expect(caps.created).toHaveBeenCalledTimes(2);
    expect(identity(caps.created.mock.calls[0][0]))
      .toEqual(identity(caps.created.mock.calls[1][0]));
  });
});

// ── E-3: serializable payload ────────────────────────────────────────────────
describe('EventBusTaskEvents — serializable payload (E-3)', function () {
  test('entire captured payload round-trips through JSON losslessly (no knex / Date / circular ref under ANY key)', function () {
    // W4-2 FIX: prior version projected only 4 known-scalar fields before the
    // round-trip, so a non-serializable value (Date, circular ref, Knex-raw) added
    // under ANY OTHER key passed green (zoe M2b confirmed).
    //
    // Fix: capture the FULL payload the bus delivers, strip _eventMeta (the bus
    // enriches every event with _eventMeta.publishedAt: new Date() — an
    // intentional Date that is not part of the app payload), then assert:
    //   1. JSON.stringify does not throw on the app payload
    //   2. JSON.parse(JSON.stringify(appPayload)) deep-equals appPayload (no
    //      lossless coercion — a Date stringifies to a string and round-trips
    //      as a string, not a Date, so deepEqual FAILS if a Date sneaks in)
    //   3. Every value in the app payload is a JSON primitive (string/number/
    //      boolean/null) — a circular ref or Knex-raw object FAILS this check
    //      even if JSON.stringify happened to produce something via toJSON()
    var caps = captureBus();
    new EventBusTaskEvents().publishTaskCreated({ id: 'ser-1', userId: 'su', status: 'todo' });
    var fullPayload = caps.created.mock.calls[0][0];

    // Strip the bus-injected envelope key so we assert the APP payload only.
    // _eventMeta is owned by lib/events (enriches with publishedAt: new Date());
    // it is not part of the TaskEventPort contract and its Date is intentional.
    var appPayload = Object.assign({}, fullPayload);
    delete appPayload._eventMeta;

    // (1) Serializable — no circular ref, no non-serializable object
    expect(function () { JSON.stringify(appPayload); }).not.toThrow();

    // (2) Lossless round-trip — a Date coerces to string and does NOT round-trip
    //     equal (new Date('x') !== 'x'), so a Date under any key FAILS this check
    expect(JSON.parse(JSON.stringify(appPayload))).toEqual(appPayload);

    // (3) Every own value is a JSON-primitive type — catches Knex-raw objects,
    //     Buffer, Symbol, function, or anything whose toJSON() would silently
    //     drop/transform the value above
    Object.keys(appPayload).forEach(function (k) {
      var v = appPayload[k];
      var type = typeof v;
      // null is typeof 'object' but is a valid JSON primitive
      var isJsonPrimitive = v === null || type === 'string' || type === 'number' || type === 'boolean';
      expect(isJsonPrimitive).toBe(true);
    });

    // Spot-check known fields are present with correct types (regression guard)
    expect(typeof appPayload.taskId).toBe('string');
    expect(typeof appPayload.userId).toBe('string');
    expect(typeof appPayload.status).toBe('string');
    expect(typeof appPayload.timestamp).toBe('number');
  });
});

// ── E-2: error isolation (a throwing subscriber must not break publish) ──────
describe('EventBusTaskEvents — error isolation (E-2)', function () {
  test('a throwing subscriber does not throw out of publish', function () {
    resetEventBus();
    getEventBus().subscribe(EventTypes.TASK_CREATED, function () { throw new Error('boom'); });
    var adapter = new EventBusTaskEvents();
    expect(function () {
      adapter.publishTaskCreated({ id: 'iso-1', userId: 'iu', status: '' });
    }).not.toThrow();
  });
});

// ── E-1 / S4 / S6: PUBLISHER NEVER TRIGGERS THE SCHEDULER ────────────────────
describe('EventBusTaskEvents — S4/S6 guard (no scheduler self-trigger / cascade)', function () {
  test('publishing create/update/complete does NOT call enqueueScheduleRun', function () {
    var caps = captureBus();
    mockEnqueueScheduleRun.mockClear();
    var adapter = new EventBusTaskEvents();
    adapter.publishTaskCreated({ id: 't', userId: 'u', status: '' });
    adapter.publishTaskUpdated({ id: 't', userId: 'u', status: '' });
    adapter.publishTaskCompleted({ id: 't', userId: 'u', status: 'done' });

    // delivery happened on each type
    expect(caps.created).toHaveBeenCalledTimes(1);
    expect(caps.updated).toHaveBeenCalledTimes(1);
    expect(caps.completed).toHaveBeenCalledTimes(1);
    // but the scheduler was never triggered
    expect(mockEnqueueScheduleRun).not.toHaveBeenCalled();
  });

  /**
   * Strip line + block comments so the import check ignores prose that legitimately
   * NAMES the scheduler in JSDoc (the modules document WHY they don't import it).
   */
  function stripComments(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
      .replace(/^\s*\/\/.*$/gm, '');      // line comments
  }

  test('STATIC PROOF: adapter CODE (comments stripped) imports no scheduler', function () {
    var src = stripComments(
      fs.readFileSync(path.join(SLICE, 'adapters', 'EventBusTaskEvents.js'), 'utf8'));
    expect(src).not.toMatch(/scheduleQueue/);
    expect(src).not.toMatch(/enqueueScheduleRun/);
    expect(src).not.toMatch(/runSchedule/);
    expect(src).not.toMatch(/unifiedSchedule/);
  });

  test('STATIC PROOF: the wrapped H2 taskEvents publisher CODE imports no scheduler', function () {
    var src = stripComments(fs.readFileSync(
      path.join(SLICE, '..', '..', 'lib', 'events', 'taskEvents.js'), 'utf8'));
    expect(src).not.toMatch(/scheduleQueue/);
    expect(src).not.toMatch(/enqueueScheduleRun/);
    expect(src).not.toMatch(/runSchedule/);
    expect(src).not.toMatch(/unifiedSchedule/);
  });

  test('TRANSITIVE PROOF: EventBusTaskEvents require-graph never loads the scheduler queue', function () {
    jest.resetModules();
    var schedQueuePath = require.resolve('../../../../src/scheduler/scheduleQueue');
    delete require.cache[schedQueuePath];
    require(path.join(SLICE, 'adapters', 'EventBusTaskEvents'));
    expect(require.cache[schedQueuePath]).toBeUndefined();
  });
});
