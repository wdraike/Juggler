/**
 * Microsoft Calendar Controller — OAuth flow, status, and auto-sync settings.
 * Sync is handled by the unified cal-sync.controller.js.
 */

var { SignJWT, jwtVerify } = require('jose');
var db = require('../db');
var msftCalApi = require('../lib/msft-cal-api');

// --- Token management ---

function getJwtSecret() {
  var secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET required in production');
    secret = 'local-dev-jwt-secret-juggler';
  }
  return new TextEncoder().encode(secret);
}

async function getValidAccessToken(user) {
  if (!user.msft_cal_refresh_token) {
    throw new Error('Microsoft Calendar not connected');
  }

  if (user.msft_cal_access_token && user.msft_cal_token_expiry) {
    var expiryStr = String(user.msft_cal_token_expiry);
    var expiry = new Date(expiryStr.endsWith('Z') ? expiryStr : expiryStr + 'Z');
    if (expiry.getTime() > Date.now() + 5 * 60 * 1000) {
      return user.msft_cal_access_token;
    }
  }

  var credentials = await msftCalApi.refreshAccessToken(user.msft_cal_refresh_token);

  var update = {
    msft_cal_access_token: credentials.accessToken,
    updated_at: db.fn.now()
  };
  if (credentials.expiresOn) {
    update.msft_cal_token_expiry = new Date(credentials.expiresOn);
  }
  if (credentials.refreshToken) {
    update.msft_cal_refresh_token = credentials.refreshToken;
  }

  await db('users').where('id', user.id).update(update);

  return credentials.accessToken;
}

// Guard against duplicate callback hits (browser retries)
var usedCodes = new Set();
function markCodeUsed(code) {
  var key = code.substring(0, 40);
  if (usedCodes.has(key)) return false;
  usedCodes.add(key);
  setTimeout(function() { usedCodes.delete(key); }, 120000);
  return true;
}

// --- Endpoints ---

async function getStatus(req, res) {
  try {
    var hasToken = !!req.user.msft_cal_refresh_token;
    var lastSyncedAt = req.user.msft_cal_last_synced_at || null;
    var connected = false;
    var tokenExpired = false;

    if (hasToken) {
      try {
        var creds = await msftCalApi.refreshAccessToken(req.user.msft_cal_refresh_token);

        var update = { msft_cal_access_token: creds.accessToken, updated_at: db.fn.now() };
        if (creds.expiresOn) update.msft_cal_token_expiry = new Date(creds.expiresOn);
        if (creds.refreshToken) update.msft_cal_refresh_token = creds.refreshToken;
        await db('users').where('id', req.user.id).update(update);

        connected = true;
      } catch (tokenErr) {
        var msg = tokenErr.message || '';
        if (msg.includes('invalid_grant') || msg.includes('AADSTS') || msg.includes('expired')) {
          await db('users').where('id', req.user.id).update({
            msft_cal_access_token: null,
            msft_cal_refresh_token: null,
            msft_cal_token_expiry: null,
            updated_at: db.fn.now()
          });
          tokenExpired = true;
          connected = false;
        } else {
          connected = true;
        }
      }
    }

    var autoSyncRow = await db('user_config')
      .where({ user_id: req.user.id, config_key: 'msft_cal_auto_sync' })
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
    console.error('MsftCal status error:', error);
    res.status(500).json({ error: 'Failed to check Microsoft Calendar status' });
  }
}

async function connect(req, res) {
  try {
    var pkce = msftCalApi.generatePkce();
    var state = await new SignJWT({ userId: req.user.id, cv: pkce.codeVerifier })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(getJwtSecret());
    var authUrl = msftCalApi.getAuthUrl(state, pkce.codeChallenge);
    res.json({ authUrl: authUrl });
  } catch (error) {
    console.error('MsftCal connect error:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
}

async function callback(req, res) {
  try {
    console.log('MsftCal callback hit at', new Date().toISOString());
    console.log('  code:', req.query.code ? req.query.code.substring(0, 30) + '... (len=' + req.query.code.length + ')' : 'NONE');
    console.log('  state:', req.query.state ? 'present' : 'NONE');
    console.log('  full URL:', req.originalUrl.substring(0, 100));
    var code = req.query.code;
    var state = req.query.state;

    if (!code || !state) {
      return res.status(400).send('Missing code or state parameter');
    }

    if (!markCodeUsed(code)) {
      console.log('[MSFT CALLBACK] Duplicate code detected, redirecting without re-exchange');
      var frontUrl = require('../proxy-config').services.juggler.frontend;
      return res.redirect(frontUrl + '/?msftcal=connected');
    }

    var decoded;
    try {
      var result = await jwtVerify(state, getJwtSecret());
      decoded = result.payload;
    } catch (e) {
      return res.status(400).send('Invalid or expired state parameter');
    }

    var userId = decoded.userId;
    var codeVerifier = decoded.cv;
    if (!codeVerifier) {
      return res.status(400).send('Missing PKCE code_verifier in state');
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

    await db('users').where('id', userId).update(update);

    var frontendUrl = require('../proxy-config').services.juggler.frontend;
    res.redirect(frontendUrl + '/?msftcal=connected');
  } catch (error) {
    console.error('MsftCal callback error:', error.message || error);
    res.status(500).send('Failed to complete Microsoft Calendar authorization: ' + (error.message || 'unknown error'));
  }
}

async function disconnect(req, res) {
  try {
    await db('users').where('id', req.user.id).update({
      msft_cal_access_token: null,
      msft_cal_refresh_token: null,
      msft_cal_token_expiry: null,
      updated_at: db.fn.now()
    });
    res.json({ disconnected: true });
  } catch (error) {
    console.error('MsftCal disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Microsoft Calendar' });
  }
}

async function setAutoSync(req, res) {
  try {
    var enabled = req.body.enabled;
    var userId = req.user.id;
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

    res.json({ autoSync: value });
  } catch (error) {
    console.error('MsftCal auto-sync error:', error);
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
