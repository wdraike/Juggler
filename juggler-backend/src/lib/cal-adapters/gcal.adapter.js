/**
 * Google Calendar adapter for unified sync engine.
 * Implements the provider adapter interface.
 */

var crypto = require('crypto');
var db = require('../../db');
var gcalApi = require('../gcal-api');
var { jugglerDateToISO, isoToJugglerDate, computeDurationMinutes } = require('../../controllers/cal-sync-helpers');
var { localToUtc } = require('../../scheduler/dateHelpers');
var { PLACEMENT_MODES } = require('../placementModes');

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
 * Used ONLY when creating NEW tasks from pulled events (new design: no bidirectional sync).
 * For new tasks from ingest-only calendars, tasks are created with when='fixed' by the sync controller.
 */
function applyEventToTaskFields(event, tz, currentTask) {
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
    fields.placementMode = PLACEMENT_MODES.MARKER;
  }

  if (!isAllDay) {
    var dateChanged = jd.date && jd.date !== currentTask?.date;
    var timeChanged = jd.time && jd.time !== currentTask?.time;
    if (dateChanged || timeChanged) {
      fields.when = 'fixed';
      fields.prev_when = currentTask?.when;
      if (dateChanged) fields.date_pinned = 1;
    }
  }

  if (!event.isTransparent && currentTask?.placement_mode === PLACEMENT_MODES.MARKER) {
    fields.placementMode = PLACEMENT_MODES.FLEXIBLE;
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
    event.description || '',
    event.isTransparent ? 'transparent' : 'opaque',
    event.isAllDay ? 'allday' : 'timed'
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
  if (task.url) descParts.push('Link: ' + task.url);
  descParts.push('', 'Synced from Raike & Sons');

  var isDone = task.status === 'done';
  var summaryText = isDone ? '✓ ' + task.text : task.text;

  if (isAllDay) {
    // task.date is now ISO YYYY-MM-DD post-migration; legacy rows may still be
    // M/D. Handle both — the old split('/') parse silently produced
    // "2026-2026-NaN" for ISO strings and GCal returned 400 Bad Request.
    var isoMatch = (task.date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    var mdMatch = !isoMatch && (task.date || '').match(/^(\d{1,2})\/(\d{1,2})$/);
    var y, month, day;
    if (isoMatch) {
      y = parseInt(isoMatch[1], 10);
      month = parseInt(isoMatch[2], 10);
      day = parseInt(isoMatch[3], 10);
    } else if (mdMatch) {
      month = parseInt(mdMatch[1], 10);
      day = parseInt(mdMatch[2], 10);
      y = year || new Date().getFullYear();
    } else {
      throw new Error('buildEventBody: unparseable task.date "' + task.date + '" for allday event');
    }
    var startDate = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    var endObj = new Date(y, month - 1, day + 1);
    var endDate = endObj.getFullYear() + '-' + String(endObj.getMonth() + 1).padStart(2, '0') + '-' + String(endObj.getDate()).padStart(2, '0');

    var body = {
      summary: summaryText,
      description: descParts.join('\n'),
      start: { date: startDate },
      end: { date: endDate }
    };
    if (task.marker || isDone) {
      body.transparency = 'transparent';
    }
    return body;
  }

  // Timed event — use Date math to handle events that span midnight
  var startDate = new Date(startISO);
  var endDate = new Date(startDate.getTime() + dur * 60000);
  var endISO = endDate.getFullYear() + '-' +
    String(endDate.getMonth() + 1).padStart(2, '0') + '-' +
    String(endDate.getDate()).padStart(2, '0') + 'T' +
    String(endDate.getHours()).padStart(2, '0') + ':' +
    String(endDate.getMinutes()).padStart(2, '0') + ':00';

  var body2 = {
    summary: summaryText,
    description: descParts.join('\n'),
    start: { dateTime: startISO, timeZone: tz },
    end: { dateTime: endISO, timeZone: tz }
  };
  if (task.marker || isDone) {
    body2.transparency = 'transparent';
  }
  return body2;
}

/**
 * Batch create events. Returns array of { taskId, providerEventId, raw, error }.
 * Google batch limit is 50 per call.
 */
async function batchCreateEvents(token, taskEventPairs, year, tz) {
  var results = [];
  // Process in chunks of 50
  for (var ci = 0; ci < taskEventPairs.length; ci += 50) {
    var chunk = taskEventPairs.slice(ci, ci + 50);
    var requests = chunk.map(function(pair, i) {
      var body = buildEventBody(pair.task, year, tz);
      return { id: String(ci + i), method: 'POST', path: '/calendars/primary/events', body: body };
    });
    var responses = await gcalApi.batchRequest(token, requests);
    for (var ri = 0; ri < responses.length; ri++) {
      var idx = parseInt(responses[ri].id, 10);
      var pair = taskEventPairs[idx];
      if (responses[ri].status >= 200 && responses[ri].status < 300 && responses[ri].body) {
        results.push({ taskId: pair.task.id, providerEventId: responses[ri].body.id, raw: responses[ri].body, error: null });
      } else {
        results.push({ taskId: pair.task.id, providerEventId: null, raw: null, error: 'Batch create failed: HTTP ' + responses[ri].status });
      }
    }
  }
  return results;
}

/**
 * Batch delete events. Returns array of { eventId, error }.
 */
async function batchDeleteEvents(token, eventIds) {
  var results = [];
  for (var ci = 0; ci < eventIds.length; ci += 50) {
    var chunk = eventIds.slice(ci, ci + 50);
    var requests = chunk.map(function(evId, i) {
      return { id: String(ci + i), method: 'DELETE', path: '/calendars/primary/events/' + encodeURIComponent(evId) };
    });
    var responses = await gcalApi.batchRequest(token, requests);
    for (var ri = 0; ri < responses.length; ri++) {
      var idx = parseInt(responses[ri].id, 10);
      var ok = responses[ri].status >= 200 && responses[ri].status < 300 || responses[ri].status === 404 || responses[ri].status === 410;
      results.push({ eventId: eventIds[idx], error: ok ? null : 'Batch delete failed: HTTP ' + responses[ri].status });
    }
  }
  return results;
}

/**
 * Batch update events. Returns array of { eventId, error }.
 * Google batch limit is 50 per call.
 */
async function batchUpdateEvents(token, updatePairs, year, tz) {
  var results = [];
  for (var ci = 0; ci < updatePairs.length; ci += 50) {
    var chunk = updatePairs.slice(ci, ci + 50);
    var requests = chunk.map(function(pair, i) {
      var body = buildEventBody(pair.task, year, tz);
      return { id: String(ci + i), method: 'PATCH', path: '/calendars/primary/events/' + encodeURIComponent(pair.eventId), body: body };
    });
    var responses = await gcalApi.batchRequest(token, requests);
    for (var ri = 0; ri < responses.length; ri++) {
      var idx = parseInt(responses[ri].id, 10);
      var ok = responses[ri].status >= 200 && responses[ri].status < 300;
      results.push({ eventId: updatePairs[idx].eventId, error: ok ? null : 'Batch update failed: HTTP ' + responses[ri].status });
    }
  }
  return results;
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
  batchCreateEvents,
  batchDeleteEvents,
  batchUpdateEvents,
  applyEventToTaskFields,
  eventHash,
  buildEventBody,
  getEventIdColumn,
  getLastSyncedColumn
};
