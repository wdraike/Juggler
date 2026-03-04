/**
 * Schedule routes — run backend scheduler
 */

var express = require('express');
var router = express.Router();
var { authenticateJWT } = require('../middleware/jwt-auth');
var { runScheduleAndPersist, getSchedulePlacements } = require('../scheduler/runSchedule');

/**
 * POST /api/schedule/run — run scheduler, persist date moves, return placements
 */
router.post('/run', authenticateJWT, async function(req, res) {
  try {
    var stats = await runScheduleAndPersist(req.user.id);
    var placements = await getSchedulePlacements(req.user.id);
    res.json(Object.assign({}, stats, { dayPlacements: placements.dayPlacements, unplaced: placements.unplaced }));
  } catch (error) {
    console.error('Schedule run error:', error);
    res.status(500).json({ error: 'Failed to run scheduler' });
  }
});

/**
 * GET /api/schedule/placements — read-only: return scheduler placements
 */
router.get('/placements', authenticateJWT, async function(req, res) {
  try {
    var placements = await getSchedulePlacements(req.user.id);
    res.json(placements);
  } catch (error) {
    console.error('Schedule placements error:', error);
    res.status(500).json({ error: 'Failed to get placements' });
  }
});

module.exports = router;
