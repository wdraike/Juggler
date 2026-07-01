/**
 * useTaskState — connectSSE() unmount-race regression (999.946 / jug946)
 *
 * connectSSE() exchanges the JWT for a one-time opaque SSE token
 * (`apiClient.post('/events/token')`) before opening `EventSource`. The
 * effect-scoped `sseTornDown` flag (set true in the effect cleanup) guards
 * both the token-POST `.then` and `.catch` so a POST resolving AFTER
 * unmount is a no-op instead of opening a zombie `EventSource` that nothing
 * will ever close (bird BLOCK-1, zoe WARN F1: async gap between the POST and
 * the EventSource construction races the cleanup, which only checks the
 * `eventSource` var — still null while the POST is in flight).
 *
 * Mirrors the renderHook + unmount() + act(async) shape already proven in
 * ../__tests__/useWeather.test.js.
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
  getAccessToken: jest.fn(() => 'raw-jwt-should-never-reach-sse-url')
}));

import apiClient, { getAccessToken } from '../../services/apiClient';

function makeDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let EventSourceSpy;

beforeEach(() => {
  jest.clearAllMocks();
  window.__jugglerEventSource = undefined;
  EventSourceSpy = jest.fn().mockImplementation(function (url) {
    this.url = url;
    this.addEventListener = jest.fn();
    this.close = jest.fn();
  });
  global.EventSource = EventSourceSpy;
  // react-scripts' Jest config sets resetMocks:true, which strips the
  // factory-time `jest.fn(() => ...)` implementation before every test —
  // so the "raw JWT is present" precondition must be re-armed here, not
  // only at jest.mock() factory time.
  getAccessToken.mockImplementation(() => 'raw-jwt-should-never-reach-sse-url');
  // Any non-/events/token POST (nudge, status, etc.) resolves harmlessly.
  apiClient.post.mockImplementation((url) => {
    if (url === '/events/token') return Promise.resolve({ data: { token: 'unused-default' } });
    return Promise.resolve({ data: {} });
  });
  apiClient.get.mockResolvedValue({ data: {} });
});

afterEach(() => {
  delete window.__jugglerEventSource;
});

test('does NOT construct EventSource when the /events/token POST resolves AFTER unmount (sseTornDown guard)', async () => {
  const deferred = makeDeferred();
  apiClient.post.mockImplementation((url) => {
    if (url === '/events/token') return deferred.promise;
    return Promise.resolve({ data: {} });
  });

  const { unmount } = renderHook(() => useTaskState());

  // Precondition check (guards against a vacuous pass): connectSSE() must
  // actually have reached the token POST before we unmount, otherwise
  // "EventSource never constructed" would be true for a trivial reason
  // (e.g. getAccessToken() returning falsy and short-circuiting to
  // startPolling()) and would prove nothing about the sseTornDown guard.
  expect(apiClient.post).toHaveBeenCalledWith('/events/token');

  // connectSSE() has fired and the token POST is in-flight (unresolved).
  // Unmount BEFORE resolving it — this is the exact race the guard closes.
  unmount();

  // Resolve the deferred POST AFTER unmount, inside act(async) so React
  // flushes any (dis-)effects triggered by the resolution.
  await act(async () => {
    deferred.resolve({ data: { token: 'opaque-post-unmount' } });
    await Promise.resolve();
    await Promise.resolve();
  });

  // The guard must have held: no zombie EventSource ever constructed, and
  // window.__jugglerEventSource must NOT have been overwritten with a live
  // post-teardown instance.
  //
  // 999.997 note: window.__jugglerEventSource is now a STABLE EventTarget hub
  // created synchronously in the effect body (before the async token POST
  // resolves), so it is no longer `undefined` here — it's the hub. What the
  // guard actually protects is that the hub is never replaced by the
  // post-teardown raw EventSource, which we assert directly.
  expect(EventSourceSpy).not.toHaveBeenCalled();
  expect(window.__jugglerEventSource).not.toBeInstanceOf(EventSourceSpy);
});

test('constructs EventSource with the opaque token (not the raw JWT) when the token POST resolves while still MOUNTED', async () => {
  apiClient.post.mockImplementation((url) => {
    if (url === '/events/token') return Promise.resolve({ data: { token: 'opaque-happy-path' } });
    return Promise.resolve({ data: {} });
  });

  const { unmount } = renderHook(() => useTaskState());

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(EventSourceSpy).toHaveBeenCalledTimes(1);
  const calledUrl = EventSourceSpy.mock.calls[0][0];
  expect(calledUrl).toContain('token=opaque-happy-path');
  expect(calledUrl).not.toContain('raw-jwt-should-never-reach-sse-url');
  // 999.997: window.__jugglerEventSource is the stable EventTarget hub, not
  // the raw per-connect EventSource (see useTaskState.sse-hub-reconnect.test.js
  // for the reconnect-survival contract this enables).
  expect(window.__jugglerEventSource).not.toBeInstanceOf(EventSourceSpy);
  expect(window.__jugglerEventSource.__jugglerHub).toBe(true);

  unmount();
});
