/**
 * MicrosoftCalendarAdapter.js
 * CalendarPort implementation for Microsoft Calendar (Outlook/Exchange).
 *
 * Refactored from: lib/msft-cal-api.js + lib/cal-adapters/msft.adapter.js
 */

const crypto = require('crypto');
const { isTerminalStatus } = require('../../../lib/task-status');

// Dependencies (resolved at runtime)
let msftCalApi, db, calSyncHelpers, localToUtc, PLACEMENT_MODES;

const providerId = 'msft';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

const IANA_TO_WINDOWS = {
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

function truncateDateTime(dt) {
  if (!dt) return null;
  return dt.replace(/(\.\d{6})\d+/, '$1');
}

/**
 * Initialize adapter dependencies
 */
function initialize(deps = {}) {
  msftCalApi = deps.msftCalApi || require('../../../lib/msft-cal-api');
  db = deps.db || require('../../../db');
  calSyncHelpers = deps.calSyncHelpers || require('../../../controllers/cal-sync-helpers');
  localToUtc = deps.localToUtc || require('../../../scheduler/dateHelpers').localToUtc;
  PLACEMENT_MODES = deps.PLACEMENT_MODES || require('../../../lib/placementModes').PLACEMENT_MODES;
}

// --- Connection & Token Management ---

function isConnected(user) {
  return !!user.msft_cal_refresh_token;
}

async function getValidAccessToken(user) {
  if (!user.msft_cal_refresh_token) {
    throw new Error('Microsoft Calendar not connected');
  }

  if (user.msft_cal_access_token && user.msft_cal_token_expiry) {
    const expiryStr = String(user.msft_cal_token_expiry);
    const expiry = new Date(expiryStr.endsWith('Z') ? expiryStr : expiryStr + 'Z');
    if (expiry.getTime() > Date.now() + 5 * 60 * 1000) {
      return user.msft_cal_access_token;
    }
  }

  const credentials = await msftCalApi.refreshAccessToken(user.msft_cal_refresh_token);

  const update = {
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

// --- Event CRUD Operations ---

async function getEvents(token, startDate, endDate, userId) {
  const result = await msftCalApi.listEvents(token, startDate, endDate);
  const events = (result && result.items) || [];
  return events.map(normalizeEvent);
}

async function createEvent(token, event, userId, year, tz, opts) {
  const eventBody = buildMsftEventBody(event, year, tz, opts);
  const created = await msftCalApi.insertEvent(token, eventBody);
  return {
    providerEventId: created.id,
    raw: created
  };
}

async function updateEvent(token, eventId, event, userId, year, tz, opts) {
  const eventBody = buildMsftEventBody(event, year, tz, opts);
  return msftCalApi.patchEvent(token, eventId, eventBody);
}

async function deleteEvent(token, eventId) {
  return msftCalApi.deleteEvent(token, eventId);
}

async function sync(token, user) {
  const deltaLink = user.msft_cal_delta_link;
  if (!deltaLink) return { hasChanges: true };

  let result;
  try {
    result = await msftCalApi.checkForChanges(token, deltaLink);
  } catch (err) {
    // 410 = delta token expired
    if (err.statusCode === 410 || err.status === 410 || (err.message && err.message.includes('syncStateNotFound'))) {
      await db('users').where('id', user.id).update({ msft_cal_delta_link: null });
      return { hasChanges: true, tokenInvalid: true };
    }
    throw err;
  }

  if (!result.hasChanges && result.deltaLink && result.deltaLink !== deltaLink) {
    await db('users').where('id', user.id).update({ msft_cal_delta_link: result.deltaLink });
  }

  return result;
}

// --- Batch Operations ---

async function batchCreateEvents(token, taskEventPairs, year, tz) {
  const results = [];
  for (let ci = 0; ci < taskEventPairs.length; ci += 20) {
    const chunk = taskEventPairs.slice(ci, ci + 20);
    const requests = chunk.map((pair, i) => {
      const body = buildMsftEventBody(pair.task, year, tz);
      return { id: String(ci + i), method: 'POST', url: '/me/events', body };
    });
    const responses = await msftCalApi.batchRequest(token, requests);
    for (const r of responses) {
      const idx = parseInt(r.id, 10);
      const pair = taskEventPairs[idx];
      if (r.status >= 200 && r.status < 300 && r.body) {
        results.push({ taskId: pair.task.id, providerEventId: r.body.id, raw: r.body, error: null });
      } else {
        results.push({ taskId: pair.task.id, providerEventId: null, raw: null, error: 'Batch create failed: HTTP ' + r.status });
      }
    }
  }
  return results;
}

async function batchDeleteEvents(token, eventIds) {
  const results = [];
  for (let ci = 0; ci < eventIds.length; ci += 20) {
    const chunk = eventIds.slice(ci, ci + 20);
    const requests = chunk.map((evId, i) => ({
      id: String(ci + i),
      method: 'DELETE',
      url: '/me/events/' + evId
    }));
    const responses = await msftCalApi.batchRequest(token, requests);
    for (const r of responses) {
      const idx = parseInt(r.id, 10);
      const ok = r.status >= 200 && r.status < 300 || r.status === 404 || r.status === 410;
      results.push({ eventId: eventIds[idx], error: ok ? null : 'Batch delete failed: HTTP ' + r.status });
    }
  }
  return results;
}

async function batchUpdateEvents(token, updatePairs, year, tz) {
  const results = [];
  for (let ci = 0; ci < updatePairs.length; ci += 20) {
    const chunk = updatePairs.slice(ci, ci + 20);
    const requests = chunk.map((pair, i) => {
      const body = buildMsftEventBody(pair.task, year, tz);
      return {
        id: String(ci + i),
        method: 'PATCH',
        url: '/me/events/' + pair.eventId,
        body
      };
    });
    const responses = await msftCalApi.batchRequest(token, requests);
    for (const r of responses) {
      const idx = parseInt(r.id, 10);
      const ok = r.status >= 200 && r.status < 300;
      results.push({ eventId: updatePairs[idx].eventId, error: ok ? null : 'Batch update failed: HTTP ' + r.status });
    }
  }
  return results;
}

// --- Helper Functions ---

function normalizeEvent(event) {
  const rawStart = event.start?.dateTime || '';
  const rawEnd = event.end?.dateTime || '';
  const startStr = (event.start?.timeZone === 'UTC' && rawStart && !rawStart.endsWith('Z')) ? rawStart + 'Z' : rawStart;
  const endStr = (event.end?.timeZone === 'UTC' && rawEnd && !rawEnd.endsWith('Z')) ? rawEnd + 'Z' : rawEnd;
  const isAllDay = !!event.isAllDay;
  let dur = 30;
  if (!isAllDay && startStr && endStr) {
    dur = calSyncHelpers.computeDurationMinutes(startStr, endStr);
  }

  return {
    id: event.id,
    title: event.subject || '(No title)',
    description: event.body?.content || '',
    startDateTime: truncateDateTime(startStr),
    endDateTime: truncateDateTime(endStr),
    startTimezone: event.start?.timeZone || null,
    isAllDay,
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
  const startStr = event.startDateTime;

  let jd;
  if (isAllDay && startStr) {
    const dateOnly = startStr.split('T')[0];
    jd = calSyncHelpers.isoToJugglerDate(dateOnly, tz);
  } else {
    const eventTz = event.startTimezone || tz;
    if (startStr && !startStr.endsWith('Z') && eventTz) {
      jd = calSyncHelpers.isoToJugglerDate(startStr, eventTz);
    } else {
      jd = calSyncHelpers.isoToJugglerDate(startStr, tz);
    }
  }

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
  return 'msft_event_id';
}

function getLastSyncedColumn() {
  return 'msft_cal_last_synced_at';
}

// --- Event Body Builder ---

function buildMsftEventBody(task, year, tz, opts) {
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
  const subjectText = isDone ? '✓ ' + cleanText : task.text;

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
      y = year || new Date().getFullYear();
      month = NaN;
      day = NaN;
    }
    const startDate = y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const endObj = new Date(y, month - 1, day + 1);
    const endDate = endObj.getFullYear() + '-' + String(endObj.getMonth() + 1).padStart(2, '0') + '-' + String(endObj.getDate()).padStart(2, '0');

    const body = {
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

  // Timed event
  const scheduledAt = task.scheduledAt || task._scheduledAtISO;
  if (scheduledAt) {
    const startUtc = new Date(scheduledAt);
    const endUtc = new Date(startUtc.getTime() + dur * 60000);

    const body = {
      subject: subjectText,
      body: { contentType: 'text', content: descParts.join('\n') },
      start: { dateTime: startUtc.toISOString().replace('Z', ''), timeZone: 'UTC' },
      end: { dateTime: endUtc.toISOString().replace('Z', ''), timeZone: 'UTC' }
    };
    if (task.marker || isDone) {
      body.showAs = 'free';
    }
    return body;
  }

  // Fallback: use local date/time
  const startISO = calSyncHelpers.jugglerDateToISO(task.date, task.time, year);
  const startDate = new Date(startISO);
  const endDate = new Date(startDate.getTime() + dur * 60000);
  const endISO = endDate.getFullYear() + '-' +
    String(endDate.getMonth() + 1).padStart(2, '0') + '-' +
    String(endDate.getDate()).padStart(2, '0') + 'T' +
    String(endDate.getHours()).padStart(2, '0') + ':' +
    String(endDate.getMinutes()).padStart(2, '0') + ':00';

  const body = {
    subject: subjectText,
    body: { contentType: 'text', content: descParts.join('\n') },
    start: { dateTime: startISO, timeZone: ianaToWindows(tz) },
    end: { dateTime: endISO, timeZone: ianaToWindows(tz) }
  };
  if (task.marker || isDone) {
    body.showAs = 'free';
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
  buildMsftEventBody,
  ianaToWindows
};
