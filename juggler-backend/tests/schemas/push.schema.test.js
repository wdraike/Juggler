'use strict';

/**
 * Unit tests — src/schemas/push.schema.js (999.1212 JUG-TEST-ROUTE-SCHEMAS).
 *
 * Pure unit, NO DB. Covers the three exported schemas with accept/reject tables,
 * with emphasis on the two security refinements:
 *   - endpoint SSRF allowlist (elmo BLOCK-1, 999.252): HTTPS + known push hosts
 *     only, INCLUDING hostname-suffix spoof attempts (fcm.googleapis.com.evil.com)
 *     and dot-boundary bypasses (evilpush.services.mozilla.com).
 *   - testSend url same-origin-path guard (elmo WARN): must start with a single
 *     '/', blocking absolute URLs and protocol-relative '//evil.com'.
 */

const { subscribeSchema, unsubscribeSchema, testSendSchema } = require('../../src/schemas/push.schema');

function runTable(schema, rows) {
  for (const [label, body, expectSuccess] of rows) {
    test(label, () => {
      const result = schema.safeParse(body);
      if (result.success !== expectSuccess) {
        const detail = result.success ? '(parsed OK)' : JSON.stringify(result.error.issues);
        throw new Error(`expected success=${expectSuccess}, got ${result.success} ${detail}`);
      }
      expect(result.success).toBe(expectSuccess);
    });
  }
}

const keys = () => ({ p256dh: 'BPubKey123', auth: 'authSecret1' });
const sub = (endpoint, extra = {}) => ({ endpoint, keys: keys(), ...extra });

describe('subscribeSchema — endpoint allowlist (SSRF guard)', () => {
  runTable(subscribeSchema, [
    // accepted browser push services
    ['accepts Chrome/FCM endpoint', sub('https://fcm.googleapis.com/fcm/send/abc123'), true],
    ['accepts Firefox autopush endpoint (exact host)', sub('https://push.services.mozilla.com/wpush/v2/x'), true],
    ['accepts Firefox autopush endpoint (subdomain)', sub('https://updates.push.services.mozilla.com/wpush/v2/x'), true],
    ['accepts Windows/legacy-Edge endpoint (subdomain)', sub('https://db5p.notify.windows.com/w/?token=x'), true],
    ['accepts Apple Web Push endpoint (subdomain)', sub('https://web.push.apple.com/QOa1'), true],
    // rejected: protocol / host attacks
    ['rejects HTTP (non-TLS) endpoint on an allowed host', sub('http://fcm.googleapis.com/fcm/send/abc'), false],
    ['rejects arbitrary HTTPS host (SSRF)', sub('https://internal-metadata.example.com/'), false],
    ['rejects cloud metadata IP', sub('https://169.254.169.254/latest/meta-data/'), false],
    ['rejects hostname-SUFFIX spoof fcm.googleapis.com.evil.com', sub('https://fcm.googleapis.com.evil.com/x'), false],
    ['rejects prefix spoof evilfcm.googleapis.com (anchored regex)', sub('https://evilfcm.googleapis.com/x'), false],
    ['rejects dot-boundary bypass evilpush.services.mozilla.com', sub('https://evilpush.services.mozilla.com/x'), false],
    ['rejects dot-boundary bypass evilnotify.windows.com', sub('https://evilnotify.windows.com/x'), false],
    ['rejects non-URL endpoint', sub('not a url'), false],
    ['rejects endpoint over 2048 chars', sub('https://fcm.googleapis.com/' + 'x'.repeat(2049)), false],
  ]);
});

describe('subscribeSchema — keys + expirationTime shape', () => {
  runTable(subscribeSchema, [
    ['accepts expirationTime: null (browser default)', sub('https://fcm.googleapis.com/s/1', { expirationTime: null }), true],
    ['accepts expirationTime as number', sub('https://fcm.googleapis.com/s/1', { expirationTime: 1760000000000 }), true],
    ['accepts absent expirationTime', sub('https://fcm.googleapis.com/s/1'), true],
    ['accepts unknown extra top-level keys (passthrough)', sub('https://fcm.googleapis.com/s/1', { browserTag: 'chrome' }), true],
    ['rejects missing keys object', { endpoint: 'https://fcm.googleapis.com/s/1' }, false],
    ['rejects empty p256dh', { endpoint: 'https://fcm.googleapis.com/s/1', keys: { p256dh: '', auth: 'a' } }, false],
    ['rejects empty auth', { endpoint: 'https://fcm.googleapis.com/s/1', keys: { p256dh: 'p', auth: '' } }, false],
    ['rejects p256dh over 255 chars', { endpoint: 'https://fcm.googleapis.com/s/1', keys: { p256dh: 'x'.repeat(256), auth: 'a' } }, false],
    ['rejects expirationTime as string', sub('https://fcm.googleapis.com/s/1', { expirationTime: 'never' }), false],
  ]);
});

describe('unsubscribeSchema', () => {
  runTable(unsubscribeSchema, [
    ['accepts an allowed endpoint', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }, true],
    ['rejects a disallowed host (same guard as subscribe)', { endpoint: 'https://evil.com/x' }, false],
    ['rejects missing endpoint', {}, false],
  ]);
});

describe('testSendSchema — manual test-send payload (POST /api/push/test)', () => {
  runTable(testSendSchema, [
    ['accepts empty body (all fields optional)', {}, true],
    ['accepts full payload with same-origin path url', { title: 'T', body: 'B', url: '/tasks/42', taskId: 't42' }, true],
    ['accepts root url "/"', { url: '/' }, true],
    ['rejects protocol-relative url //evil.com (open-redirect guard)', { url: '//evil.com/x' }, false],
    ['rejects absolute https url (open-redirect guard)', { url: 'https://evil.com/x' }, false],
    ['rejects relative url without leading slash', { url: 'tasks/42' }, false],
    ['rejects title over 200 chars', { title: 'x'.repeat(201) }, false],
    ['rejects body over 1000 chars', { body: 'x'.repeat(1001) }, false],
    ['rejects taskId over 64 chars', { taskId: 'x'.repeat(65) }, false],
    ['rejects non-string title', { title: 42 }, false],
  ]);
});
