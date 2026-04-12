/**
 * Google Calendar Controller — OAuth flow, status, and auto-sync settings.
 * Sync is handled by the unified cal-sync.controller.js.
 */

var { SignJWT, jwtVerify } = require('jose');
var db = require('../db');
var gcalApi = require('../lib/gcal-api');

// --- Token management ---

var { getJwtSecret } = require('../lib/jwt-secret');

async function getValidAccessToken(user) {
  if (!user.gcal_refresh_token) {
    throw new Error('Google Calendar not connected');
  }

  if (user.gcal_access_token && user.gcal_token_expiry) {
    var expiryStr = String(user.gcal_token_expiry);
    var expiry = new Date(expiryStr.endsWith('Z') ? expiryStr : expiryStr + 'Z');
    if (expiry.getTime() > Date.now() + 5 * 60 * 1000) {
      return user.gcal_access_token;
    }
  }

  var oauth2Client = gcalApi.createOAuth2Client();
  var credentials = await gcalApi.refreshAccessToken(oauth2Client, user.gcal_refresh_token);

  var update = {
    gcal_access_token: credentials.access_token,
    updated_at: db.fn.now()
  };
  if (credentials.expiry_date) {
    update.gcal_token_expiry = new Date(credentials.expiry_date);
  }

  await db('users').where('id', user.id).update(update);

  return credentials.access_token;
}

// --- Endpoints ---

async function getStatus(req, res) {
  try {
    var hasToken = !!req.user.gcal_refresh_token;
    var lastSyncedAt = req.user.gcal_last_synced_at || null;
    var connected = false;
    var tokenExpired = false;

    if (hasToken) {
      // Don't refresh the token on status check — just verify it exists.
      // Token refresh happens lazily when sync actually needs it.
      // This makes the status endpoint instant instead of blocking on
      // Google's auth server (which can take seconds or timeout).
      connected = true;
      if (req.user.gcal_token_expiry) {
        var expiryStr = String(req.user.gcal_token_expiry);
        var expiry = new Date(expiryStr.endsWith('Z') ? expiryStr : expiryStr + 'Z');
        if (expiry.getTime() < Date.now()) {
          // Token expired but refresh token exists — still "connected",
          // will refresh lazily on next sync
          connected = true;
        }
      }
    }

    var autoSyncRow = await db('user_config')
      .where({ user_id: req.user.id, config_key: 'gcal_auto_sync' })
      .first();
    var autoSync = false;
    if (autoSyncRow) {
      var val = typeof autoSyncRow.config_value === 'string'
        ? JSON.parse(autoSyncRow.config_value) : autoSyncRow.config_value;
      autoSync = !!val;
    }

    res.json({
      connected: connected,
      tokenExpired: tokenExpired,
      email: req.user.email,
      lastSyncedAt: lastSyncedAt,
      autoSync: autoSync
    });
  } catch (error) {
    console.error('GCal status error:', error);
    res.status(500).json({ error: 'Failed to check GCal status' });
  }
}

async function connect(req, res) {
  try {
    var oauth2Client = gcalApi.createOAuth2Client();
    var state = await new SignJWT({ userId: req.user.id })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(getJwtSecret());
    var authUrl = gcalApi.getAuthUrl(oauth2Client, state);
    res.json({ authUrl: authUrl });
  } catch (error) {
    console.error('GCal connect error:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
}

async function callback(req, res) {
  try {
    var code = req.query.code;
    var state = req.query.state;

    if (!code || !state) {
      return res.status(400).send('Missing code or state parameter');
    }

    var decoded;
    try {
      var result = await jwtVerify(state, getJwtSecret());
      decoded = result.payload;
    } catch (e) {
      return res.status(400).send('Invalid or expired state parameter');
    }

    var userId = decoded.userId;
    // Verify the OAuth flow is for the authenticated user (prevent IDOR)
    if (req.user && req.user.id !== userId) {
      return res.status(403).send('OAuth state does not match authenticated user');
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

    var frontendUrl = require('../proxy-config').services.juggler.frontend;
    res.redirect(frontendUrl + '/?gcal=connected');
  } catch (error) {
    console.error('GCal callback error:', error);
    res.status(500).send('Failed to complete Google Calendar authorization');
  }
}

async function disconnect(req, res) {
  try {
    await db('users').where('id', req.user.id).update({
      gcal_access_token: null,
      gcal_refresh_token: null,
      gcal_token_expiry: null,
      updated_at: db.fn.now()
    });
    res.json({ disconnected: true });
  } catch (error) {
    console.error('GCal disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect GCal' });
  }
}

async function setAutoSync(req, res) {
  try {
    var enabled = req.body.enabled;
    var userId = req.user.id;
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

    res.json({ autoSync: value });
  } catch (error) {
    console.error('GCal auto-sync error:', error);
    res.status(500).json({ error: 'Failed to update auto-sync setting' });
  }
}

module.exports = {
  getStatus,
  connect,
  callback,
  disconnect,
  setAutoSync
};
