/**
 * Calendar sync test setup — provides real DB + real API credentials.
 *
 * Loads test credentials from .env.test and sets up a test user
 * with real OAuth tokens for GCal, MSFT, and Apple Calendar.
 *
 * Requires: docker compose -f docker-compose.test.yml up -d
 */

var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.test') });

var db = require('../../../src/db');
var gcalApi = require('../../../src/lib/gcal-api');
var msftCalApi = require('../../../src/lib/msft-cal-api');
var appleCalApi = require('../../../src/lib/apple-cal-api');
var { decrypt } = require('../../../src/lib/credential-encrypt');

var TEST_USER_ID = 'cal-sync-test-user-001';
var TEST_TIMEZONE = 'America/New_York';

var _dbAvailable = null;

async function isDbAvailable() {
  if (_dbAvailable !== null) return _dbAvailable;
  try {
    await db.raw('SELECT 1');
    _dbAvailable = true;
  } catch (e) {
    console.warn('Test DB not available:', e.message);
    _dbAvailable = false;
  }
  return _dbAvailable;
}

function hasGCalCredentials() {
  return !!(process.env.TEST_GCAL_REFRESH_TOKEN && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function hasMsftCredentials() {
  return !!(process.env.TEST_MSFT_REFRESH_TOKEN && process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

function hasAppleCredentials() {
  return !!(process.env.TEST_APPLE_USERNAME && process.env.TEST_APPLE_PASSWORD && process.env.TEST_APPLE_CALENDAR_URL);
}

/**
 * Get a fresh GCal access token for tests.
 */
async function getGCalToken() {
  if (!hasGCalCredentials()) return null;
  var oauth2Client = gcalApi.createOAuth2Client();
  var creds = await gcalApi.refreshAccessToken(oauth2Client, process.env.TEST_GCAL_REFRESH_TOKEN);
  return creds.access_token;
}

/**
 * Get a fresh MSFT access token for tests.
 */
async function getMsftToken() {
  if (!hasMsftCredentials()) return null;
  var creds = await msftCalApi.refreshAccessToken(process.env.TEST_MSFT_REFRESH_TOKEN);
  return creds.accessToken;
}

/**
 * Get an Apple CalDAV client for tests.
 */
async function getAppleClient() {
  if (!hasAppleCredentials()) return null;
  var password = process.env.TEST_APPLE_PASSWORD;
  // If password looks like an encrypted JSON blob, decrypt it
  try {
    var parsed = JSON.parse(password);
    if (parsed.iv && parsed.ct) {
      password = decrypt(password);
    }
  } catch (e) {
    // Not JSON — use as-is (plaintext app-specific password)
  }
  return appleCalApi.createClient(
    process.env.TEST_APPLE_SERVER_URL || 'https://caldav.icloud.com',
    process.env.TEST_APPLE_USERNAME,
    password
  );
}

/**
 * Build a test user row with real credentials for all available providers.
 */
function buildTestUser(overrides) {
  var user = {
    id: TEST_USER_ID,
    email: 'calsync-test@test.com',
    name: 'Cal Sync Test User',
    timezone: TEST_TIMEZONE,
    gcal_refresh_token: process.env.TEST_GCAL_REFRESH_TOKEN || null,
    gcal_access_token: null,
    gcal_token_expiry: null,
    gcal_sync_token: null,
    gcal_last_synced_at: null,
    msft_cal_refresh_token: process.env.TEST_MSFT_REFRESH_TOKEN || null,
    msft_cal_access_token: null,
    msft_cal_token_expiry: null,
    msft_cal_delta_link: null,
    msft_cal_last_synced_at: null,
    apple_cal_username: process.env.TEST_APPLE_USERNAME || null,
    apple_cal_password: process.env.TEST_APPLE_PASSWORD || null,
    apple_cal_server_url: process.env.TEST_APPLE_SERVER_URL || null,
    apple_cal_calendar_url: process.env.TEST_APPLE_CALENDAR_URL || null,
    apple_cal_sync_token: null,
    apple_cal_last_synced_at: null,
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  };
  return Object.assign(user, overrides);
}

/**
 * Seed the test user with real credentials in the DB.
 */
async function seedTestUser(overrides) {
  var user = buildTestUser(overrides);
  await db('users').where('id', user.id).del();
  await db('users').insert(user);
  // Return a fresh read so we have DB-generated fields
  return db('users').where('id', user.id).first();
}

/**
 * Clean up all test data for the test user.
 */
async function cleanupTestData() {
  await db('sync_history').where('user_id', TEST_USER_ID).del();
  await db('cal_sync_ledger').where('user_id', TEST_USER_ID).del();
  await db('sync_locks').where('user_id', TEST_USER_ID).del();
  await db('user_config').where('user_id', TEST_USER_ID).del();
  // Two-table model: instances first (FK), then masters
  await db('task_instances').where('user_id', TEST_USER_ID).del();
  await db('task_masters').where('user_id', TEST_USER_ID).del();
}

/**
 * Full cleanup including user row.
 */
async function destroyTestUser() {
  await cleanupTestData();
  await db('users').where('id', TEST_USER_ID).del();
}

/**
 * Build a mock req object for calling sync() directly.
 */
function mockReq(user, overrides) {
  return Object.assign({
    user: user,
    headers: { 'x-timezone': TEST_TIMEZONE },
    params: {},
    query: {},
    body: {}
  }, overrides);
}

/**
 * Build a mock res object that captures the response.
 */
function mockRes() {
  var res = {
    statusCode: 200,
    _json: null,
    status: function(code) { res.statusCode = code; return res; },
    json: function(data) { res._json = data; return res; }
  };
  return res;
}

module.exports = {
  db,
  TEST_USER_ID,
  TEST_TIMEZONE,
  isDbAvailable,
  hasGCalCredentials,
  hasMsftCredentials,
  hasAppleCredentials,
  getGCalToken,
  getMsftToken,
  getAppleClient,
  buildTestUser,
  seedTestUser,
  cleanupTestData,
  destroyTestUser,
  mockReq,
  mockRes,
  gcalApi,
  msftCalApi,
  appleCalApi
};
