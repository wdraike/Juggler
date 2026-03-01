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
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250'
  });
  return calendarFetch(accessToken, '/calendars/primary/events?' + params.toString());
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

module.exports = {
  createOAuth2Client,
  getAuthUrl,
  getTokensFromCode,
  refreshAccessToken,
  listEvents,
  insertEvent,
  patchEvent,
  deleteEvent
};
