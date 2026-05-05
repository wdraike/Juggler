/**
 * Apple Calendar (iCloud CalDAV) adapter for unified sync engine.
 * Implements the provider adapter interface.
 *
 * Uses CalDAV protocol via tsdav with basic auth (app-specific password).
 * Credentials are stored encrypted in the users table.
 * Supports multi-calendar: reads enabled calendars from user_calendars table.
 */

var crypto = require('crypto');
var db = require('../../db');
var appleCalApi = require('../apple-cal-api');
var { decrypt } = require('../credential-encrypt');
var { jugglerDateToISO, isoToJugglerDate, computeDurationMinutes } = require('../../controllers/cal-sync-helpers');
var { localToUtc } = require('../../scheduler/dateHelpers');
var { PLACEMENT_MODES } = require('../placementModes');

var providerId = 'apple';

function isConnected(user) {
  return !!user.apple_cal_username && !!user.apple_cal_password && !!user.apple_cal_calendar_url;
}

/**
 * Get credentials for CalDAV. Unlike OAuth providers, CalDAV uses basic auth
 * so there's no token refresh — we decrypt the stored password each time.
 * Returns a tsdav DAV client (ready to use).
 */
async function getValidAccessToken(user) {
  if (!user.apple_cal_username || !user.apple_cal_password) {
    throw new Error('Apple Calendar not connected');
  }
  var password = decrypt(user.apple_cal_password);
  var serverUrl = user.apple_cal_server_url || appleCalApi.DEFAULT_SERVER_URL;
  return appleCalApi.createClient(serverUrl, user.apple_cal_username, password);
}

/**
 * Get enabled calendars from user_calendars table, falling back to legacy single URL.
 */
async function getEnabledCalendars(userId) {
  var calendars = await db('user_calendars')
    .where({ user_id: userId, provider: 'apple', enabled: true });

  if (calendars.length > 0) {
    return calendars;
  }

  // Fallback: legacy single-calendar from users table
  var user = await db('users').where('id', userId).first();
  if (user && user.apple_cal_calendar_url) {
    return [{
      id: null,
      calendar_id: user.apple_cal_calendar_url,
      display_name: null,
      sync_direction: 'full',
      ingest_mode: 'task'
    }];
  }

  return [];
}

/**
 * Get the default write calendar (first enabled full-sync calendar).
 */
async function getWriteCalendar(userId) {
  var calendars = await getEnabledCalendars(userId);
  // Prefer full-sync calendars for writing
  var fullSync = calendars.filter(function(c) { return c.sync_direction === 'full'; });
  return fullSync.length > 0 ? fullSync[0] : null;
}

/**
 * Fetch events from all enabled Apple Calendars and normalize to unified shape.
 */
async function listEvents(client, timeMin, timeMax, userId) {
  var calendars = await getEnabledCalendars(userId);
  if (calendars.length === 0) {
    throw new Error('Apple Calendar: no calendars enabled');
  }

  var allEvents = [];
  var hasPartialFailure = false;
  for (var i = 0; i < calendars.length; i++) {
    var cal = calendars[i];
    try {
      var events = await appleCalApi.listEvents(client, cal.calendar_id, timeMin, timeMax);
      var normalized = events.map(function(e) {
        var ne = normalizeEvent(e);
        ne._calendarId = cal.calendar_id;
        return ne;
      });
      allEvents = allEvents.concat(normalized);
    } catch (e) {
      hasPartialFailure = true;
      console.error('[APPLE-ADAPTER] Error fetching calendar ' + (cal.display_name || cal.calendar_id) + ':', e.message);
    }
  }

  // Update sync tokens for all calendars
  try {
    var fetchedCalendars = await client.fetchCalendars();
    for (var j = 0; j < calendars.length; j++) {
      var userCal = calendars[j];
      var remoteCal = fetchedCalendars.find(function(c) { return c.url === userCal.calendar_id; });
      if (remoteCal && (remoteCal.syncToken || remoteCal.ctag)) {
        // Store sync token per calendar — use the first one for legacy compat
        if (j === 0) {
          await db('users').where('id', userId).update({
            apple_cal_sync_token: remoteCal.syncToken || remoteCal.ctag
          });
        }
      }
    }
  } catch (e) {
    console.error('[APPLE-ADAPTER] sync token update failed:', e.message);
  }

  if (hasPartialFailure) {
    allEvents._hasPartialFailure = true;
  }
  return allEvents;
}

