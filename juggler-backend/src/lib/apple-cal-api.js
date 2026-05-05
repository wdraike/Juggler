/**
 * apple-cal-api.js — Low-level CalDAV wrapper for Apple Calendar (iCloud).
 *
 * Uses tsdav for CalDAV protocol operations and ical.js for VEVENT
 * parsing/building. Apple Calendar uses basic auth with an app-specific
 * password over HTTPS to caldav.icloud.com.
 */

var { createDAVClient, DAVNamespace } = require('tsdav');
var ICAL = require('ical.js');

var DEFAULT_SERVER_URL = 'https://caldav.icloud.com';

/**
 * Create a tsdav DAV client with basic auth for iCloud.
 */
async function createClient(serverUrl, username, password) {
  var client = await createDAVClient({
    serverUrl: serverUrl || DEFAULT_SERVER_URL,
    credentials: { username: username, password: password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav'
  });
  return client;
}

/**
 * Discover available calendars for the authenticated user.
 * Filters to only VEVENT-capable calendars (excludes Reminders/VTODO lists).
 * Returns: [{ url, displayName, ctag, description }]
 */
async function discoverCalendars(client) {
  var calendars = await client.fetchCalendars();
  return calendars
    .filter(function(cal) {
      // tsdav returns a components array like ['VEVENT'] or ['VTODO']
      // Only include calendars that support events
      if (cal.components && Array.isArray(cal.components)) {
        return cal.components.indexOf('VEVENT') >= 0;
      }
      // If no components info, include it (safer default)
      return true;
    })
    .map(function(cal) {
      return {
        url: cal.url,
        displayName: cal.displayName || 'Unnamed Calendar',
        ctag: cal.ctag || null,
        description: cal.description || '',
        syncToken: cal.syncToken || null
      };
    });
}

/**
 * Fetch calendar events in a date range.
 * Returns an array of parsed event objects.
 */
async function listEvents(client, calendarUrl, timeMin, timeMax) {
  var objects = await client.fetchCalendarObjects({
    calendar: { url: calendarUrl },
    timeRange: { start: timeMin, end: timeMax },
    expand: true
  });

  var events = [];
  for (var i = 0; i < objects.length; i++) {
    var obj = objects[i];
    if (!obj.data) continue;
    try {
      var parsed = parseVEvents(obj.data, obj.url, obj.etag);
      events = events.concat(parsed);
    } catch (e) {
      console.error('[APPLE-CAL] Failed to parse VEVENT:', e.message);
    }
  }
  return events;
}

/**
 * Parse iCalendar data (ICS string) into normalized event objects.
 * A single ICS may contain multiple VEVENTs (recurring expansions).
 */
function parseVEvents(icsData, url, etag) {
  var jcalData = ICAL.parse(icsData);
  var comp = new ICAL.Component(jcalData);
  var vevents = comp.getAllSubcomponents('vevent');
  var results = [];

  for (var i = 0; i < vevents.length; i++) {
    var vevent = vevents[i];
    var event = new ICAL.Event(vevent);

    var uid = event.uid || '';
    var summary = event.summary || '(No title)';
    var description = event.description || '';

    var dtstart = vevent.getFirstPropertyValue('dtstart');
    var dtend = vevent.getFirstPropertyValue('dtend');
    var duration = vevent.getFirstPropertyValue('duration');

    var isAllDay = false;
    var startStr = '';
    var endStr = '';
    var durationMinutes = 30;

    if (dtstart) {
      isAllDay = dtstart.isDate;
      if (isAllDay) {
        startStr = formatICALDate(dtstart);
        if (dtend) {
          endStr = formatICALDate(dtend);
        } else {
          // Default: 1-day event
          var nextDay = dtstart.clone();
          nextDay.addDuration(new ICAL.Duration({ days: 1 }));
          endStr = formatICALDate(nextDay);
        }
      } else {
        startStr = formatICALDateTime(dtstart);
        if (dtend) {
          endStr = formatICALDateTime(dtend);
          durationMinutes = Math.round((dtend.toUnixTime() - dtstart.toUnixTime()) / 60);
        } else if (duration) {
          durationMinutes = Math.round(duration.toSeconds() / 60);
          var endTime = dtstart.clone();
          endTime.addDuration(duration);
          endStr = formatICALDateTime(endTime);
        }
      }
    }

    // Detect transparency (free/busy)
    var transp = vevent.getFirstPropertyValue('transp');
    var isTransparent = transp && transp.toUpperCase() === 'TRANSPARENT';

    var lastModified = vevent.getFirstPropertyValue('last-modified');
    var lastModStr = lastModified ? formatICALDateTime(lastModified) : null;

    results.push({
      id: uid,
      title: summary,
      description: description,
      startDateTime: startStr,
      endDateTime: endStr,
      startTimezone: dtstart && dtstart.zone ? dtstart.zone.tzid : null,
      isAllDay: isAllDay,
      durationMinutes: durationMinutes > 0 ? durationMinutes : 30,
      lastModified: lastModStr,
      isTransparent: !!isTransparent,
      _url: url || null,
      _etag: etag || null,
      _raw: icsData
    });
  }

  return results;
}

/**
 * Build a UTC ICAL.Time from a JS Date or MySQL datetime string.
 * MySQL datetime strings lack a timezone indicator — always interpret as UTC.
 */
function toUtcICALTime(input) {
  var d;
  if (input instanceof Date) {
    d = input;
  } else {
    // MySQL "YYYY-MM-DD HH:MM:SS" — append Z so Date() parses as UTC
    var s = String(input);
    if (!s.includes('Z') && !s.includes('+') && s.includes(' ')) {
      s = s.replace(' ', 'T') + 'Z';
    }
    d = new Date(s);
  }
  return new ICAL.Time({
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
    isDate: false
  }, ICAL.Timezone.utcTimezone);
}

/**
 * Build an iCalendar (ICS) string from a task.
 */
function buildVEvent(task, year, tz) {
  var cal = new ICAL.Component(['vcalendar', [], []]);
  cal.addPropertyWithValue('prodid', '-//Raike & Sons//Juggler//EN');
  cal.addPropertyWithValue('version', '2.0');

  var vevent = new ICAL.Component('vevent');
  var uid = 'juggler-' + task.id + '@raikeandsons.com';
  vevent.addPropertyWithValue('uid', uid);

  var isDone = task.status === 'done';
  var summaryText = isDone ? '✓ ' + task.text : task.text;
  vevent.addPropertyWithValue('summary', summaryText);

  // Description with metadata
  var descParts = [];
  if (task.project) descParts.push('Project: ' + task.project);
  if (task.pri) descParts.push('Priority: ' + task.pri);
  if (task.notes) descParts.push('Notes: ' + task.notes);
  if (task.url) descParts.push('Link: ' + task.url);
  descParts.push('', 'Synced from Raike & Sons');
  vevent.addPropertyWithValue('description', descParts.join('\n'));

  var isAllDay = task.when === 'allday';

  // Parse date — handle both YYYY-MM-DD (from utcToLocal) and legacy M/D format
  var dateStr = task.date || '';
  var y, month, day;
  var isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    y = parseInt(isoMatch[1], 10);
    month = parseInt(isoMatch[2], 10);
    day = parseInt(isoMatch[3], 10);
  } else {
    var dateParts = dateStr.split('/');
    month = parseInt(dateParts[0], 10) || 1;
    day = parseInt(dateParts[1], 10) || 1;
    y = year || new Date().getFullYear();
  }

  if (isAllDay) {
    var startDate = new ICAL.Time({ year: y, month: month, day: day, isDate: true });
    var endDate = startDate.clone();
    endDate.addDuration(new ICAL.Duration({ days: 1 }));
    vevent.addPropertyWithValue('dtstart', startDate);
    vevent.addPropertyWithValue('dtend', endDate);
  } else {
    var startTime, endTime;

    // Use _scheduled_at (UTC) when available — avoids floating-time issues from missing VTIMEZONE.
    // Fall back to constructing from date+time fields, also emitted as UTC.
    if (task._scheduled_at) {
      // toUtcICALTime handles MySQL "YYYY-MM-DD HH:MM:SS" strings (no timezone indicator)
      // by appending Z before parsing, ensuring getUTC* methods return the correct UTC values.
      startTime = toUtcICALTime(task._scheduled_at);
    } else {
      var timeMatch = (task.time || '12:00 PM').match(/(\d+):(\d+)\s*(AM|PM)/i);
      var hours = 12, mins = 0;
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        var ampm = timeMatch[3].toUpperCase();
        if (ampm === 'PM' && hours !== 12) hours += 12;
        if (ampm === 'AM' && hours === 12) hours = 0;
        mins = parseInt(timeMatch[2], 10);
      }
      startTime = new ICAL.Time({
        year: y, month: month, day: day,
        hour: hours, minute: mins, second: 0,
        isDate: false
      }, ICAL.Timezone.utcTimezone);
    }

    var dur = task.dur || 30;
    endTime = startTime.clone();
    endTime.addDuration(new ICAL.Duration({ minutes: dur }));

    vevent.addPropertyWithValue('dtstart', startTime);
    vevent.addPropertyWithValue('dtend', endTime);
  }

  // Transparency
  if (task.marker || isDone) {
    vevent.addPropertyWithValue('transp', 'TRANSPARENT');
  }

  // DTSTAMP — RFC 5545 requires UTC (Z suffix). ICAL.Time.now() returns floating
  // local time which violates the spec and causes Apple Calendar to silently
  // discard the event. Use toUtcICALTime(new Date()) for a proper UTC timestamp.
  vevent.addPropertyWithValue('dtstamp', toUtcICALTime(new Date()));

  cal.addSubcomponent(vevent);
  return cal.toString();
}

