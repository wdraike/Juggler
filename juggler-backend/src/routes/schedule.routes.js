/**
 * Schedule routes — run backend scheduler
 */

var express = require('express');
var router = express.Router();
var { authenticateJWT } = require('../middleware/jwt-auth');
var { runScheduleAndPersist } = require('../scheduler/runSchedule');

/**
 * POST /api/schedule/run — run scheduler and persist date moves
 */
router.post('/run', authenticateJWT, async function(req, res) {
  try {
    var stats = await runScheduleAndPersist(req.user.id);
    res.json(stats);
  } catch (error) {
    console.error('Schedule run error:', error);
    res.status(500).json({ error: 'Failed to run scheduler' });
  }
});

module.exports = router;
