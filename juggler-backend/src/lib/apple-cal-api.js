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
  var summaryText = isDone ? '\u2713 ' + task.text : task.text;
  vevent.addPropertyWithValue('summary', summaryText);

  // Description with metadata
  var descParts = [];
  if (task.project) descParts.push('Project: ' + task.project);
  if (task.pri) descParts.push('Priority: ' + task.pri);
  if (task.notes) descParts.push('Notes: ' + task.notes);
  descParts.push('', 'Synced from Raike & Sons');
  vevent.addPropertyWithValue('description', descParts.join('\n'));

  var isAllDay = task.when === 'allday';
  var dateParts = (task.date || '').split('/');
  var month = parseInt(dateParts[0], 10);
  var day = parseInt(dateParts[1], 10);
  var y = year || new Date().getFullYear();

  if (isAllDay) {
    var startDate = new ICAL.Time({ year: y, month: month, day: day, isDate: true });
    var endDate = startDate.clone();
    endDate.addDuration(new ICAL.Duration({ days: 1 }));
    vevent.addPropertyWithValue('dtstart', startDate);
    vevent.addPropertyWithValue('dtend', endDate);
  } else {
    // Parse time (e.g. "2:30 PM")
    var timeMatch = (task.time || '12:00 PM').match(/(\d+):(\d+)\s*(AM|PM)/i);
    var hours = 12, mins = 0;
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      var ampm = timeMatch[3].toUpperCase();
      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      mins = parseInt(timeMatch[2], 10);
    }
    var dur = task.dur || 30;

    var startTime = new ICAL.Time({
      year: y, month: month, day: day,
      hour: hours, minute: mins, second: 0,
      isDate: false
    });
    if (tz) {
      try {
        var zone = ICAL.TimezoneService.get(tz);
        if (zone) startTime.zone = zone;
      } catch (e) { /* use floating time */ }
    }

    var endTime = startTime.clone();
    endTime.addDuration(new ICAL.Duration({ minutes: dur }));

    vevent.addPropertyWithValue('dtstart', startTime);
    vevent.addPropertyWithValue('dtend', endTime);
  }

  // Transparency
  if (task.marker || isDone) {
    vevent.addPropertyWithValue('transp', 'TRANSPARENT');
  }

  // Timestamp
  vevent.addPropertyWithValue('dtstamp', ICAL.Time.now());

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

  var result = await client.createCalendarObject({
    calendar: { url: calendarUrl },
    filename: filename,
    iCalString: icsData
  });

  // The result URL is the event's CalDAV URL (used as the event ID)
  var eventUrl = result.url || (calendarUrl + filename);
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

  var headers = {};
  if (etag) headers['If-Match'] = etag;

  await client.updateCalendarObject({
    calendarObject: {
      url: eventUrl,
      data: icsData,
      etag: etag || undefined
    },
    headers: headers
  });
}

/**
 * Delete a calendar event.
 */
async function deleteEvent(client, eventUrl, etag) {
  var headers = {};
  if (etag) headers['If-Match'] = etag;

  await client.deleteCalendarObject({
    calendarObject: { url: eventUrl, etag: etag || undefined },
    headers: headers
  });
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
