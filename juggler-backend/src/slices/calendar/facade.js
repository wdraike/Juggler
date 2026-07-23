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
var { stampInsert, stampUpdate, runWithActor } = require('../../lib/audit-context'); // 999.1576 inc.3b.3 + inc.4
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
var CalendarAccountRepositoryPort = require('./domain/ports/CalendarAccountRepositoryPort');
var KnexCalendarAccountRepository = require('./adapters/KnexCalendarAccountRepository');
var InMemoryCalendarAccountRepository = require('./adapters/InMemoryCalendarAccountRepository');

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
var { createLogger } = require('@raike/lib-logger');
var logger = createLogger('calendar.facade');

// JUG-FACADE-DB-VIOLATIONS stage 3: account/OAuth management DB access
// (users/user_config/user_calendars/oauth_code_nonces) moved to this adapter —
// the facade itself carries no direct db access. Default-instantiated over
// lib/db's shared singleton (same convention as KnexSyncStateRepository).
var accountRepo = new KnexCalendarAccountRepository();

// countLocalChangesSince/getSyncHistory (999.942 W1/W2) now live on
// KnexSyncStateRepository (stage 3). Lazily instantiated (NOT at module load,
// unlike accountRepo above): tests/cal-sync/characterization/W3-audit-
// characterization.test.js mocks this constructor as a plain object ({}) — a
// call this facade never made before stage 3 (it only re-exported the class).
// Constructing on first actual USE (inside countLocalChangesSince/
// getSyncHistory below, which W3 never calls) keeps that mock valid while
// still exercising the real class in production and in the W1/W2 suites that
// DO call these functions.
var _syncStateRepo = null;
function getSyncStateRepo() {
  if (!_syncStateRepo) _syncStateRepo = new KnexSyncStateRepository();
  return _syncStateRepo;
}

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
        tokenExpired = true;
      }
    }
  }

  var autoSyncRow = await accountRepo.getUserConfig(user.id, 'gcal_auto_sync');
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

  await accountRepo.deleteExpiredOAuthNonces().catch(function() {});

  var result = await accountRepo.insertOAuthNonceIgnoreDuplicate(hash);
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

  // 999.1576 inc.4 (harrison BLOCK-2): this callback route is unauthenticated
  // (browser redirect — no req.user), so the state-token's VERIFIED userId
  // establishes the actor for every write below (oauth_code_nonces claim,
  // users token update). Without this, strict getActor() throws and every
  // calendar connect 500s.
  return runWithActor(String(userId), async function () {
    if (!(await gcalMarkCodeUsed(code))) {
      logger.info('[GCAL CALLBACK] Duplicate code detected, redirecting without re-exchange');
      var frontUrl = require('../../proxy-config').services.juggler.frontend;
      return { status: 302, redirect: frontUrl + '/?gcal=connected' };
    }

    var oauth2Client = gcalApi.createOAuth2Client();
    var tokens = await gcalApi.getTokensFromCode(oauth2Client, code);

    var update = {
      gcal_access_token: tokens.access_token,
      updated_at: accountRepo.now()
    };
    if (tokens.refresh_token) {
      update.gcal_refresh_token = tokens.refresh_token;
    }
    if (tokens.expiry_date) {
      update.gcal_token_expiry = new Date(tokens.expiry_date);
    }

    await accountRepo.updateUser(userId, update);

    var frontendUrl = require('../../proxy-config').services.juggler.frontend;
    return { status: 302, redirect: frontendUrl + '/?gcal=connected' };
  });
}

async function gcalDisconnect(userId) {
  await accountRepo.updateUser(userId, {
    gcal_access_token: null,
    gcal_refresh_token: null,
    gcal_token_expiry: null,
    updated_at: accountRepo.now()
  });
  return { disconnected: true };
}

async function setGcalAutoSync(userId, enabled) {
  var value = !!enabled;
  var existing = await accountRepo.getUserConfig(userId, 'gcal_auto_sync');

  if (existing) {
    await accountRepo.updateUserConfig(userId, 'gcal_auto_sync',
      { config_value: JSON.stringify(value), updated_at: accountRepo.now() });
  } else {
    await accountRepo.insertUserConfig({
      user_id: userId,
      config_key: 'gcal_auto_sync',
      config_value: JSON.stringify(value)
    });
  }

  return { autoSync: value };
}

// ── GCal per-calendar selection (999.1626) ──
// Backend toggle mechanism mirroring appleGetCalendars/appleUpdateCalendar/
// appleRefreshCalendars below — deliberately GET-list + PUT-toggle rather than
// a bespoke UI: no frontend Settings surface was built for this leg (see
// backlog close evidence for 999.1626); these three endpoints ARE the
// documented API contract for a future Settings panel to bind to, and are
// directly usable today via curl/Postman for support/debugging.

async function gcalGetCalendars(userId) {
  var calendars = await accountRepo.findUserCalendars(userId, 'gcal');
  return { status: 200, body: { calendars: calendars } };
}

async function gcalUpdateCalendar(userId, calendarId, body) {
  var row = await accountRepo.findUserCalendarByIdForUser(calendarId, userId);

  if (!row) {
    return { status: 404, body: { error: 'Calendar not found' } };
  }

  var updates = { updated_at: accountRepo.now() };
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.syncDirection) updates.sync_direction = body.syncDirection;
  if (body.ingestMode) updates.ingest_mode = body.ingestMode;

  await accountRepo.updateUserCalendarById(calendarId, updates);

  var updated = await accountRepo.findUserCalendarById(calendarId);
  return { status: 200, body: { calendar: updated } };
}

async function gcalRefreshCalendars(userId, user) {
  if (!user.gcal_refresh_token) {
    return { status: 400, body: { error: 'Google Calendar not connected. Please connect first.' } };
  }

  var token;
  try {
    token = await getAdapter('gcal').getValidAccessToken(user);
  } catch (e) {
    return { status: 401, body: { error: 'Failed to connect. Your Google Calendar authorization may have expired.', detail: e.message } };
  }

  // GoogleCalendarAdapter.discoverCalendars is best-effort by design (same
  // path the automatic pull-sync uses) — it never throws, logging+returning
  // on failure so a calendarList hiccup degrades to "whatever is already
  // enabled" rather than blocking the request.
  await GoogleCalendarAdapter.discoverCalendars(token, userId);

  var allCalendars = await accountRepo.findUserCalendars(userId, 'gcal');
  return { status: 200, body: { calendars: allCalendars } };
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
        await accountRepo.updateUser(user.id, { msft_cal_email: msftEmail, updated_at: accountRepo.now() });
      }
    } catch (e) {
      logger.warn('MSFT account email lazy backfill failed (non-fatal):', e.message);
    }
  }

  var autoSyncRow = await accountRepo.getUserConfig(user.id, 'msft_cal_auto_sync');
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

// ── MSFT per-calendar selection (999.1977) ──
// Backend toggle mechanism mirroring gcalGetCalendars/gcalUpdateCalendar/
// gcalRefreshCalendars above (999.1626) — deliberately GET-list + PUT-toggle
// rather than a bespoke UI: no frontend Settings surface was built for this
// leg either (same deferral). These three endpoints ARE the documented API
// contract for a future Settings panel to bind to.

async function msftGetCalendars(userId) {
  var calendars = await accountRepo.findUserCalendars(userId, 'msft');
  return { status: 200, body: { calendars: calendars } };
}

