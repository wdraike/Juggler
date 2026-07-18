/**
 * Microsoft Calendar adapter for unified sync engine.
 * Implements the provider adapter interface.
 *
 * Hexagonal slice (Wave 2 / W2): relocated verbatim from
 * `src/lib/cal-adapters/msft.adapter.js`. Logic is byte-identical; only the
 * relative require() paths were adjusted for the new directory depth and
 * CalendarPort-named aliases (getEvents=listEvents, sync=hasChanges) were
 * added so this module satisfies CALENDAR_PORT_METHODS. The legacy file at
 * `src/lib/cal-adapters/msft.adapter.js` is now a thin re-export shim of this
 * module (back-compat for controllers + frozen migration until W5).
 */

var { stampInsert, stampUpdate } = require('../../../lib/audit-context'); // 999.1576 inc.3b.3
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
var msftCalApi = require('../../../lib/msft-cal-api');
// 999.1192: pure date transforms come from the slice's own domain module, not
// the HTTP-layer controllers/cal-sync-helpers (which now shims to the same fns).
var { jugglerDateToISO, isoToJugglerDate, computeDurationMinutes } = require('../domain/dateTransforms');
var { localToUtc } = require('../../../scheduler/dateHelpers');
var { PLACEMENT_MODES } = require('../../../lib/placementModes');
var { isTerminalStatus } = require('../../../lib/task-status');
var { loggers } = require('../../../lib/logger');

// Fallback used before any calendar-list discovery has ever succeeded for
// this user (brand-new connection + a transient discovery failure) —
// reproduces the pre-999.1977 default-calendar-only behavior rather than
// fetching nothing. calendar_id 'primary' is a LOCAL sentinel (not a real
// Graph id) that lib/msft-cal-api.js's listEvents recognizes as "use
// /me/calendarView with no /calendars/{id} segment" — mirrors
// GoogleCalendarAdapter.js's PRIMARY_ONLY_CALENDAR (999.1626).
var PRIMARY_ONLY_CALENDAR = [{ id: null, calendar_id: 'primary', display_name: null, sync_direction: 'full', ingest_mode: 'task' }];

var providerId = 'msft';

/**
 * Truncate an ISO datetime string to MySQL-safe precision (6 fractional digits max).
 * Microsoft Graph API returns 7+ digits (e.g. '.4777274Z') which MySQL rejects.
 */
function truncateDateTime(dt) {
  if (!dt) return null;
  return dt.replace(/(\.\d{6})\d+/, '$1');
}

var IANA_TO_WINDOWS = {
  'America/New_York': 'Eastern Standard Time',
  'America/Chicago': 'Central Standard Time',
  'America/Denver': 'Mountain Standard Time',
  'America/Los_Angeles': 'Pacific Standard Time',
  'America/Anchorage': 'Alaskan Standard Time',
  'Pacific/Honolulu': 'Hawaiian Standard Time',
  'America/Phoenix': 'US Mountain Standard Time',
  'America/Indiana/Indianapolis': 'US Eastern Standard Time',
  'America/Toronto': 'Eastern Standard Time',
  'America/Vancouver': 'Pacific Standard Time',
  'America/Winnipeg': 'Central Standard Time',
  'America/Edmonton': 'Mountain Standard Time',
  'America/Halifax': 'Atlantic Standard Time',
  'America/St_Johns': 'Newfoundland Standard Time',
  'Europe/London': 'GMT Standard Time',
  'Europe/Paris': 'Romance Standard Time',
  'Europe/Berlin': 'W. Europe Standard Time',
  'Europe/Amsterdam': 'W. Europe Standard Time',
  'Europe/Brussels': 'Romance Standard Time',
  'Europe/Rome': 'W. Europe Standard Time',
  'Europe/Madrid': 'Romance Standard Time',
  'Europe/Zurich': 'W. Europe Standard Time',
  'Europe/Vienna': 'W. Europe Standard Time',
  'Europe/Stockholm': 'W. Europe Standard Time',
  'Europe/Oslo': 'W. Europe Standard Time',
  'Europe/Copenhagen': 'Romance Standard Time',
  'Europe/Helsinki': 'FLE Standard Time',
  'Europe/Warsaw': 'Central European Standard Time',
  'Europe/Prague': 'Central Europe Standard Time',
  'Europe/Budapest': 'Central Europe Standard Time',
  'Europe/Bucharest': 'GTB Standard Time',
  'Europe/Athens': 'GTB Standard Time',
  'Europe/Istanbul': 'Turkey Standard Time',
  'Europe/Moscow': 'Russian Standard Time',
  'Asia/Jerusalem': 'Israel Standard Time',
  'Asia/Dubai': 'Arabian Standard Time',
  'Asia/Kolkata': 'India Standard Time',
  'Asia/Shanghai': 'China Standard Time',
  'Asia/Tokyo': 'Tokyo Standard Time',
  'Asia/Seoul': 'Korea Standard Time',
  'Asia/Singapore': 'Singapore Standard Time',
  'Asia/Hong_Kong': 'China Standard Time',
  'Australia/Sydney': 'AUS Eastern Standard Time',
  'Australia/Melbourne': 'AUS Eastern Standard Time',
  'Australia/Perth': 'W. Australia Standard Time',
  'Australia/Brisbane': 'E. Australia Standard Time',
  'Pacific/Auckland': 'New Zealand Standard Time',
  'UTC': 'UTC'
};

