/**
 * health.diagnostics — probe unit tests against injected fakes (999.1196).
 * No DB / express needed — every probe takes a plain knex-chain-shaped `db`
 * and returns a `{status, detail?}` shape. The full end-to-end route
 * behavior (rollup, resolveQueue ordering, plain-language leak guards) stays
 * covered by tests/unit/health-endpoints.test.js (unchanged, still green).
 */

'use strict';

const {
  checkDatabase,
  checkScheduler,
  checkSse,
  checkSync,
  checkWeather,
  runDetailedHealthCheck,
  FRIENDLY,
} = require('../../src/routes/health.diagnostics');

function chain(overrides) {
  const c = {
    where: jest.fn(() => c),
    whereNotNull: jest.fn(() => c),
    whereRaw: jest.fn(() => c),
    orderBy: jest.fn(() => c),
    select: jest.fn(() => Promise.resolve(overrides.selectResult || [])),
    count: jest.fn(() => c),
    first: jest.fn(() => Promise.resolve(overrides.firstResult)),
  };
  return c;
}

describe('checkDatabase', () => {
  test('operational on SELECT 1 success', async () => {
    const db = { raw: jest.fn(() => Promise.resolve([{ 1: 1 }])) };
    expect(await checkDatabase(db)).toEqual({ status: 'operational' });
  });

  test('error + plain detail on failure (no raw error text leaked)', async () => {
    const db = { raw: jest.fn(() => Promise.reject(new Error('ECONNREFUSED secret-ish'))) };
    const result = await checkDatabase(db);
    expect(result.status).toBe('error');
    expect(result.detail).toBe('Database unavailable');
    expect(result.detail).not.toMatch(/ECONNREFUSED/);
  });
});

describe('checkScheduler', () => {
  test('operational when no stuck claims and no recent error', async () => {
    const db = jest.fn(() => chain({ firstResult: { cnt: 0 } }));
    const result = await checkScheduler(db, () => null);
    expect(result).toEqual({ status: 'operational' });
  });

  test('error + friendly detail when stuck claims present (no table name leaked)', async () => {
    const db = jest.fn(() => chain({ firstResult: { cnt: 3 } }));
    const result = await checkScheduler(db, () => null);
    expect(result.status).toBe('error');
    expect(result.detail).toBe(FRIENDLY.schedulerError);
    expect(result.detail).not.toMatch(/schedule_queue|claim/i);
  });

  test('error + friendly detail on a recent (<10min) getLastError, raw message not leaked', async () => {
    const db = jest.fn(() => chain({ firstResult: { cnt: 0 } }));
    const getLastError = () => ({ timestamp: Date.now(), message: 'SQL constraint violated' });
    const result = await checkScheduler(db, getLastError);
    expect(result.status).toBe('error');
    expect(result.detail).toBe(FRIENDLY.schedulerError);
    expect(result.detail).not.toMatch(/SQL|constraint/i);
  });

  test('operational when getLastError is stale (>10min)', async () => {
    const db = jest.fn(() => chain({ firstResult: { cnt: 0 } }));
    const getLastError = () => ({ timestamp: Date.now() - 11 * 60 * 1000 });
    const result = await checkScheduler(db, getLastError);
    expect(result).toEqual({ status: 'operational' });
  });

  test('probe failure -> unknown-service friendly detail, error logged not leaked', async () => {
    const db = jest.fn(() => { throw new Error('table does not exist'); });
    const result = await checkScheduler(db, () => null);
    expect(result.status).toBe('error');
    expect(result.detail).toBe(FRIENDLY.schedulerUnavailable);
  });
});

describe('checkSse', () => {
  test('operational with detail when getStats is available', () => {
    jest.isolateModules(() => {
      jest.doMock('../../src/lib/sse-emitter', () => ({
        getStats: () => ({ activeConnections: 3 })
      }));
      const diag = require('../../src/routes/health.diagnostics');
      expect(diag.checkSse()).toEqual({ status: 'operational', detail: '3 active' });
    });
  });

  test('operational without detail when getStats is not exposed', () => {
    jest.isolateModules(() => {
      jest.doMock('../../src/lib/sse-emitter', () => ({}));
      const diag = require('../../src/routes/health.diagnostics');
      expect(diag.checkSse()).toEqual({ status: 'operational' });
    });
  });
});

