/**
 * 05-adapter-msft-edge.test.js — MSFT adapter edge cases
 */
jest.setTimeout(30000);

var db = require('../../src/db');
var msftAdapter = require('../../src/lib/cal-adapters/msft.adapter');
var msftCalApi = require('../../src/lib/msft-cal-api');

var TEST_USER_ID = 'msft-edge-test-001';

async function seedUser(overrides) {
  await db('users').where('id', TEST_USER_ID).del();
  var base = {
    id: TEST_USER_ID,
    email: 'msft-edge@test.com',
    name: 'MSFT Edge Test',
    timezone: 'America/New_York',
    msft_cal_refresh_token: 'valid-refresh',
    msft_cal_access_token: 'valid-access',
    msft_cal_token_expiry: new Date(Date.now() + 60 * 60 * 1000),
    msft_cal_delta_link: overrides.msft_cal_delta_link !== undefined
      ? overrides.msft_cal_delta_link : 'stale-delta-link',
    created_at: new Date(),
    updated_at: new Date()
  };
  await db('users').insert({ ...base, ...overrides });
  return db('users').where('id', TEST_USER_ID).first();
}

afterEach(async () => {
  jest.restoreAllMocks();
  await db('users').where('id', TEST_USER_ID).del();
});
afterAll(() => db.destroy());

describe('BF-2: delta link cleared on 410 (tokenInvalid)', () => {
  it('clears msft_cal_delta_link in DB when checkForChanges throws 410', async () => {
    var user = await seedUser({ msft_cal_delta_link: 'stale-link-that-causes-410' });

    jest.spyOn(msftCalApi, 'checkForChanges').mockRejectedValue(
      Object.assign(new Error('Graph API error 410: syncStateNotFound'), { statusCode: 410 })
    );

    var result = await msftAdapter.hasChanges('any-token', user);

    expect(result.hasChanges).toBe(true);
    var updated = await db('users').where('id', TEST_USER_ID).first();
    expect(updated.msft_cal_delta_link).toBeNull();
  });

  it('null delta link returns hasChanges:true immediately (full sync)', async () => {
    var user = await seedUser({ msft_cal_delta_link: null });

    var spy = jest.spyOn(msftCalApi, 'checkForChanges');
    var result = await msftAdapter.hasChanges('any-token', user);
    expect(result.hasChanges).toBe(true);
    expect(result.tokenInvalid).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('BF-8: $select includes critical fields', () => {
  it('listEvents $select contains isCancelled, type, seriesMasterId, sensitivity, responseStatus', () => {
    var fs = require('fs');
    var path = require('path');
    var src = fs.readFileSync(
      path.join(__dirname, '../../src/lib/msft-cal-api.js'), 'utf8'
    );
    // Find the $select string in the source
    var selectMatch = src.match(/'\$select'\s*:\s*'([^']+)'/);
    var selectFields = selectMatch ? selectMatch[1] : '';
    expect(selectFields).toContain('isCancelled');
    expect(selectFields).toContain('type');
    expect(selectFields).toContain('seriesMasterId');
    expect(selectFields).toContain('sensitivity');
    expect(selectFields).toContain('responseStatus');
  });
});
