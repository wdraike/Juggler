/**
 * PORT-CONTRACT test for the 6 infrastructure port interfaces (999.1535).
 *
 * Mirrors the libCalApiPorts.contract.test.js idiom (zoe finding, 2026-07-02):
 * pins down the exact invariant these port files exist to document — the
 * wrapped module MUST expose exactly the port's declared method surface — as
 * an enforced test, not a one-time manual claim. Without this, a future
 * add/remove of an export on the wrapped module silently drifts from its
 * port with zero test failure.
 *
 * Also asserts the port abstract base throws "not implemented" on every
 * declared method, and that the METHODS array is frozen.
 *
 * Pure unit — no DB, no Redis, no network.
 */

'use strict';

var RedisPort = require('../src/lib/ports/RedisPort');
var { REDIS_PORT_METHODS } = RedisPort;
var EventPublisherPort = require('../src/lib/ports/EventPublisherPort');
var { EVENT_PUBLISHER_PORT_METHODS } = EventPublisherPort;
var LockPort = require('../src/lib/ports/LockPort');
var { LOCK_PORT_METHODS } = LockPort;
var PushNotificationPort = require('../src/lib/ports/PushNotificationPort');
var { PUSH_NOTIFICATION_PORT_METHODS } = PushNotificationPort;
var TaskWriteQueuePort = require('../src/lib/ports/TaskWriteQueuePort');
var { TASK_WRITE_QUEUE_PORT_METHODS } = TaskWriteQueuePort;
var EncryptionPort = require('../src/lib/ports/EncryptionPort');
var { ENCRYPTION_PORT_METHODS } = EncryptionPort;

var redisModule = require('../src/lib/redis');
var sseEmitterModule = require('../src/lib/sse-emitter');
var syncLockModule = require('../src/lib/sync-lock');
var pushServiceModule = require('../src/lib/push-service');
var taskWriteQueueModule = require('../src/lib/task-write-queue');
var credentialEncryptModule = require('../src/lib/credential-encrypt');

// ── Helper: assert a port conformance suite ──────────────────────────────

function assertPortConformance(Port, methods, moduleName, moduleExports, opts) {
  opts = opts || {};

  test(methods.length + ' METHODS array is frozen', function () {
    expect(Object.isFrozen(methods)).toBe(true);
  });

  test('abstract base throws "not implemented" on every method', function () {
    var base = new Port();
    methods.forEach(function (m) {
      expect(function () { return base[m](); }).toThrow(/not implemented/);
    });
  });

  if (opts.exactMatch) {
    test(moduleName + ' exposes EXACTLY the ' + methods.length + ' method surface — no more, no fewer', function () {
      expect(Object.keys(moduleExports).sort()).toEqual(methods.slice().sort());
      methods.forEach(function (m) {
        expect(typeof moduleExports[m]).toBe('function');
      });
    });
  } else {
    test(moduleName + ' exposes all ' + methods.length + ' port methods as functions', function () {
      methods.forEach(function (m) {
        expect(typeof moduleExports[m]).toBe('function');
      });
    });
  }
}

// ── RedisPort ────────────────────────────────────────────────────────────

describe('RedisPort conformance', function () {
  assertPortConformance(RedisPort, REDIS_PORT_METHODS, 'redis.js', redisModule, { exactMatch: true });
});

// ── EventPublisherPort ───────────────────────────────────────────────────

describe('EventPublisherPort conformance', function () {
  assertPortConformance(EventPublisherPort, EVENT_PUBLISHER_PORT_METHODS, 'sse-emitter.js', sseEmitterModule, { exactMatch: true });
});

// ── LockPort ─────────────────────────────────────────────────────────────

describe('LockPort conformance', function () {
  assertPortConformance(LockPort, LOCK_PORT_METHODS, 'sync-lock.js', syncLockModule, { exactMatch: true });
});

// ── PushNotificationPort ─────────────────────────────────────────────────
// push-service.js exports _resetConfigForTests (test-only) alongside the
// 4 port methods — deliberately excluded from the contract (same pattern as
// AppleCalApiPort excluding DEFAULT_SERVER_URL).

describe('PushNotificationPort conformance', function () {
  assertPortConformance(PushNotificationPort, PUSH_NOTIFICATION_PORT_METHODS, 'push-service.js', pushServiceModule, { exactMatch: false });

  test('push-service.js exposes the 4 port methods (test-only _resetConfigForTests excluded)', function () {
    var functionKeys = Object.keys(pushServiceModule).filter(function (k) {
      return typeof pushServiceModule[k] === 'function';
    });
    PUSH_NOTIFICATION_PORT_METHODS.forEach(function (m) {
      expect(functionKeys).toContain(m);
    });
    expect(PUSH_NOTIFICATION_PORT_METHODS).not.toContain('_resetConfigForTests');
  });
});

// ── TaskWriteQueuePort ───────────────────────────────────────────────────
// task-write-queue.js exports NON_SCHEDULING_FIELDS (a Set constant) alongside
// the 5 port methods — deliberately excluded from the contract (same pattern
// as AppleCalApiPort excluding DEFAULT_SERVER_URL).

describe('TaskWriteQueuePort conformance', function () {
  assertPortConformance(TaskWriteQueuePort, TASK_WRITE_QUEUE_PORT_METHODS, 'task-write-queue.js', taskWriteQueueModule, { exactMatch: false });

  test('task-write-queue.js exposes the 5 port methods (NON_SCHEDULING_FIELDS constant excluded)', function () {
    var functionKeys = Object.keys(taskWriteQueueModule).filter(function (k) {
      return typeof taskWriteQueueModule[k] === 'function';
    });
    TASK_WRITE_QUEUE_PORT_METHODS.forEach(function (m) {
      expect(functionKeys).toContain(m);
    });
    expect(TASK_WRITE_QUEUE_PORT_METHODS).not.toContain('NON_SCHEDULING_FIELDS');
  });
});

// ── EncryptionPort ───────────────────────────────────────────────────────

describe('EncryptionPort conformance', function () {
  assertPortConformance(EncryptionPort, ENCRYPTION_PORT_METHODS, 'credential-encrypt.js', credentialEncryptModule, { exactMatch: true });
});