function ianaToWindows(iana) {
  return IANA_TO_WINDOWS[iana] || iana;
}

function isConnected(user) {
  return !!user.msft_cal_refresh_token;
}

async function getValidAccessToken(user) {
  if (!user.msft_cal_refresh_token) {
    throw new Error('Microsoft Calendar not connected');
  }

  if (user.msft_cal_access_token && user.msft_cal_token_expiry) {
    var expiryStr = String(user.msft_cal_token_expiry);
    var expiry = new Date(expiryStr.endsWith('Z') ? expiryStr : expiryStr + 'Z');
    if (expiry.getTime() > Date.now() + 5 * 60 * 1000) {
      return user.msft_cal_access_token;
    }
  }

  var credentials = await msftCalApi.refreshAccessToken(user.msft_cal_refresh_token);

  var update = {
    msft_cal_access_token: credentials.accessToken,
    updated_at: getDb().fn.now()
  };
  if (credentials.expiresOn) {
    update.msft_cal_token_expiry = new Date(credentials.expiresOn);
  }
  if (credentials.refreshToken) {
    update.msft_cal_refresh_token = credentials.refreshToken;
  }

  await getDb()('users').where('id', user.id).update(stampUpdate(update));

  return credentials.accessToken;
}

/**
 * Get enabled MSFT calendars from user_calendars table, falling back to
 * the default-calendar-only sentinel when no rows exist yet (999.1977 —
 * mirrors GoogleCalendarAdapter.getEnabledCalendars).
 */
async function getEnabledCalendars(userId) {
  // ORDER BY calendar_id: same determinism requirement as GCal (999.1626
  // harrison WARN) — iteration order feeds which calendar "wins" when the
  // SAME event id appears on 2+ calendars (facade.js gatherProviderSyncData's
  // eventsById construction, first-write-wins).
  var calendars = await getDb()('user_calendars')
    .where({ user_id: userId, provider: 'msft', enabled: true })
    .orderBy('calendar_id', 'asc');

  if (calendars.length > 0) {
    return calendars;
  }

  return PRIMARY_ONLY_CALENDAR;
}

/**
 * Discover the user's full Microsoft calendar list and auto-provision any
 * calendar juggler hasn't seen before into user_calendars (provider='msft'),
 * defaulting NEW rows to enabled=true (999.1977 — mirrors
 * GoogleCalendarAdapter.discoverCalendars / David ruling 2026-07-15: opt-out
 * beats opt-in). Existing rows are left untouched — a user's own enabled=false
 * toggle is never overwritten by rediscovery. Best-effort: any failure here
 * degrades to "use whatever is already enabled" rather than blocking the pull.
 */
async function discoverCalendars(token, userId) {
  try {
    var remote = await msftCalApi.listCalendarList(token);
    if (!remote || remote.length === 0) return;

    var existing = await getDb()('user_calendars').where({ user_id: userId, provider: 'msft' });
    var existingIds = {};
    existing.forEach(function(r) { existingIds[r.calendar_id] = true; });

    var toInsert = remote
      .filter(function(c) { return c && c.id && !existingIds[c.id]; })
      .map(function(c) {
        return {
          user_id: userId,
          provider: 'msft',
          calendar_id: c.id,
          display_name: c.name || null,
          enabled: true,
          sync_direction: 'full',
          ingest_mode: 'task'
        };
      });

    if (toInsert.length > 0) {
      await getDb()('user_calendars').insert(toInsert);
    }
  } catch (e) {
    loggers.calAdapterMsft.warn('Calendar discovery failed (non-fatal — pull continues with already-enabled calendars)', {
      userId: userId,
      error: e.message
    });
  }
}

