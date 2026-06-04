/**
 * AppleCalendarAdapter.js
 * CalendarPort implementation for Apple Calendar (iCloud CalDAV).
 *
 * Refactored from: lib/apple-cal-api.js + lib/cal-adapters/apple.adapter.js
 */

const crypto = require('crypto');

// Dependencies (resolved at runtime)
let appleCalApi, db, calSyncHelpers, localToUtc, PLACEMENT_MODES, decrypt;

const providerId = 'apple';

/**
 * Initialize adapter dependencies
 */
function initialize(deps = {}) {
  appleCalApi = deps.appleCalApi || require('../../../lib/apple-cal-api');
  db = deps.db || require('../../../db');
  calSyncHelpers = deps.calSyncHelpers || require('../../../controllers/cal-sync-helpers');
  localToUtc = deps.localToUtc || require('../../../scheduler/dateHelpers').localToUtc;
  PLACEMENT_MODES = deps.PLACEMENT_MODES || require('../../../lib/placementModes').PLACEMENT_MODES;
  decrypt = deps.decrypt || require('../../../lib/credential-encrypt').decrypt;
}

// --- Connection & Token Management ---

function isConnected(user) {
  return !!user.apple_cal_username && !!user.apple_cal_password && !!user.apple_cal_calendar_url;
}

async function getValidAccessToken(user) {
  if (!user.apple_cal_username || !user.apple_cal_password) {
    throw new Error('Apple Calendar not connected');
  }
  const password = decrypt(user.apple_cal_password);
  const serverUrl = user.apple_cal_server_url || appleCalApi.DEFAULT_SERVER_URL;
  return appleCalApi.createClient(serverUrl, user.apple_cal_username, password);
}

// --- Multi-Calendar Support ---

async function getEnabledCalendars(userId) {
  const calendars = await db('user_calendars')
    .where({ user_id: userId, provider: 'apple', enabled: true });

  if (calendars.length > 0) {
    return calendars;
  }

  // Fallback: legacy single-calendar from users table
  const user = await db('users').where('id', userId).first();
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

async function getWriteCalendar(userId) {
  const calendars = await getEnabledCalendars(userId);
  const fullSync = calendars.filter(c => c.sync_direction === 'full');
  return fullSync.length > 0 ? fullSync[0] : null;
}

// --- Event CRUD Operations ---

async function getEvents(client, startDate, endDate, userId) {
  const calendars = await getEnabledCalendars(userId);
  if (calendars.length === 0) {
    throw new Error('Apple Calendar: no calendars enabled');
  }

  const allEvents = [];
  let hasPartialFailure = false;

  for (const cal of calendars) {
    try {
      const events = await appleCalApi.listEvents(client, cal.calendar_id, startDate, endDate);
      const normalized = events.map(e => {
        const ne = normalizeEvent(e);
        ne.calendarId = cal.calendar_id;
        return ne;
      });
      allEvents.push(...normalized);
    } catch (e) {
      hasPartialFailure = true;
      // Log error but continue with other calendars
    }
  }

  // Update sync tokens
  try {
    const fetchedCalendars = await client.fetchCalendars();
    for (let j = 0; j < calendars.length; j++) {
      const userCal = calendars[j];
      const remoteCal = fetchedCalendars.find(c => c.url === userCal.calendar_id);
      if (remoteCal && (remoteCal.syncToken || remoteCal.ctag)) {
        if (j === 0) {
          await db('users').where('id', userId).update({
            apple_cal_sync_token: remoteCal.syncToken || remoteCal.ctag
          });
        }
      }
    }
  } catch (e) {
    // Ignore sync token update failures
  }

  if (hasPartialFailure) {
    allEvents._hasPartialFailure = true;
  }
  return allEvents;
}

async function createEvent(client, event, userId, year, tz, opts) {
  const writeCal = await getWriteCalendar(userId);
  if (!writeCal) throw new Error('No Apple calendar available for writing');

  const calendarUrl = writeCal.calendar_id;
  const result = await appleCalApi.createEvent(client, calendarUrl, event, year, tz);
  return {
    providerEventId: result.providerEventId,
    calendarId: calendarUrl,
    raw: result
  };
}

async function updateEvent(client, eventId, event, userId, year, tz, opts) {
  await appleCalApi.updateEvent(client, eventId, event, year, tz);
}

async function deleteEvent(client, eventId) {
  await appleCalApi.deleteEvent(client, eventId);
}

async function sync(client, user) {
  const syncToken = user.apple_cal_sync_token;
  if (!syncToken) return { hasChanges: true };

  const calendarUrl = user.apple_cal_calendar_url;
  if (!calendarUrl) return { hasChanges: true };

  const result = await appleCalApi.checkForChanges(client, calendarUrl, syncToken);

  if (!result.hasChanges && result.syncToken && result.syncToken !== syncToken) {
    await db('users').where('id', user.id).update({
      apple_cal_sync_token: result.syncToken
    });
  }

  return result;
}

// --- Batch Operations (Sequential for CalDAV) ---

async function batchCreateEvents(client, taskEventPairs, year, tz) {
  const results = [];
  for (const pair of taskEventPairs) {
    const userId = pair.task.userId || pair.task.user_id;
    try {
      const result = await createEvent(client, pair.task, userId, year, tz);
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

async function batchDeleteEvents(client, eventUrls) {
  const results = [];
  for (const eventUrl of eventUrls) {
    try {
      await deleteEvent(client, eventUrl);
      results.push({ eventId: eventUrl, error: null });
    } catch (e) {
      // Treat 404/410 as success
      if (e.message && (e.message.includes('404') || e.message.includes('410'))) {
        results.push({ eventId: eventUrl, error: null });
      } else {
        results.push({ eventId: eventUrl, error: e.message });
      }
    }
  }
  return results;
}

// --- Helper Functions ---

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

  if (!event.isTransparent && currentTask?.placement_mode === PLACEMENT_MODES.REMINDER) {
    fields.placement_mode = PLACEMENT_MODES.ANYTIME;
  }

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
  return 'apple_event_id';
}

function getLastSyncedColumn() {
  return 'apple_cal_last_synced_at';
}

// --- Module Exports ---

module.exports = {
  providerId,
  initialize,
  isConnected,
  getValidAccessToken,
  getEnabledCalendars,
  getWriteCalendar,
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  sync,
  batchCreateEvents,
  batchDeleteEvents,
  normalizeEvent,
  eventHash,
  applyEventToTaskFields,
  getEventIdColumn,
  getLastSyncedColumn
};
