/**
 * Feature Events Internal API
 *
 * Exposes feature event data for analytics.
 * Protected by service key (same as feature catalog).
 */

const router = require('express').Router();
const db = require('../db');

function authenticateServiceKey(req, res, next) {
  const expectedKey = process.env.FEATURE_CATALOG_KEY;
  if (!expectedKey || req.headers['x-service-key'] !== expectedKey) {
    return res.status(401).json({ error: 'Invalid service key' });
  }
  next();
}

router.get('/', authenticateServiceKey, async (req, res) => {
  try {
    const { feature_key, event_type, user_id, days = 30, limit = 100 } = req.query;
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days));

    let query = db('feature_events')
      .where('created_at', '>=', since)
      .orderBy('created_at', 'desc')
      .limit(parseInt(limit));

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
      period_days: parseInt(days),
      total_events: events.length,
      aggregated,
      events: events.map(e => ({
        ...e,
        value: typeof e.value === 'string' ? JSON.parse(e.value) : e.value
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
