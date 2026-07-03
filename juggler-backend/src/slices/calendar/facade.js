/**
 * Calendar slice facade — Wave 4 / W4.
 *
 * AGGREGATING RE-EXPORT SURFACE. This is the single public API the calendar
 * controllers will import in W5. It contains NO sync-orchestration logic and
 * NO behavior of its own — every function exposed here is the SAME
 * implementation already used in production, re-exported by reference.
 *
 * A controller swapping:
 *     require('../lib/cal-adapters')   ->  require('../slices/calendar/facade')
 *     require('../lib/sync-lock')      ->  require('../slices/calendar/facade')
 * gets byte-identical behavior.
 *
 * Design choice (registry): the facade OWNS the adapter registry directly over
 * the slice adapters (Wave 5 / W5). The tiny registry logic (getAllAdapters /
 * getConnectedAdapters / getAdapter / registerAdapter over {gcal, msft, apple})
 * is the SAME logic previously in `src/lib/cal-adapters/index.js`, copied
 * verbatim. The lib/cal-adapters/* files are now thin shims that re-export FROM
 * this facade, so the frozen migration history (which requires cal-adapters)
 * keeps working byte-identically while the dependency direction points into the
 * slice — no require cycle, since the facade no longer requires lib/cal-adapters.
 *
 * Design note (60d sync window): the controller computes the 14d-back / 60d-
 * forward window INLINE using `localToUtc` / `utcToLocal` from
 * `scheduler/dateHelpers`. There is no named window helper to re-export, so the
 * facade re-exports those SAME date helpers (by reference). No window is
 * recomputed here.
 *
 * 999.943: Added thin HTTP adapter operations for gcal/msft/apple controllers
 * (getGcalStatus, setGcalAutoSync, gcalDisconnect, gcalConnect, gcalCallback,
 * msftGetStatus, msftSetAutoSync, msftDisconnect, msftConnect, msftCallback,
 * appleGetStatus, appleConnect, appleSelectCalendar, appleSelectCalendars,
 * appleGetCalendars, appleUpdateCalendar, appleRefreshCalendars,
 * appleDisconnect, appleSetAutoSync) — each delegates to the same lib/* API
 * modules the legacy controllers used, keeping the controllers thin.
 */

// ── sync-lock (re-exported by reference, no wrapper logic) ──────────
var syncLock = require('../../lib/sync-lock');

// ── date helpers backing the 60d sync window (same refs as controller) ──
var dateHelpers = require('../../scheduler/dateHelpers');

// ── CalendarPort + adapter classes/singletons + repository ─────────
var CalendarPort = require('./domain/ports/CalendarPort');
var SyncStateRepositoryPort = require('./domain/ports/SyncStateRepositoryPort');
var CalendarEvent = require('./domain/entities/CalendarEvent');
var SyncState = require('./domain/entities/SyncState');
var EventId = require('./domain/value-objects/EventId');
var ProviderType = require('./domain/value-objects/ProviderType');

var GoogleCalendarAdapter = require('./adapters/GoogleCalendarAdapter');
var MicrosoftCalendarAdapter = require('./adapters/MicrosoftCalendarAdapter');
var AppleCalendarAdapter = require('./adapters/AppleCalendarAdapter');
var InMemoryCalendarAdapter = require('./adapters/InMemoryCalendarAdapter');
var KnexSyncStateRepository = require('./adapters/KnexSyncStateRepository');

// ── adapter registry (owned here over slice adapters — W5) ─────────
// Default registry is EXACTLY {gcal, msft, apple} — identical to the prior
// lib/cal-adapters/index.js registry. InMemory is a named export but is NOT in
// the default registry (it never was). Registry logic copied verbatim.
var adapters = {
  gcal: GoogleCalendarAdapter,
  msft: MicrosoftCalendarAdapter,
  apple: AppleCalendarAdapter
};

/**
 * Get all registered adapters as an array.
 */
function getAllAdapters() {
  return Object.values(adapters);
}

/**
 * Get adapters that are connected for a given user.
 */
function getConnectedAdapters(user) {
  return getAllAdapters().filter(function(a) { return a.isConnected(user); });
}

/**
 * Get a specific adapter by provider ID.
 */
function getAdapter(providerId) {
  return adapters[providerId] || null;
}

/**
 * Register a new adapter (for future providers like Apple, Yahoo).
 */
function registerAdapter(adapter) {
  adapters[adapter.providerId] = adapter;
}

