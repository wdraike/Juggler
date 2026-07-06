const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/jwt-auth');
const authenticateAdmin = require('../middleware/authenticateAdmin');
const { validate } = require('../middleware/validate');
const { impersonationStartSchema } = require('../schemas/route-schemas');
const {
  startImpersonation,
  stopImpersonation,
  getImpersonationTargets,
  getImpersonationLog
} = require('../controllers/impersonation.controller');

// All routes require authentication
router.use(authenticateJWT);

// Admin-only: start, get targets, get log
router.post('/start', authenticateAdmin, validate(impersonationStartSchema), startImpersonation);
router.get('/targets', authenticateAdmin, getImpersonationTargets);
router.get('/log', authenticateAdmin, getImpersonationLog);

// Any authenticated user (the impersonation token holder stops their own session)
router.post('/stop', stopImpersonation);

module.exports = router;
