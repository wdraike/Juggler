'use strict';

/**
 * Unit tests — src/lib/notify-reminder.js (999.1209 JUG-TEST-REMINDER-DISPATCH).
 *
 * The single task-reminder dispatch point (999.252): fan-out to BOTH channels —
 * in-app SSE `reminder` event AND web push. Pure unit, NO DB: sse-emitter,
 * push-service, and push-subscriptions are mocked at the module boundary.
 *
 * Pins the module's contract:
 *   1. both channels fire with the SAME normalized payload;
 *   2. push is wired to the real push-subscriptions repository callbacks
 *      (loadSubscriptions + deleteById) — this is what makes dead-subscription
 *      pruning work in production;
 *   3. fail-soft is PER-CHANNEL: an SSE throw never blocks push, a push throw
 *      never rejects the dispatch, and each failure is logged.
 */

var mockEmit = jest.fn();
var mockSendPush = jest.fn();
var mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };

// Named marker fns so we can assert IDENTITY wiring of the repo callbacks.
var mockLoadSubscriptions = jest.fn();
var mockDeleteById = jest.fn();

jest.mock('../../src/lib/sse-emitter', () => ({
  emit: mockEmit,
}));

jest.mock('../../src/lib/push-service', () => ({
  sendPush: mockSendPush,
}));

jest.mock('../../src/lib/push-subscriptions', () => ({
  loadSubscriptions: mockLoadSubscriptions,
  deleteById: mockDeleteById,
}));

jest.mock('@raike/lib-logger', () => ({
  createLogger: () => mockLogger,
}));

const { dispatchTaskReminder } = require('../../src/lib/notify-reminder');

const DISABLED_PUSH = { enabled: false, sent: 0, pruned: 0, failed: 0 };

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): per-test mockImplementation overrides
  // (e.g. the SSE-throw test) must not leak into subsequent tests.
  jest.resetAllMocks();
  mockSendPush.mockResolvedValue({ enabled: true, sent: 1, pruned: 0, failed: 0 });
});

describe('dispatchTaskReminder — dual-channel fan-out', () => {
  test('fires BOTH channels with the same normalized payload and reports both results', async () => {
    const result = await dispatchTaskReminder('user-1', {
      taskId: 't42',
      title: 'Stand-up',
      body: 'in 5 minutes',
      url: '/tasks/t42',
    });

    const expectedPayload = {
      type: 'task-reminder',
      taskId: 't42',
      title: 'Stand-up',
      body: 'in 5 minutes',
      url: '/tasks/t42',
    };

    // channel 1: in-app SSE
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith('user-1', 'reminder', expectedPayload);

    // channel 2: web push — same user, same payload
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(mockSendPush.mock.calls[0][1]).toBe('user-1');
    expect(mockSendPush.mock.calls[0][2]).toEqual(expectedPayload);

    expect(result).toEqual({ inApp: true, push: { enabled: true, sent: 1, pruned: 0, failed: 0 } });
  });

  test('wires the REAL push-subscriptions repo callbacks into sendPush (prune path wiring)', async () => {
    await dispatchTaskReminder('user-1', { title: 'x' });

    const deps = mockSendPush.mock.calls[0][0];
    // Identity assertions: a refactor that swaps in wrong/no-op callbacks
    // (silently breaking dead-subscription pruning) fails here.
    expect(deps.loadSubscriptions).toBe(mockLoadSubscriptions);
    expect(deps.deleteSubscription).toBe(mockDeleteById);
  });

  test('normalizes a minimal reminder: default title/body/url and null taskId', async () => {
    await dispatchTaskReminder('user-1', {});

    const expectedPayload = {
      type: 'task-reminder',
      taskId: null,
      title: 'Task reminder',
      body: '',
      url: '/',
    };
    expect(mockEmit).toHaveBeenCalledWith('user-1', 'reminder', expectedPayload);
    expect(mockSendPush.mock.calls[0][2]).toEqual(expectedPayload);
  });

  test('propagates the push channel result verbatim (sent/pruned/failed counters)', async () => {
    mockSendPush.mockResolvedValue({ enabled: true, sent: 3, pruned: 2, failed: 1 });

    const result = await dispatchTaskReminder('user-1', { title: 'x' });

    expect(result.push).toEqual({ enabled: true, sent: 3, pruned: 2, failed: 1 });
  });
});

describe('dispatchTaskReminder — per-channel fail-soft isolation', () => {
  test('SSE emit throwing does NOT block push: push still fires, inApp=false, warn logged', async () => {
    mockEmit.mockImplementation(() => { throw new Error('sse broke'); });
    mockSendPush.mockResolvedValue({ enabled: true, sent: 2, pruned: 0, failed: 0 });

    const result = await dispatchTaskReminder('user-1', { title: 'x' });

    expect(result.inApp).toBe(false);
    // push channel unaffected
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(result.push).toEqual({ enabled: true, sent: 2, pruned: 0, failed: 0 });
    // failure is observable
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0][1]).toEqual({ userId: 'user-1', error: 'sse broke' });
  });

  test('push rejecting does NOT reject the dispatch: resolves with disabled-push default, inApp=true, error logged', async () => {
    mockSendPush.mockRejectedValue(new Error('vapid misconfigured'));

    const result = await dispatchTaskReminder('user-1', { title: 'x' });

    // no throw, in-app channel unaffected
    expect(result.inApp).toBe(true);
    expect(mockEmit).toHaveBeenCalledTimes(1);
    // push result falls back to the explicit disabled default
    expect(result.push).toEqual(DISABLED_PUSH);
    // failure is observable (item risk: fail-soft must not be fail-silent)
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error.mock.calls[0][1]).toEqual({ userId: 'user-1', error: 'vapid misconfigured' });
  });

  test('BOTH channels failing still resolves (never throws) and logs both failures', async () => {
    mockEmit.mockImplementation(() => { throw new Error('sse broke'); });
    mockSendPush.mockRejectedValue(new Error('push broke'));

    const result = await dispatchTaskReminder('user-1', { title: 'x' });

    expect(result).toEqual({ inApp: false, push: DISABLED_PUSH });
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });

  test('push disabled (no VAPID config) is a normal result, not an error: nothing logged', async () => {
    // push-service itself fail-softs to a disabled result without throwing.
    mockSendPush.mockResolvedValue(DISABLED_PUSH);

    const result = await dispatchTaskReminder('user-1', { title: 'x' });

    expect(result).toEqual({ inApp: true, push: DISABLED_PUSH });
    expect(mockLogger.error).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
