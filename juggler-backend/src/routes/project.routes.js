const express = require('express');
const router = express.Router();
const configController = require('../controllers/config.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');

router.use(authenticateJWT);

router.get('/', configController.getProjects);
router.post('/', configController.createProject);
router.put('/:id', configController.updateProject);
router.delete('/:id', configController.deleteProject);

module.exports = router;
