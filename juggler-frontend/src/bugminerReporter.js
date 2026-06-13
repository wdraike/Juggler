/**
 * @raike/lib-error-reporter — shared BugMiner frontend error reporter.
 *
 * Generalized from juggler's errorReporter (leg log-issue-triage-browsercapture). Installs global
 * `error` + `unhandledrejection` handlers and ships captured errors to a client-errors endpoint,
 * annotating the owning **app** (caller-supplied slug) + the **page** (location.pathname at error
 * time) + error location + stack. FAIL-SILENT by contract — any failure inside the reporter is
 * swallowed and never propagates into the host app. Identical errors within a short window are
 * coalesced (bounded map). CommonJS so webpack/CRA/Vite bundle it; node-testable.
 *
 * Usage (per app, at entry):
 *   const { installErrorReporter } = require('@raike/lib-error-reporter');
 *   installErrorReporter({ app: 'juggler' });   // endpoint defaults to '/api/client-errors'
 */
var DEFAULT_ENDPOINT = '/api/client-errors';
var COALESCE_MS = 5000;
var MAX_STACK = 2000;
var MAX_SEEN = 500;

var _seen = new Map();       // signature -> last-sent epoch ms (insertion-ordered → evict oldest)
var _installed = false;
var _config = { app: 'unknown', endpoint: DEFAULT_ENDPOINT };

function _signature(p) {
  return [p.kind || '', p.message || '', p.source || ''].join('|');
}

function _page() {
  try { return typeof location !== 'undefined' ? (location.pathname || location.href || '') : ''; }
  catch (e) { return ''; }
}
function _hereUrl() {
  try { return typeof location !== 'undefined' ? location.href : ''; } catch (e) { return ''; }
}
function _ua() {
  try { return typeof navigator !== 'undefined' ? navigator.userAgent : ''; } catch (e) { return ''; }
}

function _send(payload, fetchImpl) {
  try {
    var sig = _signature(payload);
    var now = Date.now();
    var last = _seen.get(sig);
    if (last != null && now - last < COALESCE_MS) return false; // coalesced
    if (!_seen.has(sig) && _seen.size >= MAX_SEEN) {
      _seen.delete(_seen.keys().next().value); // bound the map (evict oldest)
    }
    _seen.set(sig, now);
    var doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return false;
    var body = {
      app: _config.app,
      page: _page(),
      kind: payload.kind,
      message: payload.message,
      source: payload.source,
      lineno: payload.lineno,
      colno: payload.colno,
      stack: payload.stack,
      url: _hereUrl(),
      userAgent: _ua(),
    };
    Promise.resolve(
      doFetch(_config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      })
    ).catch(function () { /* fail-silent */ });
    return true;
  } catch (e) {
    return false; // never throw into the host app
  }
}

function _onError(event) {
  try {
    _send({
      kind: 'error',
      message: (event && event.message) || String((event && event.error) || 'error'),
      source: (event && event.filename) || '',
      lineno: event && event.lineno,
      colno: event && event.colno,
      stack: event && event.error && event.error.stack ? String(event.error.stack).slice(0, MAX_STACK) : '',
    });
  } catch (e) { /* fail-silent */ }
}

function _onRejection(event) {
  try {
    var r = event && event.reason;
    _send({
      kind: 'unhandledrejection',
      message: r && r.message ? r.message : String(r),
      source: '',
      stack: r && r.stack ? String(r.stack).slice(0, MAX_STACK) : '',
    });
  } catch (e) { /* fail-silent */ }
}

function installErrorReporter(opts) {
  opts = opts || {};
  if (!opts.app) throw new Error('installErrorReporter: app (service slug) is required');
  _config.app = opts.app;
  _config.endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  if (_installed || typeof window === 'undefined') return false;
  _installed = true;
  window.addEventListener('error', _onError);
  window.addEventListener('unhandledrejection', _onRejection);
  return true;
}

function _reset() { _installed = false; _seen.clear(); _config.app = 'unknown'; _config.endpoint = DEFAULT_ENDPOINT; }

module.exports = {
  installErrorReporter, _send, _onError, _onRejection, _signature, _reset, _config,
  _seenSize: function () { return _seen.size; },
};
