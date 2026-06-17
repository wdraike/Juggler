/**
 * gcal-token-rotation.test.js — Unit tests for Google OAuth keep-alive:
 * refresh-token rotation for persistent sync (999.668).
 *
 * Tests cover:
 * 1. getValidAccessToken persists a rotated refresh_token when Google returns one
 * 2. getValidAccessToken does NOT overwrite refresh_token when Google omits it
 * 3. getValidAccessToken returns cached access_token when not expired
 * 4. getValidAccessToken throws if user has no refresh_token
 * 5. getValidAccessToken refreshes when within 5-minute expiry buffer
 * 6. gcal-api.getAuthUrl includes access_type=offline and prompt=consent
 */

// Capture the DB update call so we can assert on it.
var _lastDbUpdate = null;

var chainable = {
  where: function () { return chainable; },
  update: function (fields) {
    _lastDbUpdate = fields;
    return Promise.resolve(1);
  }
};

var mockDb = function () { return chainable; };
mockDb.fn = { now: function () { return 'NOW()'; } };

// Create mock functions at module scope so they survive jest.mock hoisting
var mockRefreshAccessToken = jest.fn();
var mockCreateOAuth2Client = jest.fn();

// Mock the DB module BEFORE requiring anything that depends on it
jest.mock('../../src/lib/db', () => ({
  getDefaultDb: () => mockDb
}));

jest.mock('../../src/lib/gcal-api', () => ({
  createOAuth2Client: mockCreateOAuth2Client,
  getAuthUrl: jest.fn(),
  getTokensFromCode: jest.fn(),
  refreshAccessToken: mockRefreshAccessToken,
  listEvents: jest.fn(),
  checkForChanges: jest.fn(),
  insertEvent: jest.fn(),
  patchEvent: jest.fn(),
  deleteEvent: jest.fn(),
  batchRequest: jest.fn()
}));

var gcalAdapter = require('../../src/slices/calendar/adapters/GoogleCalendarAdapter');

