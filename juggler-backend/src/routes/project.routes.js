const express = require('express');
const router = express.Router();
const configController = require('../controllers/config.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { resolvePlanFeatures } = require('../middleware/plan-features.middleware');
const { checkProjectLimit } = require('../middleware/entity-limits');

router.use(authenticateJWT, resolvePlanFeatures);

router.get('/', configController.getProjects);
router.post('/', checkProjectLimit, configController.createProject);
// Note: /reorder must be registered BEFORE /:id so Express doesn't match
// "reorder" as an id.
router.put('/reorder', configController.reorderProjects);
router.put('/:id', configController.updateProject);
router.delete('/:id', configController.deleteProject);

module.exports = router;
