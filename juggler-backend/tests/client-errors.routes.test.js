/**
 * Tests for the passive browser-error ingest endpoint (leg log-issue-triage-browsercapture).
 * Pure supertest against a minimal express app -- no DB, no auth stack.
 *
 * Refactored (leg juggler-clienterr-shared-pkg / CT-1..CT-5): import now targets the
 * shared @raike/lib-error-ingest vendor module. Format assertions updated to the enriched
 * v2 format (includes [juggler] app token per AC-1.3 / BC-10). Behavior contract
 * BC-1..BC-9 (HTTP codes, sanitization, caps, rotation, bodyErrorGuard, size cap,
 * rate-limit, LOG_PATH) is IDENTICAL — only format-regex assertions change.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

// Point the log at a fresh temp file BEFORE requiring the route (logPath is read at factory call).
const TMP = path.join(os.tmpdir(), 'be-clienterr-' + process.pid + '.log');
process.env.BROWSER_ERRORS_LOG = TMP;

const request = require('supertest');
const express = require('express');

// CT-3: import from shared vendor module (file:./vendor/lib-error-ingest), not the deleted local route.
// Exports: { createClientErrorsRouter, processClientError, bodyErrorGuard, sanitize, formatLine }
const { createClientErrorsRouter, bodyErrorGuard, sanitize, formatLine } = require('@raike/lib-error-ingest');

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const NUL = String.fromCharCode(0);
// Unicode line separators (U+2028, U+2029) -- used in security-regression test
const LS = String.fromCharCode(0x2028); // U+2028 LINE SEPARATOR
const PS = String.fromCharCode(0x2029); // U+2029 PARAGRAPH SEPARATOR

// CT-3 / CT-4: factory-based app construction mirrors the real app.js mount.
// createClientErrorsRouter({app:'juggler', logPath}) is the shared-module entry point.
function makeApp() {
  const app = express();
  const router = createClientErrorsRouter({ app: 'juggler', logPath: TMP });
  app.use('/api/client-errors', express.json({ limit: '16kb' }), router, bodyErrorGuard);
  return app;
}

function readLog() {
  try { return fs.readFileSync(TMP, 'utf8'); } catch (e) { return ''; }
}

beforeEach(() => { try { fs.unlinkSync(TMP); } catch (e) {} });
afterAll(() => { try { fs.unlinkSync(TMP); } catch (e) {} });

describe('POST /api/client-errors', () => {
  test('AC-1.1 valid payload => 204 + exactly one ERROR [browser] [juggler] line', async () => {
    const app = makeApp();
    await request(app).post('/api/client-errors')
      .send({ message: 'TypeError: x is undefined', source: 'app.js', lineno: 42, kind: 'error' })
      .expect(204);
    const lines = readLog().trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    // CT-1: format now includes [juggler] app token (AC-1.3 / BC-10 intentional enrichment)
    expect(lines[0]).toMatch(/^ERROR \[browser\] \[juggler\] error: TypeError: x is undefined at app\.js:42/);
  });

  test('AC-1.2 log-injection: a newline in message cannot forge a second log line', async () => {
    const app = makeApp();
    const evil = 'real error' + LF + 'ERROR [browser] error: FORGED injected line at evil.js';
    await request(app).post('/api/client-errors').send({ message: evil }).expect(204);
    const lines = readLog().trim().split('\n').filter(Boolean);
    // Forged TEXT may survive collapsed INLINE, but the newline was stripped => exactly one line.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('real error');
    expect(lines[0]).toContain('FORGED injected line');
  });

  test('AC-1.4 malformed payload (no message) => 400 + body {error:invalid payload: message required}, nothing written', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/client-errors').send({ source: 'x.js' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid payload: message required' });
    expect(readLog()).toBe('');
  });

  test('AC-1.4 empty/whitespace message => 400 + body {error:invalid payload: message required}, nothing written', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/client-errors').send({ message: '   ' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid payload: message required' });
    expect(readLog()).toBe('');
  });

  // Fix #1 (zoe BLOCK-1 / BC-6): pin the bodyErrorGuard 413 path exactly.
  // Previously asserted only `>= 400` — zoe proved mutating bodyErrorGuard's 413 branch to
  // next(err) kept all tests green. Now asserts status===413 AND exact body so the mutation fails.
  test('BC-6 oversized body => exactly 413 + body {error:"payload too large"}, nothing written', async () => {
    const app = makeApp();
    const huge = 'x'.repeat(20 * 1024); // > 16kb limit
    const res = await request(app).post('/api/client-errors')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ message: huge }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'payload too large' });
    expect(readLog()).toBe('');
  });

  // Fix #2 (zoe WARN-3): malformed-JSON branch of bodyErrorGuard (BC-1 / 400 malformed body).
  // No test previously exercised this path — posting bad JSON hits bodyErrorGuard's err.status===400
  // branch and must return 400 + {error:'malformed body'} (distinct from the no-message 400).
  test('BC-1 malformed JSON body => 400 + body {error:"malformed body"}, nothing written', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/client-errors')
      .set('Content-Type', 'application/json')
      .send('{ bad json }');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'malformed body' });
    expect(readLog()).toBe('');
  });

  test('AC-1.5 line carries kind + source for fingerprinting; per-field cap applied', () => {
    // CT-2: formatLine is now 3-arg (payload, defaultApp). Pass 'juggler' so the [juggler]
    // token is written; without it the line would read [unknown]. Format regex updated (CT-1).
    const line = formatLine({ kind: 'unhandledrejection', message: 'boom', source: 'a.js', lineno: 9 }, 'juggler');
    expect(line).toMatch(/^ERROR \[browser\] \[juggler\] unhandledrejection: boom at a\.js:9/);
    const longMsg = 'm'.repeat(5000);
    expect(formatLine({ message: longMsg }, 'juggler').length).toBeLessThan(2100);
  });

  // Fix #4 (zoe WARN-5 / BC-3 / AC-1.3): the headline new behavior of this leg — page= field.
  // Previously zero test coverage of `page` capture, 200-char cap, or page= in the log line.
  test('BC-3 page field: captured in log line + capped at 200 chars', async () => {
    const app = makeApp();

    // Happy path: page value appears as page=<value> in the log line
    await request(app).post('/api/client-errors')
      .send({ message: 'click error', page: '/dashboard/tasks' })
      .expect(204);
    const line1 = readLog().trim();
    expect(line1).toContain('page=/dashboard/tasks');

    // Cap: a 201-char page string must be truncated to 200 chars in the output
    fs.unlinkSync(TMP);
    const longPage = '/p' + 'a'.repeat(200); // 202 chars total
    await request(app).post('/api/client-errors')
      .send({ message: 'click error', page: longPage })
      .expect(204);
    const line2 = readLog().trim();
    // Extract the page= value from the line and assert it is <= 200 chars
    const pageMatch = line2.match(/page=(\S+)/);
    expect(pageMatch).not.toBeNull();
    expect(pageMatch[1].length).toBeLessThanOrEqual(200);
  });

  test('sanitize strips control chars (CR/LF/TAB/NUL)', () => {
    expect(sanitize('a' + LF + 'b' + CR + LF + 'c' + TAB + 'd')).toBe('a b c d');
    expect(sanitize('x' + NUL + 'y' + 'z')).toBe('x yz');
    expect(sanitize(null)).toBe('');
  });

  // ---- Tests authored by telly (leg log-issue-triage-browsercapture) ----------------

  test('AC-1.3 rate-limit 429: >30 requests in 60s window => 429, nothing written', async () => {
    // Mount rate limiter inline with max:1 so one request exhausts the quota
    const rateLimit = require('express-rate-limit');
    const app = express();
    const limiter = rateLimit({ windowMs: 60 * 1000, max: 1, standardHeaders: true, legacyHeaders: false });
    const router = createClientErrorsRouter({ app: 'juggler', logPath: TMP });
    app.use('/api/client-errors', limiter, express.json({ limit: '16kb' }), router, bodyErrorGuard);

    // First request consumes the quota
    await request(app).post('/api/client-errors').send({ message: 'ok' }).expect(204);
    const afterFirst = readLog();

    // Second request should be rate-limited => 429, no new write
    const res = await request(app).post('/api/client-errors').send({ message: 'should-be-blocked' });
    expect(res.status).toBe(429);
    // Log must not grow after the rate-limited request
    expect(readLog()).toBe(afterFirst);
  });

  test('500 appendFileSync failure => 500 response, no crash', async () => {
    // CT-4: use processClientError directly (framework-agnostic core, no module re-require needed).
    // Writing to a directory path as a file produces EISDIR => write failure => 500 status.
    const { processClientError } = require('@raike/lib-error-ingest');
    const tmpDir = os.tmpdir();
    const result = await processClientError({ body: { message: 'trigger-500' }, logPath: tmpDir, app: 'juggler' });
    expect(result.status).toBe(500);
  });

  test('AC-1.2 CRLF injection: CR+LF in message cannot forge a second log line', async () => {
    const app = makeApp();
    const crlf = 'before' + CR + LF + 'ERROR [browser] error: INJECTED line';
    await request(app).post('/api/client-errors').send({ message: crlf }).expect(204);
    const lines = readLog().trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('before');
    expect(lines[0]).toContain('INJECTED line');
  });

  test('bodyErrorGuard passes unknown errors to next middleware', (done) => {
    // CT-5: bodyErrorGuard imported from vendor module (same implementation, same semantics).
    const unknownErr = new Error('something else');
    unknownErr.status = 503;
    const next = (err) => {
      expect(err).toBe(unknownErr);
      done();
    };
    bodyErrorGuard(unknownErr, {}, { status: () => ({ json: () => {} }) }, next);
  });

  // REFER->telly from elmo SECURITY-REVIEW.md Finding #1 (now CLOSED):
  // Unicode LS (U+2028) in message - regression test for log-injection via Unicode line separator.
  // DEFENSE-IN-DEPTH (two independent layers, both verified by zoe mutation): (1) CONTROL_CHARS now
  // EXPLICITLY includes U+2028/U+2029 (elmo WARN-1 fix), and (2) the /\s+/g collapse also matches
  // them as Unicode whitespace. Removing either layer alone still passes; removing BOTH fails this
  // test. Pins the stripping so a future regression on either layer is caught.
  test('SECURITY-REGRESSION elmo-WARN-1: U+2028 LINE SEPARATOR stripped from written log (protected by whitespace collapse)', async () => {
    const app = makeApp();
    const msg = 'real error' + LS + 'ERROR [browser] forged: injected';
    await request(app).post('/api/client-errors').send({ message: msg }).expect(204);
    const raw = readLog();
    // U+2028 must NOT appear in the written log line (whitespace-collapse strips it)
    expect(raw).not.toContain(LS);
    // Exactly 1 ERROR [browser] line written -- no visual forgery possible
    const browserLines = raw.split('\n').filter(l => /^ERROR \[browser\]/.test(l));
    expect(browserLines).toHaveLength(1);
  });
});
