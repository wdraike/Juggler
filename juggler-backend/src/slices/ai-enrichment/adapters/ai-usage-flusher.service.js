var { runWithActor } = require('../../../lib/audit-context'); // 999.1576 inc.3b
const BATCH_SIZE     = 500;
const INTERVAL_MS    = 60_000;
const MAX_ATTEMPTS   = 10;
const HEALTH_TIMEOUT = 5_000;
const POST_TIMEOUT   = 30_000;

const { aiUsageFlusherLogger } = require('../../../lib/logger');

class AiUsageFlusher {
  constructor({ db, billingUrl, serviceKey, sourceApp }) {
    this._db         = db;
    this._billingUrl = billingUrl;
    this._serviceKey = serviceKey;
    this._sourceApp  = sourceApp;
    this._timer      = null;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => { runWithActor('ai-usage-flusher', () => this._tick()).catch(() => {}); }, INTERVAL_MS); // 999.1576
    setTimeout(() => { runWithActor('ai-usage-flusher', () => this._tick()).catch(() => {}); }, 5_000); // 999.1576 inc.4a: first tick fires from server boot — no ambient ALS context
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  async _tick() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT);
      let health;
      try {
        health = await fetch(`${this._billingUrl}/health`, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!health.ok) return;
    } catch {
      return;
    }

    try {
      const rows = await this._db('ai_usage_outbox')
        .select('*')
        .where('flush_attempts', '<', MAX_ATTEMPTS)
        .orderBy('queued_at', 'asc')
        .limit(BATCH_SIZE);

      if (!rows || rows.length === 0) return;

      const ids    = rows.map(r => r.id);
      const events = rows.map(r => ({
        id:             r.id,
        user_id:        r.user_id,
        use_case:       r.use_case,
        model_name:     r.model_name,
        model_params:   r.model_params ? JSON.parse(r.model_params) : null,
        tokens_in:      r.tokens_in,
        tokens_out:     r.tokens_out,
        latency_ms:     r.latency_ms,
        error_flag:     Boolean(r.error_flag),
        error_type:     r.error_type,
        correlation_id: r.correlation_id,
        occurred_at:    r.occurred_at,
      }));

      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), POST_TIMEOUT);
        let resp;
        try {
          resp = await fetch(`${this._billingUrl}/internal/ai-usage/ingest`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-key': this._serviceKey },
            body:    JSON.stringify({ source_app: this._sourceApp, events }),
            signal:  ctrl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (resp.ok) {
          await this._db('ai_usage_outbox').whereIn('id', ids).delete();
        } else {
          await this._db('ai_usage_outbox').whereIn('id', ids).increment('flush_attempts', 1);
        }
      } catch {
        await this._db('ai_usage_outbox').whereIn('id', ids).increment('flush_attempts', 1);
      }
    } catch (err) {
      aiUsageFlusherLogger.warn('Tick error', { error: err });
    }
  }
}

let _instance = null;

function createFlusher(deps) {
  _instance = new AiUsageFlusher(deps);
  return _instance;
}

module.exports = { AiUsageFlusher, createFlusher };
