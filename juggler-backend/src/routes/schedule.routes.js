/**
 * Schedule routes — run backend scheduler
 */

var express = require('express');
var router = express.Router();
var { authenticateJWT } = require('../middleware/jwt-auth');
var { runScheduleAndPersist, getSchedulePlacements } = require('../scheduler/runSchedule');
var { withSyncLock } = require('../lib/sync-lock');

/**
 * POST /api/schedule/run — run scheduler, persist date moves, return placements
 */
router.post('/run', authenticateJWT, withSyncLock(async function(req, res) {
  try {
    var opts = req.body && req.body.timezone ? { timezone: req.body.timezone } : undefined;
    var result = await runScheduleAndPersist(req.user.id, undefined, opts);
    // result now includes dayPlacements and unplaced from the same run (cached)
    res.json(result);
  } catch (error) {
    console.error('Schedule run error:', error);
    res.status(500).json({ error: 'Failed to run scheduler' });
  }
}));

/**
 * GET /api/schedule/placements — read-only: return scheduler placements
 */
router.get('/placements', authenticateJWT, async function(req, res) {
  try {
    var opts = req.query && req.query.timezone ? { timezone: req.query.timezone } : undefined;
    var placements = await getSchedulePlacements(req.user.id, opts);
    res.json(placements);
  } catch (error) {
    console.error('Schedule placements error:', error);
    res.status(500).json({ error: 'Failed to get placements' });
  }
});

module.exports = router;
