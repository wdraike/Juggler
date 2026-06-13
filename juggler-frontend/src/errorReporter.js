/**
 * errorReporter.js — passive browser-error capture (leg log-issue-triage-browsercapture).
 *
 * Installs global `error` + `unhandledrejection` listeners and ships captured errors to
 * POST /api/client-errors (mined by the log-triage skill). FAIL-SILENT by contract: any failure
 * inside the reporter (network down, endpoint 5xx, serialization error) is swallowed and never
 * propagates into the host app. Identical errors within a short window are coalesced so a tight
 * error loop can't flood the endpoint.
 */
const ENDPOINT = '/api/client-errors';
const COALESCE_MS = 5000;
const MAX_STACK = 2000;
const MAX_SEEN = 500;     // cap the coalesce map so a long SPA session can't leak memory (ernie F2)

const _seen = new Map(); // signature -> last-sent epoch ms (insertion-ordered → evict oldest)

export function _signature(p) {
  return [p.kind || '', p.message || '', p.source || ''].join('|');
}

export function _send(payload, fetchImpl) {
  try {
    const sig = _signature(payload);
    const now = Date.now();
    const last = _seen.get(sig);
    if (last != null && now - last < COALESCE_MS) return false; // coalesced
    // Bound the map: evict the oldest entry (Map preserves insertion order) before growing.
    if (!_seen.has(sig) && _seen.size >= MAX_SEEN) {
      _seen.delete(_seen.keys().next().value);
    }
    _seen.set(sig, now);
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return false;
    // keepalive so an error during unload still ships; .catch swallows network failure.
    Promise.resolve(
      doFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      })
    ).catch(function () { /* fail-silent */ });
    return true;
  } catch (_e) {
    return false; // never throw into the host app
  }
}

function _hereUrl() {
  try { return typeof location !== 'undefined' ? location.href : ''; } catch (_e) { return ''; }
}
function _ua() {
  try { return typeof navigator !== 'undefined' ? navigator.userAgent : ''; } catch (_e) { return ''; }
}

export function _onError(event) {
  try {
    _send({
      kind: 'error',
      message: (event && event.message) || String((event && event.error) || 'error'),
      source: (event && event.filename) || '',
      lineno: event && event.lineno,
      colno: event && event.colno,
      stack: event && event.error && event.error.stack ? String(event.error.stack).slice(0, MAX_STACK) : '',
      url: _hereUrl(),
      userAgent: _ua(),
    });
  } catch (_e) { /* fail-silent */ }
}

export function _onRejection(event) {
  try {
    const r = event && event.reason;
    _send({
      kind: 'unhandledrejection',
      message: r && r.message ? r.message : String(r),
      source: '',
      stack: r && r.stack ? String(r.stack).slice(0, MAX_STACK) : '',
      url: _hereUrl(),
      userAgent: _ua(),
    });
  } catch (_e) { /* fail-silent */ }
}

let _installed = false;
export function installErrorReporter() {
  if (_installed || typeof window === 'undefined') return false;
  _installed = true;
  window.addEventListener('error', _onError);
  window.addEventListener('unhandledrejection', _onRejection);
  return true;
}

// test-only reset
export function _reset() { _installed = false; _seen.clear(); }
