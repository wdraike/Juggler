/**
 * Microsoft Calendar Controller — OAuth flow, status, and auto-sync settings.
 * Sync is handled by the unified cal-sync.controller.js.
 */

var { SignJWT } = require('jose');
const getDb = () => require('../db');
var msftCalApi = require('../lib/msft-cal-api');

// --- Token management (canonical implementation in adapter) ---

var { getJwtSecret, verifyStateToken } = require('../lib/jwt-secret');
// Resolved lazily (inside getStatus) to avoid an adapter-registration load-order
// dependency at module require time.
function getMsftAdapter() {
  return require('../slices/calendar/facade').getAdapter('msft');
}
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('msft-cal.controller');

// Guard against duplicate callback hits (browser retries).
//
// FIX-03 — Multi-instance safe OAuth code dedup.
// Replaces the former per-instance in-memory `usedCodes` Set with a
// DB-backed nonce table (oauth_code_nonces).
//
// RESEARCH.md Category 4g + Pitfall 5: if the browser retries the OAuth
// redirect and Cloud Run routes the retry to a different instance, the
// old in-memory Set would have missed the duplicate. The DB row is visible
// to all instances, so INSERT IGNORE provides atomic cross-instance dedup.
//
// Security notes:
//   - The raw OAuth code is never stored. We hash the first 40 chars
//     (matching the original truncation) with SHA-256 before writing to DB.
//   - INSERT IGNORE: succeeds (affectedRows=1) on first hit; silently
//     no-ops (affectedRows=0) if the PK already exists — i.e. duplicate.
//   - Best-effort sweep: DELETE WHERE expires_at < NOW() before each INSERT
//     keeps the table bounded. Wrap in .catch() so a sweep failure never
//     blocks the OAuth flow (table grows by at most one extra row).
//   - 2-minute TTL matches the OAuth code lifetime + browser retry window.
async function markCodeUsed(code) {
  var key = code.substring(0, 40);
  var hash = require('crypto').createHash('sha256').update(key).digest('hex');

  // Best-effort sweep of expired rows (keeps table naturally bounded)
  await getDb().raw('DELETE FROM oauth_code_nonces WHERE expires_at < NOW()').catch(function() {});

  // INSERT IGNORE: atomic "claim this nonce or detect duplicate"
  var result = await getDb().raw(
    'INSERT IGNORE INTO oauth_code_nonces (code_hash, expires_at) ' +
    'VALUES (?, DATE_ADD(NOW(), INTERVAL 2 MINUTE))',
    [hash]
  );
  return result[0].affectedRows === 1;
}

// --- Endpoints ---

async function getStatus(req, res) {
  try {
    var hasToken = !!req.user.msft_cal_refresh_token;
    var lastSyncedAt = req.user.msft_cal_last_synced_at || null;
    var connected = false;
    var tokenExpired = false;

    if (hasToken) {
      // Don't refresh the token on status check — just verify it exists.
      // Token refresh happens lazily when sync actually needs it.
      connected = true;
    }

    // Show the connected Microsoft account, never the local Raike account email
    // (999.859). Lazily backfill msft_cal_email for connections made before the
    // column existed — best-effort so a Graph/token hiccup never fails status.
    var msftEmail = req.user.msft_cal_email || null;
    if (connected && !msftEmail) {
      try {
        var token = await getMsftAdapter().getValidAccessToken(req.user);
        var info = await msftCalApi.getUserInfo(token);
        if (info && info.email) {
          msftEmail = info.email;
          await getDb()('users').where('id', req.user.id)
            .update({ msft_cal_email: msftEmail, updated_at: getDb().fn.now() });
        }
      } catch (e) {
        logger.warn('MSFT account email lazy backfill failed (non-fatal):', e.message);
      }
    }

    var autoSyncRow = await getDb()('user_config')
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
      email: msftEmail,
      lastSyncedAt: lastSyncedAt,
      autoSync: autoSync
    });
  } catch (error) {
    logger.error('MsftCal status error:', error);
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
    logger.error('MsftCal connect error:', error);
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

    if (!(await markCodeUsed(code))) {
      logger.info('[MSFT CALLBACK] Duplicate code detected, redirecting without re-exchange');
      var frontUrl = require('../proxy-config').services.juggler.frontend;
      return res.redirect(frontUrl + '/?msftcal=connected');
    }

    var decoded;
    try {
      var result = await verifyStateToken(state);
      decoded = result.payload;
    } catch (_e) {
      return res.status(400).send('Invalid or expired state parameter');
    }

    var userId = decoded.userId;
    if (req.user && req.user.id !== userId) {
      return res.status(403).send('OAuth state does not match authenticated user');
    }
    var codeVerifier = decoded.cv;
    if (!codeVerifier) {
      return res.status(400).send('Missing PKCE code_verifier in state');
    }
    var tokens = await msftCalApi.getTokensFromCode(code, codeVerifier);

    var update = {
      msft_cal_access_token: tokens.accessToken,
      updated_at: getDb().fn.now()
    };
    if (tokens.refreshToken) {
      update.msft_cal_refresh_token = tokens.refreshToken;
    }
    if (tokens.expiresOn) {
      update.msft_cal_token_expiry = new Date(tokens.expiresOn);
    }

    // Capture the Microsoft account identity for the Calendar Sync modal (999.859).
    // Best-effort: a Graph hiccup must not break an otherwise-successful connect.
    try {
      var info = await msftCalApi.getUserInfo(tokens.accessToken);
      if (info && info.email) update.msft_cal_email = info.email;
    } catch (e) {
      logger.warn('MSFT account email capture failed (non-fatal):', e.message);
    }

    await getDb()('users').where('id', userId).update(update);

    var frontendUrl = require('../proxy-config').services.juggler.frontend;
    res.redirect(frontendUrl + '/?msftcal=connected');
  } catch (error) {
    logger.error('MsftCal callback error:', error);
    res.status(500).send('Failed to complete Microsoft Calendar authorization. Please try again.');
  }
}

async function disconnect(req, res) {
  try {
    await getDb()('users').where('id', req.user.id).update({
      msft_cal_access_token: null,
      msft_cal_refresh_token: null,
      msft_cal_token_expiry: null,
      updated_at: getDb().fn.now()
    });
    res.json({ disconnected: true });
  } catch (error) {
    logger.error('MsftCal disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Microsoft Calendar' });
  }
}

async function setAutoSync(req, res) {
  try {
    var enabled = req.body.enabled;
    var userId = req.user.id;
    var value = !!enabled;

    var existing = await getDb()('user_config')
      .where({ user_id: userId, config_key: 'msft_cal_auto_sync' })
      .first();

    if (existing) {
      await getDb()('user_config')
        .where({ user_id: userId, config_key: 'msft_cal_auto_sync' })
        .update({ config_value: JSON.stringify(value), updated_at: getDb().fn.now() });
    } else {
      await getDb()('user_config').insert({
        user_id: userId,
        config_key: 'msft_cal_auto_sync',
        config_value: JSON.stringify(value)
      });
    }

    res.json({ autoSync: value });
  } catch (error) {
    logger.error('MsftCal auto-sync error:', error);
    res.status(500).json({ error: 'Failed to update auto-sync setting' });
  }
}

module.exports = {
  getStatus,
  connect,
  callback,
  disconnect,
  setAutoSync,
  // Test-only: direct access to markCodeUsed for unit testing without HTTP stack
  _internal: { markCodeUsed }
};
