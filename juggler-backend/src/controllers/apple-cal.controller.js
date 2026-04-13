/**
 * Apple Calendar Controller — CalDAV connection, status, and management.
 *
 * Unlike Google/Microsoft which use OAuth, Apple Calendar uses CalDAV
 * with basic auth (Apple ID + app-specific password). The connection
 * flow is: enter credentials → discover calendars → select one.
 */

var db = require('../db');
var appleCalApi = require('../lib/apple-cal-api');
var { encrypt, decrypt } = require('../lib/credential-encrypt');

/**
 * GET /api/apple-cal/status — connection status
 */
async function getStatus(req, res) {
  try {
    var connected = !!req.user.apple_cal_username && !!req.user.apple_cal_password && !!req.user.apple_cal_calendar_url;
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

    // Store encrypted credentials (calendar URL set separately via select-calendar)
    await db('users').where('id', req.user.id).update({
      apple_cal_server_url: url,
      apple_cal_username: username,
      apple_cal_password: encrypt(password),
      updated_at: db.fn.now()
    });

    res.json({
      calendars: calendars.map(function(c) {
        return { url: c.url, displayName: c.displayName, description: c.description };
      })
    });
  } catch (error) {
    console.error('Apple Calendar connect error:', error);
    res.status(500).json({ error: 'Failed to connect Apple Calendar' });
  }
}

/**
 * POST /api/apple-cal/select-calendar — select which calendar to sync.
 * Body: { calendarUrl }
 */
async function selectCalendar(req, res) {
  try {
    var { calendarUrl } = req.body;
    if (!calendarUrl) {
      return res.status(400).json({ error: 'calendarUrl is required' });
    }

    // Verify the user is connected
    if (!req.user.apple_cal_username || !req.user.apple_cal_password) {
      return res.status(400).json({ error: 'Not connected to Apple Calendar. Connect first.' });
    }

    await db('users').where('id', req.user.id).update({
      apple_cal_calendar_url: calendarUrl,
      updated_at: db.fn.now()
    });

    res.json({ calendarUrl: calendarUrl });
  } catch (error) {
    console.error('Apple Calendar select error:', error);
    res.status(500).json({ error: 'Failed to select calendar' });
  }
}

/**
 * POST /api/apple-cal/disconnect — clear all Apple Calendar credentials.
 */
async function disconnect(req, res) {
  try {
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

module.exports = {
  getStatus,
  connect,
  selectCalendar,
  disconnect,
  setAutoSync
};