/**
 * Lightweight check: has anything changed since last sync?
 */
async function hasChanges(client, user) {
  var syncToken = user.apple_cal_sync_token;
  if (!syncToken) return { hasChanges: true };

  // Check the primary calendar (legacy field) for changes
  var calendarUrl = user.apple_cal_calendar_url;
  if (!calendarUrl) return { hasChanges: true };

  var result = await appleCalApi.checkForChanges(
    client, calendarUrl, syncToken
  );

  if (!result.hasChanges && result.syncToken && result.syncToken !== syncToken) {
    await db('users').where('id', user.id).update({
      apple_cal_sync_token: result.syncToken
    });
  }

  return result;
}

/**
 * Normalize a parsed CalDAV event to the unified NormalizedEvent shape.
 * The events from apple-cal-api.js are already partially normalized;
 * this ensures full compatibility with the sync engine.
 */
function normalizeEvent(event) {
  return {
    id: event.id || event._url || '',
    title: event.title || '(No title)',
    description: event.description || '',
    startDateTime: event.startDateTime || '',
    endDateTime: event.endDateTime || '',
    startTimezone: event.startTimezone || null,
    isAllDay: !!event.isAllDay,
    durationMinutes: event.durationMinutes || 30,
    lastModified: event.lastModified || null,
    isTransparent: !!event.isTransparent,
    _url: event._url || null,
    _etag: event._etag || null,
    _raw: event._raw || null
  };
}

/**
 * Create a calendar event from a task.
 * Writes to the default write calendar (first enabled full-sync calendar).
 */
async function createEvent(client, task, year, tz) {
  var userId = task.userId || task.user_id;
  var writeCal = await getWriteCalendar(userId);
  if (!writeCal) throw new Error('No Apple calendar available for writing (all ingest-only?)');

  var calendarUrl = writeCal.calendar_id;
  var result = await appleCalApi.createEvent(client, calendarUrl, task, year, tz);
  return {
    providerEventId: result.providerEventId,
    calendarId: calendarUrl,
    raw: result
  };
}

/**
 * Update an existing calendar event.
 */
async function updateEvent(client, eventUrl, task, year, tz) {
  await appleCalApi.updateEvent(client, eventUrl, task, year, tz);
}

/**
 * Delete a calendar event.
 */
async function deleteEvent(client, eventUrl) {
  await appleCalApi.deleteEvent(client, eventUrl);
}

/**
 * Compute DB update fields from a normalized event.
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
  return 'apple_event_id';
}

function getLastSyncedColumn() {
  return 'apple_cal_last_synced_at';
}

/**
 * Batch create events. CalDAV has no batch API, so we do sequential creates.
 */
async function batchCreateEvents(client, taskEventPairs, year, tz) {
  var results = [];
  for (var i = 0; i < taskEventPairs.length; i++) {
    var pair = taskEventPairs[i];
    try {
      var result = await createEvent(client, pair.task, year, tz);
      results.push({
        taskId: pair.task.id,
        providerEventId: result.providerEventId,
        raw: result.raw,
        error: null
      });
    } catch (e) {
      results.push({
        taskId: pair.task.id,
        providerEventId: null,
        raw: null,
        error: e.message
      });
    }
  }
  return results;
}

/**
 * Batch delete events. Sequential deletes (no CalDAV batch API).
 */
async function batchDeleteEvents(client, eventUrls) {
  var results = [];
  for (var i = 0; i < eventUrls.length; i++) {
    try {
      await deleteEvent(client, eventUrls[i]);
      results.push({ eventId: eventUrls[i], error: null });
    } catch (e) {
      // Treat 404/410 as success (event already gone)
      if (e.message && (e.message.includes('404') || e.message.includes('410'))) {
        results.push({ eventId: eventUrls[i], error: null });
      } else {
        results.push({ eventId: eventUrls[i], error: e.message });
      }
    }
  }
  return results;
}

module.exports = {
  providerId,
  isConnected,
  getValidAccessToken,
  getEnabledCalendars,
  getWriteCalendar,
  listEvents,
  hasChanges,
  normalizeEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  batchCreateEvents,
  batchDeleteEvents,
  applyEventToTaskFields,
  eventHash,
  getEventIdColumn,
  getLastSyncedColumn
};
