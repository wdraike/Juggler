/**
 * Apple Calendar Controller — CalDAV connection, status, and management.
 *
 * Unlike Google/Microsoft which use OAuth, Apple Calendar uses CalDAV
 * with basic auth (Apple ID + app-specific password). The connection
 * flow is: enter credentials → discover calendars → toggle selection.
 */

var db = require('../db');
var appleCalApi = require('../lib/apple-cal-api');
var { encrypt, decrypt } = require('../lib/credential-encrypt');

/**
 * GET /api/apple-cal/status — connection status
 */
async function getStatus(req, res) {
  try {
    // Check if credentials are stored — that's enough to be "connected"
    var hasCredentials = !!req.user.apple_cal_username && !!req.user.apple_cal_password;

    // Load all calendars (enabled + disabled) for the toggle UI
    var allCalendars = [];
    try {
      allCalendars = await db('user_calendars')
        .where({ user_id: req.user.id, provider: 'apple' });
    } catch (e) {
      // Table may not exist if migration hasn't run yet
    }

    var connected = hasCredentials && (allCalendars.length > 0 || !!req.user.apple_cal_calendar_url);

    var lastSyncedAt = req.user.apple_cal_last_synced_at || null;

    var autoSyncRow = await db('user_config')
      .where({ user_id: req.user.id, config_key: 'apple_cal_auto_sync' })
      .first();
    var autoSync = false;
    if (autoSyncRow) {
      var val = typeof autoSyncRow.config_value === 'string'
        ? JSON.parse(autoSyncRow.config_value) : autoSyncRow.config_value;
      autoSync = !!val;
    }

    res.json({
      connected: connected,
      username: connected ? req.user.apple_cal_username : null,
      calendarUrl: connected ? req.user.apple_cal_calendar_url : null,
      calendars: allCalendars.length > 0 ? allCalendars : null,
      lastSyncedAt: lastSyncedAt,
      autoSync: autoSync
    });
  } catch (error) {
    console.error('Apple Calendar status error:', error);
    res.status(500).json({ error: 'Failed to get Apple Calendar status' });
  }
}

/**
 * POST /api/apple-cal/connect — validate credentials and discover calendars.
 * Body: { username, password, serverUrl? }
 * Returns: { calendars: [{ url, displayName }] }
 */
async function connect(req, res) {
  try {
    var { username, password, serverUrl } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Apple ID email and app-specific password are required' });
    }

    var url = serverUrl || appleCalApi.DEFAULT_SERVER_URL;

    // Validate credentials by attempting to discover calendars
    var client;
    try {
      client = await appleCalApi.createClient(url, username, password);
    } catch (e) {
      console.error('Apple Calendar connect failed:', e.message);
      return res.status(401).json({
        error: 'Failed to connect. Check your Apple ID and app-specific password.',
        detail: e.message
      });
    }

    var calendars;
    try {
      calendars = await appleCalApi.discoverCalendars(client);
    } catch (e) {
      console.error('Apple Calendar discovery failed:', e.message);
      return res.status(401).json({
        error: 'Connected but failed to discover calendars. Check your credentials.',
        detail: e.message
      });
    }

    if (calendars.length === 0) {
      return res.status(404).json({ error: 'No calendars found on this account' });
    }

    // Store encrypted credentials (calendar selection done separately)
    await db('users').where('id', req.user.id).update({
      apple_cal_server_url: url,
      apple_cal_username: username,
      apple_cal_password: encrypt(password),
      updated_at: db.fn.now()
    });

    // Load existing selections so frontend can show current state
    var existingSelections = [];
    try {
      existingSelections = await db('user_calendars')
        .where({ user_id: req.user.id, provider: 'apple' });
    } catch (e) {
      // Table may not exist if migration hasn't run yet — graceful fallback
      console.warn('user_calendars table not available:', e.message);
    }

    var selectionMap = {};
    existingSelections.forEach(function(s) {
      selectionMap[s.calendar_id] = s;
    });

    res.json({
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
    });
  } catch (error) {
    console.error('Apple Calendar connect error:', error);
    res.status(500).json({ error: 'Failed to connect Apple Calendar' });
  }
}

