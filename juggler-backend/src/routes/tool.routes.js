const express = require('express');
const router = express.Router();
const configController = require('../controllers/config.controller');
const { authenticateJWT } = require('../middleware/jwt-auth');
const { validate } = require('../middleware/validate');
const { toolReplaceSchema } = require('../schemas/route-schemas');

router.use(authenticateJWT);

router.get('/', configController.getTools);
router.put('/', validate(toolReplaceSchema), configController.replaceTools);

module.exports = router;
