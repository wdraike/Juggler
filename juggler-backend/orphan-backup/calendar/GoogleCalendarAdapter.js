/**
 * GoogleCalendarAdapter.js
 * CalendarPort implementation for Google Calendar.
 *
 * Refactored from: lib/gcal-api.js + lib/cal-adapters/gcal.adapter.js
 */

const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');
const { computeEventHash } = require('../domain/entities/CalendarEvent');
const { isTerminalStatus } = require('../../../lib/task-status');

// These require statements will be resolved at runtime
// They reference the existing lib modules
let gcalApi, db, calSyncHelpers, localToUtc, PLACEMENT_MODES;

const providerId = 'gcal';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

/**
 * Initialize adapter dependencies
 * @param {Object} deps - Dependencies object
 */
function initialize(deps = {}) {
  gcalApi = deps.gcalApi || require('../../../lib/gcal-api');
  db = deps.db || require('../../../db');
  calSyncHelpers = deps.calSyncHelpers || require('../../../controllers/cal-sync-helpers');
  localToUtc = deps.localToUtc || require('../../../scheduler/dateHelpers').localToUtc;
  PLACEMENT_MODES = deps.PLACEMENT_MODES || require('../../../lib/placementModes').PLACEMENT_MODES;
}

// --- Connection & Token Management ---

function isConnected(user) {
  return !!user.gcal_refresh_token;
}

async function getValidAccessToken(user) {
  if (!user.gcal_refresh_token) {
    throw new Error('Google Calendar not connected');
  }

  if (user.gcal_access_token && user.gcal_token_expiry) {
    const expiryStr = String(user.gcal_token_expiry);
    const expiry = new Date(expiryStr.endsWith('Z') ? expiryStr : expiryStr + 'Z');
    if (expiry.getTime() > Date.now() + 5 * 60 * 1000) {
      return user.gcal_access_token;
    }
  }

  const oauth2Client = gcalApi.createOAuth2Client();
  const credentials = await gcalApi.refreshAccessToken(oauth2Client, user.gcal_refresh_token);

  const update = {
    gcal_access_token: credentials.access_token,
    updated_at: db.fn.now()
  };
  if (credentials.expiry_date) {
    update.gcal_token_expiry = new Date(credentials.expiry_date);
  }

  await db('users').where('id', user.id).update(update);

  return credentials.access_token;
}

// --- Event CRUD Operations ---

async function getEvents(token, startDate, endDate, userId) {
  // Use the low-level API
  const result = await gcalApi.listEvents(token, startDate, endDate);
  const events = (result && result.items) || [];

  // Store sync token for future lightweight checks
  if (result.nextSyncToken && userId) {
    await db('users').where('id', userId).update({ gcal_sync_token: result.nextSyncToken });
  }

  return events
    .filter(e => e.status !== 'cancelled')
    .map(normalizeEvent);
}

async function createEvent(token, event, userId, year, tz, opts) {
  // Build event body from task-like object
  const eventBody = buildEventBody(event, year, tz, opts);
  const created = await gcalApi.insertEvent(token, eventBody);
  return {
    providerEventId: created.id,
    raw: created
  };
}

async function updateEvent(token, eventId, event, userId, year, tz, opts) {
  const eventBody = buildEventBody(event, year, tz, opts);
  return gcalApi.patchEvent(token, eventId, eventBody);
}

async function deleteEvent(token, eventId) {
  return gcalApi.deleteEvent(token, eventId);
}

async function sync(token, user) {
  const syncToken = user.gcal_sync_token;
  if (!syncToken) return { hasChanges: true };

  const result = await gcalApi.checkForChanges(token, syncToken);

  // If no changes but new token, update stored token
  if (!result.hasChanges && result.nextSyncToken && result.nextSyncToken !== syncToken) {
    await db('users').where('id', user.id).update({ gcal_sync_token: result.nextSyncToken });
  }

  return result;
}

// --- Batch Operations (optional) ---

