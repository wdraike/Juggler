/**
 * Google Calendar adapter for unified sync engine.
 * Implements the provider adapter interface.
 *
 * Hexagonal slice (Wave 2 / W2): relocated verbatim from
 * `src/lib/cal-adapters/gcal.adapter.js`. Logic is byte-identical; only the
 * relative require() paths were adjusted for the new directory depth and
 * CalendarPort-named aliases (getEvents=listEvents, sync=hasChanges) were
 * added so this module satisfies CALENDAR_PORT_METHODS. The legacy file at
 * `src/lib/cal-adapters/gcal.adapter.js` is now a thin re-export shim of this
 * module (back-compat for controllers + frozen migration until W5).
 */

var crypto = require('crypto');
// W5 (juggler-hex-h2): route through lib/db's shared singleton (single pool).
// 999.1534: db is lazily resolved and injectable via setDb() for unit tests,
// matching the KnexTaskRepository injection pattern (d.db || singleton).
// Default resolves lib/db's shared singleton (same pool, same behavior);
// setDb(mockDb) overrides before first DB access, avoiding the live singleton.
var _db;
function getDb() {
  if (!_db) _db = require('../../../lib/db').getDefaultDb();
  return _db;
}
function setDb(d) {
  _db = d;
}
var gcalApi = require('../../../lib/gcal-api');
// 999.1192: pure date transforms come from the slice's own domain module, not
// the HTTP-layer controllers/cal-sync-helpers (which now shims to the same fns).
var { jugglerDateToISO, isoToJugglerDate, computeDurationMinutes } = require('../domain/dateTransforms');
var { localToUtc } = require('../../../scheduler/dateHelpers');
var { PLACEMENT_MODES } = require('../../../lib/placementModes');
var { _isAllDayTaskBackend } = require('../../../lib/isAllDayTaskBackend');
var { isTerminalStatus } = require('../../../lib/task-status');
var { loggers } = require('../../../lib/logger');

// Fallback used before any calendarList discovery has ever succeeded for this
// user (brand-new connection + a transient discovery failure) — reproduces
// the pre-999.1626 primary-only behavior rather than fetching nothing.
var PRIMARY_ONLY_CALENDAR = [{ id: null, calendar_id: 'primary', display_name: null, sync_direction: 'full', ingest_mode: 'task' }];

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
    updated_at: getDb().fn.now()
  };
  if (credentials.expiry_date) {
    update.gcal_token_expiry = new Date(credentials.expiry_date);
  }

  // Google may rotate the refresh_token on each refresh when prompt=consent
  // was used during authorization. Persist the new refresh_token if provided
  // so the connection stays alive indefinitely (999.668).
  if (credentials.refresh_token) {
    update.gcal_refresh_token = credentials.refresh_token;
  }

  await getDb()('users').where('id', user.id).update(update);

  return credentials.access_token;
}

/**
 * Get enabled GCal calendars from user_calendars table, falling back to
 * primary-only when no rows exist yet (999.1626 — mirrors
 * AppleCalendarAdapter.getEnabledCalendars).
 */
async function getEnabledCalendars(userId) {
  // ORDER BY calendar_id: 999.1626 harrison WARN — iteration order MUST be
  // deterministic. It feeds (a) which calendar's nextSyncToken gets persisted
  // (see listEvents — only meaningful when length===1, but still), and (b)
  // which calendar "wins" when the SAME event id appears on 2+ calendars
  // (shared/invite copies — event ids are unique per-calendar, NOT globally;
  // see facade.js gatherProviderSyncData's eventsById construction).
  var calendars = await getDb()('user_calendars')
    .where({ user_id: userId, provider: 'gcal', enabled: true })
    .orderBy('calendar_id', 'asc');

  if (calendars.length > 0) {
    return calendars;
  }

  return PRIMARY_ONLY_CALENDAR;
}

/**
 * Discover the user's full Google calendarList and auto-provision any
 * calendar juggler hasn't seen before into user_calendars (provider='gcal'),
 * defaulting NEW rows to enabled=true (999.1626 — David ruling 2026-07-15:
 * opt-out beats opt-in for correctness; a silently-missed secondary/shared
 * calendar was the bug being killed, toggles in Settings handle noise
 * calendars). Existing rows are left untouched — a user's own enabled=false
 * toggle is never overwritten by rediscovery. Best-effort: any failure here
 * degrades to "use whatever is already enabled" rather than blocking the pull.
 */
async function discoverCalendars(token, userId) {
  try {
    var remote = await gcalApi.listCalendarList(token);
    if (!remote || remote.length === 0) return;

    var existing = await getDb()('user_calendars').where({ user_id: userId, provider: 'gcal' });
    var existingIds = {};
    existing.forEach(function(r) { existingIds[r.calendar_id] = true; });

    var toInsert = remote
      .filter(function(c) { return c && c.id && !existingIds[c.id]; })
      .map(function(c) {
        return {
          user_id: userId,
          provider: 'gcal',
          calendar_id: c.id,
          display_name: c.summary || null,
          enabled: true,
          sync_direction: 'full',
          ingest_mode: 'task'
        };
      });

    if (toInsert.length > 0) {
      await getDb()('user_calendars').insert(toInsert);
    }
  } catch (e) {
    loggers.calAdapterGcal.warn('Calendar discovery failed (non-fatal — pull continues with already-enabled calendars)', {
      userId: userId,
      error: e.message
    });
  }
}