/**
 * POST /api/apple-cal/select-calendar — legacy single-calendar selection.
 * Body: { calendarUrl }
 * Kept for backward compatibility — prefer select-calendars for multi-select.
 */
async function selectCalendar(req, res) {
  try {
    var { calendarUrl } = req.body;
    if (!calendarUrl) {
      return res.status(400).json({ error: 'calendarUrl is required' });
    }

    if (!req.user.apple_cal_username || !req.user.apple_cal_password) {
      return res.status(400).json({ error: 'Not connected to Apple Calendar. Connect first.' });
    }

    await db('users').where('id', req.user.id).update({
      apple_cal_calendar_url: calendarUrl,
      updated_at: db.fn.now()
    });

    // Also upsert into user_calendars for forward compat
    var existing = await db('user_calendars')
      .where({ user_id: req.user.id, provider: 'apple', calendar_id: calendarUrl })
      .first();

    if (existing) {
      await db('user_calendars').where('id', existing.id).update({ enabled: true, updated_at: db.fn.now() });
    } else {
      await db('user_calendars').insert({
        user_id: req.user.id,
        provider: 'apple',
        calendar_id: calendarUrl,
        enabled: true,
        sync_direction: 'full'
      });
    }

    res.json({ calendarUrl: calendarUrl });
  } catch (error) {
    console.error('Apple Calendar select error:', error);
    res.status(500).json({ error: 'Failed to select calendar' });
  }
}

/**
 * POST /api/apple-cal/select-calendars — multi-calendar selection.
 * Body: { calendars: [{ url, displayName, enabled, syncDirection }] }
 */
async function selectCalendars(req, res) {
  try {
    var { calendars } = req.body;
    if (!Array.isArray(calendars) || calendars.length === 0) {
      return res.status(400).json({ error: 'calendars array is required' });
    }

    if (!req.user.apple_cal_username || !req.user.apple_cal_password) {
      return res.status(400).json({ error: 'Not connected to Apple Calendar. Connect first.' });
    }

    var userId = req.user.id;

    // Upsert each calendar selection
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
          updated_at: db.fn.now()
        });
      } else {
        await db('user_calendars').insert({
          user_id: userId,
          provider: 'apple',
          calendar_id: cal.url,
          display_name: cal.displayName || null,
          enabled: cal.enabled !== undefined ? cal.enabled : false,
          sync_direction: cal.syncDirection || 'full'
        });
      }
    }

    // Update legacy single-calendar field to first enabled calendar (backward compat)
    var firstEnabled = await db('user_calendars')
      .where({ user_id: userId, provider: 'apple', enabled: true })
      .first();

    await db('users').where('id', userId).update({
      apple_cal_calendar_url: firstEnabled ? firstEnabled.calendar_id : null,
      updated_at: db.fn.now()
    });

    var savedCalendars = await db('user_calendars')
      .where({ user_id: userId, provider: 'apple' });

    res.json({ calendars: savedCalendars });
  } catch (error) {
    console.error('Apple Calendar select-calendars error:', error);
    res.status(500).json({ error: 'Failed to save calendar selections' });
  }
}

/**
 * GET /api/apple-cal/calendars — get saved calendar selections.
 */
async function getCalendars(req, res) {
  try {
    var calendars = await db('user_calendars')
      .where({ user_id: req.user.id, provider: 'apple' });

    res.json({ calendars: calendars });
  } catch (error) {
    console.error('Apple Calendar get-calendars error:', error);
    res.status(500).json({ error: 'Failed to get calendars' });
  }
}

/**
 * PUT /api/apple-cal/calendars/:id — update a single calendar's settings.
 * Body: { enabled?, syncDirection? }
 */
async function updateCalendar(req, res) {
  try {
    var calendarId = req.params.id;
    var row = await db('user_calendars')
      .where({ id: calendarId, user_id: req.user.id })
      .first();

    if (!row) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    var updates = { updated_at: db.fn.now() };
    if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
    if (req.body.syncDirection) updates.sync_direction = req.body.syncDirection;

    await db('user_calendars').where('id', calendarId).update(updates);

    // Update legacy field
    var firstEnabled = await db('user_calendars')
      .where({ user_id: req.user.id, provider: 'apple', enabled: true })
      .first();

    await db('users').where('id', req.user.id).update({
      apple_cal_calendar_url: firstEnabled ? firstEnabled.calendar_id : null,
      updated_at: db.fn.now()
    });

    var updated = await db('user_calendars').where('id', calendarId).first();
    res.json({ calendar: updated });
  } catch (error) {
    console.error('Apple Calendar update-calendar error:', error);
    res.status(500).json({ error: 'Failed to update calendar' });
  }
}