beforeEach(() => {
  _lastDbUpdate = null;
  mockRefreshAccessToken.mockReset();
  mockCreateOAuth2Client.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── 1. getValidAccessToken persists a rotated refresh_token ─────────────

describe('GoogleCalendarAdapter — getValidAccessToken: refresh-token rotation', () => {
  it('persists a rotated refresh_token when Google returns one', async () => {
    mockRefreshAccessToken.mockResolvedValue({
      access_token: 'new-access-token-rotated',
      expiry_date: Date.now() + 3600000,
      refresh_token: 'new-rotated-refresh-token',
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/calendar.events'
    });
    mockCreateOAuth2Client.mockReturnValue({});

    var user = {
      id: 'user-123',
      gcal_refresh_token: 'old-refresh-token',
      gcal_access_token: 'expired-access-token',
      gcal_token_expiry: new Date(Date.now() - 60000) // expired 1 min ago
    };

    var accessToken = await gcalAdapter.getValidAccessToken(user);

    expect(accessToken).toBe('new-access-token-rotated');
    expect(mockRefreshAccessToken).toHaveBeenCalledWith({}, 'old-refresh-token');

    // Verify the DB update includes the rotated refresh_token
    expect(_lastDbUpdate).toBeDefined();
    expect(_lastDbUpdate.gcal_access_token).toBe('new-access-token-rotated');
    expect(_lastDbUpdate.gcal_refresh_token).toBe('new-rotated-refresh-token');
    expect(_lastDbUpdate.gcal_token_expiry).toBeInstanceOf(Date);
  });

  it('does NOT overwrite refresh_token when Google omits it from credentials', async () => {
    // Google returns new access_token but no refresh_token (common case —
    // refresh_token rotation only happens on first consent or explicit prompt=consent)
    mockRefreshAccessToken.mockResolvedValue({
      access_token: 'new-access-token-no-rotation',
      expiry_date: Date.now() + 3600000,
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/calendar.events'
      // No refresh_token — Google didn't rotate it
    });
    mockCreateOAuth2Client.mockReturnValue({});

    var user = {
      id: 'user-456',
      gcal_refresh_token: 'existing-refresh-token',
      gcal_access_token: 'expired-access-token',
      gcal_token_expiry: new Date(Date.now() - 60000)
    };

    var accessToken = await gcalAdapter.getValidAccessToken(user);

    expect(accessToken).toBe('new-access-token-no-rotation');

    expect(_lastDbUpdate).toBeDefined();
    expect(_lastDbUpdate.gcal_access_token).toBe('new-access-token-no-rotation');
    // refresh_token should NOT be in the update object when Google doesn't provide one
    expect(_lastDbUpdate).not.toHaveProperty('gcal_refresh_token');
  });

  it('returns cached access_token when not expired (no refresh needed)', async () => {
    mockRefreshAccessToken.mockResolvedValue({ access_token: 'should-not-be-called' });
    mockCreateOAuth2Client.mockReturnValue({});

    // Use ISO string format for gcal_token_expiry to match production DB behavior.
    // The adapter does String(expiry).endsWith('Z') check — ISO strings end with 'Z'.
    var user = {
      id: 'user-789',
      gcal_refresh_token: 'valid-refresh-token',
      gcal_access_token: 'still-valid-access-token',
      // Token expires in 10 minutes — well beyond the 5-minute buffer
      gcal_token_expiry: new Date(Date.now() + 600000).toISOString()
    };

    var accessToken = await gcalAdapter.getValidAccessToken(user);

    // Should return the cached token without calling refreshAccessToken
    expect(accessToken).toBe('still-valid-access-token');
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();

    // No DB update should have been made
    expect(_lastDbUpdate).toBeNull();
  });

  it('throws if user has no refresh_token (disconnected)', async () => {
    mockRefreshAccessToken.mockResolvedValue({ access_token: 'should-not-be-called' });

    var user = {
      id: 'user-disconnected',
      gcal_refresh_token: null,
      gcal_access_token: null,
      gcal_token_expiry: null
    };

    await expect(gcalAdapter.getValidAccessToken(user))
      .rejects.toThrow('Google Calendar not connected');

    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    expect(_lastDbUpdate).toBeNull();
  });

  it('refreshes access_token when within 5-minute expiry buffer', async () => {
    // Token expires in 3 minutes — within the 5-minute buffer, should trigger refresh
    mockRefreshAccessToken.mockResolvedValue({
      access_token: 'refreshed-access-token',
      expiry_date: Date.now() + 3600000,
      token_type: 'Bearer'
    });
    mockCreateOAuth2Client.mockReturnValue({});

    var user = {
      id: 'user-almost-expired',
      gcal_refresh_token: 'refresh-token',
      gcal_access_token: 'almost-expired-access-token',
      // Token expires in 3 minutes — within the 5-min refresh buffer
      gcal_token_expiry: new Date(Date.now() + 180000)
    };

    var accessToken = await gcalAdapter.getValidAccessToken(user);

    expect(accessToken).toBe('refreshed-access-token');
    expect(mockRefreshAccessToken).toHaveBeenCalledWith({}, 'refresh-token');
    expect(_lastDbUpdate).toBeDefined();
    expect(_lastDbUpdate.gcal_access_token).toBe('refreshed-access-token');
  });

  it('persists both access_token and refresh_token when Google rotates both', async () => {
    mockRefreshAccessToken.mockResolvedValue({
      access_token: 'fresh-access',
      expiry_date: Date.now() + 3600000,
      refresh_token: 'fresh-refresh',
      token_type: 'Bearer'
    });
    mockCreateOAuth2Client.mockReturnValue({});

    var user = {
      id: 'user-full-rotation',
      gcal_refresh_token: 'stale-refresh',
      gcal_access_token: 'stale-access',
      gcal_token_expiry: new Date(Date.now() - 100000)
    };

    var accessToken = await gcalAdapter.getValidAccessToken(user);

    expect(accessToken).toBe('fresh-access');
    expect(_lastDbUpdate.gcal_access_token).toBe('fresh-access');
    expect(_lastDbUpdate.gcal_refresh_token).toBe('fresh-refresh');
    expect(_lastDbUpdate.gcal_token_expiry).toBeInstanceOf(Date);
  });
});

// ─── 2. gcal-api.getAuthUrl includes offline access + consent ──────────────

describe('gcal-api — getAuthUrl', () => {
  it('requests access_type=offline and prompt=consent for persistent refresh tokens', () => {
    jest.resetModules();
    jest.dontMock('../../src/lib/gcal-api');
    jest.dontMock('../../src/lib/db');

    // Mock google-auth-library so createOAuth2Client returns a spyable client
    jest.doMock('google-auth-library', () => ({
      OAuth2Client: jest.fn().mockImplementation(function () {
        return {
          generateAuthUrl: jest.fn(function (opts) {
            // Return the opts encoded in URL so we can assert on them
            return 'https://accounts.google.com/o/oauth2/v2/auth?' +
              'access_type=' + opts.access_type +
              '&prompt=' + opts.prompt +
              '&scope=' + opts.scope.join(',');
          })
        };
      })
    }));

    var realGcalApi = require('../../src/lib/gcal-api');

    var oauth2Client = realGcalApi.createOAuth2Client();
    var url = realGcalApi.getAuthUrl(oauth2Client, 'test-state');

    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('scope=https://www.googleapis.com/auth/calendar.events');
  });
});