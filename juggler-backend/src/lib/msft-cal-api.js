/**
 * Microsoft Calendar API wrapper using Microsoft Graph REST API
 * Uses direct OAuth2 REST calls with PKCE (no MSAL dependency).
 */

var crypto = require('crypto');

var GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
var TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
var AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

var SCOPES = 'Calendars.ReadWrite offline_access User.Read';

function getRedirectUri() {
  return process.env.MSFT_CAL_REDIRECT_URI || 'http://localhost:5002/api/msft-cal/callback';
}

/**
 * Generate PKCE code_verifier and code_challenge (S256).
 * Required by Azure AD for apps registered with /common endpoint.
 */
function generatePkce() {
  var verifier = crypto.randomBytes(32).toString('base64url');
  var challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { codeVerifier: verifier, codeChallenge: challenge };
}

function getAuthUrl(state, codeChallenge) {
  var params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    state: state,
    prompt: 'select_account',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  return AUTH_URL + '?' + params.toString();
}

async function getTokensFromCode(code, codeVerifier) {
  var body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    code: code,
    redirect_uri: getRedirectUri(),
    grant_type: 'authorization_code',
    scope: SCOPES,
    code_verifier: codeVerifier
  });

  console.log('[MSFT TOKEN] Exchanging code with PKCE, redirect_uri=' + getRedirectUri());

  var res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  var data = await res.json();
  if (!res.ok) {
    console.log('[MSFT TOKEN] FAILED:', data.error, data.error_description);
    throw new Error('Token exchange error: ' + (data.error_description || data.error || res.status));
  }
  console.log('[MSFT TOKEN] SUCCESS, got access_token');

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresIn: data.expires_in,
    expiresOn: new Date(Date.now() + data.expires_in * 1000)
  };
}

async function refreshAccessToken(refreshToken) {
  var body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPES
  });

  var res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  var data = await res.json();
  if (!res.ok) {
    throw new Error('Token refresh error: ' + (data.error_description || data.error || res.status));
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresOn: new Date(Date.now() + data.expires_in * 1000)
  };
}

async function graphFetch(accessToken, path, options) {
  options = options || {};
  var url = GRAPH_BASE + path;
  var headers = {
    'Authorization': 'Bearer ' + accessToken,
    'Content-Type': 'application/json'
  };

  var fetchOpts = { method: options.method || 'GET', headers: headers };
  if (options.body) {
    fetchOpts.body = JSON.stringify(options.body);
  }

  var res = await fetch(url, fetchOpts);
  if (!res.ok) {
    var text = await res.text();
    throw new Error('Graph API error ' + res.status + ': ' + text);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function listEvents(accessToken, startDateTime, endDateTime) {
  var allItems = [];
  var params = new URLSearchParams({
    startDateTime: startDateTime,
    endDateTime: endDateTime,
    '$top': '250',
    '$orderby': 'start/dateTime'
  });

  var path = '/me/calendarView?' + params.toString();

  do {
    var data = await graphFetch(accessToken, path);
    if (data && data.value) {
      allItems = allItems.concat(data.value);
    }
    if (data && data['@odata.nextLink']) {
      var nextUrl = data['@odata.nextLink'];
      if (nextUrl.startsWith(GRAPH_BASE)) {
        path = nextUrl.substring(GRAPH_BASE.length);
      } else {
        break;
      }
    } else {
      path = null;
    }
  } while (path);

  return { items: allItems };
}

async function insertEvent(accessToken, event) {
  return graphFetch(accessToken, '/me/events', {
    method: 'POST',
    body: event
  });
}

async function patchEvent(accessToken, eventId, patch) {
  return graphFetch(accessToken, '/me/events/' + encodeURIComponent(eventId), {
    method: 'PATCH',
    body: patch
  });
}

async function deleteEvent(accessToken, eventId) {
  return graphFetch(accessToken, '/me/events/' + encodeURIComponent(eventId), {
    method: 'DELETE'
  });
}

/**
 * Lightweight check using Microsoft Graph delta query.
 * Returns { hasChanges, deltaLink }.
 * If the deltaLink is invalid/expired, returns { hasChanges: true, tokenInvalid: true }.
 */
async function checkForChanges(accessToken, deltaLink) {
  try {
    // deltaLink is a full URL — extract the path after the Graph base
    var path = deltaLink;
    if (path.startsWith(GRAPH_BASE)) {
      path = path.substring(GRAPH_BASE.length);
    }

    var data = await graphFetch(accessToken, path);
    var items = (data && data.value) || [];
    var newDeltaLink = data && data['@odata.deltaLink'] ? data['@odata.deltaLink'] : deltaLink;

    return {
      hasChanges: items.length > 0,
      changedCount: items.length,
      deltaLink: newDeltaLink
    };
  } catch (err) {
    // Expired delta token — need full sync
    if (err.message && (err.message.includes('410') || err.message.includes('syncStateNotFound'))) {
      return { hasChanges: true, tokenInvalid: true };
    }
    throw err;
  }
}

module.exports = {
  generatePkce,
  getAuthUrl,
  getTokensFromCode,
  refreshAccessToken,
  listEvents,
  checkForChanges,
  insertEvent,
  patchEvent,
  deleteEvent
};
