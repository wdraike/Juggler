/**
 * 999.15520 — GCal push notifications (watch API) unit tests.
 *
 * Verifies the adapter's watch registration / renewal / stop methods and
 * the gcal-api REST wrappers for Google's events.watch / channels.stop.
 *
 * Pure unit — no DB, no live credentials, no network. gcal-api is mocked;
 * the DB is a hand-rolled in-memory stub injected via GoogleCalendarAdapter.setDb().
 */

'use strict';

jest.mock('../../src/lib/gcal-api');
var gcalApi = require('../../src/lib/gcal-api');
var GoogleCalendarAdapter = require('../../src/slices/calendar/adapters/GoogleCalendarAdapter');

// ── Minimal in-memory knex-shaped stub — user_config + user_calendars + users ──
function makeMockDb(seedCalendars, seedConfig) {
  var calendars = (seedCalendars || []).slice();
  var configRows = (seedConfig || []).slice();
  var insertedConfig = [];

  function db(table) {
    if (table === 'user_calendars') {
      return {
        where: function (cond) {
          var filtered = calendars.filter(function (r) {
            return Object.keys(cond).every(function (k) { return r[k] === cond[k]; });
          });
          filtered.orderBy = function () { return Promise.resolve(filtered); };
          return filtered;
        }
      };
    }
    if (table === 'user_config') {
      return {
        where: function (cond) {
          var filtered = configRows.filter(function (r) {
            return Object.keys(cond).every(function (k) { return r[k] === cond[k]; });
          });
          filtered.first = function () { return Promise.resolve(filtered[0] || null); };
          filtered.update = function (fields) {
            filtered.forEach(function (r) { Object.assign(r, fields); });
            return Promise.resolve(1);
          };
          filtered.del = function () {
            // Remove ALL rows matching the cond from configRows
            for (var i = configRows.length - 1; i >= 0; i--) {
              var matches = Object.keys(cond).every(function (k) { return configRows[i][k] === cond[k]; });
              if (matches) configRows.splice(i, 1);
            }
            return Promise.resolve(1);
          };
          return filtered;
        },
        insert: function (rows) {
          var arr = Array.isArray(rows) ? rows : [rows];
          arr.forEach(function (r) { configRows.push(r); insertedConfig.push(r); });
          return Promise.resolve([1]);
        }
      };
    }
    if (table === 'users') {
      return {
        where: function () { return { update: function () { return Promise.resolve(1); } }; }
      };
    }
    throw new Error('makeMockDb: unexpected table ' + table);
  }
  db.fn = { now: function () { return 'NOW()'; } };

  return { db: db, configRows: configRows, insertedConfig: insertedConfig };
}

var USER_ID = 'user-15520';

beforeEach(function () {
  jest.clearAllMocks();
});

// ── gcal-api.js: watchEvents / stopWatch REST wrappers ──

describe('gcal-api.watchEvents', function () {
  test('POSTs to /calendars/{id}/events/watch with channel body and returns the channel resource', async function () {
    gcalApi.watchEvents.mockResolvedValue({
      id: 'ch-1', resourceId: 'res-1', expiration: '1234567890000', resourceUri: 'https://...'
    });

    var result = await gcalApi.watchEvents('tok', 'primary', 'ch-1', 'https://app.example.com/api/gcal/webhook');

    expect(result.id).toBe('ch-1');
    expect(result.resourceId).toBe('res-1');
  });
});

describe('gcal-api.stopWatch', function () {
  test('POSTs to /channels/stop with id + resourceId', async function () {
    gcalApi.stopWatch.mockResolvedValue(null);

    var result = await gcalApi.stopWatch('tok', 'ch-1', 'res-1');

    expect(result).toBeNull();
    expect(gcalApi.stopWatch).toHaveBeenCalledWith('tok', 'ch-1', 'res-1');
  });
});

// ── GoogleCalendarAdapter.registerWatch ──

describe('GoogleCalendarAdapter.registerWatch', function () {
  test('registers a watch for every enabled calendar and persists channel info to user_config', async function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'primary', enabled: true },
      { id: 2, user_id: USER_ID, provider: 'gcal', calendar_id: 'secondary@x.com', enabled: true }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);

    gcalApi.watchEvents.mockImplementation(function (token, calId, chId) {
      return Promise.resolve({
        id: chId, resourceId: 'res-' + calId, expiration: String(Date.now() + 7 * 24 * 3600 * 1000),
        resourceUri: 'https://googleapis.com/...'
      });
    });

    var channels = await GoogleCalendarAdapter.registerWatch('tok', USER_ID, 'https://app.example.com/api/gcal/webhook');

    expect(gcalApi.watchEvents).toHaveBeenCalledTimes(2);
    expect(channels.length).toBe(2);
    expect(channels[0]).toHaveProperty('channelId');
    expect(channels[0]).toHaveProperty('resourceId');
    expect(channels[0]).toHaveProperty('calendarId');
    expect(channels[0]).toHaveProperty('expiration');
    // channel info was persisted to user_config
    expect(mock.insertedConfig.length).toBe(1);
    var cfg = mock.insertedConfig[0];
    expect(cfg.user_id).toBe(USER_ID);
    expect(cfg.config_key).toBe('gcal_watch_channels');
    expect(JSON.parse(cfg.config_value)).toHaveLength(2);
  });

  test('falls back gracefully — returns empty array if watch registration fails for all calendars', async function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'primary', enabled: true }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);

    gcalApi.watchEvents.mockRejectedValue(new Error('watch API 403'));

    var channels = await GoogleCalendarAdapter.registerWatch('tok', USER_ID, 'https://app.example.com/api/gcal/webhook');

    expect(channels).toEqual([]);
    // No config persisted since all failed
    expect(mock.insertedConfig.length).toBe(0);
  });

  test('partial failure — registers what it can, logs failures, persists successful channels', async function () {
    var mock = makeMockDb([
      { id: 1, user_id: USER_ID, provider: 'gcal', calendar_id: 'good', enabled: true },
      { id: 2, user_id: USER_ID, provider: 'gcal', calendar_id: 'bad', enabled: true }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);

    gcalApi.watchEvents.mockImplementation(function (token, calId, chId) {
      if (calId === 'bad') return Promise.reject(new Error('403'));
      return Promise.resolve({ id: chId, resourceId: 'res-good', expiration: '123', resourceUri: 'uri' });
    });

    var channels = await GoogleCalendarAdapter.registerWatch('tok', USER_ID, 'https://app.example.com/api/gcal/webhook');

    expect(channels.length).toBe(1);
    expect(channels[0].calendarId).toBe('good');
  });
});

