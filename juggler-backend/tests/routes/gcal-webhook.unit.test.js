/**
 * 999.15520 — GCal push-notification webhook receiver unit tests.
 *
 * Verifies the webhook route at /api/gcal-webhook correctly:
 * - Acknowledges Google's initial 'sync' confirmation
 * - Maps a channel ID to a user via the adapter and emits an SSE event
 * - Handles unknown channels gracefully (200 to stop Google retrying)
 * - Rejects requests missing required headers
 *
 * Uses supertest with the express app, mocking the adapter + SSE emitter.
 */

'use strict';

var express = require('express');
var request = require('supertest');

// Mock the calendar facade's findUserByWatchChannel
var mockChannelLookup = null;
jest.mock('../../src/slices/calendar/facade', function () {
  return {
    findUserByWatchChannel: function (channelId, resourceId) {
      if (mockChannelLookup) return mockChannelLookup(channelId, resourceId);
      return Promise.resolve(null);
    }
  };
});

// Mock the SSE emitter
var mockEmittedEvents = [];
jest.mock('../../src/lib/sse-emitter', function () {
  return {
    emit: function (userId, event, data) {
      mockEmittedEvents.push({ userId: userId, event: event, data: data });
    }
  };
});

// Mock rate-limit store to avoid Redis
jest.mock('../../src/lib/rate-limit-store', function () {
  return { maybeRedisStore: function () { return undefined; } };
});

var webhookRoute = require('../../src/routes/gcal-webhook.routes');

function makeApp() {
  var app = express();
  app.use(express.json());
  app.use('/api/gcal-webhook', webhookRoute);
  return app;
}

beforeEach(function () {
  mockChannelLookup = null;
  mockEmittedEvents = [];
  jest.clearAllMocks();
});

describe('GCal webhook receiver (999.15520)', function () {
  test('acknowledges initial sync confirmation with 200', async function () {
    var app = makeApp();
    var res = await request(app)
      .post('/api/gcal-webhook')
      .set('X-Goog-Channel-ID', 'ch-123')
      .set('X-Goog-Resource-ID', 'res-123')
      .set('X-Goog-Resource-State', 'sync')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, state: 'sync' });
  });

  test('returns 400 when required headers are missing', async function () {
    var app = makeApp();
    var res = await request(app)
      .post('/api/gcal-webhook')
      .send({});

    expect(res.status).toBe(400);
  });

  test('maps channel to user and emits SSE calendar-changed event', async function () {
    mockChannelLookup = function () { return Promise.resolve(42); };

    var app = makeApp();
    var res = await request(app)
      .post('/api/gcal-webhook')
      .set('X-Goog-Channel-ID', 'ch-abc')
      .set('X-Goog-Resource-ID', 'res-abc')
      .set('X-Goog-Resource-State', 'exists')
      .set('X-Goog-Message-Number', '1')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockEmittedEvents).toHaveLength(1);
    expect(mockEmittedEvents[0].userId).toBe('42');
    expect(mockEmittedEvents[0].event).toBe('calendar-changed');
    expect(mockEmittedEvents[0].data.provider).toBe('gcal');
  });

  test('returns 200 for unknown channel (acknowledges to stop Google retrying)', async function () {
    mockChannelLookup = function () { return Promise.resolve(null); };

    var app = makeApp();
    var res = await request(app)
      .post('/api/gcal-webhook')
      .set('X-Goog-Channel-ID', 'ch-unknown')
      .set('X-Goog-Resource-ID', 'res-unknown')
      .set('X-Goog-Resource-State', 'exists')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.unknown).toBe(true);
    expect(mockEmittedEvents).toHaveLength(0);
  });

  test('adapter lookup error returns 200 (stops Google retrying)', async function () {
    mockChannelLookup = function () { return Promise.reject(new Error('DB error')); };

    var app = makeApp();
    var res = await request(app)
      .post('/api/gcal-webhook')
      .set('X-Goog-Channel-ID', 'ch-err')
      .set('X-Goog-Resource-ID', 'res-err')
      .set('X-Goog-Resource-State', 'exists')
      .send({});

    expect(res.status).toBe(200);
    expect(mockEmittedEvents).toHaveLength(0);
  });
});

// 999.2176 MOCK-DRIFT guard: verify the route module can actually be required
// without mocks — catches a mismatch between the mock's export shape and the
// real GoogleCalendarAdapter module surface.
describe('gcal-webhook.routes — real-require smoke (no mocks)', function () {
  test('calendar facade exports findUserByWatchChannel as a function', function () {
    jest.dontMock('../../src/slices/calendar/facade');
    jest.dontMock('../../src/lib/sse-emitter');
    jest.dontMock('../../src/lib/rate-limit-store');
    var realFacade = require('../../src/slices/calendar/facade');
    expect(typeof realFacade.findUserByWatchChannel).toBe('function');
    // Re-enable mocks for subsequent tests
    jest.mock('../../src/slices/calendar/facade', function () {
      return {
        findUserByWatchChannel: function () { return Promise.resolve(null); }
      };
    });
    jest.mock('../../src/lib/sse-emitter', function () {
      return { emit: function () {} };
    });
    jest.mock('../../src/lib/rate-limit-store', function () {
      return { maybeRedisStore: function () { return undefined; } };
    });
  });
});