/**
 * POST /api/apple-cal/disconnect — clear all Apple Calendar credentials.
 */
async function disconnect(req, res) {
  try {
    // Remove all calendar selections
    await db('user_calendars')
      .where({ user_id: req.user.id, provider: 'apple' })
      .del();

    await db('users').where('id', req.user.id).update({
      apple_cal_server_url: null,
      apple_cal_username: null,
      apple_cal_password: null,
      apple_cal_calendar_url: null,
      apple_cal_sync_token: null,
      apple_cal_last_synced_at: null,
      updated_at: db.fn.now()
    });

    // Clear auto-sync setting
    await db('user_config')
      .where({ user_id: req.user.id, config_key: 'apple_cal_auto_sync' })
      .del()
      .catch(function() {});

    res.json({ disconnected: true });
  } catch (error) {
    console.error('Apple Calendar disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Apple Calendar' });
  }
}

/**
 * POST /api/apple-cal/auto-sync — toggle auto-sync.
 * Body: { enabled: boolean }
 */
async function setAutoSync(req, res) {
  try {
    var userId = req.user.id;
    var value = !!req.body.enabled;

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

    res.json({ autoSync: value });
  } catch (error) {
    console.error('Apple Calendar auto-sync error:', error);
    res.status(500).json({ error: 'Failed to update auto-sync setting' });
  }
}

/**
 * GET /api/apple-cal/refresh-calendars — re-discover calendars from iCloud
 * using stored credentials. Upserts new calendars (enabled=false), updates
 * display names on existing ones. Does NOT require re-entering credentials.
 */
async function refreshCalendars(req, res) {
  try {
    var userId = req.user.id;

    if (!req.user.apple_cal_username || !req.user.apple_cal_password) {
      return res.status(400).json({ error: 'Apple Calendar not connected. Please connect first.' });
    }

    var password = decrypt(req.user.apple_cal_password);
    var serverUrl = req.user.apple_cal_server_url || appleCalApi.DEFAULT_SERVER_URL;

    var client;
    try {
      client = await appleCalApi.createClient(serverUrl, req.user.apple_cal_username, password);
    } catch (e) {
      return res.status(401).json({
        error: 'Failed to connect. Your credentials may have expired.',
        detail: e.message
      });
    }

    var remoteCalendars;
    try {
      remoteCalendars = await appleCalApi.discoverCalendars(client);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to discover calendars.', detail: e.message });
    }

    // Load existing rows
    var existingRows = await db('user_calendars')
      .where({ user_id: userId, provider: 'apple' });
    var existingByUrl = {};
    existingRows.forEach(function(r) { existingByUrl[r.calendar_id] = r; });

    // Upsert: new calendars → insert enabled=false, existing → update display_name
    var remoteUrls = new Set();
    for (var i = 0; i < remoteCalendars.length; i++) {
      var rc = remoteCalendars[i];
      remoteUrls.add(rc.url);

      if (existingByUrl[rc.url]) {
        // Update display name if changed
        if (existingByUrl[rc.url].display_name !== rc.displayName) {
          await db('user_calendars').where('id', existingByUrl[rc.url].id)
            .update({ display_name: rc.displayName, updated_at: db.fn.now() });
        }
      } else {
        // New calendar — insert as disabled
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

    // Return the full list with current state
    var allCalendars = await db('user_calendars')
      .where({ user_id: userId, provider: 'apple' });

    res.json({
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
    });
  } catch (error) {
    console.error('Apple Calendar refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh calendars' });
  }
}

module.exports = {
  getStatus,
  connect,
  selectCalendar,
  selectCalendars,
  getCalendars,
  updateCalendar,
  refreshCalendars,
  disconnect,
  setAutoSync
};
