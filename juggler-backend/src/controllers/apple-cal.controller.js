/**
 * Apple Calendar Controller — THIN HTTP adapter over the calendar slice facade
 * (999.943).
 *
 * All CalDAV connection, status, and management logic now lives in
 * `src/slices/calendar/facade.js`. This module holds ONLY the HTTP req->args
 * mapping and response/error mapping. ZERO direct DB access.
 */

var facade = require('../slices/calendar/facade');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('apple-cal.controller');

async function getStatus(req, res) {
  try {
    var result = await facade.appleGetStatus(req.user);
    res.json(result);
  } catch (error) {
    logger.error('Apple Calendar status error:', error);
    res.status(500).json({ error: 'Failed to get Apple Calendar status' });
  }
}

async function connect(req, res) {
  try {
    var result = await facade.appleConnect(req.user.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Apple Calendar connect error:', error);
    res.status(500).json({ error: 'Failed to connect Apple Calendar' });
  }
}

async function selectCalendar(req, res) {
  try {
    var result = await facade.appleSelectCalendar(req.user.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Apple Calendar select error:', error);
    res.status(500).json({ error: 'Failed to select calendar' });
  }
}

async function selectCalendars(req, res) {
  try {
    var result = await facade.appleSelectCalendars(req.user.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Apple Calendar select-calendars error:', error);
    res.status(500).json({ error: 'Failed to save calendar selections' });
  }
}

async function getCalendars(req, res) {
  try {
    var result = await facade.appleGetCalendars(req.user.id);
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Apple Calendar get-calendars error:', error);
    res.status(500).json({ error: 'Failed to get calendars' });
  }
}

async function updateCalendar(req, res) {
  try {
    var result = await facade.appleUpdateCalendar(req.user.id, req.params.id, req.body);
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Apple Calendar update-calendar error:', error);
    res.status(500).json({ error: 'Failed to update calendar' });
  }
}

async function refreshCalendars(req, res) {
  try {
    var result = await facade.appleRefreshCalendars(req.user.id, req.user);
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('Apple Calendar refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh calendars' });
  }
}

async function disconnect(req, res) {
  try {
    var result = await facade.appleDisconnect(req.user.id);
    res.json(result);
  } catch (error) {
    logger.error('Apple Calendar disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Apple Calendar' });
  }
}

async function setAutoSync(req, res) {
  try {
    var result = await facade.setAppleAutoSync(req.user.id, req.body.enabled);
    res.json(result);
  } catch (error) {
    logger.error('Apple Calendar auto-sync error:', error);
    res.status(500).json({ error: 'Failed to update auto-sync setting' });
  }
}

module.exports = {
  getStatus,
  connect,
  selectCalendar,
  selectCalendars,
  getCalendars,
  updateCalendar,
  refreshCalendars,
  disconnect,
  setAutoSync
};
