/**
 * Characterization tests for bugminerReporter.js — vendored @raike/lib-error-reporter
 * consumed by juggler-frontend (leg bugminer-leg-b-juggler-fe, 999.454 B2).
 *
 * Covers:
 *   - All 11 baselines from the deleted errorReporter.test.js (adapted to shared API)
 *   - NEW: BC3 — installErrorReporter() w/o {app} throws; app:'juggler' sets _config.app
 *   - NEW: BC4 — POSTed payload carries app + page fields
 *
 * CRA jest + jsdom. CommonJS module => ESM interop via CRA/webpack (import { ... } from '...').
 */
import {
  installErrorReporter,
  _onError,
  _onRejection,
  _send,
  _signature,
  _reset,
  _config,
} from './bugminerReporter';

beforeEach(() => {
  _reset();
  // Stub global.fetch so the default-fetch path never hits the (jsdom) network.
  global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
});

afterEach(() => {
  delete global.fetch;
});

// ---------------------------------------------------------------------------
// BC3 (NEW) -- required-app contract
// ---------------------------------------------------------------------------

test('BC3 installErrorReporter() with no {app} throws', () => {
  expect(() => installErrorReporter()).toThrow('installErrorReporter: app (service slug) is required');
});

test('BC3 installErrorReporter({ app: "juggler" }) sets _config.app === "juggler"', () => {
  installErrorReporter({ app: 'juggler' });
  expect(_config.app).toBe('juggler');
});

// ---------------------------------------------------------------------------
// AC-2.1 -- install registers listeners, idempotent
// ---------------------------------------------------------------------------

test('AC-2.1 installErrorReporter registers error + unhandledrejection listeners (idempotent)', () => {
  const spy = jest.spyOn(window, 'addEventListener');
  expect(installErrorReporter({ app: 'juggler' })).toBe(true);
  const events = spy.mock.calls.map((c) => c[0]);
  expect(events).toContain('error');
  expect(events).toContain('unhandledrejection');
  // Second call: already installed, returns false
  expect(installErrorReporter({ app: 'juggler' })).toBe(false);
  spy.mockRestore();
});

// ---------------------------------------------------------------------------
// AC-2.2 -- coalesce / distinct errors
// ---------------------------------------------------------------------------

test('AC-2.2 an error event POSTs exactly once; identical error within window is coalesced', () => {
  const fetchMock = jest.fn(() => Promise.resolve({ ok: true }));
  expect(_send({ kind: 'error', message: 'Boom', source: 'app.js' }, fetchMock)).toBe(true);
  expect(_send({ kind: 'error', message: 'Boom', source: 'app.js' }, fetchMock)).toBe(false); // coalesced
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, opts] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/client-errors');
  expect(JSON.parse(opts.body).message).toBe('Boom');
});

