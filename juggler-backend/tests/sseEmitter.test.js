/**
 * FIX-02: SSE emitter Redis pub/sub contract.
 *
 * Tests:
 *   1. When REDIS_URL is set to a reachable Redis, emit() publishes via Redis.
 *   2. When REDIS_URL is unset / Redis unreachable, emit() falls back to local
 *      emit and does not throw.
 *   3. Module load with REDIS_URL=undefined does NOT crash the process.
 *
 * Strategy: ioredis-mock is not installed. We use jest.doMock() (non-hoisted)
 * so we can reference helper functions from within factory closures.
 * jest.mock() (hoisted) does NOT allow out-of-scope variable access.
 */
process.env.NODE_ENV = 'test';

// ── helpers ────────────────────────────────────────────────────────────────
//
// Variables prefixed with `mock` are allowed in jest.mock() factories.
// For jest.doMock() there is no such restriction, but naming them clearly helps.

function mockMakeIoredisInstance({ status = 'ready', publishFails = false } = {}) {
  const instance = {
    status,
    _publishedMessages: [],
    _onMessageHandler: null,
    publish: jest.fn(function(channel, message) {
      if (publishFails) return Promise.reject(new Error('Redis publish failed'));
      instance._publishedMessages.push({ channel, message });
      if (instance._onMessageHandler) instance._onMessageHandler(channel, message);
      return Promise.resolve(1);
    }),
    subscribe: jest.fn(function() { return Promise.resolve(); }),
    unsubscribe: jest.fn(function() { return Promise.resolve(); }),
    on: jest.fn(function(event, handler) {
      if (event === 'message') instance._onMessageHandler = handler;
      return instance;
    })
  };
  return instance;
}

// ── Test 3 (process-crash guard) ─────────────────────────────────────────

describe('sseEmitter module load', function() {
  test('loading with REDIS_URL=undefined does not crash the process', function() {
    const savedUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    // Use jest.doMock (non-hoisted) so we can reference our helper
    jest.doMock('ioredis', function() {
      return function IORedisMock() {
        return mockMakeIoredisInstance({ status: 'connecting' });
      };
    });

    jest.resetModules();

    expect(function() {
      require('../src/lib/sse-emitter');
    }).not.toThrow();

    if (savedUrl !== undefined) process.env.REDIS_URL = savedUrl;
    jest.resetModules();
    jest.unmock('ioredis');
  });
});

// ── Test 1: Redis path — emit() publishes when status === 'ready' ──────────

describe('sseEmitter.emit — Redis path', function() {
  var sseEmitter;
  var mockPublisher;
  var mockSubscriber;

  beforeEach(function() {
    jest.resetModules();
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    mockPublisher = undefined;
    mockSubscriber = undefined;

    var callCount = 0;
    jest.doMock('ioredis', function() {
      return function IORedisMock() {
        callCount++;
        // sse-emitter.js lazily creates subscriber first (via addClient → getSubscriber),
        // then publisher (via emit → getPublisher).
        if (callCount === 1) {
          mockSubscriber = mockMakeIoredisInstance({ status: 'ready' });
          return mockSubscriber;
        }
        mockPublisher = mockMakeIoredisInstance({ status: 'ready' });
        return mockPublisher;
      };
    });

    sseEmitter = require('../src/lib/sse-emitter');
  });

  afterEach(function() {
    jest.resetModules();
    jest.unmock('ioredis');
    delete process.env.REDIS_URL;
  });

  test('emit() calls Redis publish when publisher status is ready', function() {
    var fakeRes = { write: jest.fn(), on: jest.fn() };
    // addClient triggers getSubscriber (first ioredis instance)
    sseEmitter.addClient('user123', fakeRes);

    // emit() triggers getPublisher (second ioredis instance), then publish
    sseEmitter.emit('user123', 'tasks:changed', { foo: 'bar' });

    expect(mockPublisher).toBeDefined();
    expect(mockPublisher.publish).toHaveBeenCalledWith(
      'sse:user123',
      expect.stringContaining('tasks:changed')
    );
  });
});

// ── Test 2: Fallback path — emit() uses local delivery when Redis is down ─

describe('sseEmitter.emit — local fallback path', function() {
  var sseEmitter;
  var warnSpy;

  beforeEach(function() {
    jest.resetModules();
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(function() {});

    var callCount = 0;
    jest.doMock('ioredis', function() {
      return function IORedisMock() {
        callCount++;
        if (callCount === 1) {
          // Subscriber: not connected
          return mockMakeIoredisInstance({ status: 'connecting' });
        }
        // Publisher: not ready → sse-emitter falls through to local emit
        return mockMakeIoredisInstance({ status: 'connecting' });
      };
    });

    sseEmitter = require('../src/lib/sse-emitter');
  });

  afterEach(function() {
    warnSpy.mockRestore();
    jest.resetModules();
    jest.unmock('ioredis');
    delete process.env.REDIS_URL;
  });

  test('emit() falls back to local write and does not throw when Redis is down', function() {
    var localPayloads = [];
    var fakeRes = {
      write: jest.fn(function(payload) { localPayloads.push(payload); }),
      on: jest.fn()
    };
    sseEmitter.addClient('user456', fakeRes);

    expect(function() {
      sseEmitter.emit('user456', 'schedule:changed', { ok: true });
    }).not.toThrow();

    expect(fakeRes.write).toHaveBeenCalled();
    var written = fakeRes.write.mock.calls[0][0];
    expect(written).toContain('schedule:changed');
  });

  test('emit() logs a warning when publish fails and falls back to local', function() {
    jest.resetModules();
    jest.unmock('ioredis');

    var callCount2 = 0;
    jest.doMock('ioredis', function() {
      return function IORedisMock() {
        callCount2++;
        if (callCount2 === 1) return mockMakeIoredisInstance({ status: 'connecting' });
        // Publisher is "ready" but publish() rejects
        return mockMakeIoredisInstance({ status: 'ready', publishFails: true });
      };
    });

    // sse-emitter uses @raike/lib-logger (Winston). Winston routes warn-level output
    // through console._stdout.write or _consoleLog depending on Jest TTY mode,
    // making console-level spies unreliable across suite runs. Mock the logger
    // module directly so we can inspect calls regardless of Winston internals.
    var mockWarn = jest.fn();
    jest.doMock('@raike/lib-logger', function() {
      return {
        createLogger: function() {
          return { info: jest.fn(), warn: mockWarn, error: jest.fn(), debug: jest.fn() };
        },
        logger: { info: jest.fn(), warn: mockWarn, error: jest.fn(), debug: jest.fn() },
        transports: {},
        format: {}
      };
    });

    var sseEmitter2 = require('../src/lib/sse-emitter');
    var fakeRes2 = { write: jest.fn(), on: jest.fn() };
    sseEmitter2.addClient('user789', fakeRes2);

    sseEmitter2.emit('user789', 'tasks:changed', {});

    return new Promise(function(resolve) {
      setTimeout(function() {
        // Verify that logger.warn was called with the publish-failure message
        expect(mockWarn).toHaveBeenCalled();
        var warnMessages = mockWarn.mock.calls.map(function(c) { return c[0]; }).join(' ');
        expect(warnMessages).toContain('publish failed');
        resolve();
      }, 150);
    });
  });
});
