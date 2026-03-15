/**
 * Microsoft Calendar adapter for unified sync engine.
 * Implements the provider adapter interface.
 */

var crypto = require('crypto');
var db = require('../../db');
var msftCalApi = require('../msft-cal-api');
var { jugglerDateToISO, isoToJugglerDate, computeDurationMinutes } = require('../../controllers/cal-sync-helpers');
var { localToUtc } = require('../../scheduler/dateHelpers');

var providerId = 'msft';

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
    updated_at: db.fn.now()
  };
  if (credentials.expiresOn) {
    update.msft_cal_token_expiry = new Date(credentials.expiresOn);
  }
  if (credentials.refreshToken) {
    update.msft_cal_refresh_token = credentials.refreshToken;
  }

  await db('users').where('id', user.id).update(update);

  return credentials.accessToken;
}

/**
 * Fetch events from Microsoft Calendar and normalize to unified shape.
 */
async function listEvents(token, timeMin, timeMax) {
  var result = await msftCalApi.listEvents(token, timeMin, timeMax);
  var events = (result && result.items) || [];
  return events.map(normalizeEvent);
}

/**
 * Normalize an MSFT Graph event to the unified NormalizedEvent shape.
 */
function normalizeEvent(event) {
  var startStr = event.start?.dateTime || '';
  var endStr = event.end?.dateTime || '';
  var isAllDay = !!event.isAllDay;
  var dur = 30;
  if (!isAllDay && startStr && endStr) {
    dur = computeDurationMinutes(startStr, endStr);
  }

  return {
    id: event.id,
    title: event.subject || '(No title)',
    description: (event.body?.content) || '',
    startDateTime: startStr,
    endDateTime: endStr,
    startTimezone: event.start?.timeZone || null,
    isAllDay: isAllDay,
    durationMinutes: dur,
    lastModified: event.lastModifiedDateTime || null,
    isTransparent: event.showAs === 'free',
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
function applyEventToTaskFields(event, tz) {
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
  return 'msft_event_id';
}

function getLastSyncedColumn() {
  return 'msft_cal_last_synced_at';
}

// --- Internal helpers ---

function buildMsftEventBody(task, year, tz, opts) {
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
      subject: task.text,
      body: { contentType: 'text', content: descParts.join('\n') },
      start: { dateTime: startDate + 'T00:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: endDate + 'T00:00:00.0000000', timeZone: 'UTC' },
      isAllDay: true
    };
    if (task.marker) {
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
      subject: task.text,
      body: { contentType: 'text', content: descParts.join('\n') },
      start: { dateTime: startUtc.toISOString().replace('Z', ''), timeZone: 'UTC' },
      end: { dateTime: endUtc.toISOString().replace('Z', ''), timeZone: 'UTC' }
    };
    if (task.marker) {
      body2.showAs = 'free';
    }
    return body2;
  }

  // Fallback: use local date/time with Windows timezone
  var startISO = jugglerDateToISO(task.date, task.time, year);
  var sParts = startISO.split('T');
  var tParts = sParts[1].split(':');
  var sMins = parseInt(tParts[0], 10) * 60 + parseInt(tParts[1], 10);
  var eMins = sMins + dur;
  var eH = Math.floor(eMins / 60);
  var eM = eMins % 60;
  var endISO = sParts[0] + 'T' + String(eH).padStart(2, '0') + ':' + String(eM).padStart(2, '0') + ':00';

  var body3 = {
    subject: task.text,
    body: { contentType: 'text', content: descParts.join('\n') },
    start: { dateTime: startISO, timeZone: ianaToWindows(tz) },
    end: { dateTime: endISO, timeZone: ianaToWindows(tz) }
  };
  if (task.marker) {
    body3.showAs = 'free';
  }
  return body3;
}

module.exports = {
  providerId,
  isConnected,
  getValidAccessToken,
  listEvents,
  normalizeEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  applyEventToTaskFields,
  eventHash,
  getEventIdColumn,
  getLastSyncedColumn
};