/**
 * Fetch events from EVERY enabled MSFT calendar and normalize to unified
 * shape (999.1977 — was default-calendar-only, same bug 999.1626 fixed for
 * GCal).
 *
 * Unlike GoogleCalendarAdapter.listEvents, this does NOT attempt to persist
 * any sync-token/delta-link here: lib/msft-cal-api.js's listEvents hits
 * /me/calendarView (or /me/calendars/{id}/calendarView), which returns no
 * @odata.deltaLink — only the dedicated .../events/delta endpoint does, and
 * this adapter's pull path does not call it. There is therefore nothing
 * produced by this call to gate on calendar count the way GCal's
 * nextSyncToken is; the "exactly 1 enabled calendar" gate that matters for
 * MSFT lives entirely in hasChanges() below (msft_cal_delta_link).
 */
async function listEvents(token, timeMin, timeMax, userId) {
  if (userId) {
    await discoverCalendars(token, userId);
  }
  var calendars = userId ? await getEnabledCalendars(userId) : PRIMARY_ONLY_CALENDAR;

  var allEvents = [];
  var hasPartialFailure = false;

  for (var i = 0; i < calendars.length; i++) {
    var cal = calendars[i];
    try {
      var result = await msftCalApi.listEvents(token, timeMin, timeMax, cal.calendar_id);
      var items = (result && result.items) || [];
      var normalized = items
        .filter(function(e) {
          // 999.1012: parity with GoogleCalendarAdapter's declined-self-invite
          // filter. Microsoft Graph exposes the signed-in user's own RSVP directly
          // via event.responseStatus.response ('$select' includes responseStatus,
          // see lib/msft-cal-api.js) — no attendees array scan needed.
          var rs = e && e.responseStatus;
          return !(rs && rs.response === 'declined');
        })
        .map(normalizeEvent)
        .map(function(ne) { ne._calendarId = cal.calendar_id; return ne; });
      allEvents = allEvents.concat(normalized);
    } catch (e) {
      hasPartialFailure = true;
      loggers.calAdapterMsft.error('Error fetching calendar', {
        calendarId: cal.display_name || cal.calendar_id,
        error: e
      });
    }
  }

  if (hasPartialFailure) {
    allEvents._hasPartialFailure = true;
  }
  return allEvents;
}

/**
 * Lightweight check: ask Microsoft if anything changed since the last sync.
 * Uses delta link. Returns { hasChanges, deltaLink }.
 *
 * 999.1977 (mirrors 999.1626 harrison BLOCK fix): with 2+ enabled calendars
 * there is no single delta link that can represent "anything changed on ANY
 * enabled calendar" (see listEvents doc comment above — no delta link is ever
 * captured from the pull path in the first place). Trusting a stale/single
 * delta link here while a secondary/shared calendar is also enabled would let
 * a new event on THAT calendar report hasChanges:false — the frontend poll
 * never fires the real multi-calendar pull, silently deferring the event
 * until the next full-sync trigger. Correctness over call-cost: always report
 * changed so the real pull runs every poll for these users. Users with a
 * single enabled calendar (the common case) keep the cheap check.
 */
async function hasChanges(token, user) {
  var calendars = await getEnabledCalendars(user.id);
  if (calendars.length > 1) {
    return { hasChanges: true };
  }

  var deltaLink = user.msft_cal_delta_link;
  if (!deltaLink) return { hasChanges: true }; // No delta link yet — need full sync

  var result;
  try {
    result = await msftCalApi.checkForChanges(token, deltaLink);
  } catch (err) {
    // 410 = delta token expired; clear it so next sync does full fetch
    if (err.statusCode === 410 || err.status === 410 || (err.message && err.message.includes('syncStateNotFound'))) {
      await getDb()('users').where('id', user.id).update(stampUpdate({ msft_cal_delta_link: null }));
      return { hasChanges: true, tokenInvalid: true };
    }
    throw err;
  }

  if (!result.hasChanges && result.deltaLink && result.deltaLink !== deltaLink) {
    await getDb()('users').where('id', user.id).update(stampUpdate({ msft_cal_delta_link: result.deltaLink }));
  }

  return result;
}

/**
 * Normalize an MSFT Graph event to the unified NormalizedEvent shape.
 */
