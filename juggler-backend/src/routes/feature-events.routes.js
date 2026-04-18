/**
 * Feature Events Internal API
 *
 * Exposes feature event data for analytics.
 * Protected by service key (same as feature catalog).
 */

const crypto = require('crypto');
const router = require('express').Router();
const db = require('../db');

const MAX_DAYS = 90;
const MAX_LIMIT = 1000;
const ALLOWED_EVENT_TYPES = new Set(['used', 'blocked', 'limit_reached']);

function authenticateServiceKey(req, res, next) {
  const expectedKey = process.env.FEATURE_CATALOG_KEY;
  if (!expectedKey) {
    return res.status(503).json({ error: 'Feature catalog not configured' });
  }
  const providedKey = req.headers['x-service-key'];
  if (typeof providedKey !== 'string' || providedKey.length !== expectedKey.length) {
    return res.status(401).json({ error: 'Invalid service key' });
  }
  const a = Buffer.from(providedKey);
  const b = Buffer.from(expectedKey);
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid service key' });
  }
  next();
}

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

router.get('/', authenticateServiceKey, async (req, res) => {
  try {
    const { feature_key, event_type, user_id } = req.query;
    const days = clampInt(req.query.days, 30, 1, MAX_DAYS);
    const limit = clampInt(req.query.limit, 100, 1, MAX_LIMIT);
    const since = new Date();
    since.setDate(since.getDate() - days);

    if (event_type && !ALLOWED_EVENT_TYPES.has(event_type)) {
      return res.status(400).json({ error: 'Invalid event_type' });
    }

    let query = db('feature_events')
      .where('created_at', '>=', since)
      .orderBy('created_at', 'desc')
      .limit(limit);

    if (feature_key) query = query.where('feature_key', feature_key);
    if (event_type) query = query.where('event_type', event_type);
    if (user_id) query = query.where('user_id', user_id);

    const events = await query;

    let aggQuery = db('feature_events')
      .where('created_at', '>=', since)
      .select('feature_key', 'event_type')
      .count('id as count')
      .groupBy('feature_key', 'event_type')
      .orderBy('count', 'desc');

    if (feature_key) aggQuery = aggQuery.where('feature_key', feature_key);

    const aggregated = await aggQuery;

    res.json({
      success: true,
      period_days: days,
      total_events: events.length,
      aggregated,
      events: events.map(e => ({
        ...e,
        value: typeof e.value === 'string' ? JSON.parse(e.value) : e.value
      }))
    });
  } catch (error) {
    console.error('[feature-events] query failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