/**
 * Create a calendar event.
 * Returns { providerEventId, etag, url }
 */
async function createEvent(client, calendarUrl, task, year, tz) {
  var icsData = buildVEvent(task, year, tz);
  var filename = 'juggler-' + task.id + '.ics';
  var baseUrl = calendarUrl.endsWith('/') ? calendarUrl : calendarUrl + '/';
  var expectedUrl = baseUrl + filename;

  var result = await client.createCalendarObject({
    calendar: { url: calendarUrl },
    filename: filename,
    iCalString: icsData
  });

  if (result && result.status === 412) {
    // Event already exists at this URL (stale ledger) — fetch current ETag and overwrite
    var currentEtag = null;
    try {
      var existing = await client.fetchCalendarObjects({
        calendar: { url: calendarUrl },
        objectUrls: [expectedUrl]
      });
      if (existing && existing[0] && existing[0].etag) {
        currentEtag = existing[0].etag;
      }
    } catch (fetchErr) {
      // proceed without ETag — server may accept unconditional overwrite
    }
    var updateResponse = await client.updateCalendarObject({
      calendarObject: { url: expectedUrl, data: icsData, etag: currentEtag || undefined }
    });
    if (updateResponse && updateResponse.status >= 300) {
      var upErr = new Error('CalDAV PUT failed: HTTP ' + updateResponse.status);
      upErr.statusCode = updateResponse.status;
      throw upErr;
    }
    return { providerEventId: expectedUrl, etag: currentEtag, url: expectedUrl };
  }

  if (result && result.status >= 300) {
    var err = new Error('CalDAV PUT failed: HTTP ' + result.status);
    err.statusCode = result.status;
    throw err;
  }

  var eventUrl = result.url || expectedUrl;
  return {
    providerEventId: eventUrl,
    etag: result.etag || null,
    url: eventUrl
  };
}