/**
 * CalendarService — thin aggregation per the README shape.
 *
 * `initialize(deps)` is side-effect-free: it returns the facade itself so
 * callers can do `const facade = calendar.initialize()`. It does NOT wire up
 * any new orchestration, registration, or background work — sync orchestration
 * lives in the controllers (REFACTOR mode: no behavior change). `deps` is
 * accepted for README-shape compatibility but intentionally unused; the slice
 * adapters resolve their own dependencies as they do today.
 */
function initialize(/* deps */) {
  return module.exports;
}

// ── 999.943: Thin HTTP adapter operations for calendar controllers ──
// These delegate to the same lib/* API modules the legacy controllers used,
// keeping the controllers thin (no direct DB access).

var { SignJWT } = require('jose');
var { getJwtSecret, verifyStateToken } = require('../../lib/jwt-secret');
var gcalApi = require('../../lib/gcal-api');
var msftCalApi = require('../../lib/msft-cal-api');
var appleCalApi = require('../../lib/apple-cal-api');
var { encrypt, decrypt } = require('../../lib/credential-encrypt');
var db = require('../../lib/db').getDefaultDb();
var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('calendar.facade');

// ── GCal operations ──

async function getGcalStatus(user) {
  var hasToken = !!user.gcal_refresh_token;
  var lastSyncedAt = user.gcal_last_synced_at || null;
  var connected = false;
  var tokenExpired = false;

  if (hasToken) {
    connected = true;
    if (user.gcal_token_expiry) {
      var expiryStr = String(user.gcal_token_expiry);
      var expiry = new Date(expiryStr.endsWith('Z') ? expiryStr : expiryStr + 'Z');
      if (expiry.getTime() < Date.now()) {
        connected = true;
      }
    }
  }

  var autoSyncRow = await db('user_config')
    .where({ user_id: user.id, config_key: 'gcal_auto_sync' })
    .first();
  var autoSync = false;
  if (autoSyncRow) {
    var val = typeof autoSyncRow.config_value === 'string'
      ? JSON.parse(autoSyncRow.config_value) : autoSyncRow.config_value;
    autoSync = !!val;
  }

  return {
    connected: connected,
    tokenExpired: tokenExpired,
    email: user.email,
    lastSyncedAt: lastSyncedAt,
    autoSync: autoSync
  };
}

