/**
 * AI Usage Queue Service — Batches AI usage events for payment service
 */

const { v7: uuidv7 } = require('uuid');
const { aiUsageQueueLogger } = require('../lib/logger');

async function enqueue(db, event) {
  try {
    await db('ai_usage_outbox').insert({
      id:             uuidv7(),
      user_id:        event.userId ?? null,
      use_case:       event.useCase,
      model_name:     event.modelName,
      model_params:   event.modelParams != null ? JSON.stringify(event.modelParams) : null,
      tokens_in:      event.tokensIn,
      tokens_out:     event.tokensOut,
      latency_ms:     event.latencyMs,
      error_flag:     event.error ? 1 : 0,
      error_type:     event.errorType ?? null,
      correlation_id: event.correlationId ?? null,
      occurred_at:    event.occurredAt,
      queued_at:      new Date(),
      flush_attempts: 0,
    });
  } catch (err) {
    aiUsageQueueLogger.warn('Enqueue failed', { error: err });
  }
}

module.exports = { enqueue };
