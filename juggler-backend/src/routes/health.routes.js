const express = require('express');
const router = express.Router();
const db = require('../db');

// Immediate health check (no DB)
router.get('/immediate', (req, res) => {
  res.json({ status: 'ok', service: 'juggler-backend' });
});

// Full health check with DB ping + scheduler timezone info
router.get('/', async (req, res) => {
  try {
    await db.raw('SELECT 1');
    var now = new Date();
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
    }).formatToParts(now);
    var vals = {};
    parts.forEach(function(p) { vals[p.type] = parseInt(p.value, 10); });
    var hour = vals.hour % 24;
    var _m = vals.month, _d = vals.day;
    var todayKey = vals.year + '-' + (_m < 10 ? '0' : '') + _m + '-' + (_d < 10 ? '0' : '') + _d;
    res.json({
      status: 'ok', db: 'connected', service: 'juggler-backend',
      serverUtc: now.toISOString(),
      schedulerTodayKey: todayKey,
      schedulerNowMins: hour * 60 + vals.minute
    });
  } catch (error) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: error.message });
  }
});

module.exports = router;
