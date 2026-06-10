/**
 * fetchWithTimeout — B6 (NEW BEHAVIOR) AbortController wrapper around a single
 * outbound HTTP fetch.
 *
 * The legacy weather controller issued bare `fetch(url)` / `fetch(url, opts)`
 * calls with no timeout, so a hung upstream (Open-Meteo / Nominatim) could stall
 * the request indefinitely. This helper arms an AbortController that fires after
 * `timeoutMs` (EXTERNAL_CALL_TIMEOUT_MS), aborting the in-flight fetch. On abort
 * the underlying fetch rejects with an AbortError, which we re-throw as a clear
 * timeout Error so callers (and tests) get a deterministic failure rather than a
 * hang.
 *
 * The injectable `fetchImpl` defaults to the global fetch so unit tests can pass
 * a fake that never resolves (to prove the timeout fires) without monkeypatching
 * globals. The injectable `timerImpl` ({ setTimeout, clearTimeout }) defaults to
 * the globals so tests can use fake timers if they prefer.
 *
 * Happy path: when the upstream responds before the budget, the timer is cleared
 * and the original Response is returned UNCHANGED — so existing forecast/geocode
 * output stays byte-identical.
 */

'use strict';

var EXTERNAL_CALL_TIMEOUT_MS = require('./constants').EXTERNAL_CALL_TIMEOUT_MS;

/**
 * @param {string} url
 * @param {Object} [options] fetch options (headers, etc.). `signal` is injected.
 * @param {Object} [deps]
 * @param {number} [deps.timeoutMs] abort budget (defaults to EXTERNAL_CALL_TIMEOUT_MS).
 * @param {Function} [deps.fetchImpl] fetch implementation (defaults to global fetch).
 * @param {{setTimeout: Function, clearTimeout: Function}} [deps.timerImpl]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options, deps) {
  var d = deps || {};
  // Explicit presence checks (no `||`): a caller-supplied 0 budget would be a
  // bug, so we use the named default only when the dep is genuinely absent.
  var timeoutMs = (d.timeoutMs != null) ? d.timeoutMs : EXTERNAL_CALL_TIMEOUT_MS;
  var fetchImpl = (d.fetchImpl != null) ? d.fetchImpl : globalThis.fetch;
  var setT = (d.timerImpl && d.timerImpl.setTimeout) ? d.timerImpl.setTimeout : setTimeout;
  var clearT = (d.timerImpl && d.timerImpl.clearTimeout) ? d.timerImpl.clearTimeout : clearTimeout;

  var controller = new AbortController();
  var timer = null;

  function timeoutError(cause) {
    var e = new Error('External call timed out after ' + timeoutMs + 'ms');
    e.code = 'ETIMEDOUT';
    if (cause) e.cause = cause;
    return e;
  }

  var opts = Object.assign({}, options || {}, { signal: controller.signal });

  // Race the fetch against a timer that BOTH aborts the in-flight request (so a
  // well-behaved fetch tears down its socket) AND rejects this promise directly.
  // Rejecting via the timer — rather than waiting for the fetch to surface the
  // AbortError — means a fetch that ignores the abort signal (or a polyfill that
  // never settles on abort) still produces a deterministic timeout rejection
  // within the budget. Without this race, a signal-ignoring hang never rejects.
  var timeoutPromise = new Promise(function (_resolve, reject) {
    timer = setT(function () {
      controller.abort();
      reject(timeoutError());
    }, timeoutMs);
  });

  var fetchPromise = Promise.resolve()
    .then(function () { return fetchImpl(url, opts); })
    .catch(function (err) {
      // Map an honored-abort rejection to the same timeout error so callers see
      // one consistent failure regardless of how the fetch reacts to abort.
      if (err && err.name === 'AbortError') throw timeoutError(err);
      throw err;
    });

  // Defensive: swallow the loser's late rejection. Promise.race already consumes
  // it once the race settles, so this is belt-and-suspenders against future chain
  // restructuring — not the sole guard.
  fetchPromise.catch(function () {});

  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    clearT(timer);
  }
}

module.exports = fetchWithTimeout;