test('AC-2.2 distinct errors are NOT coalesced', () => {
  const fetchMock = jest.fn(() => Promise.resolve({}));
  _send({ kind: 'error', message: 'A', source: 'a.js' }, fetchMock);
  _send({ kind: 'error', message: 'B', source: 'b.js' }, fetchMock);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

// ---------------------------------------------------------------------------
// BC4 (NEW) -- payload carries app + page fields after install
// ---------------------------------------------------------------------------

test('BC4 POSTed payload carries app:"juggler" and a page field after install with {app:"juggler"}', () => {
  // Must install so _config.app is populated (calling _send directly without install yields
  // app:'unknown'; the assertion proves the install path flows through correctly).
  installErrorReporter({ app: 'juggler' });

  const fetchMock = jest.fn(() => Promise.resolve({ ok: true }));

  // Drive _onError with the global fetch stubbed so _send uses it
  global.fetch = fetchMock;
  const err = new Error('bc4-test');
  err.stack = 'Error: bc4-test\n    at x (bc4.js:1:1)';
  _onError({ message: 'bc4-test', filename: 'bc4.js', lineno: 1, colno: 1, error: err });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.app).toBe('juggler');
  // page must be present (may be '' in jsdom but must be a field in the payload)
  expect(Object.prototype.hasOwnProperty.call(body, 'page')).toBe(true);
});

// ---------------------------------------------------------------------------
// AC-2.3 -- fail-silent contract
// ---------------------------------------------------------------------------

test('AC-2.3 fail-silent: a throwing fetch never propagates out of _send', () => {
  const throwingFetch = () => { throw new Error('network exploded'); };
  expect(() => _send({ kind: 'error', message: 'x' }, throwingFetch)).not.toThrow();
});

test('AC-2.3 fail-silent: a rejecting fetch is swallowed (no unhandled rejection)', async () => {
  const rejectingFetch = () => Promise.reject(new Error('5xx'));
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    expect(() => _send({ kind: 'error', message: 'y' }, rejectingFetch)).not.toThrow();
    // Let the rejected promise settle -- the .catch inside _send must absorb it
    await new Promise((r) => setTimeout(r, 10));
    expect(unhandled).toHaveLength(0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('AC-2.3 _onError / _onRejection never throw even on a malformed event', () => {
  expect(() => _onError(undefined)).not.toThrow();
  expect(() => _onError({})).not.toThrow();
  expect(() => _onRejection(undefined)).not.toThrow();
  expect(() => _onRejection({ reason: null })).not.toThrow();
});

// ---------------------------------------------------------------------------
// _signature
// ---------------------------------------------------------------------------

test('_signature distinguishes by kind/message/source', () => {
  expect(_signature({ kind: 'error', message: 'm', source: 's' }))
    .not.toBe(_signature({ kind: 'error', message: 'm', source: 't' }));
});

// ---------------------------------------------------------------------------
// AC-2.2 -- coalesce-window expiry + no-fetch guard
// ---------------------------------------------------------------------------

test('AC-2.2 _seen coalesce-window: same error AFTER window expires fires again', () => {
  const fetchMock = jest.fn(() => Promise.resolve({}));
  const payload = { kind: 'error', message: 'stale-test', source: 'app.js' };
  // First send -- recorded in _seen
  expect(_send(payload, fetchMock)).toBe(true);
  // Advance Date.now past COALESCE_MS (5000ms) so the window is expired
  const realNow = Date.now;
  Date.now = jest.fn(() => realNow() + 6000);
  expect(_send(payload, fetchMock)).toBe(true); // window expired -> allowed
  expect(fetchMock).toHaveBeenCalledTimes(2);
  Date.now = realNow;
});

test('AC-2.2 _send with no fetch available returns false, does not throw', () => {
  delete global.fetch;
  expect(() => {
    const result = _send({ kind: 'error', message: 'no-fetch' }, undefined);
    expect(result).toBe(false);
  }).not.toThrow();
  // Restore for afterEach
  global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
});

// ---------------------------------------------------------------------------
// AC-2.1 -- _onError and _onRejection extraction
// ---------------------------------------------------------------------------

test('AC-2.1 _onError extracts message, filename, lineno, colno, and stack from event', () => {
  const fetchMock = jest.fn(() => Promise.resolve({}));
  global.fetch = fetchMock;
  const err = new Error('test-extraction');
  err.stack = 'Error: test-extraction\n    at x (app.js:10:5)';
  _onError({ message: 'test-extraction', filename: 'app.js', lineno: 10, colno: 5, error: err });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.kind).toBe('error');
  expect(body.message).toBe('test-extraction');
  expect(body.source).toBe('app.js');
  expect(body.lineno).toBe(10);
  expect(body.stack).toContain('test-extraction');
});

test('AC-2.1 _onRejection extracts reason.message and reason.stack', () => {
  const fetchMock = jest.fn(() => Promise.resolve({}));
  global.fetch = fetchMock;
  const reason = new Error('rejected-promise');
  reason.stack = 'Error: rejected-promise\n    at p (p.js:3:1)';
  _onRejection({ reason });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.kind).toBe('unhandledrejection');
  expect(body.message).toBe('rejected-promise');
  expect(body.stack).toContain('rejected-promise');
});
