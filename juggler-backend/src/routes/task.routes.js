const express = require('express');
const router = express.Router();
const taskController = require('../controllers/task.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { runScheduleAndPersist } = require('../scheduler/runSchedule');

router.use(authenticateJWT);

// After any mutating request succeeds, re-run the scheduler in the background
// so the placement cache stays current without a manual "reschedule" button.
var pendingSchedule = {};
function scheduleAfterMutation(req, res, next) {
  var origJson = res.json.bind(res);
  res.json = function(body) {
    origJson(body);
    // Only trigger on success responses
    if (res.statusCode < 400 && req.user && req.user.id) {
      var uid = req.user.id;
      // Debounce: if a schedule run is already pending for this user, skip
      if (pendingSchedule[uid]) return;
      pendingSchedule[uid] = true;
      // Small delay so batch saves within the same request cycle settle
      setTimeout(function() {
        delete pendingSchedule[uid];
        runScheduleAndPersist(uid).catch(function(err) {
          console.error('[SCHED] auto-schedule after mutation failed:', err.message);
        });
      }, 500);
    }
  };
  next();
}

router.get('/', taskController.getAllTasks);
router.get('/version', taskController.getVersion);
router.post('/', scheduleAfterMutation, taskController.createTask);
router.post('/batch', scheduleAfterMutation, taskController.batchCreateTasks);
router.put('/batch', scheduleAfterMutation, taskController.batchUpdateTasks);
router.put('/:id/status', scheduleAfterMutation, taskController.updateTaskStatus);
router.put('/:id', scheduleAfterMutation, taskController.updateTask);
router.delete('/:id', scheduleAfterMutation, taskController.deleteTask);

module.exports = router;