async function batchCreateEvents(token, taskEventPairs, year, tz) {
  const results = [];
  // Process in chunks of 50
  for (let ci = 0; ci < taskEventPairs.length; ci += 50) {
    const chunk = taskEventPairs.slice(ci, ci + 50);
    const requests = chunk.map((pair, i) => {
      const body = buildEventBody(pair.task, year, tz);
      return { id: String(ci + i), method: 'POST', path: '/calendars/primary/events', body };
    });
    const responses = await gcalApi.batchRequest(token, requests);
    for (let ri = 0; ri < responses.length; ri++) {
      const idx = parseInt(responses[ri].id, 10);
      const pair = taskEventPairs[idx];
      if (responses[ri].status >= 200 && responses[ri].status < 300 && responses[ri].body) {
        results.push({ taskId: pair.task.id, providerEventId: responses[ri].body.id, raw: responses[ri].body, error: null });
      } else {
        results.push({ taskId: pair.task.id, providerEventId: null, raw: null, error: 'Batch create failed: HTTP ' + responses[ri].status });
      }
    }
  }
  return results;
}

async function batchDeleteEvents(token, eventIds) {
  const results = [];
  for (let ci = 0; ci < eventIds.length; ci += 50) {
    const chunk = eventIds.slice(ci, ci + 50);
    const requests = chunk.map((evId, i) => ({
      id: String(ci + i),
      method: 'DELETE',
      path: '/calendars/primary/events/' + encodeURIComponent(evId)
    }));
    const responses = await gcalApi.batchRequest(token, requests);
    for (let ri = 0; ri < responses.length; ri++) {
      const idx = parseInt(responses[ri].id, 10);
      const ok = responses[ri].status >= 200 && responses[ri].status < 300 ||
                 responses[ri].status === 404 ||
                 responses[ri].status === 410;
      results.push({ eventId: eventIds[idx], error: ok ? null : 'Batch delete failed: HTTP ' + responses[ri].status });
    }
  }
  return results;
}

async function batchUpdateEvents(token, updatePairs, year, tz) {
  const results = [];
  for (let ci = 0; ci < updatePairs.length; ci += 50) {
    const chunk = updatePairs.slice(ci, ci + 50);
    const requests = chunk.map((pair, i) => {
      const body = buildEventBody(pair.task, year, tz);
      return {
        id: String(ci + i),
        method: 'PATCH',
        path: '/calendars/primary/events/' + encodeURIComponent(pair.eventId),
        body
      };
    });
    const responses = await gcalApi.batchRequest(token, requests);
    for (let ri = 0; ri < responses.length; ri++) {
      const idx = parseInt(responses[ri].id, 10);
      const ok = responses[ri].status >= 200 && responses[ri].status < 300;
      results.push({ eventId: updatePairs[idx].eventId, error: ok ? null : 'Batch update failed: HTTP ' + responses[ri].status });
    }
  }
  return results;
}

// --- Helper Functions ---

function normalizeEvent(event) {
  const startStr = event.start?.dateTime || event.start?.date || '';
  const endStr = event.end?.dateTime || event.end?.date || '';
  const isAllDay = !event.start?.dateTime;
  let dur = 30;
  if (!isAllDay && startStr && endStr) {
    dur = calSyncHelpers.computeDurationMinutes(startStr, endStr);
  }

  return {
    id: event.id,
    title: event.summary || '(No title)',
    description: event.description || '',
    startDateTime: startStr,
    endDateTime: endStr,
    startTimezone: event.start?.timeZone || null,
    isAllDay,
    durationMinutes: dur,
    lastModified: event.updated || null,
    isTransparent: event.transparency === 'transparent',
    eventUrl: event.htmlLink || null,
    _raw: event
  };
}

function eventHash(event) {
  const str = [
    event.title || '',
    event.startDateTime || '',
    event.endDateTime || '',
    event.description || '',
    event.isTransparent ? 'transparent' : 'opaque',
    event.isAllDay ? 'allday' : 'timed'
  ].join('|');
  return crypto.createHash('sha256').update(str).digest('hex');
}

