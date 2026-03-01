const express = require('express');
const router = express.Router();
const db = require('../db');

// Immediate health check (no DB)
router.get('/immediate', (req, res) => {
  res.json({ status: 'ok', service: 'juggler-backend' });
});

// Full health check with DB ping
router.get('/', async (req, res) => {
  try {
    await db.raw('SELECT 1');
    res.json({ status: 'ok', db: 'connected', service: 'juggler-backend' });
  } catch (error) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: error.message });
  }
});

module.exports = router;
