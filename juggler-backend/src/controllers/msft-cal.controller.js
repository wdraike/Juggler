/**
 * Microsoft Calendar Controller — THIN HTTP adapter over the calendar slice facade
 * (999.943).
 *
 * All OAuth flow, status, and auto-sync logic now lives in
 * `src/slices/calendar/facade.js`. This module holds ONLY the HTTP req->args
 * mapping and response/error mapping. ZERO direct DB access.
 */

var facade = require('../slices/calendar/facade');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('msft-cal.controller');

async function getStatus(req, res) {
  try {
    var result = await facade.getMsftStatus(req.user);
    res.json(result);
  } catch (error) {
    logger.error('MsftCal status error:', error);
    res.status(500).json({ error: 'Failed to check Microsoft Calendar status' });
  }
}

async function connect(req, res) {
  try {
    var result = await facade.msftConnect(req.user);
    res.json(result);
  } catch (error) {
    logger.error('MsftCal connect error:', error);
    res.status(500).json({ error: 'Failed to generate auth URL' });
  }
}

async function callback(req, res) {
  try {
    var result = await facade.msftCallback(req.query.code, req.query.state, req.user);
    if (result.redirect) {
      return res.redirect(result.redirect);
    }
    res.status(result.status).send(result.body);
  } catch (error) {
    logger.error('MsftCal callback error:', error);
    res.status(500).send('Failed to complete Microsoft Calendar authorization. Please try again.');
  }
}

async function disconnect(req, res) {
  try {
    var result = await facade.msftDisconnect(req.user.id);
    res.json(result);
  } catch (error) {
    logger.error('MsftCal disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Microsoft Calendar' });
  }
}

async function setAutoSync(req, res) {
  try {
    var result = await facade.setMsftAutoSync(req.user.id, req.body.enabled);
    res.json(result);
  } catch (error) {
    logger.error('MsftCal auto-sync error:', error);
    res.status(500).json({ error: 'Failed to update auto-sync setting' });
  }
}

module.exports = {
  getStatus,
  connect,
  callback,
  disconnect,
  setAutoSync,
  // Test-only: direct access to markCodeUsed for unit testing without HTTP stack
  _internal: { markCodeUsed: facade.msftMarkCodeUsed }
};
