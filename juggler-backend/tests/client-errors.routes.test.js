/**
 * Tests for the passive browser-error ingest endpoint (leg log-issue-triage-browsercapture).
 * Pure supertest against a minimal express app -- no DB, no auth stack.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

// Point the log at a fresh temp file BEFORE requiring the route (LOG_PATH is read at load).
const TMP = path.join(os.tmpdir(), 'be-clienterr-' + process.pid + '.log');
process.env.BROWSER_ERRORS_LOG = TMP;

const request = require('supertest');
const express = require('express');
const { router, sanitize, formatLine } = require('../src/routes/client-errors.routes');

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const NUL = String.fromCharCode(0);
// Unicode line separators (U+2028, U+2029) -- used in security-regression test
const LS = String.fromCharCode(0x2028); // U+2028 LINE SEPARATOR
const PS = String.fromCharCode(0x2029); // U+2029 PARAGRAPH SEPARATOR

function makeApp() {
  const app = express();
  app.use('/api/client-errors', express.json({ limit: '16kb' }), router);
  return app;
}

function readLog() {
  try { return fs.readFileSync(TMP, 'utf8'); } catch (e) { return ''; }
}

beforeEach(() => { try { fs.unlinkSync(TMP); } catch (e) {} });
afterAll(() => { try { fs.unlinkSync(TMP); } catch (e) {} });

describe('POST /api/client-errors', () => {
  test('AC-1.1 valid payload => 204 + exactly one ERROR [browser] line', async () => {
    const app = makeApp();
    await request(app).post('/api/client-errors')
      .send({ message: 'TypeError: x is undefined', source: 'app.js', lineno: 42, kind: 'error' })
      .expect(204);
    const lines = readLog().trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ERROR \[browser\] error: TypeError: x is undefined at app\.js:42/);
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

  test('AC-1.4 malformed payload (no message) => 400, nothing written', async () => {
    const app = makeApp();
    await request(app).post('/api/client-errors').send({ source: 'x.js' }).expect(400);
    expect(readLog()).toBe('');
  });

  test('AC-1.4 empty/whitespace message => 400, nothing written', async () => {
    const app = makeApp();
    await request(app).post('/api/client-errors').send({ message: '   ' }).expect(400);
    expect(readLog()).toBe('');
  });

  test('AC-1.3 oversized body => 4xx, nothing written', async () => {
    const app = makeApp();
    const huge = 'x'.repeat(20 * 1024); // > 16kb limit
    const res = await request(app).post('/api/client-errors').send({ message: huge });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(readLog()).toBe('');
  });

  test('AC-1.5 line carries kind + source for fingerprinting; per-field cap applied', () => {
    const line = formatLine({ kind: 'unhandledrejection', message: 'boom', source: 'a.js', lineno: 9 });
    expect(line).toMatch(/^ERROR \[browser\] unhandledrejection: boom at a\.js:9/);
    const longMsg = 'm'.repeat(5000);
    expect(formatLine({ message: longMsg }).length).toBeLessThan(2100);
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
    app.use('/api/client-errors', limiter, express.json({ limit: '16kb' }), router);

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
    // Use a LOG_PATH that cannot be written (directory path acts as a file => EISDIR)
    const savedEnv = process.env.BROWSER_ERRORS_LOG;
    const tmpDir = require('os').tmpdir();
    process.env.BROWSER_ERRORS_LOG = tmpDir; // writing to a dir as a file => EISDIR
    jest.resetModules();
    const { router: badRouter } = require('../src/routes/client-errors.routes');
    const app = express();
    app.use('/api/client-errors', express.json({ limit: '16kb' }), badRouter);
    const res = await request(app).post('/api/client-errors').send({ message: 'trigger-500' });
    expect(res.status).toBe(500);
    // Restore
    process.env.BROWSER_ERRORS_LOG = savedEnv;
    jest.resetModules();
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
    const { bodyErrorGuard } = require('../src/routes/client-errors.routes');
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
