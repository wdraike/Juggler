/**
 * Tests for the passive browser-error reporter (leg log-issue-triage-browsercapture).
 * CRA jest + jsdom. Verifies handler install, debounce/coalesce, and the fail-silent contract.
 */
import {
  installErrorReporter, _onError, _onRejection, _send, _signature, _reset,
} from './errorReporter';

beforeEach(() => {
  _reset();
  // Stub global fetch so the default-fetch path never hits the (jsdom) network.
  global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
});
afterEach(() => { delete global.fetch; });

test('AC-2.1 installErrorReporter registers error + unhandledrejection listeners (idempotent)', () => {
  const spy = jest.spyOn(window, 'addEventListener');
  expect(installErrorReporter()).toBe(true);
  const events = spy.mock.calls.map((c) => c[0]);
  expect(events).toContain('error');
  expect(events).toContain('unhandledrejection');
  expect(installErrorReporter()).toBe(false); // second call is a no-op
  spy.mockRestore();
});

test('AC-2.2 an error event POSTs exactly once; identical error within window is coalesced', () => {
  const fetchMock = jest.fn(() => Promise.resolve({ ok: true }));
  const ev = { message: 'Boom', filename: 'app.js', lineno: 5, colno: 1, error: { stack: 'Boom\n at x' } };
  // drive _send directly with the injected fetch (the listeners call the no-arg _send)
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
    // let the rejected promise settle a microtask/macrotask later — the .catch must absorb it
    await new Promise((r) => setTimeout(r, 10));
    expect(unhandled).toHaveLength(0); // the reporter's .catch swallowed it; nothing escaped
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

test('_signature distinguishes by kind/message/source', () => {
  expect(_signature({ kind: 'error', message: 'm', source: 's' }))
    .not.toBe(_signature({ kind: 'error', message: 'm', source: 't' }));
});

// ---- Tests authored by telly (leg log-issue-triage-browsercapture) ----------------

test('AC-2.2 _seen Map coalesce-window: same error sent again AFTER window expires fires again', () => {
  // Simulate stale entry by backdating the recorded timestamp beyond COALESCE_MS (5000ms)
  const fetchMock = jest.fn(() => Promise.resolve({}));
  const payload = { kind: 'error', message: 'stale-test', source: 'app.js' };
  // First send — recorded in _seen
  expect(_send(payload, fetchMock)).toBe(true);
  // Manually wind the clock by directly manipulating what _send will see via the module.
  // We can't import _seen (not exported); instead use jest.spyOn(Date, 'now') to advance time.
  const realNow = Date.now;
  Date.now = jest.fn(() => realNow() + 6000); // 6s > 5s COALESCE_MS
  expect(_send(payload, fetchMock)).toBe(true); // window expired → allowed
  expect(fetchMock).toHaveBeenCalledTimes(2);
  Date.now = realNow;
});

test('AC-2.2 _send with no fetch available (fetch undefined) returns false, does not throw', () => {
  delete global.fetch;
  expect(() => {
    const result = _send({ kind: 'error', message: 'no-fetch' }, undefined);
    expect(result).toBe(false);
  }).not.toThrow();
  // Restore for afterEach cleanup
  global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
});

test('AC-2.1 _onError extracts message, filename, lineno, colno, and stack from event', () => {
  const fetchMock = jest.fn(() => Promise.resolve({}));
  // Patch _send to capture the payload by calling _onError with real event fields
  // We verify the composed payload via the fetch body
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