async function gcalConnect(user) {
  var oauth2Client = gcalApi.createOAuth2Client();
  var state = await new SignJWT({ userId: user.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(getJwtSecret());
  var authUrl = gcalApi.getAuthUrl(oauth2Client, state);
  return { authUrl: authUrl };
}

async function gcalMarkCodeUsed(code) {
  var key = code.substring(0, 40);
  var hash = require('crypto').createHash('sha256').update(key).digest('hex');

  await db.raw('DELETE FROM oauth_code_nonces WHERE expires_at < NOW()').catch(function() {});

  var result = await db.raw(
    'INSERT IGNORE INTO oauth_code_nonces (code_hash, expires_at) ' +
    'VALUES (?, DATE_ADD(NOW(), INTERVAL 2 MINUTE))',
    [hash]
  );
  return result[0].affectedRows === 1;
}

async function gcalCallback(code, state, reqUser) {
  if (!code || !state) {
    return { status: 400, body: 'Missing code or state parameter' };
  }

  var decoded;
  try {
    var result = await verifyStateToken(state);
    decoded = result.payload;
  } catch (_e) {
    return { status: 400, body: 'Invalid or expired state parameter' };
  }

  var userId = decoded.userId;
  if (reqUser && reqUser.id !== userId) {
    return { status: 403, body: 'OAuth state does not match authenticated user' };
  }

  if (!(await gcalMarkCodeUsed(code))) {
    logger.info('[GCAL CALLBACK] Duplicate code detected, redirecting without re-exchange');
    var frontUrl = require('../../proxy-config').services.juggler.frontend;
    return { status: 302, redirect: frontUrl + '/?gcal=connected' };
  }

  var oauth2Client = gcalApi.createOAuth2Client();
  var tokens = await gcalApi.getTokensFromCode(oauth2Client, code);

  var update = {
    gcal_access_token: tokens.access_token,
    updated_at: db.fn.now()
  };
  if (tokens.refresh_token) {
    update.gcal_refresh_token = tokens.refresh_token;
  }
  if (tokens.expiry_date) {
    update.gcal_token_expiry = new Date(tokens.expiry_date);
  }

  await db('users').where('id', userId).update(update);

  var frontendUrl = require('../../proxy-config').services.juggler.frontend;
  return { status: 302, redirect: frontendUrl + '/?gcal=connected' };
}

async function gcalDisconnect(userId) {
  await db('users').where('id', userId).update({
    gcal_access_token: null,
    gcal_refresh_token: null,
    gcal_token_expiry: null,
    updated_at: db.fn.now()
  });
  return { disconnected: true };
}

async function setGcalAutoSync(userId, enabled) {
  var value = !!enabled;
  var existing = await db('user_config')
    .where({ user_id: userId, config_key: 'gcal_auto_sync' })
    .first();

  if (existing) {
    await db('user_config')
      .where({ user_id: userId, config_key: 'gcal_auto_sync' })
      .update({ config_value: JSON.stringify(value), updated_at: db.fn.now() });
  } else {
    await db('user_config').insert({
      user_id: userId,
      config_key: 'gcal_auto_sync',
      config_value: JSON.stringify(value)
    });
  }

  return { autoSync: value };
}

// ── MSFT Calendar operations ──

async function getMsftStatus(user) {
  var hasToken = !!user.msft_cal_refresh_token;
  var lastSyncedAt = user.msft_cal_last_synced_at || null;
  var connected = false;
  var tokenExpired = false;

  if (hasToken) {
    connected = true;
  }

  var msftEmail = user.msft_cal_email || null;
  if (connected && !msftEmail) {
    try {
      var token = await getAdapter('msft').getValidAccessToken(user);
      var info = await msftCalApi.getUserInfo(token);
      if (info && info.email) {
        msftEmail = info.email;
        await db('users').where('id', user.id)
          .update({ msft_cal_email: msftEmail, updated_at: db.fn.now() });
      }
    } catch (e) {
      logger.warn('MSFT account email lazy backfill failed (non-fatal):', e.message);
    }
  }

  var autoSyncRow = await db('user_config')
    .where({ user_id: user.id, config_key: 'msft_cal_auto_sync' })
    .first();
  var autoSync = false;
  if (autoSyncRow) {
    var val = typeof autoSyncRow.config_value === 'string'
      ? JSON.parse(autoSyncRow.config_value) : autoSyncRow.config_value;
    autoSync = !!val;
  }

  return {
    connected: connected,
    tokenExpired: tokenExpired,
    email: msftEmail,
    lastSyncedAt: lastSyncedAt,
    autoSync: autoSync
  };
}

async function msftConnect(user) {
  var pkce = msftCalApi.generatePkce();
  var state = await new SignJWT({ userId: user.id, cv: pkce.codeVerifier })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(getJwtSecret());
  var authUrl = msftCalApi.getAuthUrl(state, pkce.codeChallenge);
  return { authUrl: authUrl };
}

async function msftMarkCodeUsed(code) {
  var key = code.substring(0, 40);
  var hash = require('crypto').createHash('sha256').update(key).digest('hex');

  await db.raw('DELETE FROM oauth_code_nonces WHERE expires_at < NOW()').catch(function() {});

  var result = await db.raw(
    'INSERT IGNORE INTO oauth_code_nonces (code_hash, expires_at) ' +
    'VALUES (?, DATE_ADD(NOW(), INTERVAL 2 MINUTE))',
    [hash]
  );
  return result[0].affectedRows === 1;
}

async function msftCallback(code, state, reqUser) {
  if (!code || !state) {
    return { status: 400, body: 'Missing code or state parameter' };
  }

  var decoded;
  try {
    var result = await verifyStateToken(state);
    decoded = result.payload;
  } catch (_e) {
    return { status: 400, body: 'Invalid or expired state parameter' };
  }

  var userId = decoded.userId;
  if (reqUser && reqUser.id !== userId) {
    return { status: 403, body: 'OAuth state does not match authenticated user' };
  }
  var codeVerifier = decoded.cv;
  if (!codeVerifier) {
    return { status: 400, body: 'Missing PKCE code_verifier in state' };
  }

  if (!(await msftMarkCodeUsed(code))) {
    logger.info('[MSFT CALLBACK] Duplicate code detected, redirecting without re-exchange');
    var frontUrl = require('../../proxy-config').services.juggler.frontend;
    return { status: 302, redirect: frontUrl + '/?msftcal=connected' };
  }

  var tokens = await msftCalApi.getTokensFromCode(code, codeVerifier);

  var update = {
    msft_cal_access_token: tokens.accessToken,
    updated_at: db.fn.now()
  };
  if (tokens.refreshToken) {
    update.msft_cal_refresh_token = tokens.refreshToken;
  }
  if (tokens.expiresOn) {
    update.msft_cal_token_expiry = new Date(tokens.expiresOn);
  }

  try {
    var info = await msftCalApi.getUserInfo(tokens.accessToken);
    if (info && info.email) update.msft_cal_email = info.email;
  } catch (e) {
    logger.warn('MSFT account email capture failed (non-fatal):', e.message);
  }

  await db('users').where('id', userId).update(update);

  var frontendUrl = require('../../proxy-config').services.juggler.frontend;
  return { status: 302, redirect: frontendUrl + '/?msftcal=connected' };
}

async function msftDisconnect(userId) {
  await db('users').where('id', userId).update({
    msft_cal_access_token: null,
    msft_cal_refresh_token: null,
    msft_cal_token_expiry: null,
    updated_at: db.fn.now()
  });
  return { disconnected: true };
}

async function setMsftAutoSync(userId, enabled) {
  var value = !!enabled;
  var existing = await db('user_config')
    .where({ user_id: userId, config_key: 'msft_cal_auto_sync' })
    .first();

  if (existing) {
    await db('user_config')
      .where({ user_id: userId, config_key: 'msft_cal_auto_sync' })
      .update({ config_value: JSON.stringify(value), updated_at: db.fn.now() });
  } else {
    await db('user_config').insert({
      user_id: userId,
      config_key: 'msft_cal_auto_sync',
      config_value: JSON.stringify(value)
    });
  }

  return { autoSync: value };
}

// ── Apple Calendar operations ──

async function appleGetStatus(user) {
  var hasCredentials = !!user.apple_cal_username && !!user.apple_cal_password;

  var allCalendars = [];
  try {
    allCalendars = await db('user_calendars')
      .where({ user_id: user.id, provider: 'apple' });
  } catch (_e) {
    // Table may not exist if migration hasn't run yet
  }

  var connected = hasCredentials && (allCalendars.length > 0 || !!user.apple_cal_calendar_url);
  var lastSyncedAt = user.apple_cal_last_synced_at || null;

  var autoSyncRow = await db('user_config')
    .where({ user_id: user.id, config_key: 'apple_cal_auto_sync' })
    .first();
  var autoSync = false;
  if (autoSyncRow) {
    var val = typeof autoSyncRow.config_value === 'string'
      ? JSON.parse(autoSyncRow.config_value) : autoSyncRow.config_value;
    autoSync = !!val;
  }

  return {
    connected: connected,
    username: connected ? user.apple_cal_username : null,
    calendarUrl: connected ? user.apple_cal_calendar_url : null,
    calendars: allCalendars.length > 0 ? allCalendars : null,
    lastSyncedAt: lastSyncedAt,
    autoSync: autoSync
  };
}

async function appleConnect(userId, body) {
  var { username, password, serverUrl } = body;
  if (!username || !password) {
    return { status: 400, body: { error: 'Apple ID email and app-specific password are required' } };
  }

  var url = serverUrl || appleCalApi.DEFAULT_SERVER_URL;

  var client;
  try {
    client = await appleCalApi.createClient(url, username, password);
  } catch (e) {
    logger.error('Apple Calendar connect failed:', e.message);
    return { status: 401, body: { error: 'Failed to connect. Check your Apple ID and app-specific password.', detail: e.message } };
  }

  var calendars;
  try {
    calendars = await appleCalApi.discoverCalendars(client);
  } catch (e) {
    logger.error('Apple Calendar discovery failed:', e.message);
    return { status: 401, body: { error: 'Connected but failed to discover calendars. Check your credentials.', detail: e.message } };
  }

  if (calendars.length === 0) {
    return { status: 404, body: { error: 'No calendars found on this account' } };
  }

  await db('users').where('id', userId).update({
    apple_cal_server_url: url,
    apple_cal_username: username,
    apple_cal_password: encrypt(password),
    updated_at: db.fn.now()
  });

  var existingSelections = [];
  try {
    existingSelections = await db('user_calendars')
      .where({ user_id: userId, provider: 'apple' });
  } catch (e) {
    logger.warn('user_calendars table not available:', e.message);
  }

  var selectionMap = {};
  existingSelections.forEach(function(s) {
    selectionMap[s.calendar_id] = s;
  });

  return {
    status: 200,
    body: {
      calendars: calendars.map(function(c) {
        var existing = selectionMap[c.url];
        return {
          url: c.url,
          displayName: c.displayName,
          description: c.description,
          enabled: existing ? existing.enabled : false,
          syncDirection: existing ? existing.sync_direction : 'full'
        };
      })
    }
  };
}

async function appleSelectCalendar(userId, body) {
  var { calendarUrl } = body;
  if (!calendarUrl) {
    return { status: 400, body: { error: 'calendarUrl is required' } };
  }

  var user = await db('users').where('id', userId).first();
  if (!user || !user.apple_cal_username || !user.apple_cal_password) {
    return { status: 400, body: { error: 'Not connected to Apple Calendar. Connect first.' } };
  }

  await db('users').where('id', userId).update({
    apple_cal_calendar_url: calendarUrl,
    updated_at: db.fn.now()
  });

  var existing = await db('user_calendars')
    .where({ user_id: userId, provider: 'apple', calendar_id: calendarUrl })
    .first();

  if (existing) {
    await db('user_calendars').where('id', existing.id).update({ enabled: true, updated_at: db.fn.now() });
  } else {
    await db('user_calendars').insert({
      user_id: userId,
      provider: 'apple',
      calendar_id: calendarUrl,
      enabled: true,
      sync_direction: 'full'
    });
  }

  return { status: 200, body: { calendarUrl: calendarUrl } };
}

async function appleSelectCalendars(userId, body) {
  var { calendars } = body;
  if (!Array.isArray(calendars) || calendars.length === 0) {
    return { status: 400, body: { error: 'calendars array is required' } };
  }

  var user = await db('users').where('id', userId).first();
  if (!user || !user.apple_cal_username || !user.apple_cal_password) {
    return { status: 400, body: { error: 'Not connected to Apple Calendar. Connect first.' } };
  }

  for (var i = 0; i < calendars.length; i++) {
    var cal = calendars[i];
    var existing = await db('user_calendars')
      .where({ user_id: userId, provider: 'apple', calendar_id: cal.url })
      .first();

    if (existing) {
      await db('user_calendars').where('id', existing.id).update({
        display_name: cal.displayName || existing.display_name,
        enabled: cal.enabled !== undefined ? cal.enabled : existing.enabled,
        sync_direction: cal.syncDirection || existing.sync_direction,
        ingest_mode: cal.ingestMode || existing.ingest_mode,
        updated_at: db.fn.now()
      });
    } else {
      await db('user_calendars').insert({
        user_id: userId,
        provider: 'apple',
        calendar_id: cal.url,
        display_name: cal.displayName || null,
        enabled: cal.enabled !== undefined ? cal.enabled : false,
        sync_direction: cal.syncDirection || 'full',
        ingest_mode: cal.ingestMode || 'task'
      });
    }
  }

  var firstEnabled = await db('user_calendars')
    .where({ user_id: userId, provider: 'apple', enabled: true })
    .first();

  await db('users').where('id', userId).update({
    apple_cal_calendar_url: firstEnabled ? firstEnabled.calendar_id : null,
    updated_at: db.fn.now()
  });

  var savedCalendars = await db('user_calendars')
    .where({ user_id: userId, provider: 'apple' });

  return { status: 200, body: { calendars: savedCalendars } };
}

async function appleGetCalendars(userId) {
  var calendars = await db('user_calendars')
    .where({ user_id: userId, provider: 'apple' });
  return { status: 200, body: { calendars: calendars } };
}

async function appleUpdateCalendar(userId, calendarId, body) {
  var row = await db('user_calendars')
    .where({ id: calendarId, user_id: userId })
    .first();

  if (!row) {
    return { status: 404, body: { error: 'Calendar not found' } };
  }

  var updates = { updated_at: db.fn.now() };
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.syncDirection) updates.sync_direction = body.syncDirection;
  if (body.ingestMode) updates.ingest_mode = body.ingestMode;

  await db('user_calendars').where('id', calendarId).update(updates);

  var firstEnabled = await db('user_calendars')
    .where({ user_id: userId, provider: 'apple', enabled: true })
    .first();

  await db('users').where('id', userId).update({
    apple_cal_calendar_url: firstEnabled ? firstEnabled.calendar_id : null,
    updated_at: db.fn.now()
  });

  var updated = await db('user_calendars').where('id', calendarId).first();
  return { status: 200, body: { calendar: updated } };
}

async function appleRefreshCalendars(userId, user) {
  if (!user.apple_cal_username || !user.apple_cal_password) {
    return { status: 400, body: { error: 'Apple Calendar not connected. Please connect first.' } };
  }

  var password = decrypt(user.apple_cal_password);
  var serverUrl = user.apple_cal_server_url || appleCalApi.DEFAULT_SERVER_URL;

  var client;
  try {
    client = await appleCalApi.createClient(serverUrl, user.apple_cal_username, password);
  } catch (e) {
    return { status: 401, body: { error: 'Failed to connect. Your credentials may have expired.', detail: e.message } };
  }

  var remoteCalendars;
  try {
    remoteCalendars = await appleCalApi.discoverCalendars(client);
  } catch (e) {
    return { status: 500, body: { error: 'Failed to discover calendars.', detail: e.message } };
  }

  var existingRows = await db('user_calendars')
    .where({ user_id: userId, provider: 'apple' });
  var existingByUrl = {};
  existingRows.forEach(function(r) { existingByUrl[r.calendar_id] = r; });

  var remoteUrls = new Set();
  for (var i = 0; i < remoteCalendars.length; i++) {
    var rc = remoteCalendars[i];
    remoteUrls.add(rc.url);

    if (existingByUrl[rc.url]) {
      if (existingByUrl[rc.url].display_name !== rc.displayName) {
        await db('user_calendars').where('id', existingByUrl[rc.url].id)
          .update({ display_name: rc.displayName, updated_at: db.fn.now() });
      }
    } else {
      await db('user_calendars').insert({
        user_id: userId,
        provider: 'apple',
        calendar_id: rc.url,
        display_name: rc.displayName,
        enabled: false,
        sync_direction: 'full',
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });
    }
  }

  var allCalendars = await db('user_calendars')
    .where({ user_id: userId, provider: 'apple' });

  return {
    status: 200,
    body: {
      calendars: allCalendars.map(function(c) {
        return {
          id: c.id,
          url: c.calendar_id,
          displayName: c.display_name,
          enabled: !!c.enabled,
          syncDirection: c.sync_direction,
          availableRemotely: remoteUrls.has(c.calendar_id)
        };
      })
    }
  };
}

async function appleDisconnect(userId) {
  await db('user_calendars')
    .where({ user_id: userId, provider: 'apple' })
    .del();

  await db('users').where('id', userId).update({
    apple_cal_server_url: null,
    apple_cal_username: null,
    apple_cal_password: null,
    apple_cal_calendar_url: null,
    apple_cal_sync_token: null,
    apple_cal_last_synced_at: null,
    updated_at: db.fn.now()
  });

  await db('user_config')
    .where({ user_id: userId, config_key: 'apple_cal_auto_sync' })
    .del()
    .catch(function() {});

  return { disconnected: true };
}

async function setAppleAutoSync(userId, enabled) {
  var value = !!enabled;
  var existing = await db('user_config')
    .where({ user_id: userId, config_key: 'apple_cal_auto_sync' })
    .first();

  if (existing) {
    await db('user_config')
      .where({ user_id: userId, config_key: 'apple_cal_auto_sync' })
      .update({ config_value: JSON.stringify(value) });
  } else {
    await db('user_config').insert({
      user_id: userId,
      config_key: 'apple_cal_auto_sync',
      config_value: JSON.stringify(value)
    });
  }

  return { autoSync: value };
}

// ── 999.942 W1/W2: cal-sync controller read-path facade methods ──
// hasChanges/getSyncHistory (cal-sync.controller.js) previously ran these
// queries via a raw inline `getDb()('tasks_v'|'sync_history')` call. This
// re-exposes the SAME exact queries behind the facade boundary — no
// orchestration logic, no shape change (REFACTOR mode — no behavior change).
//
// Uses `../../db` (src/db.js) rather than the `lib/db.getDefaultDb()` var
// used above: src/db.js simply re-exports lib/db's getDefaultDb() singleton
// verbatim, so this is the byte-identical connection in production — it
// matches what the controller's pre-existing `getDb()` already resolved to.
var srcDb = require('../../db');

/**
 * Count tasks_v rows for a user updated after a given timestamp (used by
 * hasChanges' local-change detection). Exact query previously inlined in
 * cal-sync.controller.js:hasChanges.
 */
async function countLocalChangesSince(userId, sinceTimestamp) {
  return srcDb('tasks_v')
    .where('user_id', userId)
    .whereNotNull('scheduled_at')
    .where('updated_at', '>', sinceTimestamp)
    .count('* as cnt')
    .first();
}

/**
 * Read the recent sync_history runs (grouped run IDs + detail rows) for a
 * user. Exact two-query sequence previously inlined in
 * cal-sync.controller.js:getSyncHistory — grouping/shaping stays in the
 * controller, only the raw reads move behind the facade.
 */
async function getSyncHistory(userId, opts) {
  opts = opts || {};
  var runLimit = opts.runLimit;

  var recentRuns = await srcDb('sync_history')
    .where('user_id', userId)
    .select('sync_run_id')
    .max('created_at as run_time')
    .groupBy('sync_run_id')
    .orderBy('run_time', 'desc')
    .limit(runLimit);

  if (recentRuns.length === 0) {
    return { recentRuns: recentRuns, rows: [] };
  }

  var runIds = recentRuns.map(function(r) { return r.sync_run_id; });

  var rows = await srcDb('sync_history')
    .where('user_id', userId)
    .whereIn('sync_run_id', runIds)
    .orderBy('id', 'asc')
    .select();

  return { recentRuns: recentRuns, rows: rows };
}

// ── 999.1026: cal-sync controller audit-path facade method ──
// audit (cal-sync.controller.js:audit) previously ran the task-fetch +
// template-text resolution + per-adapter event comparison INLINE in the
// controller. This re-exposes the SAME exact logic behind the facade boundary
// — no behavior change (REFACTOR mode). The controller's audit() becomes a
// thin HTTP handler that delegates here.
//
// The cross-require on task.controller.js:fetchTasksWithEventIds is resolved
// HERE (inside the facade), not in the controller — the facade already owns
// the calendar domain's read-path; the task read is a collaborator dependency
// the facade manages, matching how 999.942 handled the DB reads.

/**
 * Compare Strive tasks to calendar events and report mismatches.
 *
 * @param {string} userId - user ID
 * @param {Object} userRow - row from users table (used for adapter connectivity)
 * @param {number} days - window in days (capped at 60 by caller)
 * @returns {Promise<Object>} report — { window: {startUTC,endUTC,days}, providers: {pid: provReport} }
 */
async function auditCalendarSync(userId, userRow, days) {
  var now = new Date();
  var end = new Date(now); end.setDate(end.getDate() + days);

  var adapters = getConnectedAdapters(userRow);
  var report = {
    window: { startUTC: now.toISOString(), endUTC: end.toISOString(), days: days },
    providers: {}
  };

  // Load Strive tasks in window
  var { fetchTasksWithEventIds } = require('../../controllers/task.controller');
  // 999.488/489: signature is (userId, queryBuilder) — see note at the other
  // call site; the legacy 3-arg shape caused ER_NO_TABLES_USED.
  var taskRows = await fetchTasksWithEventIds(userId, function(q) {
    q.whereNotNull('scheduled_at')
      .where('scheduled_at', '>=', now).where('scheduled_at', '<=', end)
      .whereNot('status', 'done').whereNot('status', 'cancel').whereNot('status', 'skip')
      .whereNot('status', 'pause').whereNot('status', 'disabled')
      .whereNot('task_type', 'recurring_template')
      .where(function() { this.whereNull('unscheduled').orWhere('unscheduled', 0); })
      .orderBy('scheduled_at');
  });

  // Resolve recurring instance text from templates
  var srcIds = taskRows.filter(function(r){ return !r.text && r.source_id; }).map(function(r){ return r.source_id; });
  var tpl = {};
  if (srcIds.length > 0) {
    (await srcDb('tasks_v').whereIn('id', srcIds).select('id', 'text'))
      .forEach(function(r) { tpl[r.id] = r.text; });
  }
  taskRows.forEach(function(r) { if (!r.text && r.source_id) r.text = tpl[r.source_id] || ''; });

  for (var pi = 0; pi < adapters.length; pi++) {
    var adapter = adapters[pi];
    var pid = adapter.providerId;
    var eventIdCol = adapter.getEventIdColumn();
    var provReport = {
      striveTasks: taskRows.length,
      matched: 0,
      missingFromCalendar: [],
      timeMismatches: [],
      durMismatches: [],
      orphansOnCalendar: []
    };

    try {
      var token = await adapter.getValidAccessToken(userRow);
      var events = await adapter.listEvents(token, now.toISOString(), end.toISOString(), userId);

      var eventsById = {};
      events.forEach(function(e) {
        eventsById[e.id] = e;
        if (e._url) eventsById[e._url] = e;
      });
      provReport.calendarEvents = events.length;

      taskRows.forEach(function(r) {
        var evId = r[eventIdCol];
        var striveStart = new Date(String(r.scheduled_at).replace(' ', 'T') + 'Z');
        var striveDur = r.dur || 30;

        if (!evId) {
          provReport.missingFromCalendar.push({
            taskId: r.id, text: r.text, striveTime: striveStart.toISOString(), striveDur: striveDur, reason: 'no event ID'
          });
          return;
        }
        var ev = eventsById[evId];
        if (!ev) {
          provReport.missingFromCalendar.push({
            taskId: r.id, text: r.text, striveTime: striveStart.toISOString(), striveDur: striveDur, reason: 'event ID not on calendar'
          });
          return;
        }
        var evStart = new Date(ev.startDateTime);
        var timeDiffMin = Math.abs(striveStart.getTime() - evStart.getTime()) / 60000;
        var evDur = ev.durationMinutes || 30;
        var durDiff = Math.abs(striveDur - evDur);

        if (timeDiffMin > 1) {
          provReport.timeMismatches.push({
            taskId: r.id, text: r.text,
            striveTime: striveStart.toISOString(), calTime: evStart.toISOString(), diffMinutes: Math.round(timeDiffMin)
          });
        } else if (durDiff > 1 && striveDur > 0 && evDur > 0) {
          provReport.durMismatches.push({
            taskId: r.id, text: r.text, striveDur: striveDur, calDur: evDur
          });
        } else {
          provReport.matched++;
        }
      });

      var taskEventIds = new Set(taskRows.map(function(r) { return r[eventIdCol]; }).filter(Boolean));
      events.forEach(function(e) {
        if (!taskEventIds.has(e.id)) {
          provReport.orphansOnCalendar.push({
            eventId: e.id, title: e.title, calTime: e.startDateTime
          });
        }
      });

      provReport.mismatchCount = provReport.missingFromCalendar.length + provReport.timeMismatches.length + provReport.durMismatches.length + provReport.orphansOnCalendar.length;
    } catch (err) {
      provReport.error = err.message;
    }

    report.providers[pid] = provReport;
  }

  return report;
}

module.exports = {
  // initializer (thin, side-effect-free)
  initialize: initialize,

  // adapter registry surface (owned here over slice adapters)
  getAdapter: getAdapter,
  getConnectedAdapters: getConnectedAdapters,
  getAllAdapters: getAllAdapters,
  registerAdapter: registerAdapter,

  // sync-lock surface (re-exported by reference — same function objects)
  acquireLock: syncLock.acquireLock,
  releaseLock: syncLock.releaseLock,
  refreshLock: syncLock.refreshLock,
  withSyncLock: syncLock.withSyncLock,
  withLock: syncLock.withLock,
  isLocked: syncLock.isLocked,

  // 60d sync-window date helpers (same refs the controller uses today)
  localToUtc: dateHelpers.localToUtc,
  utcToLocal: dateHelpers.utcToLocal,
  dateHelpers: dateHelpers,

  // domain ports
  CalendarPort: CalendarPort,
  SyncStateRepositoryPort: SyncStateRepositoryPort,

  // domain entities + value objects
  CalendarEvent: CalendarEvent,
  SyncState: SyncState,
  EventId: EventId,
  ProviderType: ProviderType,

  // adapter implementations
  GoogleCalendarAdapter: GoogleCalendarAdapter,
  MicrosoftCalendarAdapter: MicrosoftCalendarAdapter,
  AppleCalendarAdapter: AppleCalendarAdapter,
  InMemoryCalendarAdapter: InMemoryCalendarAdapter,
  KnexSyncStateRepository: KnexSyncStateRepository,

  // 999.943: Thin HTTP adapter operations for calendar controllers
  getGcalStatus: getGcalStatus,
  gcalConnect: gcalConnect,
  gcalCallback: gcalCallback,
  gcalDisconnect: gcalDisconnect,
  setGcalAutoSync: setGcalAutoSync,
  getMsftStatus: getMsftStatus,
  msftConnect: msftConnect,
  msftCallback: msftCallback,
  msftDisconnect: msftDisconnect,
  setMsftAutoSync: setMsftAutoSync,
  msftMarkCodeUsed: msftMarkCodeUsed,
  gcalMarkCodeUsed: gcalMarkCodeUsed,
  appleGetStatus: appleGetStatus,
  appleConnect: appleConnect,
  appleSelectCalendar: appleSelectCalendar,
  appleSelectCalendars: appleSelectCalendars,
  appleGetCalendars: appleGetCalendars,
  appleUpdateCalendar: appleUpdateCalendar,
  appleRefreshCalendars: appleRefreshCalendars,
  appleDisconnect: appleDisconnect,
  setAppleAutoSync: setAppleAutoSync,

  // 999.942: cal-sync controller read-path facade methods
  countLocalChangesSince: countLocalChangesSince,
  getSyncHistory: getSyncHistory,

  // 999.1026: cal-sync controller audit-path facade method
  auditCalendarSync: auditCalendarSync,
};
