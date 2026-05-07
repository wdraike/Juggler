const { enqueue } = require('./ai-usage-queue.service');

async function trackedGeminiCall(db, client, modelName, contents, config, { useCase, userId = null, correlationId = null } = {}) {
  const start = Date.now();
  let result = null;
  let errorFlag = false;
  let errorType = null;

  try {
    result = await client.models.generateContent({ model: modelName, contents, config });
    return result;
  } catch (err) {
    errorFlag = true;
    errorType = err.code ?? err.constructor.name ?? 'UnknownError';
    throw err;
  } finally {
    const usage = result?.usageMetadata ?? {};
    enqueue(db, {
      userId,
      useCase,
      modelName,
      modelParams:   config ?? null,
      tokensIn:      usage.promptTokenCount     ?? 0,
      tokensOut:     usage.candidatesTokenCount ?? 0,
      latencyMs:     Date.now() - start,
      error:         errorFlag,
      errorType,
      correlationId,
      occurredAt:    new Date(start),
    });
  }
}

module.exports = { trackedGeminiCall };
