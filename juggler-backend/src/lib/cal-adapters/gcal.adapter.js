/**
 * Google Calendar adapter for unified sync engine.
 * Implements the provider adapter interface.
 */

var crypto = require('crypto');
var db = require('../../db');
var gcalApi = require('../gcal-api');
var { jugglerDateToISO, isoToJugglerDate, computeDurationMinutes } = require('../../controllers/cal-sync-helpers');
var { localToUtc } = require('../../scheduler/dateHelpers');

var providerId = 'gcal';

function isConnected(user) {
  return !!user.gcal_refresh_token;
}

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

/**
 * Fetch events from GCal and normalize to unified shape.
 * Also saves the nextSyncToken to the user record for future lightweight checks.
 */
async function listEvents(token, timeMin, timeMax, userId) {
  var result = await gcalApi.listEvents(token, timeMin, timeMax);
  var events = (result && result.items) || [];

  // Store the sync token for future lightweight change detection
  if (result.nextSyncToken && userId) {
    await db('users').where('id', userId).update({ gcal_sync_token: result.nextSyncToken });
  }

  return events.map(normalizeEvent);
}

/**
 * Lightweight check: ask Google if anything changed since the last sync.
 * Uses the stored sync token. Returns { hasChanges, nextSyncToken }.
 */
async function hasChanges(token, user) {
  var syncToken = user.gcal_sync_token;
  if (!syncToken) return { hasChanges: true }; // No token yet — need full sync

  var result = await gcalApi.checkForChanges(token, syncToken);

  // If Google returned a new sync token with no changes, save it
  if (!result.hasChanges && result.nextSyncToken && result.nextSyncToken !== syncToken) {
    await db('users').where('id', user.id).update({ gcal_sync_token: result.nextSyncToken });
  }

  return result;
}

/**
 * Normalize a GCal event to the unified NormalizedEvent shape.
 */
function normalizeEvent(event) {
  var startStr = event.start?.dateTime || event.start?.date || '';
  var endStr = event.end?.dateTime || event.end?.date || '';
  var isAllDay = !event.start?.dateTime;
  var dur = 30;
  if (!isAllDay && startStr && endStr) {
    dur = computeDurationMinutes(startStr, endStr);
  }

  return {
    id: event.id,
    title: event.summary || '(No title)',
    description: event.description || '',
    startDateTime: startStr,
    endDateTime: endStr,
    startTimezone: event.start?.timeZone || null,
    isAllDay: isAllDay,
    durationMinutes: dur,
    lastModified: event.updated || null,
    isTransparent: event.transparency === 'transparent',
    _raw: event
  };
}

/**
 * Create a calendar event from a task. Returns { providerEventId, raw }.
 */
async function createEvent(token, task, year, tz, opts) {
  var eventBody = buildEventBody(task, year, tz, opts);
  var created = await gcalApi.insertEvent(token, eventBody);
  return {
    providerEventId: created.id,
    raw: created
  };
}

/**
 * Update an existing calendar event.
 */
async function updateEvent(token, eventId, task, year, tz, opts) {
  var eventBody = buildEventBody(task, year, tz, opts);
  return gcalApi.patchEvent(token, eventId, eventBody);
}

/**
 * Delete a calendar event.
 */
async function deleteEvent(token, eventId) {
  return gcalApi.deleteEvent(token, eventId);
}

/**
 * Compute DB update fields from a normalized event.
 */
function applyEventToTaskFields(event, tz) {
  var isAllDay = event.isAllDay;
  var jd = isoToJugglerDate(event.startDateTime, tz);

  var fields = {
    text: event.title,
    dur: event.durationMinutes,
    updated_at: db.fn.now()
  };

  if (jd.date) {
    if (isAllDay) {
      fields.scheduled_at = localToUtc(jd.date, '12:00 AM', tz);
    } else if (jd.time) {
      fields.scheduled_at = localToUtc(jd.date, jd.time, tz);
    }
  }

  if (isAllDay) {
    fields.when = 'allday';
  }

  if (event.isTransparent) {
    fields.marker = true;
  }

  return fields;
}

/**
 * Hash a normalized event for change detection.
 */
function eventHash(event) {
  var str = [
    event.title || '',
    event.startDateTime || '',
    event.endDateTime || '',
    event.description || ''
  ].join('|');
  return crypto.createHash('md5').update(str).digest('hex');
}

function getEventIdColumn() {
  return 'gcal_event_id';
}

function getLastSyncedColumn() {
  return 'gcal_last_synced_at';
}

// --- Internal helpers ---

function buildEventBody(task, year, tz, opts) {
  var startISO = jugglerDateToISO(task.date, task.time, year);
  var dur = task.dur || 30;
  var isAllDay = task.when === 'allday';

  var descParts = [];
  if (task.project) descParts.push('Project: ' + task.project);
  if (task.pri) descParts.push('Priority: ' + task.pri);
  if (task.notes) descParts.push('Notes: ' + task.notes);
  descParts.push('', 'Synced from Raike & Sons');

  if (isAllDay) {
    var dateParts = (task.date || '').split('/');
    var month = parseInt(dateParts[0], 10);
    var day = parseInt(dateParts[1], 10);
    var y = year || new Date().getFullYear();
    var startDate = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    var endObj = new Date(y, month - 1, day + 1);
    var endDate = endObj.getFullYear() + '-' + String(endObj.getMonth() + 1).padStart(2, '0') + '-' + String(endObj.getDate()).padStart(2, '0');

    var body = {
      summary: task.text,
      description: descParts.join('\n'),
      start: { date: startDate },
      end: { date: endDate }
    };
    if (task.marker) {
      body.transparency = 'transparent';
    }
    return body;
  }

  // Timed event
  var sParts = startISO.split('T');
  var tParts = sParts[1].split(':');
  var sMins = parseInt(tParts[0], 10) * 60 + parseInt(tParts[1], 10);
  var eMins = sMins + dur;
  var eH = Math.floor(eMins / 60);
  var eM = eMins % 60;
  var endISO = sParts[0] + 'T' + String(eH).padStart(2, '0') + ':' + String(eM).padStart(2, '0') + ':00';

  var body2 = {
    summary: task.text,
    description: descParts.join('\n'),
    start: { dateTime: startISO, timeZone: tz },
    end: { dateTime: endISO, timeZone: tz }
  };
  if (task.marker) {
    body2.transparency = 'transparent';
  }
  return body2;
}

module.exports = {
  providerId,
  isConnected,
  getValidAccessToken,
  listEvents,
  hasChanges,
  normalizeEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  applyEventToTaskFields,
  eventHash,
  getEventIdColumn,
  getLastSyncedColumn
};