function applyEventToTaskFields(event, tz, currentTask) {
  const isAllDay = event.isAllDay;
  const jd = calSyncHelpers.isoToJugglerDate(event.startDateTime, tz);

  const fields = {
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
    fields.placement_mode = PLACEMENT_MODES.ALL_DAY;
  }

  if (event.isTransparent) {
    fields.placement_mode = PLACEMENT_MODES.REMINDER;
  }

  // Reset to ANYTIME if no longer transparent
  if (!event.isTransparent && currentTask?.placement_mode === PLACEMENT_MODES.REMINDER) {
    fields.placement_mode = PLACEMENT_MODES.ANYTIME;
  }

  // Set FIXED if date/time changed
  if (!isAllDay) {
    const dateChanged = jd.date && jd.date !== currentTask?.date;
    const timeChanged = jd.time && jd.time !== currentTask?.time;
    if (dateChanged || timeChanged) {
      fields.placement_mode = PLACEMENT_MODES.FIXED;
    }
  }

  return fields;
}

function getEventIdColumn() {
  return 'gcal_event_id';
}

function getLastSyncedColumn() {
  return 'gcal_last_synced_at';
}

// --- Event Body Builder ---

function buildEventBody(task, year, tz, opts) {
  const startISO = calSyncHelpers.jugglerDateToISO(task.date, task.time, year);
  const dur = task.dur || 30;
  const isAllDay = task.placementMode === PLACEMENT_MODES.ALL_DAY ||
                   task.placement_mode === PLACEMENT_MODES.ALL_DAY;

  const descParts = [];
  if (task.project) descParts.push('Project: ' + task.project);
  if (task.pri) descParts.push('Priority: ' + task.pri);
  if (task.notes) descParts.push('Notes: ' + task.notes);
  if (task.url) descParts.push('Link: ' + task.url);
  descParts.push('', 'Synced from Raike & Sons');

  const isDone = isTerminalStatus(task.status);
  const cleanText = task.text.replace(/^(✓\s+)+/, '');
  const summaryText = isDone ? '✓ ' + cleanText : task.text;

  if (isAllDay) {
    // Handle both ISO and legacy M/D formats
    const isoMatch = (task.date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const mdMatch = !isoMatch && (task.date || '').match(/^(\d{1,2})\/(\d{1,2})$/);
    let y, month, day;
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
    const startDate = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const endObj = new Date(y, month - 1, day + 1);
    const endDate = endObj.getFullYear() + '-' + String(endObj.getMonth() + 1).padStart(2, '0') + '-' + String(endObj.getDate()).padStart(2, '0');

    const body = {
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

  // Timed event — prefer UTC scheduled_at
  const scheduledAt = task.scheduledAt || task._scheduledAtISO;
  if (scheduledAt) {
    const startUtc = new Date(scheduledAt);
    const endUtc = new Date(startUtc.getTime() + dur * 60000);
    const body = {
      summary: summaryText,
      description: descParts.join('\n'),
      start: { dateTime: startUtc.toISOString(), timeZone: 'UTC' },
      end: { dateTime: endUtc.toISOString(), timeZone: 'UTC' }
    };
    if (task.marker || isDone) {
      body.transparency = 'transparent';
    }
    return body;
  }

  // Fallback: build from local date+time
  const startDate = new Date(startISO);
  const endDate = new Date(startDate.getTime() + dur * 60000);
  const endISO = endDate.getFullYear() + '-' +
    String(endDate.getMonth() + 1).padStart(2, '0') + '-' +
    String(endDate.getDate()).padStart(2, '0') + 'T' +
    String(endDate.getHours()).padStart(2, '0') + ':' +
    String(endDate.getMinutes()).padStart(2, '0') + ':00';

  const body = {
    summary: summaryText,
    description: descParts.join('\n'),
    start: { dateTime: startISO, timeZone: tz },
    end: { dateTime: endISO, timeZone: tz }
  };
  if (task.marker || isDone) {
    body.transparency = 'transparent';
  }
  return body;
}

// --- Module Exports ---

module.exports = {
  providerId,
  initialize,
  isConnected,
  getValidAccessToken,
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  sync,
  batchCreateEvents,
  batchDeleteEvents,
  batchUpdateEvents,
  normalizeEvent,
  eventHash,
  applyEventToTaskFields,
  getEventIdColumn,
  getLastSyncedColumn,
  buildEventBody
};
