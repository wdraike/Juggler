const crypto = require('crypto');
const request = require('supertest');

process.env.BILLING_WEBHOOK_SECRET = 'test-webhook-secret-hardening';
const app = require('../../src/app');
const SECRET = process.env.BILLING_WEBHOOK_SECRET;

function signBuffer(buf) {
  return 'sha256=' + crypto.createHmac('sha256', SECRET).update(buf).digest('hex');
}

describe('Billing webhook signature', () => {
  afterAll(async () => {
    // Close any open handles
    await new Promise(r => setTimeout(r, 100));
  });

  it('accepts a valid raw-body signature', async () => {
    const body = JSON.stringify({ event: 'subscription.created', user_id: 'u1', timestamp: new Date().toISOString() });
    const buf = Buffer.from(body);
    const res = await request(app)
      .post('/api/billing-webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Billing-Signature', signBuffer(buf))
      .send(body);
    // Not 401 (auth) and not 5xx (server error)
    expect(res.status).toBeLessThan(500);
    expect(res.status).not.toBe(401);
  });

  it('rejects non-JSON content-type with 415', async () => {
    const res = await request(app)
      .post('/api/billing-webhooks')
      .set('Content-Type', 'text/plain')
      .send('hello');
    expect(res.status).toBe(415);
  });

  it('rejects a stale timestamp', async () => {
    const staleTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const body = JSON.stringify({ event: 'subscription.created', user_id: 'u1', timestamp: staleTs });
    const buf = Buffer.from(body);
    const res = await request(app)
      .post('/api/billing-webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Billing-Signature', signBuffer(buf))
      .send(body);
    expect(res.status).toBe(401);
  });

  it('rejects a missing signature header', async () => {
    const body = JSON.stringify({ event: 'subscription.created', user_id: 'u1' });
    const res = await request(app)
      .post('/api/billing-webhooks')
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(401);
  });
});