/**
 * Update an existing calendar event.
 */
async function updateEvent(client, eventUrl, task, year, tz, etag) {
  var icsData = buildVEvent(task, year, tz);

  var response = await client.updateCalendarObject({
    calendarObject: {
      url: eventUrl,
      data: icsData,
      etag: etag || undefined
    }
  });

  if (response && response.status === 412) {
    // Stale ETag — fetch current ETag from server and retry once
    var calUrl = eventUrl.substring(0, eventUrl.lastIndexOf('/') + 1);
    var freshEtag = null;
    try {
      var existing = await client.fetchCalendarObjects({
        calendar: { url: calUrl },
        objectUrls: [eventUrl]
      });
      if (existing && existing[0] && existing[0].etag) {
        freshEtag = existing[0].etag;
      }
    } catch (fetchErr) {
      // proceed without ETag
    }
    var retryResponse = await client.updateCalendarObject({
      calendarObject: { url: eventUrl, data: icsData, etag: freshEtag || undefined }
    });
    if (retryResponse && retryResponse.status >= 300 && retryResponse.status !== 404 && retryResponse.status !== 410) {
      var retryErr = new Error('CalDAV PUT failed: HTTP ' + retryResponse.status);
      retryErr.statusCode = retryResponse.status;
      throw retryErr;
    }
    return;
  }

  if (response && response.status >= 300 && response.status !== 404 && response.status !== 410) {
    var err = new Error('CalDAV PUT failed: HTTP ' + response.status);
    err.statusCode = response.status;
    throw err;
  }
}

/**
 * Delete a calendar event.
 * tsdav returns the HTTP Response without throwing on non-2xx — check it.
 */
async function deleteEvent(client, eventUrl, etag) {
  var response = await client.deleteCalendarObject({
    calendarObject: { url: eventUrl, etag: etag || undefined }
  });

  if (response && response.status >= 300 && response.status !== 404 && response.status !== 410) {
    var err = new Error('CalDAV DELETE failed: HTTP ' + response.status);
    err.statusCode = response.status;
    throw err;
  }
}

/**
 * Check for changes using sync-token or ctag comparison.
 * Returns { hasChanges, syncToken }
 */
async function checkForChanges(client, calendarUrl, storedSyncToken) {
  if (!storedSyncToken) return { hasChanges: true };

  try {
    var calendars = await client.fetchCalendars();
    var cal = calendars.find(function(c) { return c.url === calendarUrl; });
    if (!cal) return { hasChanges: true };

    var currentToken = cal.syncToken || cal.ctag || '';
    if (currentToken !== storedSyncToken) {
      return { hasChanges: true, syncToken: currentToken };
    }
    return { hasChanges: false, syncToken: currentToken };
  } catch (e) {
    // If check fails, assume changes
    return { hasChanges: true };
  }
}

// ── Internal helpers ─────────────────────────────────────────────

function formatICALDate(icalTime) {
  return icalTime.year + '-' +
    String(icalTime.month).padStart(2, '0') + '-' +
    String(icalTime.day).padStart(2, '0');
}

function formatICALDateTime(icalTime) {
  return icalTime.year + '-' +
    String(icalTime.month).padStart(2, '0') + '-' +
    String(icalTime.day).padStart(2, '0') + 'T' +
    String(icalTime.hour).padStart(2, '0') + ':' +
    String(icalTime.minute).padStart(2, '0') + ':' +
    String(icalTime.second || 0).padStart(2, '0');
}

module.exports = {
  DEFAULT_SERVER_URL,
  createClient,
  discoverCalendars,
  listEvents,
  parseVEvents,
  buildVEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  checkForChanges
};
