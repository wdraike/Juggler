/**
 * useTaskState — SSE reconnect-survival regression (999.997 / jug997)
 *
 * Bug: external SSE consumers (AppLayout.jsx, CalSyncPanel.jsx, SchedulerStepper.jsx)
 * bind listeners ONCE on mount to `window.__jugglerEventSource`. Before the fix that
 * global WAS the raw EventSource, which `connectSSE()` REPLACES on every reconnect
 * (onerror -> close -> new EventSource after 5s). So after any reconnect, those
 * once-bound listeners pointed at the closed/dead EventSource instance and silently
 * stopped firing until a full component remount.
 *
 * Fix (useTaskState.js): `window.__jugglerEventSource` is now a STABLE `EventTarget`
 * hub that is never replaced. Each reconnect's raw EventSource forwards the consumer
 * event types (tasks:changed, schedule:changed, schedule:running, sync:progress,
 * sync:error, sync:lock_conflict) onto the hub via `new MessageEvent(type, { data:
 * e.data })`. Consumers keep binding to `window.__jugglerEventSource` with the same
 * addEventListener API — they now survive reconnects because the hub they bound to
 * is never swapped out.
 *
 * Harness mirrors ../useWeather.test.js (renderHook + act + fake timers) and
 * ./useTaskState.test.js (jug946 — apiClient/EventSource mocking shape), but uses a
 * fuller EventSource mock that records addEventListener handlers per-instance so we
 * can drive a specific (first vs. second) raw connection's events directly — the
 * jug946 mock's `addEventListener: jest.fn()` doesn't retain handlers, which this
 * test needs to dispatch from a *specific* stale-vs-fresh EventSource instance.
 */

import { renderHook, act } from '@testing-library/react';
import useTaskState from '../useTaskState';

jest.mock('../../services/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn()
  },
  TZ_OVERRIDE_KEY: 'juggler-tz-override',
  USER_TZ_KEY: 'juggler-user-tz',
  getAccessToken: jest.fn(() => 'jwt-present')
}));

import apiClient, { getAccessToken } from '../../services/apiClient';

// A fuller EventSource mock than jug946's: retains registered listeners per
// instance (keyed by event type) and exposes `.dispatch(type, data)` so a test
// can fire an event from a SPECIFIC (e.g. the second, post-reconnect) raw
// EventSource — the exact thing needed to prove the hub forwards from whichever
// raw connection is currently live.
function makeEventSourceSpy() {
  const instances = [];
  const ES = jest.fn().mockImplementation(function (url) {
    this.url = url;
    this._listeners = {};
    this.onerror = null;
    this.close = jest.fn();
    this.addEventListener = jest.fn((type, handler) => {
      (this._listeners[type] = this._listeners[type] || []).push(handler);
    });
    this.dispatch = (type, data) => {
      (this._listeners[type] || []).forEach((h) => h({ data }));
    };
    instances.push(this);
  });
  ES.instances = instances;
  return ES;
}

let EventSourceSpy;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  delete window.__jugglerEventSource;

  EventSourceSpy = makeEventSourceSpy();
  global.EventSource = EventSourceSpy;

  // react-scripts' jest config sets resetMocks:true, which strips factory-time
  // jest.fn(() => ...) implementations before every test (see jug946 test) —
  // re-arm here.
  getAccessToken.mockImplementation(() => 'jwt-present');
  let tokenSeq = 0;
  apiClient.post.mockImplementation((url) => {
    if (url === '/events/token') {
      tokenSeq += 1;
      return Promise.resolve({ data: { token: 'opaque-token-' + tokenSeq } });
    }
    return Promise.resolve({ data: {} });
  });
  apiClient.get.mockResolvedValue({ data: {} });
});

afterEach(() => {
  jest.useRealTimers();
  delete window.__jugglerEventSource;
});

// Drives connectSSE()'s onerror -> setTimeout(connectSSE, 5000) reconnect path
// and flushes the resulting apiClient.post('/events/token') microtasks so the
// new (second) raw EventSource is constructed before the assertion runs.
async function simulateReconnect(staleES) {
  act(() => {
    staleES.onerror();
  });
  expect(staleES.close).toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

test('RECONNECT-SURVIVAL (999.997): a listener bound ONCE to window.__jugglerEventSource before a reconnect still fires after it', async () => {
  const { unmount } = renderHook(() => useTaskState());

  // Let the first connectSSE() resolve its token POST and construct the
  // first raw EventSource.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(EventSourceSpy).toHaveBeenCalledTimes(1);
  const firstES = EventSourceSpy.instances[0];

  // External consumer binds ONCE to the (supposedly) stable global, exactly
  // as AppLayout.jsx / CalSyncPanel.jsx / SchedulerStepper.jsx do on mount.
  const consumerSpy = jest.fn();
  window.__jugglerEventSource.addEventListener('tasks:changed', consumerSpy);

  // Force a reconnect: the first raw EventSource errors, closes, and a NEW
  // one connects 5s later (connectSSE's onerror path).
  await simulateReconnect(firstES);
  expect(EventSourceSpy).toHaveBeenCalledTimes(2);
  const secondES = EventSourceSpy.instances[1];
  expect(secondES).not.toBe(firstES);

  // Dispatch tasks:changed from the NEW (second) raw EventSource only — the
  // once-bound consumer never re-binds to it directly.
  act(() => {
    secondES.dispatch('tasks:changed', JSON.stringify({ ids: [] }));
  });

  // RED on pre-fix code: pre-fix, window.__jugglerEventSource WAS firstES at
  // bind time, so the consumer's listener sits on the closed instance and
  // never sees an event dispatched from secondES. GREEN post-fix: the
  // consumer bound to the stable hub, which the new raw ES forwards into.
  expect(consumerSpy).toHaveBeenCalledTimes(1);

  unmount();
});

test('forwarded event preserves e.data so a consumer can JSON.parse it', async () => {
  const { unmount } = renderHook(() => useTaskState());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const firstES = EventSourceSpy.instances[0];
  const consumerSpy = jest.fn();
  window.__jugglerEventSource.addEventListener('schedule:changed', consumerSpy);

  const payload = JSON.stringify({ changeset: { added: [], changed: [], removed: [] } });
  act(() => {
    firstES.dispatch('schedule:changed', payload);
  });

  expect(consumerSpy).toHaveBeenCalledTimes(1);
  const forwarded = consumerSpy.mock.calls[0][0];
  expect(forwarded.data).toBe(payload);
  expect(JSON.parse(forwarded.data)).toEqual({ changeset: { added: [], changed: [], removed: [] } });

  unmount();
});

test('window.__jugglerEventSource is a STABLE EventTarget hub whose identity survives a reconnect', async () => {
  const { unmount } = renderHook(() => useTaskState());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const hubBefore = window.__jugglerEventSource;
  expect(hubBefore).toBeInstanceOf(EventTarget);
  expect(hubBefore.__jugglerHub).toBe(true);
  expect(hubBefore).not.toBeInstanceOf(EventSourceSpy);

  const firstES = EventSourceSpy.instances[0];
  await simulateReconnect(firstES);
  expect(EventSourceSpy).toHaveBeenCalledTimes(2);

  // Same object identity before and after the reconnect — never orphaned/replaced.
  expect(window.__jugglerEventSource).toBe(hubBefore);

  unmount();
});
