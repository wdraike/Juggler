/**
 * JUG-FACADE-DB-VIOLATIONS stage 2b — db-backed pin for logFeatureEvent + query,
 * moved verbatim from user-config/facade.js into
 * adapters/KnexFeatureEventsRepository.js.
 *
 * Pins:
 *  - logFeatureEvent: req-object branch populates user_id/plan_id/endpoint/
 *    ip_address/request_id/value; bare-userId branch leaves those columns null
 *    (except planId, which defaults to 'free'); insert failures never reject
 *    the caller (fire-and-forget .catch).
 *  - query(): returns a knex query builder scoped to feature_events — rows
 *    seeded directly are readable through it exactly like GetFeatureEventsReport
 *    reads them (where/orderBy/limit chaining).
 *
 * Requires: test-bed DB at 127.0.0.1:3407 (make test-juggler[-pool]).
 */

'use strict';

var db = require('../../../../src/db');
var { assertDbAvailable } = require('../../../helpers/requireDB');
var featureEvents = require('../../../../src/slices/user-config/adapters/KnexFeatureEventsRepository');

jest.mock('../../../../src/scheduler/scheduleQueue', () => ({
  enqueueScheduleRun: jest.fn(),
  stopPollLoop: jest.fn()
}));

var USER_ID = 'knex-feature-events-user-001';
var available = false;

async function cleanup() {
  await db('feature_events').where('user_id', USER_ID).del();
  await db('users').where('id', USER_ID).del();
}

beforeAll(async () => {
  await assertDbAvailable();
  available = true;
  await cleanup();
  await db('users').insert({
    id: USER_ID, email: 'featureevents@test.com', name: 'Feature Events',
    timezone: 'America/New_York', created_at: db.fn.now(), updated_at: db.fn.now()
  });
}, 20000);

beforeEach(async () => {
  await db('feature_events').where('user_id', USER_ID).del();
});

afterAll(async () => {
  if (available) await cleanup();
  await db.destroy();
});

describe('KnexFeatureEventsRepository.logFeatureEvent', () => {
  test('req-object branch writes user_id/plan_id/endpoint/ip_address/request_id/value', async () => {
    var req = {
      user: { id: USER_ID },
      planId: 'plan-pro',
      method: 'POST',
      originalUrl: '/api/x?y=1',
      ip: '127.0.0.1',
      headers: { 'x-request-id': 'req-abc' }
    };
    await featureEvents.logFeatureEvent(req, 'tasks.placementMode', 'used', { selected: 'fixed' });

    var row = await db('feature_events').where({ user_id: USER_ID, feature_key: 'tasks.placementMode' }).first();
    expect(row).toBeTruthy();
    expect(row.event_type).toBe('used');
    expect(row.plan_id).toBe('plan-pro');
    expect(row.planId).toBe('plan-pro');
    expect(row.endpoint).toBe('POST /api/x?y=1');
    expect(row.ip_address).toBe('127.0.0.1');
    expect(row.request_id).toBe('req-abc');
    // mysql2 auto-parses JSON columns to objects — mirror GetFeatureEventsReport's
    // own typeof guard rather than assuming a string.
    var value = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    expect(value).toEqual({ selected: 'fixed' });
  });

  test('bare-userId branch leaves plan_id/endpoint/ip_address/request_id null and planId defaults to free', async () => {
    await featureEvents.logFeatureEvent(USER_ID, 'data.export', 'blocked', null);

    var row = await db('feature_events').where({ user_id: USER_ID, feature_key: 'data.export' }).first();
    expect(row).toBeTruthy();
    expect(row.event_type).toBe('blocked');
    expect(row.plan_id).toBeNull();
    expect(row.planId).toBe('free');
    expect(row.endpoint).toBeNull();
    expect(row.ip_address).toBeNull();
    expect(row.request_id).toBeNull();
    expect(row.value).toBeNull();
  });

  test('insert failure is swallowed — never rejects the caller', async () => {
    // user_id FK violation (no such user) — the insert throws inside the promise
    // chain; the fire-and-forget .catch must absorb it, not reject logFeatureEvent's
    // returned promise.
    await expect(
      featureEvents.logFeatureEvent('no-such-user-id', 'x.y', 'used', null)
    ).resolves.toBeUndefined();
  });
});

describe('KnexFeatureEventsRepository.query', () => {
  test('reads rows seeded directly, chainable like GetFeatureEventsReport uses it', async () => {
    await db('feature_events').insert([
      { user_id: USER_ID, feature_key: 'ai.commands', event_type: 'used', created_at: new Date() },
      { user_id: USER_ID, feature_key: 'ai.commands', event_type: 'blocked', created_at: new Date() }
    ]);

    var rows = await featureEvents.query().where('user_id', USER_ID).orderBy('event_type', 'asc');
    expect(rows.map(function (r) { return r.event_type; })).toEqual(['blocked', 'used']);
  });

  test('two calls return independent query builders (no shared mutable state)', async () => {
    await db('feature_events').insert({ user_id: USER_ID, feature_key: 'k1', event_type: 'used', created_at: new Date() });
    var a = featureEvents.query().where('feature_key', 'k1');
    var b = featureEvents.query().where('feature_key', 'nope');
    var aRows = await a;
    var bRows = await b;
    expect(aRows.length).toBe(1);
    expect(bRows.length).toBe(0);
  });
});