describe('checkSync', () => {
  test('operational + no providers surfaced when nothing is connected', async () => {
    const db = jest.fn((table) => {
      if (table === 'users') return chain({ firstResult: { id: 'u1', gcal_refresh_token: null, msft_cal_refresh_token: null, apple_cal_password: null } });
      return chain({ selectResult: [] }); // cal_sync_ledger
    });
    const result = await checkSync(db, 'u1');
    expect(result.status).toBe('operational');
    expect(result.providers.gcal.connected).toBe(false);
  });

  test('permanent error on a connected provider -> error status, friendly detail, raw error_detail not leaked', async () => {
    const db = jest.fn((table) => {
      if (table === 'users') return chain({ firstResult: { id: 'u1', gcal_refresh_token: 'tok', msft_cal_refresh_token: null, apple_cal_password: null } });
      return chain({ selectResult: [{ provider: 'gcal', status: 'error', error_detail: 'SQLSTATE secret', synced_at: new Date() }] });
    });
    const result = await checkSync(db, 'u1');
    expect(result.status).toBe('error');
    expect(result.detail).toBe(FRIENDLY.syncError);
    expect(result.detail).not.toMatch(/SQLSTATE/);
  });

  test('transient error on a connected provider -> degraded status', async () => {
    const db = jest.fn((table) => {
      if (table === 'users') return chain({ firstResult: { id: 'u1', gcal_refresh_token: 'tok', msft_cal_refresh_token: null, apple_cal_password: null } });
      return chain({ selectResult: [{ provider: 'gcal', status: 'error', error_detail: 'HTTP 429 rate limited', synced_at: new Date() }] });
    });
    const result = await checkSync(db, 'u1');
    expect(result.status).toBe('degraded');
    expect(result.detail).toBe(FRIENDLY.syncRetry);
  });

  test('probe failure -> unknown, providers:null', async () => {
    const db = jest.fn(() => { throw new Error('boom'); });
    const result = await checkSync(db, 'u1');
    expect(result).toEqual({ status: 'unknown', detail: FRIENDLY.syncUnavailable, providers: null });
  });
});

describe('checkWeather', () => {
  const roundCoord = (c) => Math.round(c * 10) / 10;

  test('not_configured when the user has no lat/lon location', async () => {
    const db = jest.fn(() => chain({ firstResult: undefined }));
    const result = await checkWeather(db, 'u1', roundCoord);
    expect(result).toEqual({ status: 'not_configured' });
  });

  test('degraded when no forecast row exists yet', async () => {
    let call = 0;
    const db = jest.fn(() => {
      call++;
      return call === 1 ? chain({ firstResult: { lat: 40.1, lon: -74.1 } }) : chain({ firstResult: undefined });
    });
    const result = await checkWeather(db, 'u1', roundCoord);
    expect(result.status).toBe('degraded');
    expect(result.detail).toMatch(/no forecast data/);
  });

  test('operational when the forecast is fresh (<2h)', async () => {
    let call = 0;
    const db = jest.fn(() => {
      call++;
      if (call === 1) return chain({ firstResult: { lat: 40.1, lon: -74.1 } });
      return chain({ firstResult: { fetched_at: new Date().toISOString() } });
    });
    const result = await checkWeather(db, 'u1', roundCoord);
    expect(result.status).toBe('operational');
  });

  test('degraded when the forecast is stale (>2h)', async () => {
    let call = 0;
    const staleDate = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const db = jest.fn(() => {
      call++;
      if (call === 1) return chain({ firstResult: { lat: 40.1, lon: -74.1 } });
      return chain({ firstResult: { fetched_at: staleDate } });
    });
    const result = await checkWeather(db, 'u1', roundCoord);
    expect(result.status).toBe('degraded');
    expect(result.detail).toMatch(/min old/);
  });
});

describe('runDetailedHealthCheck', () => {
  test('database down -> scheduler/sync/weather are "unknown", overall status ERROR', async () => {
    const db = { raw: jest.fn(() => Promise.reject(new Error('down'))) };
    const result = await runDetailedHealthCheck({
      db, userId: 'u1', getLastError: () => null, roundCoord: (c) => c
    });
    expect(result.services.database).toBe('error');
    expect(result.services.scheduler).toBe('unknown');
    expect(result.services.sync).toBe('unknown');
    expect(result.services.weather).toBe('unknown');
    expect(result.status).toBe('ERROR');
  });

  test('all-operational (incl. not_configured weather) rolls up to OK', async () => {
    const db = jest.fn((table) => {
      if (table === 'schedule_queue') return chain({ firstResult: { cnt: 0 } });
      if (table === 'users') return chain({ firstResult: { id: 'u1', gcal_refresh_token: null, msft_cal_refresh_token: null, apple_cal_password: null } });
      if (table === 'cal_sync_ledger') return chain({ selectResult: [] });
      if (table === 'locations') return chain({ firstResult: undefined }); // not_configured
      return chain({});
    });
    db.raw = jest.fn(() => Promise.resolve([{ 1: 1 }]));

    const result = await runDetailedHealthCheck({
      db, userId: 'u1', getLastError: () => null, roundCoord: (c) => c
    });

    expect(result.services.database).toBe('operational');
    expect(result.services.scheduler).toBe('operational');
    expect(result.services.sync).toBe('operational');
    expect(result.services.weather).toBe('not_configured');
    expect(result.status).toBe('OK');
  });
});