async function msftUpdateCalendar(userId, calendarId, body) {
  var row = await accountRepo.findUserCalendarByIdForUser(calendarId, userId);

  if (!row) {
    return { status: 404, body: { error: 'Calendar not found' } };
  }

  var updates = { updated_at: accountRepo.now() };
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.syncDirection) updates.sync_direction = body.syncDirection;
  if (body.ingestMode) updates.ingest_mode = body.ingestMode;

  await accountRepo.updateUserCalendarById(calendarId, updates);

  var updated = await accountRepo.findUserCalendarById(calendarId);
  return { status: 200, body: { calendar: updated } };
}

async function msftRefreshCalendars(userId, user) {
  if (!user.msft_cal_refresh_token) {
    return { status: 400, body: { error: 'Microsoft Calendar not connected. Please connect first.' } };
  }

  var token;
  try {
    token = await getAdapter('msft').getValidAccessToken(user);
  } catch (e) {
    return { status: 401, body: { error: 'Failed to connect. Your Microsoft Calendar authorization may have expired.', detail: e.message } };
  }

  // MicrosoftCalendarAdapter.discoverCalendars is best-effort by design (same
  // path the automatic pull-sync uses) — it never throws, logging+returning
  // on failure so a calendar-list hiccup degrades to "whatever is already
  // enabled" rather than blocking the request.
  await MicrosoftCalendarAdapter.discoverCalendars(token, userId);

  var allCalendars = await accountRepo.findUserCalendars(userId, 'msft');
  return { status: 200, body: { calendars: allCalendars } };
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

  await accountRepo.deleteExpiredOAuthNonces().catch(function() {});

  var result = await accountRepo.insertOAuthNonceIgnoreDuplicate(hash);
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

  // 999.1576 inc.4 (harrison BLOCK-2): unauthenticated browser-redirect route —
  // the state-token's VERIFIED userId establishes the actor for the writes
  // below (oauth_code_nonces claim, users token update). See gcalCallback.
  return runWithActor(String(userId), async function () {
    if (!(await msftMarkCodeUsed(code))) {
      logger.info('[MSFT CALLBACK] Duplicate code detected, redirecting without re-exchange');
      var frontUrl = require('../../proxy-config').services.juggler.frontend;
      return { status: 302, redirect: frontUrl + '/?msftcal=connected' };
    }

    var tokens = await msftCalApi.getTokensFromCode(code, codeVerifier);

    var update = {
      msft_cal_access_token: tokens.accessToken,
      updated_at: accountRepo.now()
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

    await accountRepo.updateUser(userId, update);

    var frontendUrl = require('../../proxy-config').services.juggler.frontend;
    return { status: 302, redirect: frontendUrl + '/?msftcal=connected' };
  });
}

async function msftDisconnect(userId) {
  await accountRepo.updateUser(userId, {
    msft_cal_access_token: null,
    msft_cal_refresh_token: null,
    msft_cal_token_expiry: null,
    updated_at: accountRepo.now()
  });
  return { disconnected: true };
}

async function setMsftAutoSync(userId, enabled) {
  var value = !!enabled;
  var existing = await accountRepo.getUserConfig(userId, 'msft_cal_auto_sync');

  if (existing) {
    await accountRepo.updateUserConfig(userId, 'msft_cal_auto_sync',
      { config_value: JSON.stringify(value), updated_at: accountRepo.now() });
  } else {
    await accountRepo.insertUserConfig({
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
    allCalendars = await accountRepo.findUserCalendars(user.id, 'apple');
  } catch (_e) {
    // Table may not exist if migration hasn't run yet
  }

  var connected = hasCredentials && (allCalendars.length > 0 || !!user.apple_cal_calendar_url);
  var lastSyncedAt = user.apple_cal_last_synced_at || null;

  var autoSyncRow = await accountRepo.getUserConfig(user.id, 'apple_cal_auto_sync');
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

  await accountRepo.updateUser(userId, {
    apple_cal_server_url: url,
    apple_cal_username: username,
    apple_cal_password: encrypt(password),
    updated_at: accountRepo.now()
  });

  var existingSelections = [];
  try {
    existingSelections = await accountRepo.findUserCalendars(userId, 'apple');
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

  var user = await accountRepo.getUser(userId);
  if (!user || !user.apple_cal_username || !user.apple_cal_password) {
    return { status: 400, body: { error: 'Not connected to Apple Calendar. Connect first.' } };
  }

  await accountRepo.updateUser(userId, {
    apple_cal_calendar_url: calendarUrl,
    updated_at: accountRepo.now()
  });

  var existing = await accountRepo.findUserCalendarByCalendarId(userId, 'apple', calendarUrl);

  if (existing) {
    await accountRepo.updateUserCalendarById(existing.id, { enabled: true, updated_at: accountRepo.now() });
  } else {
    await accountRepo.insertUserCalendar({
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

  var user = await accountRepo.getUser(userId);
  if (!user || !user.apple_cal_username || !user.apple_cal_password) {
    return { status: 400, body: { error: 'Not connected to Apple Calendar. Connect first.' } };
  }

  for (var i = 0; i < calendars.length; i++) {
    var cal = calendars[i];
    var existing = await accountRepo.findUserCalendarByCalendarId(userId, 'apple', cal.url);

    if (existing) {
      await accountRepo.updateUserCalendarById(existing.id, {
        display_name: cal.displayName || existing.display_name,
        enabled: cal.enabled !== undefined ? cal.enabled : existing.enabled,
        sync_direction: cal.syncDirection || existing.sync_direction,
        ingest_mode: cal.ingestMode || existing.ingest_mode,
        updated_at: accountRepo.now()
      });
    } else {
      await accountRepo.insertUserCalendar({
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

  var firstEnabled = await accountRepo.findFirstEnabledUserCalendar(userId, 'apple');

  await accountRepo.updateUser(userId, {
    apple_cal_calendar_url: firstEnabled ? firstEnabled.calendar_id : null,
    updated_at: accountRepo.now()
  });

  var savedCalendars = await accountRepo.findUserCalendars(userId, 'apple');

  return { status: 200, body: { calendars: savedCalendars } };
}

async function appleGetCalendars(userId) {
  var calendars = await accountRepo.findUserCalendars(userId, 'apple');
  return { status: 200, body: { calendars: calendars } };
}

async function appleUpdateCalendar(userId, calendarId, body) {
  var row = await accountRepo.findUserCalendarByIdForUser(calendarId, userId);

  if (!row) {
    return { status: 404, body: { error: 'Calendar not found' } };
  }

  var updates = { updated_at: accountRepo.now() };
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.syncDirection) updates.sync_direction = body.syncDirection;
  if (body.ingestMode) updates.ingest_mode = body.ingestMode;

  await accountRepo.updateUserCalendarById(calendarId, updates);

  var firstEnabled = await accountRepo.findFirstEnabledUserCalendar(userId, 'apple');

  await accountRepo.updateUser(userId, {
    apple_cal_calendar_url: firstEnabled ? firstEnabled.calendar_id : null,
    updated_at: accountRepo.now()
  });

  var updated = await accountRepo.findUserCalendarById(calendarId);
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

  var existingRows = await accountRepo.findUserCalendars(userId, 'apple');
  var existingByUrl = {};
  existingRows.forEach(function(r) { existingByUrl[r.calendar_id] = r; });

  var remoteUrls = new Set();
  for (var i = 0; i < remoteCalendars.length; i++) {
    var rc = remoteCalendars[i];
    remoteUrls.add(rc.url);

    if (existingByUrl[rc.url]) {
      if (existingByUrl[rc.url].display_name !== rc.displayName) {
        await accountRepo.updateUserCalendarById(existingByUrl[rc.url].id,
          { display_name: rc.displayName, updated_at: accountRepo.now() });
      }
    } else {
      await accountRepo.insertUserCalendar({
        user_id: userId,
        provider: 'apple',
        calendar_id: rc.url,
        display_name: rc.displayName,
        enabled: false,
        sync_direction: 'full',
        created_at: accountRepo.now(),
        updated_at: accountRepo.now()
      });
    }
  }

  var allCalendars = await accountRepo.findUserCalendars(userId, 'apple');

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
  await accountRepo.deleteUserCalendars(userId, 'apple');

  await accountRepo.updateUser(userId, {
    apple_cal_server_url: null,
    apple_cal_username: null,
    apple_cal_password: null,
    apple_cal_calendar_url: null,
    apple_cal_sync_token: null,
    apple_cal_last_synced_at: null,
    updated_at: accountRepo.now()
  });

  await accountRepo.deleteUserConfig(userId, 'apple_cal_auto_sync').catch(function() {});

  return { disconnected: true };
}

async function setAppleAutoSync(userId, enabled) {
  var value = !!enabled;
  var existing = await accountRepo.getUserConfig(userId, 'apple_cal_auto_sync');

  if (existing) {
    await accountRepo.updateUserConfig(userId, 'apple_cal_auto_sync',
      { config_value: JSON.stringify(value) });
  } else {
    await accountRepo.insertUserConfig({
      user_id: userId,
      config_key: 'apple_cal_auto_sync',
      config_value: JSON.stringify(value)
    });
  }

  return { autoSync: value };
}

// ── 999.942 W1/W2: cal-sync controller read-path facade methods ──
// hasChanges/getSyncHistory (cal-sync.controller.js) previously ran these
// queries via a raw inline `getDb()('tasks_v'|'sync_history')` call, then
// (999.942) via a `srcDb` (`../../db`) require in this facade. JUG-FACADE-DB-
// VIOLATIONS stage 3 moves BOTH query bodies verbatim onto syncStateRepo
// (adapters/KnexSyncStateRepository.js — it already carries an injected db
// handle over the SAME lib/db singleton `srcDb` re-exported byte-identically).
// No orchestration logic, no shape change (REFACTOR mode — no behavior
// change); W1/W2 characterization suites stay green unchanged.
//
// NOTE: `srcDb` (`require('../../db')`) is STILL required below — it backs
// auditCalendarSync/gatherProviderSyncData, which are sync()/audit()
// orchestration logic explicitly OUT OF SCOPE for this stage (a different
// ticket, JUG-H7-SYNC-EXTRACT/999.1515 — see the flagged conflict in this
// stage's report). Do not remove this require.
var srcDb = require('../../db');

/**
 * Count tasks_v rows for a user updated after a given timestamp (used by
 * hasChanges' local-change detection). Exact query previously inlined in
 * cal-sync.controller.js:hasChanges, now on syncStateRepo (stage 3).
 */
async function countLocalChangesSince(userId, sinceTimestamp) {
  return getSyncStateRepo().countLocalChangesSince(userId, sinceTimestamp);
}

/**
 * Read the recent sync_history runs (grouped run IDs + detail rows) for a
 * user. Exact two-query sequence previously inlined in
 * cal-sync.controller.js:getSyncHistory — grouping/shaping stays in the
 * controller, the raw reads live on syncStateRepo (stage 3).
 */
async function getSyncHistory(userId, opts) {
  return getSyncStateRepo().getSyncHistory(userId, opts);
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
  // 999.1192: cross-slice read via the task slice's own facade (which binds this
  // over its repo), not the HTTP controller's re-export of the same function.
  // Function-local require kept: this facade is loaded by cal-sync.controller at
  // boot and the task facade is heavy — same laziness as before, new target.
  var { fetchTasksWithEventIds } = require('../task/facade');
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

// ── 999.1025 sub-leg 2: cal-sync controller "Phase 1" gather facade method ──
// sync() (cal-sync.controller.js) previously ran connected-adapter discovery,
// token pre-validation, per-provider event fetch, ledger + task-snapshot
// loads, the contiguous-split-chunk merge, and the Apple calendar-label
// lookup INLINE, under the `// === Phase 1: Gather data from all connected
// providers ===` marker. This re-exposes the SAME exact logic behind the
// facade boundary — no behavior change (REFACTOR mode). The controller's
// sync() becomes a thin caller: it still owns the HTTP response and the
// early-return decision (this function signals `earlyReturn: true`, with
// `emitProgress` already fired at the same point the original inline code
// fired it, and the caller does `return res.json(stats)`).
//
// Read-only aside from the SAME incidental token-invalidation writes to
// `users` the original inline code performed when a provider token was
// detected expired/revoked during pre-validation or fetch (existing
// behavior, unchanged — not a new write introduced by this extraction).

// Copied verbatim from cal-sync.controller.js's RE_AUTH_ERR — same
// expired/revoked-token detection pattern. Used only by
// gatherProviderSyncData below; the controller keeps its own copy for the
// sync phases it still owns directly (hasChanges/audit token handling).
var RE_AUTH_ERR = /invalid_grant|unauthorized|forbidden|authorization|access.?denied|token.*expired|expired.*token/i;

/**
 * Gather Phase 1 sync data for cal-sync.controller.js:sync() — connected
 * adapters, per-provider fetched events, the unified ledger + task snapshot,
 * the contiguous-split-chunk merge, and Apple calendar labels/ingest modes.
 *
 * @param {Object} user - req.user (adapters' isConnected/getValidAccessToken use this)
 * @param {string} userId - req.user.id
 * @param {Date} windowStart - sync window start (UTC)
 * @param {Date} windowEnd - sync window end (UTC)
 * @param {string} tz - user's IANA timezone
 * @param {Object} stats - the sync() stats accumulator (mutated in place, same object the caller reads after return — matches the original inline code's mutation-in-place shape)
 * @param {Function} emitProgress - the controller's SSE progress emitter, (phase, detail, pct, extra) => void
 * @returns {Promise<Object>} `{ earlyReturn: true }` (caller must `return res.json(stats)`) or
 *   `{ earlyReturn: false, providerData, ledgerRecords, allTasks, tasksById, mergedFollowers, tasksByMasterDate, calIngestModeMap, calendarLabels }`
 */
async function gatherProviderSyncData(user, userId, windowStart, windowEnd, tz, stats, emitProgress) {
  var connectedAdapters = getConnectedAdapters(user);
  if (connectedAdapters.length === 0) {
    return { earlyReturn: true };
  }

  // Pre-validate tokens before fetching events. Adapters with invalid tokens
  // are excluded so the ledger phase won't misinterpret missing events as deletions.
  var validAdapters = [];
  for (var vai = 0; vai < connectedAdapters.length; vai++) {
    var va = connectedAdapters[vai];
    try {
      await va.getValidAccessToken(user);
      validAdapters.push(va);
    } catch (err) {
      var vaErrMsg = err.message || '';
      var vaIsTokenExpired = RE_AUTH_ERR.test(vaErrMsg);
      if (vaIsTokenExpired) {
        var vaEventIdCol = va.getEventIdColumn();
        var vaTokenCols = vaEventIdCol === 'gcal_event_id'
          ? { gcal_access_token: null, gcal_refresh_token: null, gcal_token_expiry: null }
          : vaEventIdCol === 'apple_event_id'
            ? { apple_cal_password: null }
            : { msft_cal_access_token: null, msft_cal_refresh_token: null, msft_cal_token_expiry: null };
        await srcDb('users').where('id', userId).update(stampUpdate({ ...vaTokenCols, updated_at: srcDb.fn.now() }));
      }
      stats.errors.push({
        phase: 'token_validation',
        provider: va.providerId,
        error: vaErrMsg,
        tokenExpired: vaIsTokenExpired,
        action: vaIsTokenExpired ? 'Please reconnect your calendar in Settings' : undefined
      });
      stats.providers[va.providerId] = { error: vaErrMsg, tokenExpired: vaIsTokenExpired };
      logger.warn('[CAL-SYNC] Token validation failed for ' + va.providerId + ': ' + vaErrMsg);
    }
  }
  if (validAdapters.length === 0) {
    emitProgress('done', 'No valid calendar connections', 100);
    return { earlyReturn: true };
  }

  // Get tokens and fetch events for all validated providers IN PARALLEL
  var providerData = {}; // { providerId: { token, events, eventsById } }
  var timeMin = windowStart.toISOString();
  var timeMax = windowEnd.toISOString();

  await Promise.all(validAdapters.map(async function(adapter) {
    try {
      emitProgress('fetch', 'Fetching events...', 5, { provider: adapter.providerId });
      var token = await adapter.getValidAccessToken(user);
      var events = await adapter.listEvents(token, timeMin, timeMax, userId);
      emitProgress('fetch', 'Fetched ' + events.length + ' events', 15, { provider: adapter.providerId });

      var eventsById = {};
      for (var ei = 0; ei < events.length; ei++) {
        // 999.1626 harrison WARN: a provider event id is unique PER CALENDAR,
        // NOT globally — the same invited meeting can appear with the SAME
        // id on multiple calendars the user has enabled (shared calendars /
        // meeting invite copies). FIRST write wins so the surviving event
        // (and therefore its _calendarId -> ingest_mode resolution at
        // cal-sync.controller.js) is deterministic run-to-run, not
        // "whichever calendar happened to iterate last" — adapters now
        // return calendars in a stable order (e.g.
        // GoogleCalendarAdapter.getEnabledCalendars ORDER BY calendar_id).
        if (!eventsById[events[ei].id]) {
          eventsById[events[ei].id] = events[ei];
        }
        // Apple events: provider_event_id stores the CalDAV URL, not the UID —
        // index by _url too so ledger lookups work regardless of which key was stored.
        if (events[ei]._url && !eventsById[events[ei]._url]) {
          eventsById[events[ei]._url] = events[ei];
        }
      }

      providerData[adapter.providerId] = { token: token, events: events, eventsById: eventsById, adapter: adapter, partialFailure: !!events._hasPartialFailure };
      stats.providers[adapter.providerId] = { pushed: 0, pulled: 0, skipped: 0, deleted_local: 0, deleted_remote: 0, errors: [] };
    } catch (err) {
      logger.error('[CAL-SYNC] Event fetch failed for ' + adapter.providerId + ':', err);
      var errMsg = err.message || '';
      var isTokenExpired = RE_AUTH_ERR.test(errMsg);

      if (isTokenExpired) {
        var eventIdCol = adapter.getEventIdColumn();
        var tokenCols = eventIdCol === 'gcal_event_id'
          ? { gcal_access_token: null, gcal_refresh_token: null, gcal_token_expiry: null }
          : eventIdCol === 'apple_event_id'
            ? { apple_cal_password: null }
            : { msft_cal_access_token: null, msft_cal_refresh_token: null, msft_cal_token_expiry: null };
        await srcDb('users').where('id', userId).update(stampUpdate({ ...tokenCols, updated_at: srcDb.fn.now() }));
      }

      stats.errors.push({
        phase: 'fetch',
        provider: adapter.providerId,
        error: errMsg,
        tokenExpired: isTokenExpired,
        action: isTokenExpired ? 'Please reconnect your calendar in Settings' : undefined
      });
      stats.providers[adapter.providerId] = {
        error: errMsg,
        tokenExpired: isTokenExpired
      };
    }
  }));

  // Load unified ledger and all tasks once
  // Load active rows AND deleted_local rows that still hold a provider_event_id.
  // The deleted_local+provider_event_id case arises when deleteTask marks the ledger
  // before the next sync runs — the provider event is still live. Phase 2's
  // !task && event branch handles the actual provider DELETE and clears provider_event_id.
  var ledgerRecords = await srcDb('cal_sync_ledger')
    .where('user_id', userId)
    .where(function() {
      this.where('status', 'active')
        .orWhere(function() {
          this.where('status', 'deleted_local').whereNotNull('provider_event_id');
        });
    })
    .select();

  // 999.1192: cross-slice read via the task slice's own facade (which binds
  // this over its repo), matching auditCalendarSync's pattern above.
  var { fetchTasksWithEventIds, rowToTask } = require('../task/facade');
  // 999.488/489: signature is (userId, queryBuilder) — the legacy
  // (db, userId, queryBuilder) shape put getDb() in the userId slot →
  // ER_NO_TABLES_USED ((select *) subquery on cal_sync_ledger/tasks_v).
  var allTaskRows = await fetchTasksWithEventIds(userId, function(q) {
    q.whereNotNull('scheduled_at')
      .where(function() { this.whereNull('unscheduled').orWhere('unscheduled', 0); });
  });

  var allTasks = allTaskRows.map(function(r) {
    var t = rowToTask(r, tz);
    t._recurring = r.recurring;
    t._generated = r.generated;
    t._scheduled_at = r.scheduled_at;
    t._updated_at = r.updated_at;
    t._marker = r.marker;
    t.marker = !!r.marker;
    t.user_id = r.user_id; // needed by Apple adapter's createEvent
    // rowToTask only derives local date/time for user-anchored tasks
    // (recurring / generated / marker / placement_mode = 'fixed')
    // so the scheduler doesn't re-bias off stale auto-placements. Sync is
    // a different consumer: it needs the local date/time for buildEventBody
    // and for the push-filter (!time && when !== 'allday' → skip). Without
    // this, flexible tasks (e.g. one-off with when='morning,afternoon,…')
    // get skipped from every sync and never land on the calendar. Localize
    // from scheduled_at here for display purposes only — this does not
    // write back to the DB and does not affect the next scheduler run.
    if (r.scheduled_at && (!t.date || !t.time)) {
      var local = dateHelpers.utcToLocal(r.scheduled_at, tz);
      if (local) {
        if (!t.date) t.date = local.date;
        if (!t.time) t.time = local.time;
        if (!t.day) t.day = local.day;
      }
    }
    return t;
  });

  var tasksById = {};
  for (var ti = 0; ti < allTasks.length; ti++) {
    tasksById[allTasks[ti].id] = allTasks[ti];
  }

  // Contiguous-split merge (#33 finding #7). Each split chunk of an
  // occurrence lives as its own task_instances row — so a 3-hour task
  // cut into 6×30-min contiguous blocks persists as 6 separate tasks
  // and, without this pass, syncs as 6 separate GCal events. Users
  // see a stack of "Task (chunk-like titles)" instead of one span.
  //
  // Group sibling chunks by (master_id, occurrence_ordinal), sort by
  // split_ordinal, find contiguous runs (where chunk N's end equals
  // chunk N+1's start). For each run longer than 1:
  //   - LEADER = first chunk. Mutate its in-memory dur to the run's
  //     total, append "(parts X-Y/N)" to the title when the run doesn't
  //     cover all of the original chunks, and let it push as normal.
  //   - FOLLOWERS = chunks 2..N in the run. Marked in `mergedFollowers`
  //     to suppress from the push loop below, and any existing ledger
  //     row for them gets queued for delete (their old one-per-chunk
  //     GCal event disappears and the leader's single merged event
  //     takes over).
  // The hash-skip in the ledger loop handles steady-state updates —
  // hash now sees merged dur + new title, so the first post-deploy
  // sync will re-push each merged leader with the new shape; after
  // that hash matches and the sync is a no-op for that task.
  var mergedFollowers = {}; // taskId -> leaderId (suppress in push loop)
  var mergedLeaderInfo = {}; // leaderId -> { leaderDur, titleSuffix }
  (function mergeContiguousSplitChunks() {
    var byOccurrence = {};
    allTaskRows.forEach(function(r) {
      var tot = Number(r.split_total) || 1;
      if (tot <= 1) return;
      if (!r.master_id || r.occurrence_ordinal == null) return;
      var key = r.master_id + '|' + r.occurrence_ordinal;
      if (!byOccurrence[key]) byOccurrence[key] = [];
      byOccurrence[key].push(r);
    });
    Object.keys(byOccurrence).forEach(function(k) {
      var chunks = byOccurrence[k].slice().sort(function(a, b) {
        return (Number(a.split_ordinal) || 1) - (Number(b.split_ordinal) || 1);
      });
      // Build contiguous runs. "Contiguous" = chunk N's end (UTC ms) equals
      // chunk N+1's start (UTC ms) within a 30-second tolerance (scheduler
      // rounds to 15-minute slots so drift is never real).
      var runs = [];
      var current = null;
      chunks.forEach(function(c) {
        if (!c.scheduled_at) return;
        var startMs = new Date(String(c.scheduled_at).replace(' ', 'T') + 'Z').getTime();
        var endMs = startMs + ((Number(c.dur) || 30) * 60000);
        if (current && Math.abs(current.endMs - startMs) < 30000) {
          current.chunks.push(c);
          current.endMs = endMs;
        } else {
          current = { chunks: [c], startMs: startMs, endMs: endMs };
          runs.push(current);
        }
      });
      runs.forEach(function(run) {
        if (run.chunks.length < 2) {
          // Non-contiguous singleton chunk: still part of a split task.
          // Add a "(X/N)" suffix so the user can see which part it is.
          var c = run.chunks[0];
          var tot = Number(c.split_total) || 1;
          if (tot > 1) {
            var so = Number(c.split_ordinal) || 1;
            mergedLeaderInfo[c.id] = {
              leaderDur: c.dur != null ? Number(c.dur) : null,
              titleSuffix: ' (' + so + '/' + tot + ')'
            };
          }
          return;
        }
        var leader = run.chunks[0];
        var total = chunks.length;
        var coversAll = run.chunks.length === total;
        var firstPart = Number(leader.split_ordinal) || 1;
        var lastPart = Number(run.chunks[run.chunks.length - 1].split_ordinal) || run.chunks.length;
        mergedLeaderInfo[leader.id] = {
          leaderDur: Math.round((run.endMs - run.startMs) / 60000),
          titleSuffix: coversAll ? '' : ' (parts ' + firstPart + '-' + lastPart + '/' + total + ')'
        };
        for (var ci = 1; ci < run.chunks.length; ci++) {
          mergedFollowers[run.chunks[ci].id] = leader.id;
        }
      });
    });
    // Apply mutations to the in-memory task objects. Leaders get merged
    // dur + optional title suffix; followers are left untouched here
    // and filtered later in the push loop + ledger-follower deletes.
    for (var mi = 0; mi < allTasks.length; mi++) {
      var info = mergedLeaderInfo[allTasks[mi].id];
      if (!info) continue;
      if (info.leaderDur != null) allTasks[mi].dur = info.leaderDur;
      if (info.titleSuffix) allTasks[mi].text = (allTasks[mi].text || '') + info.titleSuffix;
    }
  })();

  // Secondary index: (masterId|date) → instance task. Used to self-heal
  // ledger rows whose `task_id` points to an occurrence_ordinal that the
  // scheduler's reconcile has since renumbered. Without this, every renamed
  // instance triggers a delete-and-recreate cycle on GCal (see issue #33 —
  // Apr 24 reconnect surfaced 222 orphan events from exactly this drift).
  var tasksByMasterDate = {};
  for (var tj = 0; tj < allTasks.length; tj++) {
    var t2 = allTasks[tj];
    if (t2.sourceId && t2.date) tasksByMasterDate[t2.sourceId + '|' + t2.date] = t2;
  }

  // Resolve text for recurring/generated instances that inherit from templates.
  // Instances often have empty text — the frontend resolves it at render time
  // from the source template, but sync needs it for the calendar event title.
  // Templates have scheduled_at=NULL so they're not in allTasks — load them.
  var sourceIds = [];
  allTasks.forEach(function(t) {
    if (!t.text && t.sourceId && !tasksById[t.sourceId]) sourceIds.push(t.sourceId);
  });
  var templateTextById = {};
  if (sourceIds.length > 0) {
    var templateRows = await srcDb('tasks_v').whereIn('id', sourceIds).select('id', 'text');
    templateRows.forEach(function(r) { templateTextById[r.id] = r.text; });
  }
  allTasks.forEach(function(t) {
    if (t.text) return;
    var src = t.sourceId;
    if (src) {
      t.text = (tasksById[src] && tasksById[src].text) || templateTextById[src] || '';
    }
  });

  // 999.1217 (W4): split task placements now come straight from allTasks —
  // each split chunk persists as its OWN task_instances row (999.841 binding
  // ruling: chunk rows are never merged/deleted), so it already carries its
  // own scheduled_at/dur/splitOrdinal/splitTotal/splitGroup (see taskMappers.js
  // + tasks_with_sync_v). One calendar event per chunk falls out of the
  // normal per-task push loop below; mergeContiguousSplitChunks() (above)
  // already folds CONTIGUOUS chunks into one event by reading these same DB
  // rows directly. No cache-derived per-part expansion is needed.
  //
  // Duration correction: DELTA-WRITE (runSchedule.js) deliberately does NOT
  // overwrite instance.dur when a task's time_remaining drives the effective
  // placement duration — dur stays the user-set full/nominal chunk size,
  // time_remaining is the separate "how much is left" value (see
  // runSchedule.js's "Don't overwrite instance.dur when time_remaining..."
  // comment). Recompute the SAME effective duration the scheduler used
  // (ConstraintSolver.effectiveDuration — a pure function of dur/timeRemaining,
  // both already loaded on every task) so the pushed calendar event reflects
  // the actually-placed block, not the full nominal duration. Skip merged
  // leaders — mergeContiguousSplitChunks() already set their correct summed
  // dur from the DB rows; this must not override that total.
  //
  // Cross-slice read of ConstraintSolver via the scheduler slice's own facade
  // (JUG-HEX-H6/999.435 boundary rule — never reach into slices/scheduler/domain/
  // directly), matching the controller's prior import of the same symbol.
  var { ConstraintSolver } = require('../scheduler/facade');
  allTasks.forEach(function(t) {
    if (mergedLeaderInfo[t.id]) return;
    if (t.timeRemaining == null) return; // dur is already correct — nothing to recompute
    t.dur = ConstraintSolver.effectiveDuration(t);
  });

  // Load Apple write-calendar display name for progress reporting (best-effort)
  // Also build calIngestModeMap: { calendarUrl: 'task'|'reminder' } for pull-new branching.
  var appleCalendarLabel = null;
  var calIngestModeMap = {}; // calendarUrl → ingest_mode
  if (providerData.apple) {
    try {
      var appleCals = await srcDb('user_calendars')
        .where({ user_id: userId, provider: 'apple', enabled: true });
      var appleWriteCal = appleCals
        .slice()
        .sort(function(a, _b) { return a.sync_direction === 'full' ? -1 : 1; })[0] || null;
      appleCalendarLabel = appleWriteCal ? (appleWriteCal.display_name || null) : null;
      appleCals.forEach(function(c) {
        calIngestModeMap[c.calendar_id] = c.ingest_mode || 'task';
      });
    } catch (_e) { /* ignore — label is display-only */ }
  }
  // 999.1626: GCal now pulls from every enabled calendar (not just primary),
  // each pulled event tagged newEvent._calendarId — extend the SAME shared
  // map so a GCal calendar's ingest_mode is honored at pull-new branching,
  // mirroring the Apple block above exactly.
  if (providerData.gcal) {
    try {
      var gcalCals = await srcDb('user_calendars')
        .where({ user_id: userId, provider: 'gcal', enabled: true });
      gcalCals.forEach(function(c) {
        calIngestModeMap[c.calendar_id] = c.ingest_mode || 'task';
      });
    } catch (_e) { /* ignore — falls back to 'task' default at read site */ }
  }
  // 999.1977: MSFT now pulls from every enabled calendar too (same fix as
  // 999.1626 for GCal), each pulled event tagged newEvent._calendarId —
  // extend the SAME shared map so an MSFT calendar's ingest_mode is honored
  // at pull-new branching, mirroring the GCal block immediately above.
  if (providerData.msft) {
    try {
      var msftCals = await srcDb('user_calendars')
        .where({ user_id: userId, provider: 'msft', enabled: true });
      msftCals.forEach(function(c) {
        calIngestModeMap[c.calendar_id] = c.ingest_mode || 'task';
      });
    } catch (_e) { /* ignore — falls back to 'task' default at read site */ }
  }
  var calendarLabels = { apple: appleCalendarLabel };

  return {
    earlyReturn: false,
    providerData: providerData,
    ledgerRecords: ledgerRecords,
    allTasks: allTasks,
    tasksById: tasksById,
    mergedFollowers: mergedFollowers,
    tasksByMasterDate: tasksByMasterDate,
    calIngestModeMap: calIngestModeMap,
    calendarLabels: calendarLabels
  };
}

// ── 999.1025 sub-leg 3: cal-sync controller "Write Phase" facade method ──
// sync() (cal-sync.controller.js) previously ran the write-phase lock
// acquire/retry loop, the post-lock ledger re-read (Fix Bug #5), flushing
// pending user/MCP queue writes, conflict detection against fresh DB state,
// the 7-step buffered-mutation transaction, and lock release INLINE, under
// the `// === Write Phase: Acquire lock, flush pending writes, then apply
// ===` marker. This re-exposes the SAME exact logic behind the facade
// boundary — no behavior change (REFACTOR mode). The controller's sync()
// becomes a thin caller: it still owns the HTTP response and the
// early-return decision (this function signals which case fired via
// `earlyReturn`, matching gatherProviderSyncData's contract shape but with
// three distinct reasons since the original inline code had three different
// early-return status codes/bodies).

/**
 * Run sync()'s Write Phase for cal-sync.controller.js — acquire the per-user
 * write lock (retry/backoff), re-read the ledger post-lock to catch
 * concurrent syncs, flush pending user/MCP writes, run conflict detection
 * against fresh DB state, apply every buffered mutation from Phases 1-3 in
 * one transaction (task inserts/updates/deletes, ledger updates/inserts,
 * sync_history inserts, stale-row pruning, per-provider last-synced
 * timestamps), then release the lock.
 *
 * @param {string} userId - req.user.id
 * @param {Object} buffers - the mutation buffers + lookups Phases 1-3 built
 *   (mutated in place — same objects the caller reads after return):
 *   taskInserts, taskUpdates, taskDeletes, ledgerUpdates, ledgerInserts,
 *   historyInserts, ledgerRecords, tasksById, providerIds, providerData
 * @param {number} syncStart - Date.now() at the top of sync(), backing the
 *   5-minute abort-before-write-phase check
 * @param {Function} emitProgress - the controller's SSE progress emitter,
 *   (phase, detail, pct, extra) => void
 * @returns {Promise<Object>} one of:
 *   `{ earlyReturn: 'timeout' }` — caller must
 *     `return res.status(200).json(Object.assign({}, stats, { error: 'sync_timeout' }))`
 *   `{ earlyReturn: 'lock_busy' }` — caller must
 *     `return res.status(409).json({ error: 'Scheduler is busy. Try again in a few seconds.', retryAfter: 30 })`
 *   `{ earlyReturn: 'lock_lost' }` — caller must
 *     `return res.status(503).json({ error: 'Sync lock lost. Please retry.', retryAfter: 5 })`
 *   `{ earlyReturn: false, preSyncMaxUpdatedAt }` — success, caller continues to Phase 5
 */
async function runSyncWritePhase(userId, buffers, syncStart, emitProgress) {
  var taskInserts = buffers.taskInserts;
  var taskUpdates = buffers.taskUpdates;
  var taskDeletes = buffers.taskDeletes;
  var ledgerUpdates = buffers.ledgerUpdates;
  var ledgerInserts = buffers.ledgerInserts;
  var historyInserts = buffers.historyInserts;
  var ledgerRecords = buffers.ledgerRecords;
  var tasksById = buffers.tasksById;
  var providerIds = buffers.providerIds;
  var providerData = buffers.providerData;

  emitProgress('finalize', 'Saving changes...', 85);

  // 999.1457: the lock may have been acquired earlier in the controller
  // (before the push phase) to prevent orphan remote events on lock contention.
  // If so, the token arrives via buffers.existingLockToken and we skip the
  // acquisition loop below. The controller owns the lock until this function
  // returns; the finally block below releases it in all cases.
  var lockToken = buffers.existingLockToken || null;
  var lockStart = buffers.existingLockStart || Date.now();

  if (Date.now() - syncStart > 300000) {
    logger.warn('[CAL-SYNC] Sync exceeded 5-minute timeout — aborting before write phase');
    emitProgress('done', 'Sync timed out — please try again', 100);
    if (buffers.prePushHeartbeat) clearInterval(buffers.prePushHeartbeat);
    if (lockToken) {
      try { await syncLock.releaseLock(userId, lockToken); } catch (_e) { /* best-effort */ }
    }
    return { earlyReturn: 'timeout' };
  }

  if (lockToken) {
    // Lock already acquired by the controller — do the post-lock ledger re-read
    // (same Bug #5 fix as below, just without the acquisition loop).
    var postLockLedger = await srcDb('cal_sync_ledger')
      .where('user_id', userId)
      .where(function() {
        this.where('status', 'active')
          .orWhere(function() {
            this.where('status', 'deleted_local').whereNotNull('provider_event_id');
          });
      })
      .select();

    var seenById = {};
    for (var pli = 0; pli < ledgerRecords.length; pli++) {
      seenById[ledgerRecords[pli].id] = ledgerRecords[pli];
    }
    for (var pli2 = 0; pli2 < postLockLedger.length; pli2++) {
      var newRow = postLockLedger[pli2];
      var existing = seenById[newRow.id];
      if (!existing) {
        ledgerRecords.push(newRow);
        seenById[newRow.id] = newRow;
      }
    }
  } else {
    // No pre-acquired lock — acquire here (legacy path for callers that don't
    // pre-acquire, e.g. if the controller's pre-push lock was removed).
    var MAX_LOCK_ATTEMPTS = 8;
    var lockResult = null;
    for (var lockAttempt = 0; lockAttempt < MAX_LOCK_ATTEMPTS; lockAttempt++) {
      lockResult = await syncLock.acquireLock(userId);
      if (lockResult.acquired) {
        // === Fix Bug #5: Re-read ledger after lock to detect concurrent sync changes ===
        // Another sync may have inserted ledger rows between our Phase 1 read and lock.
        var postLockLedger2 = await srcDb('cal_sync_ledger')
          .where('user_id', userId)
          .where(function() {
            this.where('status', 'active')
              .orWhere(function() {
                this.where('status', 'deleted_local').whereNotNull('provider_event_id');
              });
          })
          .select();

        // Dedupe: merge post-read rows, keeping newer (by updated_at or computed_at)
        var seenById2 = {};
        for (var pli3 = 0; pli3 < ledgerRecords.length; pli3++) {
          seenById2[ledgerRecords[pli3].id] = ledgerRecords[pli3];
        }
        for (var pli4 = 0; pli4 < postLockLedger2.length; pli4++) {
          var newRow2 = postLockLedger2[pli4];
          var existing2 = seenById2[newRow2.id];
          if (!existing2) {
            ledgerRecords.push(newRow2);
            seenById2[newRow2.id] = newRow2;
          }
        }

        lockToken = lockResult.token;
        lockStart = Date.now();
        break;
      }
      var backoffMs = Math.min(1000 * Math.pow(1.5, lockAttempt), 10000) + Math.floor(Math.random() * 500);
      await new Promise(function(r) { setTimeout(r, backoffMs); });
    }
    if (!lockToken) {
      logger.error('[CAL-SYNC] could not acquire lock for write phase after ' + MAX_LOCK_ATTEMPTS + ' attempts');
      var sseEmitter = require('../../lib/sse-emitter');
      sseEmitter.emit(userId, 'sync:lock_conflict', { error: 'Scheduler is busy', retryAfter: 30 });
      return { earlyReturn: 'lock_busy' };
    }
  }
  var writePhaseLockLost = false;
  // Clear the controller's pre-push heartbeat (if any) — the write-phase
  // heartbeat below takes over with the same lockStart.
  if (buffers.prePushHeartbeat) clearInterval(buffers.prePushHeartbeat);
  var lockHeartbeat = setInterval(function() {
    if (Date.now() - lockStart > 120000) {
      clearInterval(lockHeartbeat);
      writePhaseLockLost = true;
      logger.warn('[CAL-SYNC] Write-phase heartbeat stopped — held over 120s, allowing expiry');
      return;
    }
    syncLock.refreshLock(userId, lockToken).then(function(ok) {
      if (!ok) {
        writePhaseLockLost = true;
        clearInterval(lockHeartbeat);
        logger.warn('[CAL-SYNC] Write-phase lock lost — refresh returned 0 rows');
      }
    }).catch(function(err) {
      writePhaseLockLost = true;
      clearInterval(lockHeartbeat);
      logger.error('[CAL-SYNC] Write-phase lock refresh failed:', err.message);
    });
  }, 10000);

  try {

  // Flush any pending user/MCP writes so conflict detection sees fresh data
  var { flushQueueInLock } = require('../../lib/task-write-queue');
  await flushQueueInLock(userId);

  // Snapshot watermark BEFORE writing so we can detect what we touched
  var syncStartWatermark = (await srcDb('tasks_v')
    .where('user_id', userId)
    .max('updated_at as max_ts')
    .first()) || { max_ts: null };
  var preSyncMaxUpdatedAt = syncStartWatermark.max_ts;

  // Conflict detection: if a task was modified by user/MCP during the API
  // phase, skip our update for that task to avoid clobbering their edit.
  // Runs inside lock so the data is stable.
  var conflictSkipIds = new Set();
  var taskIdsToCheck = taskUpdates.map(function(u) { return u.id; });
  if (taskIdsToCheck.length > 0) {
    var freshRows = await srcDb('tasks_v')
      .whereIn('id', taskIdsToCheck)
      .select('id', 'updated_at');
    var freshById = {};
    freshRows.forEach(function(r) { freshById[r.id] = r.updated_at; });
    for (var ci = 0; ci < taskUpdates.length; ci++) {
      var tu = taskUpdates[ci];
      var origTask = tasksById[tu.id];
      if (origTask) {
        if (!freshById[tu.id]) {
          // Task was deleted between the API-phase snapshot and the write phase —
          // skip the DB write so we don't update a non-existent row.
          conflictSkipIds.add(tu.id);
        } else {
          var origTime = new Date(String(origTask._updated_at).replace(' ', 'T') + 'Z').getTime();
          var freshTime = new Date(String(freshById[tu.id]).replace(' ', 'T') + 'Z').getTime();
          if (!isNaN(origTime) && !isNaN(freshTime) && freshTime > origTime) {
            conflictSkipIds.add(tu.id);
          }
        }
      }
    }
  }

  // Abort if the lock was lost during conflict detection
  if (writePhaseLockLost) {
    logger.error('[CAL-SYNC] Aborting write phase — lock lost before transaction');
    emitProgress('error', 'Sync aborted — lock lost', 0);
    return { earlyReturn: 'lock_lost' };
  }

  var { KnexTaskRepository } = require('../task/facade');

  await srcDb.transaction(async function(trx) {
    var now = srcDb.fn.now();
    // 999.1199: lib/tasks-write is internal to slices/task/adapters (eslint
    // boundary) now. `taskRepo` is a transaction-token wrapper — a
    // KnexTaskRepository constructed over this SAME trx — whose `.tasksWrite`
    // property is the raw passthrough. Kept as raw passthrough (not the
    // P1-asserting port methods) because `now` here is a Knex `fn.now()` raw
    // (MySQL server clock), not a JS Date — exactly what the W4 golden
    // masters pin bit-for-bit; the strict port would reject it outright.
    var taskRepo = new KnexTaskRepository({ db: trx });

    // 1. Task inserts (new tasks from provider events) — bulk insert
    if (taskInserts.length > 0) {
      for (var wi = 0; wi < taskInserts.length; wi++) {
        taskInserts[wi].created_at = now;
        taskInserts[wi].updated_at = now;
      }
      await taskRepo.tasksWrite.insertTasksBatch(trx, taskInserts);
    }

    // 2. Task updates (event IDs, field changes from provider)
    // Merge multiple updates for the same task into one write
    var mergedTaskUpdates = {};
    for (var wu = 0; wu < taskUpdates.length; wu++) {
      var upd = taskUpdates[wu];
      if (conflictSkipIds.has(upd.id)) continue;
      if (!mergedTaskUpdates[upd.id]) mergedTaskUpdates[upd.id] = {};
      Object.assign(mergedTaskUpdates[upd.id], upd.fields);
    }
    var mergedIds = Object.keys(mergedTaskUpdates);
    for (var wm = 0; wm < mergedIds.length; wm++) {
      var mid = mergedIds[wm];
      mergedTaskUpdates[mid].updated_at = now;
      await taskRepo.tasksWrite.updateTaskById(trx, mid, mergedTaskUpdates[mid], userId);
    }

    // 3. Task deletes (remote-deleted events past miss threshold)
    for (var wd = 0; wd < taskDeletes.length; wd++) {
      var del = taskDeletes[wd];
      // Transfer dependencies first
      for (var wdt = 0; wdt < del.dependencyTransfers.length; wdt++) {
        var dt = del.dependencyTransfers[wdt];
        await taskRepo.tasksWrite.updateTaskById(trx, dt.id, {
          depends_on: dt.newDepsJson, updated_at: now
        }, userId);
      }
      await taskRepo.tasksWrite.deleteTaskById(trx, del.id, userId);
    }

    // 4. Ledger updates — group rows with identical field sets so they execute as
    // batched WHERE IN queries instead of one UPDATE per row.
    var ledgerGroups = {}; // sig -> { fields, ids[] }
    for (var wl = 0; wl < ledgerUpdates.length; wl++) {
      var lu = ledgerUpdates[wl];
      lu.fields.synced_at = now;
      // Stable sig: sort keys, represent Knex Raw objects (srcDb.fn.now()) as sentinel
      var sigParts = Object.keys(lu.fields).sort().map(function(k) {
        var v = lu.fields[k];
        return k + '=' + (v !== null && typeof v === 'object' ? '__raw__' : JSON.stringify(v));
      });
      var sig = sigParts.join('|');
      if (!ledgerGroups[sig]) ledgerGroups[sig] = { fields: lu.fields, ids: [] };
      ledgerGroups[sig].ids.push(lu.id);
    }
    var groupSigs = Object.keys(ledgerGroups);
    for (var wg = 0; wg < groupSigs.length; wg++) {
      var grp = ledgerGroups[groupSigs[wg]];
      await trx('cal_sync_ledger').whereIn('id', grp.ids).update(stampUpdate(grp.fields));
    }

    // 5. Ledger inserts — dedup by (user_id, provider, task_id) then bulk insert.
    // Within-run dedup: last entry wins (handles split-replacement / partial-failure cases).
    // Cross-run dedup: INSERT IGNORE silently drops rows that violate the DB-level
    // unique constraint on active_task_key (concurrent sync runs pushing the same task).
    if (ledgerInserts.length > 0) {
      var seenLedgerKeys = {};
      var dedupedLedgerInserts = [];
      for (var wli = 0; wli < ledgerInserts.length; wli++) {
        ledgerInserts[wli].synced_at = now;
        ledgerInserts[wli].created_at = now;
        if (ledgerInserts[wli].origin === 'juggler' && ledgerInserts[wli].status === 'active') {
          ledgerInserts[wli].last_pushed_at = now;
        }
        var lKey = ledgerInserts[wli].user_id + '|' + ledgerInserts[wli].provider + '|' + ledgerInserts[wli].task_id;
        seenLedgerKeys[lKey] = wli; // last entry wins
      }
      var winnerIdxs = Object.values(seenLedgerKeys);
      for (var wli2 = 0; wli2 < winnerIdxs.length; wli2++) {
        dedupedLedgerInserts.push(ledgerInserts[winnerIdxs[wli2]]);
      }
      await trx('cal_sync_ledger').insert(dedupedLedgerInserts.map(stampInsert)).onConflict().ignore();
    }

    // 6. Sync history inserts — bulk insert
    if (historyInserts.length > 0) {
      for (var wh = 0; wh < historyInserts.length; wh++) {
        historyInserts[wh].created_at = now;
      }
      await trx('sync_history').insert(historyInserts.map(stampInsert));
    }

    // [FIX D-09] Prune fully-resolved orphan ledger rows — no task, no event, no purpose
    await trx('cal_sync_ledger')
      .where({ user_id: userId, status: 'deleted_local' })
      .whereNull('provider_event_id')
      .whereNull('task_id')
      .del();

    // [FIX D-13] Prune sync_history rows older than 3 days
    await trx('sync_history')
      .where('user_id', userId)
      .where('created_at', '<', trx.raw('NOW() - INTERVAL 3 DAY'))
      .del();

    // 7. Update last-synced timestamps for all providers
    var userUpdate = { updated_at: now };
    for (var pi3 = 0; pi3 < providerIds.length; pi3++) {
      var syncedCol = providerData[providerIds[pi3]].adapter.getLastSyncedColumn();
      userUpdate[syncedCol] = now;
    }
    await trx('users').where('id', userId).update(stampUpdate(userUpdate));
  });

  } finally {
    // Release the write-phase lock
    clearInterval(lockHeartbeat);
    await syncLock.releaseLock(userId, lockToken);
  }

  return { earlyReturn: false, preSyncMaxUpdatedAt: preSyncMaxUpdatedAt };
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
  CalendarAccountRepositoryPort: CalendarAccountRepositoryPort,

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
  // JUG-FACADE-DB-VIOLATIONS stage 3
  KnexCalendarAccountRepository: KnexCalendarAccountRepository,
  InMemoryCalendarAccountRepository: InMemoryCalendarAccountRepository,

  // 999.943: Thin HTTP adapter operations for calendar controllers
  getGcalStatus: getGcalStatus,
  gcalConnect: gcalConnect,
  gcalCallback: gcalCallback,
  gcalDisconnect: gcalDisconnect,
  setGcalAutoSync: setGcalAutoSync,
  gcalGetCalendars: gcalGetCalendars,
  gcalUpdateCalendar: gcalUpdateCalendar,
  gcalRefreshCalendars: gcalRefreshCalendars,
  getMsftStatus: getMsftStatus,
  msftConnect: msftConnect,
  msftCallback: msftCallback,
  msftDisconnect: msftDisconnect,
  setMsftAutoSync: setMsftAutoSync,
  msftGetCalendars: msftGetCalendars,
  msftUpdateCalendar: msftUpdateCalendar,
  msftRefreshCalendars: msftRefreshCalendars,
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

  // 999.1025 sub-leg 2: cal-sync controller "Phase 1" gather facade method
  gatherProviderSyncData: gatherProviderSyncData,

  // 999.1025 sub-leg 3: cal-sync controller "Write Phase" facade method
  runSyncWritePhase: runSyncWritePhase,
};

// 999.1628 (CalendarFacadeTriggerPort inversion): register this facade with
// the dependency-free lib/calendar-facade-trigger seam so cross-slice
// consumers (SchedulerCalendarProvider's forward-looking busy-query seam) can
// reach it without a require() edge back into this file — that lazy require
// closed the cycle calendar/facade -> scheduler/facade -> adapters/index ->
// SchedulerCalendarProvider -> calendar/facade (gatherProviderSyncData
// requires scheduler/facade for ConstraintSolver, which pulls in the adapter
// barrel). Load-time registration: every production entrypoint (app.js's
// route mounting) loads this facade well before any scheduler run could
// construct a SchedulerCalendarProvider.
require('../../lib/calendar-facade-trigger').registerCalendarFacade(module.exports);
