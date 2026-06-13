/**
 * @raike/lib-error-ingest — shared BugMiner browser-error ingest.
 *
 * Extracted from juggler's hardened client-errors route (leg log-issue-triage-browsercapture)
 * and generalized so every backend mounts the SAME logic. Security controls preserved verbatim:
 * control-char + U+2028/U+2029 log-injection sanitization, per-field caps, async append with size
 * rotation, malformed→400 / oversized→413. The caller supplies its own rate limiter + body-size
 * limit at mount time (see createClientErrorsRouter docs).
 *
 * NEW vs the juggler-local version (BugMiner global, leg bugminer-global-leg-a):
 *   - the written line carries [<app>] + page=<page> so the log-triage miner fingerprints
 *     per-app (app IN the fingerprint) and annotates the backlog row with the page (metadata).
 *
 * The request-handling LOGIC is `processClientError` (framework-agnostic, fully unit-testable
 * with no express); `createClientErrorsRouter` is a thin express wrapper (express lazy-required
 * so the core + this module load without express present).
 */
const fs = require('fs');
const path = require('path');

const MAX_FIELD = 2000;
const MAX_UA = 160;
const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;

// All C0 + C1 control chars (incl. CR, LF, TAB, NUL, DEL) + Unicode line/paragraph separators
// U+2028/U+2029. Built from an escaped string so no literal control byte appears in source.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029]+', 'g');

function sanitize(value, cap) {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, cap || MAX_FIELD);
}

function digits(value, n) {
  if (value == null) return '';
  return String(value).replace(/\D/g, '').slice(0, n || 8);
}

// AC-1.3 — line carries [<app>] + page=<page>. app falls back to the mount's defaultApp (each
// backend knows its own service slug) when the payload omits it. page is optional.
function formatLine(payload, defaultApp) {
  const app = sanitize(payload.app, 40) || sanitize(defaultApp, 40) || 'unknown';
  const kind = sanitize(payload.kind, 40) || 'error';
  const msg = sanitize(payload.message);
  const src = sanitize(payload.source || payload.url, 300);
  const lineno = digits(payload.lineno);
  const ua = sanitize(payload.userAgent, MAX_UA);
  const page = sanitize(payload.page, 200);
  const loc = src ? ` at ${src}${lineno ? ':' + lineno : ''}` : '';
  return `ERROR [browser] [${app}] ${kind}: ${msg}${loc}${page ? ` page=${page}` : ''}${ua ? ` ua=${ua}` : ''}`;
}

async function rotateIfLarge(p, maxLogBytes) {
  try {
    const st = await fs.promises.stat(p);
    if (st.size > maxLogBytes) await fs.promises.rename(p, p + '.1');
  } catch (err) { /* ENOENT or non-fatal rotate error → proceed to append */ }
}

/**
 * processClientError({ body, logPath, app, maxLogBytes }) → { status } (+ writes one line).
 * Framework-agnostic core. AC-1.1 valid→204 + one line; AC-1.4 malformed→400 no write;
 * write failure→500. Sanitization (AC-1.2) + format (AC-1.3) via formatLine.
 */
async function processClientError(args) {
  const body = args.body;
  const logPath = args.logPath;
  const app = args.app;
  const maxLogBytes = args.maxLogBytes || DEFAULT_MAX_LOG_BYTES;
  if (!body || typeof body !== 'object' ||
      typeof body.message !== 'string' || !body.message.trim()) {
    return { status: 400, error: 'invalid payload: message required' };
  }
  const line = formatLine(body, app);
  try {
    await fs.promises.mkdir(path.dirname(path.resolve(logPath)), { recursive: true });
    await rotateIfLarge(logPath, maxLogBytes);
    await fs.promises.appendFile(logPath, line + '\n', { encoding: 'utf8' });
  } catch (err) {
    return { status: 500, error: 'log write failed' };
  }
  return { status: 204 };
}

function bodyErrorGuard(err, req, res, next) {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'payload too large' });
  }
  if (err && err.status === 400) {
    return res.status(400).json({ error: 'malformed body' });
  }
  return next(err);
}

/**
 * createClientErrorsRouter({ app, logPath, maxLogBytes }) → express.Router with POST '/'.
 * express is lazy-required here (peerDependency) so the core loads without it. Mount WITH your
 * own rate limiter + tight express.json BEFORE the global json parser, then bodyErrorGuard:
 *   app.use('/api/client-errors', limiter, express.json({limit:'16kb'}),
 *           createClientErrorsRouter({app:'<svc>', logPath}), bodyErrorGuard)
 */
function createClientErrorsRouter(opts) {
  const options = opts || {};
  if (!options.logPath) throw new Error('createClientErrorsRouter: logPath is required');
  if (!options.app) throw new Error('createClientErrorsRouter: app (service slug) is required');
  const express = require('express'); // lazy — peerDependency
  const router = express.Router();
  router.post('/', async function (req, res) {
    const result = await processClientError({
      body: req.body, logPath: options.logPath, app: options.app, maxLogBytes: options.maxLogBytes,
    });
    if (result.status === 204) return res.status(204).end();
    return res.status(result.status).json({ error: result.error });
  });
  return router;
}

module.exports = {
  createClientErrorsRouter, processClientError, bodyErrorGuard, sanitize, formatLine,
};
