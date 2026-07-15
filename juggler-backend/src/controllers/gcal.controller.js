/**
 * Google Calendar Controller — THIN HTTP adapter over the calendar slice facade
 * (999.943).
 *
 * All OAuth flow, status, and auto-sync logic now lives in
 * `src/slices/calendar/facade.js`. This module holds ONLY the HTTP req->args
 * mapping and response/error mapping. ZERO direct DB access.
 */

var facade = require('../slices/calendar/facade');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('gcal.controller');

async function getStatus(req, res) {
  try {
    var result = await facade.getGcalStatus(req.user);
    res.json(result);
  } catch (error) {
    logger.error('GCal status error:', error);
    res.status(500).json({ error: 'Failed to check GCal status' });
  }
}

async function connect(req, res) {
  try {
    var result = await facade.gcalConnect(req.user);
    res.json(result);
  } catch (error) {
    logger.error('GCal connect error:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
}

async function callback(req, res) {
  try {
    var result = await facade.gcalCallback(req.query.code, req.query.state, req.user);
    if (result.redirect) {
      return res.redirect(result.redirect);
    }
    res.status(result.status).send(result.body);
  } catch (error) {
    logger.error('GCal callback error:', error);
    res.status(500).send('Failed to complete Google Calendar authorization');
  }
}

async function disconnect(req, res) {
  try {
    var result = await facade.gcalDisconnect(req.user.id);
    res.json(result);
  } catch (error) {
    logger.error('GCal disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect GCal' });
  }
}

async function setAutoSync(req, res) {
  try {
    var result = await facade.setGcalAutoSync(req.user.id, req.body.enabled);
    res.json(result);
  } catch (error) {
    logger.error('GCal auto-sync error:', error);
    res.status(500).json({ error: 'Failed to update auto-sync setting' });
  }
}

// 999.1626: per-calendar selection (list / toggle / discover) — backend
// counterpart to appleCalController's getCalendars/updateCalendar/refreshCalendars.
async function getCalendars(req, res) {
  try {
    var result = await facade.gcalGetCalendars(req.user.id);
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('GCal get-calendars error:', error);
    res.status(500).json({ error: 'Failed to get calendars' });
  }
}

async function updateCalendar(req, res) {
  try {
    var result = await facade.gcalUpdateCalendar(req.user.id, req.params.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('GCal update-calendar error:', error);
    res.status(500).json({ error: 'Failed to update calendar' });
  }
}

async function refreshCalendars(req, res) {
  try {
    var result = await facade.gcalRefreshCalendars(req.user.id, req.user);
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('GCal refresh-calendars error:', error);
    res.status(500).json({ error: 'Failed to refresh calendars' });
  }
}

module.exports = {
  getStatus,
  connect,
  callback,
  disconnect,
  setAutoSync,
  getCalendars,
  updateCalendar,
  refreshCalendars,
  // Test-only: direct access to markCodeUsed for unit testing without HTTP stack
  _internal: { markCodeUsed: facade.gcalMarkCodeUsed }
};