function normalizeEvent(event) {
  var rawStart = event.start?.dateTime || '';
  var rawEnd = event.end?.dateTime || '';
  // MSFT returns naive datetimes (no Z) with a separate timeZone field.
  // Append Z when timeZone is UTC so downstream Date parsing treats it as UTC,
  // not local machine time (which would introduce a timezone-offset error).
  var startStr = (event.start?.timeZone === 'UTC' && rawStart && !rawStart.endsWith('Z')) ? rawStart + 'Z' : rawStart;
  var endStr = (event.end?.timeZone === 'UTC' && rawEnd && !rawEnd.endsWith('Z')) ? rawEnd + 'Z' : rawEnd;
  var isAllDay = !!event.isAllDay;
  var dur = 30;
  if (!isAllDay && startStr && endStr) {
    dur = computeDurationMinutes(startStr, endStr);
  }

  return {
    id: event.id,
    title: event.subject || '(No title)',
    description: (event.body?.content) || '',
    startDateTime: truncateDateTime(startStr),
    endDateTime: truncateDateTime(endStr),
    startTimezone: event.start?.timeZone || null,
    isAllDay: isAllDay,
    durationMinutes: dur,
    lastModified: truncateDateTime(event.lastModifiedDateTime),
    isTransparent: event.showAs === 'free',
    isCancelled: !!event.isCancelled,
    eventType: event.type || null,
    seriesMasterId: event.seriesMasterId || null,
    eventUrl: event.webLink || null,
    _raw: event
  };
}

/**
 * Create a calendar event from a task. Returns { providerEventId, raw }.
 */
async function createEvent(token, task, year, tz, opts) {
  var eventBody = buildMsftEventBody(task, year, tz, opts);
  var created = await msftCalApi.insertEvent(token, eventBody);
  return {
    providerEventId: created.id,
    raw: created
  };
}

/**
 * Update an existing calendar event.
 */
async function updateEvent(token, eventId, task, year, tz, opts) {
  var eventBody = buildMsftEventBody(task, year, tz, opts);
  return msftCalApi.patchEvent(token, eventId, eventBody);
}

/**
 * Delete a calendar event.
 */
async function deleteEvent(token, eventId) {
  return msftCalApi.deleteEvent(token, eventId);
}

/**
 * Compute DB update fields from a normalized event.
 */
