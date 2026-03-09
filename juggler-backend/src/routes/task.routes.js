const express = require('express');
const router = express.Router();
const taskController = require('../controllers/task.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');

router.use(authenticateJWT);

router.get('/', taskController.getAllTasks);
router.get('/version', taskController.getVersion);
router.post('/', taskController.createTask);
router.post('/batch', taskController.batchCreateTasks);
router.put('/batch', taskController.batchUpdateTasks);
router.put('/:id/status', taskController.updateTaskStatus);
router.put('/:id', taskController.updateTask);
router.delete('/:id', taskController.deleteTask);

module.exports = router;