/**
 * Fetch events from EVERY enabled GCal calendar and normalize to unified
 * shape (999.1626 — was primary-only). Also saves the nextSyncToken to the
 * user record for future lightweight checks — but ONLY when there is
 * exactly ONE enabled calendar (999.1626 harrison BLOCK/WARN review): a
 * single global gcal_sync_token column cannot represent 2+ calendars'
 * cursors, and hasChanges() below refuses to trust it once more than one
 * calendar is enabled. Storing it in that case would be silently-wrong dead
 * weight (previously sourced from calendars[0] with no deterministic order,
 * so an arbitrary secondary calendar's cursor could clobber primary's).
 */
async function listEvents(token, timeMin, timeMax, userId) {
  if (userId) {
    await discoverCalendars(token, userId);
  }
  var calendars = userId ? await getEnabledCalendars(userId) : PRIMARY_ONLY_CALENDAR;

  var allEvents = [];
  var hasPartialFailure = false;
  var syncTokenToStore = null;

  for (var i = 0; i < calendars.length; i++) {
    var cal = calendars[i];
    try {
      var result = await gcalApi.listEvents(token, timeMin, timeMax, cal.calendar_id);
      var items = (result && result.items) || [];
      var normalized = items
        .filter(function(e) { return e.status !== 'cancelled'; })
        .filter(function(e) {
          // 999.1014: guard against a null/undefined element in attendees (would
          // otherwise throw reading a.self on it).
          var self = Array.isArray(e.attendees) && e.attendees.find(function(a) { return a && a.self === true; });
          return !(self && self.responseStatus === 'declined');
        })
        .map(normalizeEvent)
        .map(function(ne) { ne._calendarId = cal.calendar_id; return ne; });
      allEvents = allEvents.concat(normalized);

      // Store the sync token for future lightweight change detection — ONLY
      // when this is the lone enabled calendar (see doc comment above).
      if (calendars.length === 1 && result && result.nextSyncToken) {
        syncTokenToStore = result.nextSyncToken;
      }
    } catch (e) {
      hasPartialFailure = true;
      loggers.calAdapterGcal.error('Error fetching calendar', {
        calendarId: cal.display_name || cal.calendar_id,
        error: e
      });
    }
  }

  if (syncTokenToStore && userId) {
    await getDb()('users').where('id', userId).update({ gcal_sync_token: syncTokenToStore });
  }

  if (hasPartialFailure) {
    allEvents._hasPartialFailure = true;
  }
  return allEvents;
}

/**
 * Lightweight check: ask Google if anything changed since the last sync.
 * Uses the stored sync token. Returns { hasChanges, nextSyncToken }.
 *
 * 999.1626 harrison BLOCK fix: with 2+ enabled calendars there is no single
 * sync token that can represent "anything changed on ANY enabled calendar"
 * (see listEvents — a token is only ever persisted for the lone-calendar
 * case). Trusting a primary-only check here while a secondary/shared
 * calendar is also enabled would let a new event on THAT calendar report
 * hasChanges:false — the frontend poll (AppLayout.jsx checkAndSync) never
 * fires the real multi-calendar pull, silently deferring the event until
 * the next full-sync trigger (app reload / manual sync). That is exactly
 * the "silent, permanent" miss this ticket exists to kill, merely narrowed
 * from "forever" to "until reload". Correctness over call-cost: always
 * report changed so the real pull runs every poll for these users. Users
 * with a single enabled calendar (the common case) keep the cheap check.
 */