function applyEventToTaskFields(event, tz, currentTask) {
  var isAllDay = event.isAllDay;
  var startStr = event.startDateTime;

  var jd;
  if (isAllDay && startStr) {
    var dateOnly = startStr.split('T')[0];
    jd = isoToJugglerDate(dateOnly, tz);
  } else {
    var eventTz = event.startTimezone || tz;
    if (startStr && !startStr.endsWith('Z') && eventTz) {
      jd = isoToJugglerDate(startStr, eventTz);
    } else {
      jd = isoToJugglerDate(startStr, tz);
    }
  }

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

  // 999.2030: Reset to FIXED (not ANYTIME) if no longer transparent (was REMINDER).
  // A busy synced event must own its time slot — ANYTIME lets other tasks double-book.
  // Must run before the date/time-change FIXED promotion so a same-sync change still wins.
  if (!event.isTransparent && currentTask?.placement_mode === PLACEMENT_MODES.REMINDER) {
    fields.placement_mode = PLACEMENT_MODES.FIXED;
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
  return 'msft_event_id';
}

function getLastSyncedColumn() {
  return 'msft_cal_last_synced_at';
}

// --- Internal helpers ---

function buildMsftEventBody(task, year, tz, _opts) {
  var dur = task.dur || 30;
  // Phase 15: Migrated to placement_mode='all_day' exclusively
  // ponytail: also check legacy when='allday' for test compat
  var isAllDay = task.placementMode === PLACEMENT_MODES.ALL_DAY ||
                 task.placement_mode === PLACEMENT_MODES.ALL_DAY ||
                 task.when === 'allday';

  var descParts = [];
  if (task.project) descParts.push('Project: ' + task.project);
  if (task.pri) descParts.push('Priority: ' + task.pri);
  if (task.notes) descParts.push('Notes: ' + task.notes);
  if (task.url) descParts.push('Link: ' + task.url);
  descParts.push('', 'Synced from Raike & Sons');

  var isDone = isTerminalStatus(task.status);
  var cleanText = task.text.replace(/^(✓\s+)+/, '');
  var subjectText = isDone ? '✓ ' + cleanText : task.text;

  if (isAllDay) {
    // task.date may be ISO YYYY-MM-DD or legacy M/D — handle both to avoid "2026-2026-NaN"
    var isoMatch = (task.date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    var mdMatch = !isoMatch && (task.date || '').match(/^(\d{1,2})\/(\d{1,2})$/);
    var y, month, day;
    if (isoMatch) {
      y = parseInt(isoMatch[1], 10); month = parseInt(isoMatch[2], 10); day = parseInt(isoMatch[3], 10);
    } else if (mdMatch) {
      month = parseInt(mdMatch[1], 10); day = parseInt(mdMatch[2], 10); y = year || new Date().getFullYear();
    } else {
      y = year || new Date().getFullYear(); month = NaN; day = NaN;
    }
    var startDate = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    var endObj = new Date(y, month - 1, day + 1);
    var endDate = endObj.getFullYear() + '-' + String(endObj.getMonth() + 1).padStart(2, '0') + '-' + String(endObj.getDate()).padStart(2, '0');

    var body = {
      subject: subjectText,
      body: { contentType: 'text', content: descParts.join('\n') },
      start: { dateTime: startDate + 'T00:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: endDate + 'T00:00:00.0000000', timeZone: 'UTC' },
      isAllDay: true
    };
    if (task.marker || isDone) {
      body.showAs = 'free';
    }
    return body;
  }

  // Timed event — prefer UTC scheduled_at when available
  var scheduledAt = task.scheduledAt || task._scheduledAtISO;
  if (scheduledAt) {
    var startUtc = new Date(scheduledAt);
    var endUtc = new Date(startUtc.getTime() + dur * 60000);

    var body2 = {
      subject: subjectText,
      body: { contentType: 'text', content: descParts.join('\n') },
      start: { dateTime: startUtc.toISOString().replace('Z', ''), timeZone: 'UTC' },
      end: { dateTime: endUtc.toISOString().replace('Z', ''), timeZone: 'UTC' }
    };
    if (task.marker || isDone) {
      body2.showAs = 'free';
    }
    return body2;
  }

  // Fallback: use local date/time with Windows timezone
  var startISO = jugglerDateToISO(task.date, task.time, year);
  // Use Date math to handle events that span midnight
  var startDate2 = new Date(startISO);
  var endDate2 = new Date(startDate2.getTime() + dur * 60000);
  var endISO = endDate2.getFullYear() + '-' +
    String(endDate2.getMonth() + 1).padStart(2, '0') + '-' +
    String(endDate2.getDate()).padStart(2, '0') + 'T' +
    String(endDate2.getHours()).padStart(2, '0') + ':' +
    String(endDate2.getMinutes()).padStart(2, '0') + ':00';

  var body3 = {
    subject: subjectText,
    body: { contentType: 'text', content: descParts.join('\n') },
    start: { dateTime: startISO, timeZone: ianaToWindows(tz) },
    end: { dateTime: endISO, timeZone: ianaToWindows(tz) }
  };
  if (task.marker || isDone) {
    body3.showAs = 'free';
  }
  return body3;
}

/**
 * Batch create events. Returns array of { taskId, providerEventId, raw, error }.
 * Microsoft Graph batch limit is 20 per call.
 */
async function batchCreateEvents(token, taskEventPairs, year, tz) {
  var results = [];
  for (var ci = 0; ci < taskEventPairs.length; ci += 20) {
    var chunk = taskEventPairs.slice(ci, ci + 20);
    var requests = chunk.map(function(pair, i) {
      var body = buildMsftEventBody(pair.task, year, tz);
      return { id: String(ci + i), method: 'POST', url: '/me/events', body: body };
    });
    var responses = await msftCalApi.batchRequest(token, requests);
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
  for (var ci = 0; ci < eventIds.length; ci += 20) {
    var chunk = eventIds.slice(ci, ci + 20);
    var requests = chunk.map(function(evId, i) {
      return { id: String(ci + i), method: 'DELETE', url: '/me/events/' + encodeURIComponent(evId) };
    });
    var responses = await msftCalApi.batchRequest(token, requests);
    for (var ri = 0; ri < responses.length; ri++) {
      var idx = parseInt(responses[ri].id, 10);
      var ok = responses[ri].status >= 200 && responses[ri].status < 300 || responses[ri].status === 404;
      results.push({ eventId: eventIds[idx], error: ok ? null : 'Batch delete failed: HTTP ' + responses[ri].status });
    }
  }
  return results;
}

/**
 * Batch update events. Returns array of { eventId, error }.
 * Microsoft Graph batch limit is 20 per call.
 */
async function batchUpdateEvents(token, updatePairs, year, tz) {
  var results = [];
  for (var ci = 0; ci < updatePairs.length; ci += 20) {
    var chunk = updatePairs.slice(ci, ci + 20);
    var requests = chunk.map(function(pair, i) {
      var body = buildMsftEventBody(pair.task, year, tz);
      return { id: String(ci + i), method: 'PATCH', url: '/me/events/' + encodeURIComponent(pair.eventId), body: body };
    });
    var responses = await msftCalApi.batchRequest(token, requests);
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
  buildMsftEventBody,
  getEventIdColumn,
  getLastSyncedColumn,
  setDb
};
