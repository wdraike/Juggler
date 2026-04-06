const express = require('express');
const router = express.Router();
const taskController = require('../controllers/task.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
const { checkTaskOrRecurringLimit, checkBatchTaskLimits } = require('../middleware/entity-limits');

router.use(authenticateJWT, resolvePlanFeatures);

router.get('/', taskController.getAllTasks);
router.get('/version', taskController.getVersion);
router.get('/disabled', taskController.getDisabledTasks);
router.post('/', checkTaskOrRecurringLimit, taskController.createTask);
router.post('/batch', checkBatchTaskLimits, taskController.batchCreateTasks);
router.put('/batch', taskController.batchUpdateTasks);
router.put('/:id/status', taskController.updateTaskStatus);
router.put('/:id/re-enable', taskController.reEnableTask);
router.put('/:id/unpin', taskController.unpinTask);
router.put('/:id', taskController.updateTask);
router.delete('/:id', taskController.deleteTask);

module.exports = router;
