const express = require('express');
const router = express.Router();
const configController = require('../controllers/config.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');

router.use(authenticateJWT);

// Config
router.get('/', configController.getAllConfig);
router.put('/:key', configController.updateConfig);

// Projects (mounted at /api/projects)
router.get('/projects', configController.getProjects);
router.post('/projects', configController.createProject);
router.put('/projects/:id', configController.updateProject);
router.delete('/projects/:id', configController.deleteProject);

// Locations (mounted at /api/locations)
router.get('/locations', configController.getLocations);
router.put('/locations', configController.replaceLocations);

// Tools (mounted at /api/tools)
router.get('/tools', configController.getTools);
router.put('/tools', configController.replaceTools);

module.exports = router;