async function hasChanges(token, user) {
  var calendars = await getEnabledCalendars(user.id);
  if (calendars.length > 1) {
    return { hasChanges: true };
  }

  var syncToken = user.gcal_sync_token;
  if (!syncToken) return { hasChanges: true }; // No token yet — need full sync

  var result = await gcalApi.checkForChanges(token, syncToken);

  // If Google returned a new sync token with no changes, save it
  if (!result.hasChanges && result.nextSyncToken && result.nextSyncToken !== syncToken) {
    await getDb()('users').where('id', user.id).update({ gcal_sync_token: result.nextSyncToken });
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
    eventUrl: event.htmlLink || null,
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
 * For new tasks from ingest-only calendars, tasks are created with placement_mode=FIXED
 * by the sync controller. All-day events also carry legacy when='allday' for downstream
 * consumers that haven't migrated to placement_mode yet.
 */
function applyEventToTaskFields(event, tz, currentTask) {
  var isAllDay = event.isAllDay;
  var jd = isoToJugglerDate(event.startDateTime, tz);

  var fields = {
    text: event.title,
    dur: event.durationMinutes,
    updated_at: getDb().fn.now()
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
    // Phase 15: Removed legacy when='allday' tag — all downstream sites now
    // use placement_mode='all_day' exclusively (see ROADMAP 999.011).
  }

  if (event.isTransparent) {
    fields.placement_mode = PLACEMENT_MODES.REMINDER;
  }

  // Reset to ANYTIME if no longer transparent (was REMINDER) — must run before
  // FIXED promotion so a same-sync date/time change still wins.
  if (!event.isTransparent && currentTask?.placement_mode === PLACEMENT_MODES.REMINDER) {
    fields.placement_mode = PLACEMENT_MODES.ANYTIME;
  }

  // Set FIXED only when an already-anchored task's date or time actually changed.
  // A null→value transition (flexible task gaining its first computed anchor) is
  // NOT a promotion trigger — require a prior non-null anchor before comparing.
  if (!isAllDay) {
    var dateChanged = jd.date && currentTask?.date && jd.date !== currentTask.date;
    var timeChanged = jd.time && currentTask?.time && jd.time !== currentTask.time;
    if (dateChanged || timeChanged) {
      fields.placement_mode = PLACEMENT_MODES.FIXED;
    }
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
  return crypto.createHash('sha256').update(str).digest('hex');
}

function getEventIdColumn() {
  return 'gcal_event_id';
}

function getLastSyncedColumn() {
  return 'gcal_last_synced_at';
}

// --- Internal helpers ---

function buildEventBody(task, year, tz, _opts) {
  var startISO = jugglerDateToISO(task.date, task.time, year);
  var dur = task.dur || 30;
  // Phase 15: Migrated to placement_mode='all_day' exclusively
  var isAllDay = task.placementMode === PLACEMENT_MODES.ALL_DAY ||
                 task.placement_mode === PLACEMENT_MODES.ALL_DAY;

  var descParts = [];
  if (task.project) descParts.push('Project: ' + task.project);
  if (task.pri) descParts.push('Priority: ' + task.pri);
  if (task.notes) descParts.push('Notes: ' + task.notes);
  if (task.url) descParts.push('Link: ' + task.url);
  descParts.push('', 'Synced from Raike & Sons');

  var isDone = isTerminalStatus(task.status);
  var cleanText = task.text.replace(/^(✓\s+)+/, '');
  var summaryText = isDone ? '✓ ' + cleanText : task.text;

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

  // Timed event — prefer the UTC scheduled_at as the single source of truth.
  // MSFT and Apple builders both prefer scheduledAt first; aligning GCal here
  // collapses the three-builder fallback chain into a single path so providers
  // can never diverge on event start time. The local task.date+task.time path
  // remains as a fallback for tasks the scheduler has not yet placed (e.g.
  // pinned/fixed tasks pushed before a schedule run).
  var scheduledAt = task.scheduledAt || task._scheduledAtISO;
  if (scheduledAt) {
    var startUtc = new Date(scheduledAt);
    var endUtc = new Date(startUtc.getTime() + dur * 60000);
    var body2 = {
      summary: summaryText,
      description: descParts.join('\n'),
      start: { dateTime: startUtc.toISOString(), timeZone: 'UTC' },
      end: { dateTime: endUtc.toISOString(), timeZone: 'UTC' }
    };
    if (task.marker || isDone) {
      body2.transparency = 'transparent';
    }
    return body2;
  }

  // Fallback: build from local date+time when scheduled_at is missing.
  var startDate2 = new Date(startISO);
  var endDate2 = new Date(startDate2.getTime() + dur * 60000);
  var endISO = endDate2.getFullYear() + '-' +
    String(endDate2.getMonth() + 1).padStart(2, '0') + '-' +
    String(endDate2.getDate()).padStart(2, '0') + 'T' +
    String(endDate2.getHours()).padStart(2, '0') + ':' +
    String(endDate2.getMinutes()).padStart(2, '0') + ':00';

  var body3 = {
    summary: summaryText,
    description: descParts.join('\n'),
    start: { dateTime: startISO, timeZone: tz },
    end: { dateTime: endISO, timeZone: tz }
  };
  if (task.marker || isDone) {
    body3.transparency = 'transparent';
  }
  return body3;
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

// --- CalendarPort conformance aliases (W2) ---
// The port (README/CalendarPort.js) names these `getEvents`/`sync`; the legacy
// implementation names them `listEvents`/`hasChanges`. Expose both so this
// module satisfies CALENDAR_PORT_METHODS while every legacy caller still
// resolves. These are thin aliases — zero logic change.
var getEvents = listEvents;
var sync = hasChanges;

module.exports = {
  providerId,
  isConnected,
  getValidAccessToken,
  getEnabledCalendars,
  discoverCalendars,
  listEvents,
  hasChanges,
  getEvents,
  sync,
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
  getLastSyncedColumn,
  setDb
};