describe('GoogleCalendarAdapter.unregisterWatch', function () {
  test('stops all stored watch channels and clears user_config', async function () {
    var mock = makeMockDb([], [
      {
        user_id: USER_ID,
        config_key: 'gcal_watch_channels',
        config_value: JSON.stringify([
          { channelId: 'ch-1', resourceId: 'res-1', calendarId: 'primary', expiration: '123' },
          { channelId: 'ch-2', resourceId: 'res-2', calendarId: 'secondary', expiration: '456' }
        ])
      }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);
    gcalApi.stopWatch.mockResolvedValue(null);

    await GoogleCalendarAdapter.unregisterWatch('tok', USER_ID);

    expect(gcalApi.stopWatch).toHaveBeenCalledTimes(2);
    expect(gcalApi.stopWatch).toHaveBeenCalledWith('tok', 'ch-1', 'res-1');
    expect(gcalApi.stopWatch).toHaveBeenCalledWith('tok', 'ch-2', 'res-2');
  });

  test('no-op when no channels are stored', async function () {
    var mock = makeMockDb([], []);
    GoogleCalendarAdapter.setDb(mock.db);

    await GoogleCalendarAdapter.unregisterWatch('tok', USER_ID);

    expect(gcalApi.stopWatch).not.toHaveBeenCalled();
  });
});

describe('GoogleCalendarAdapter.getWatchChannels', function () {
  test('returns parsed channel array from user_config', async function () {
    var stored = [
      { channelId: 'ch-1', resourceId: 'res-1', calendarId: 'primary', expiration: '123' }
    ];
    var mock = makeMockDb([], [
      { user_id: USER_ID, config_key: 'gcal_watch_channels', config_value: JSON.stringify(stored) }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);

    var result = await GoogleCalendarAdapter.getWatchChannels(USER_ID);

    expect(result).toEqual(stored);
  });

  test('returns empty array when no config row exists', async function () {
    var mock = makeMockDb([], []);
    GoogleCalendarAdapter.setDb(mock.db);

    var result = await GoogleCalendarAdapter.getWatchChannels(USER_ID);

    expect(result).toEqual([]);
  });
});

describe('GoogleCalendarAdapter.findUserByWatchChannel', function () {
  test('finds the user who owns a matching channel', async function () {
    var mock = makeMockDb([], [
      { user_id: 42, config_key: 'gcal_watch_channels', config_value: JSON.stringify([
        { channelId: 'ch-1', resourceId: 'res-1', calendarId: 'primary', expiration: '123' }
      ]) },
      { user_id: 99, config_key: 'gcal_watch_channels', config_value: JSON.stringify([
        { channelId: 'ch-2', resourceId: 'res-2', calendarId: 'primary', expiration: '456' }
      ]) }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);

    var userId = await GoogleCalendarAdapter.findUserByWatchChannel('ch-2', 'res-2');
    expect(userId).toBe(99);
  });

  test('returns null when no channel matches', async function () {
    var mock = makeMockDb([], [
      { user_id: 42, config_key: 'gcal_watch_channels', config_value: JSON.stringify([
        { channelId: 'ch-1', resourceId: 'res-1', calendarId: 'primary', expiration: '123' }
      ]) }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);

    var userId = await GoogleCalendarAdapter.findUserByWatchChannel('unknown', 'unknown');
    expect(userId).toBeNull();
  });

  test('skips rows with invalid JSON without crashing', async function () {
    var mock = makeMockDb([], [
      { user_id: 1, config_key: 'gcal_watch_channels', config_value: 'not-json' },
      { user_id: 2, config_key: 'gcal_watch_channels', config_value: JSON.stringify([
        { channelId: 'ch-good', resourceId: 'res-good', calendarId: 'primary', expiration: '123' }
      ]) }
    ]);
    GoogleCalendarAdapter.setDb(mock.db);

    var userId = await GoogleCalendarAdapter.findUserByWatchChannel('ch-good', 'res-good');
    expect(userId).toBe(2);
  });

  test('returns null when no config rows exist', async function () {
    var mock = makeMockDb([], []);
    GoogleCalendarAdapter.setDb(mock.db);

    var userId = await GoogleCalendarAdapter.findUserByWatchChannel('ch', 'res');
    expect(userId).toBeNull();
  });
});