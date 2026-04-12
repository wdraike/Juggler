/**
 * Google Calendar API wrapper using google-auth-library OAuth2Client
 * Makes REST calls to Calendar API v3 — no googleapis package needed.
 */

const { OAuth2Client } = require('google-auth-library');

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

function createOAuth2Client() {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GCAL_REDIRECT_URI || 'http://localhost:5002/api/gcal/callback'
  );
}

function getAuthUrl(oauth2Client, state) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state
  });
}

async function getTokensFromCode(oauth2Client, code) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

async function refreshAccessToken(oauth2Client, refreshToken) {
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();
  return credentials;
}

async function calendarFetch(accessToken, path, options = {}) {
  const url = CALENDAR_BASE + path;
  const headers = {
    'Authorization': 'Bearer ' + accessToken,
    'Content-Type': 'application/json'
  };

  const fetchOpts = { method: options.method || 'GET', headers };
  if (options.body) {
    fetchOpts.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, fetchOpts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error('Calendar API error ' + res.status + ': ' + text);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function listEvents(accessToken, timeMin, timeMax) {
  var allItems = [];
  var pageToken = null;
  var nextSyncToken = null;

  var maxPages = 20; // Cap to prevent runaway pagination
  var page = 0;
  do {
    var params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250'
    });
    if (pageToken) params.append('pageToken', pageToken);

    var data = await calendarFetch(accessToken, '/calendars/primary/events?' + params.toString());
    if (data && data.items) {
      allItems = allItems.concat(data.items);
    }
    pageToken = data && data.nextPageToken ? data.nextPageToken : null;
    if (data && data.nextSyncToken) nextSyncToken = data.nextSyncToken;
    page++;
  } while (pageToken && page < maxPages);

  return { items: allItems, nextSyncToken: nextSyncToken };
}

/**
 * Lightweight check: use a sync token to ask Google if anything changed.
 * Returns { hasChanges, changedCount, nextSyncToken, items }.
 * If the sync token is invalid/expired (410), returns { hasChanges: true, tokenInvalid: true }.
 */
async function checkForChanges(accessToken, syncToken) {
  try {
    var params = new URLSearchParams({ syncToken: syncToken, maxResults: '1' });
    var data = await calendarFetch(accessToken, '/calendars/primary/events?' + params.toString());

    var items = (data && data.items) || [];
    return {
      hasChanges: items.length > 0,
      changedCount: items.length,
      nextSyncToken: data && data.nextSyncToken ? data.nextSyncToken : syncToken
    };
  } catch (err) {
    // 410 Gone = sync token expired, need full sync
    if (err.message && err.message.includes('410')) {
      return { hasChanges: true, tokenInvalid: true };
    }
    throw err;
  }
}

async function insertEvent(accessToken, event) {
  return calendarFetch(accessToken, '/calendars/primary/events', {
    method: 'POST',
    body: event
  });
}

async function patchEvent(accessToken, eventId, patch) {
  return calendarFetch(accessToken, '/calendars/primary/events/' + encodeURIComponent(eventId), {
    method: 'PATCH',
    body: patch
  });
}

async function deleteEvent(accessToken, eventId) {
  return calendarFetch(accessToken, '/calendars/primary/events/' + encodeURIComponent(eventId), {
    method: 'DELETE'
  });
}

/**
 * Batch API: send up to 50 requests in a single HTTP call.
 * Google uses multipart/mixed with a boundary for batch requests.
 *
 * @param {string} accessToken
 * @param {Array<{method, path, body?, id?}>} requests — each is one sub-request
 * @returns {Array<{id, status, body}>} — parsed responses in order
 */
async function batchRequest(accessToken, requests) {
  if (requests.length === 0) return [];

  var boundary = 'batch_' + Date.now();
  var parts = requests.map(function(req, i) {
    var id = req.id || String(i);
    var method = req.method || 'GET';
    var path = req.path.startsWith('http') ? req.path : CALENDAR_BASE + req.path;
    var lines = [
      '--' + boundary,
      'Content-Type: application/http',
      'Content-ID: <' + id + '>',
      '',
      method + ' ' + path + ' HTTP/1.1'
    ];
    if (req.body) {
      lines.push('Content-Type: application/json');
      lines.push('');
      lines.push(JSON.stringify(req.body));
    } else {
      lines.push('');
    }
    return lines.join('\r\n');
  });

  var payload = parts.join('\r\n') + '\r\n--' + boundary + '--';

  var res = await fetch('https://www.googleapis.com/batch/calendar/v3', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + accessToken,
      'Content-Type': 'multipart/mixed; boundary=' + boundary
    },
    body: payload
  });

  var responseText = await res.text();

  // Parse multipart response
  var respBoundary = res.headers.get('content-type').match(/boundary=(.+)/);
  var sep = respBoundary ? respBoundary[1] : boundary;
  var responseParts = responseText.split('--' + sep).filter(function(p) {
    return p.trim() && p.trim() !== '--';
  });

  return responseParts.map(function(part) {
    // Extract Content-ID
    var idMatch = part.match(/Content-ID:\s*<?\s*response-([^>\s]+)/i);
    var id = idMatch ? idMatch[1] : null;

    // Find the HTTP response line
    var httpMatch = part.match(/HTTP\/1\.1\s+(\d+)/);
    var status = httpMatch ? parseInt(httpMatch[1], 10) : 0;

    // Extract JSON body (everything after the blank line following headers)
    var bodyMatch = part.match(/\r?\n\r?\n\{[\s\S]*$/);
    var body = null;
    if (bodyMatch) {
      try { body = JSON.parse(bodyMatch[0].trim()); } catch (e) { /* not JSON */ }
    }

    return { id: id, status: status, body: body };
  });
}

module.exports = {
  createOAuth2Client,
  getAuthUrl,
  getTokensFromCode,
  refreshAccessToken,
  listEvents,
  checkForChanges,
  insertEvent,
  patchEvent,
  deleteEvent,
  batchRequest
};
