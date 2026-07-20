const { AiUsageFlusher } = require('../../src/slices/ai-enrichment/adapters/ai-usage-flusher.service');

global.fetch = jest.fn();

const rows = [
  { id: 'row-1', user_id: 'u1', use_case: 'task-ai', model_name: 'gemini-2.5-flash',
    model_params: null, tokens_in: 200, tokens_out: 50, latency_ms: 600,
    error_flag: 0, error_type: null, correlation_id: 'task-1', occurred_at: new Date() },
];

const makeFlusher = () => {
  const updates = [];
  const db = (table) => ({
    select:    jest.fn().mockReturnThis(),
    where:     jest.fn().mockReturnThis(),
    orderBy:   jest.fn().mockReturnThis(),
    limit:     jest.fn().mockResolvedValue(rows),
    whereIn:   jest.fn().mockReturnThis(),
    delete:    jest.fn().mockResolvedValue(1),
    // 999.1576 inc.4: retry bump is a stamped .update (raw increment expr),
    // no longer knex .increment
    update:    jest.fn((changes) => { updates.push(changes); return Promise.resolve(1); }),
  });
  db.raw = jest.fn((expr) => expr);
  db.__updates = updates;
  return new AiUsageFlusher({
    db,
    billingUrl: 'http://billing:5020',
    serviceKey: 'test-key',
    sourceApp: 'juggler',
  });
};

describe('AiUsageFlusher [juggler]', () => {
  beforeEach(() => { global.fetch.mockReset(); });

  test('skips flush when health check throws', async () => {
    global.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const flusher = makeFlusher();
    await flusher._tick();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('skips flush when health returns non-2xx', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const flusher = makeFlusher();
    await flusher._tick();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('calls ingest when health is ok', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, inserted: 1 }) });
    const flusher = makeFlusher();
    await flusher._tick();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [url, opts] = global.fetch.mock.calls[1];
    expect(url).toBe('http://billing:5020/internal/ai-usage/ingest');
    expect(opts.headers['x-internal-key']).toBe('test-key');
    const body = JSON.parse(opts.body);
    expect(body.source_app).toBe('juggler');
  });

  test('does not throw when ingest POST fails, and the retry bump stamps updated_by', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockRejectedValueOnce(new Error('billing down'));
    const flusher = makeFlusher();
    await expect(flusher._tick()).resolves.not.toThrow();
    // inc.4: flush_attempts bump is an audit-stamped UPDATE ('jest' = the
    // sandbox-armed test default; production ticks run under 'ai-usage-flusher').
    expect(flusher._db.__updates).toHaveLength(1);
    expect(flusher._db.__updates[0].flush_attempts).toBe('flush_attempts + 1');
    expect(flusher._db.__updates[0].updated_by).toBe('jest');
  });
});
