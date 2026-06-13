/**
 * client-errors.routes.js — passive browser-error ingest.
 *
 * Accepts a browser error payload from the frontend error reporter and appends ONE sanitized
 * line to a browser-errors log that the log-triage skill mines. Unauthenticated by design
 * (errors can occur pre-auth / on any page); abuse is bounded by a rate limiter (mounted in
 * app.js) + a tight body-size limit + per-field caps. The endpoint never trusts payload text:
 * all fields are control-char-stripped so a crafted `message` cannot forge extra log lines
 * (log injection). See SPEC FR-1, leg log-issue-triage-browsercapture.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Log path — env-overridable; defaults to juggler-backend/browser-errors.log, which the
// log-triage juggler glob (`juggler/juggler-backend/*.log`) already mines.
const LOG_PATH = process.env.BROWSER_ERRORS_LOG ||
  path.join(__dirname, '..', '..', 'browser-errors.log');

const MAX_FIELD = 2000;   // per-field char cap (defense even within the body-size limit)
const MAX_UA = 160;

// All C0 + C1 control characters (incl. CR, LF, TAB, NUL, DEL) PLUS Unicode line/paragraph
// separators U+2028/U+2029 (elmo WARN-1 — they render as line breaks in editors/log viewers, so
// strip them too for defense-in-depth even though the python miner doesn't split on them). Built
// from an escaped string so no literal control byte appears in source.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029]+', 'g');

const MAX_LOG_BYTES = 5 * 1024 * 1024;   // rotate at 5MB → bounded ≤ ~10MB on tmpfs (elmo WARN-2)

// FR-1.2 (elmo) — strip ALL control chars so payload text can never inject a newline and forge
// an additional log line (log injection). Collapse whitespace, trim, then cap length.
function sanitize(value, cap) {
  if (typeof value !== 'string') return '';
  return value
    .replace(CONTROL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap || MAX_FIELD);
}

function digits(value, n) {
  if (value == null) return '';
  return String(value).replace(/\D/g, '').slice(0, n || 8);
}

// FR-1.5 — leading `ERROR [browser]` token so the leg-1 collector's error pattern matches;
// embeds kind + source so the fingerprint gets a stable error_type + source_location.
function formatLine(payload) {
  const kind = sanitize(payload.kind, 40) || 'error';
  const msg = sanitize(payload.message);
  const src = sanitize(payload.source || payload.url, 300);
  const lineno = digits(payload.lineno);
  const ua = sanitize(payload.userAgent, MAX_UA);
  const loc = src ? ` at ${src}${lineno ? ':' + lineno : ''}` : '';
  return `ERROR [browser] ${kind}: ${msg}${loc}${ua ? ` ua=${ua}` : ''}`;
}

// Rotate the log when it exceeds the cap so a flood can't fill tmpfs (elmo WARN-2). Bounded to
// one .1 backup (≤ ~10MB total). Best-effort: a rotate failure must not block ingest.
async function rotateIfLarge(p) {
  try {
    const st = await fs.promises.stat(p);
    if (st.size > MAX_LOG_BYTES) {
      await fs.promises.rename(p, p + '.1');
    }
  } catch (err) {
    // ENOENT (no file yet) is normal; any other rotate error is non-fatal — proceed to append.
  }
}

// FR-1.1/1.4 — validate, write exactly one line, return 204. Malformed → 400, no write.
// Async (fs.promises) so the append never blocks the event loop under a flood (ernie F3).
async function handler(req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object' ||
      typeof body.message !== 'string' || !body.message.trim()) {
    return res.status(400).json({ error: 'invalid payload: message required' });
  }
  const line = formatLine(body);
  try {
    await rotateIfLarge(LOG_PATH);
    await fs.promises.appendFile(LOG_PATH, line + '\n', { encoding: 'utf8' });
  } catch (err) {
    return res.status(500).json({ error: 'log write failed' });
  }
  return res.status(204).end();
}

// FR-1.3 — body-parse error (payload over the mount's size limit) → 4xx, nothing written.
// express.json throws PayloadTooLargeError (413) before reaching the handler.
function bodyErrorGuard(err, req, res, next) {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'payload too large' });
  }
  if (err && err.status === 400) {
    return res.status(400).json({ error: 'malformed body' });
  }
  return next(err);
}

router.post('/', handler);
// NOTE: bodyErrorGuard is NOT mounted here — express.json is a sibling middleware mounted before
// this router, so its parse errors skip the router's internal stack (ernie F1). It is exported and
// mounted as the trailing app-level error handler in app.js so it actually catches 413/400.

module.exports = { router, sanitize, formatLine, handler, bodyErrorGuard, rotateIfLarge, LOG_PATH };
