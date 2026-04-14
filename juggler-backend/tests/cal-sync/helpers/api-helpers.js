/**
 * Direct API helpers for verifying calendar state in tests.
 * These bypass the adapter layer to independently verify events exist/don't exist.
 */

var { gcalApi, msftCalApi } = require('./test-setup');

/**
 * Get a specific GCal event by ID. Returns null if not found.
 */
async function getGCalEvent(token, eventId) {
  try {
    var url = '/calendars/primary/events/' + encodeURIComponent(eventId);
    var res = await fetch('https://www.googleapis.com/calendar/v3' + url, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    return null;
  }
}

/**
 * Get a specific MSFT event by ID. Returns null if not found.
 */
async function getMSFTEvent(token, eventId) {
  try {
    var url = 'https://graph.microsoft.com/v1.0/me/events/' + encodeURIComponent(eventId);
    var res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) return null;
    return res.json();
  } catch (e) {
    return null;
  }
}

/**
 * List GCal events in a time range. Returns array of events.
 */
async function listGCalEvents(token, timeMin, timeMax) {
  var result = await gcalApi.listEvents(token, timeMin, timeMax);
  return (result && result.items) || [];
}

/**
 * List MSFT events in a time range. Returns array of events.
 */
async function listMSFTEvents(token, timeMin, timeMax) {
  var result = await msftCalApi.listEvents(token, timeMin, timeMax);
  return (result && result.items) || [];
}

/**
 * Wait for event propagation (some APIs have slight delay).
 */
function waitForPropagation(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms || 2000); });
}

module.exports = {
  getGCalEvent,
  getMSFTEvent,
  listGCalEvents,
  listMSFTEvents,
  waitForPropagation
};
