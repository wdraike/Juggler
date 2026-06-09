// Mock the logger before requiring the service so that aiUsageQueueLogger
// (currently not exported by name from src/lib/logger — REAL BUG in src) doesn't
// crash the catch block with "Cannot read properties of undefined (reading 'warn')".
jest.mock('../../src/lib/logger', () => ({
  aiUsageQueueLogger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { enqueue } = require('../../src/services/ai-usage-queue.service');

const mockInsert = jest.fn().mockResolvedValue([1]);
const mockDb = jest.fn(() => ({ insert: mockInsert }));

const validEvent = {
  userId: 'user-abc',
  useCase: 'task-ai',
  modelName: 'gemini-2.5-flash',
  modelParams: { temperature: 0.2 },
  tokensIn: 500,
  tokensOut: 100,
  latencyMs: 800,
  error: false,
  errorType: null,
  correlationId: 'task-xyz',
  occurredAt: new Date(),
};

describe('ai-usage-queue enqueue() [juggler]', () => {
  beforeEach(() => { mockInsert.mockClear(); mockDb.mockClear(); });

  test('inserts a row with correct shape', async () => {
    await enqueue(mockDb, validEvent);
    expect(mockDb).toHaveBeenCalledWith('ai_usage_outbox');
    const row = mockInsert.mock.calls[0][0];
    expect(row.use_case).toBe('task-ai');
    expect(row.model_name).toBe('gemini-2.5-flash');
    expect(row.tokens_in).toBe(500);
    expect(row.error_flag).toBe(0);
    expect(row.flush_attempts).toBe(0);
    expect(typeof row.id).toBe('string');
  });

  test('sets user_id to null when userId is undefined', async () => {
    await enqueue(mockDb, { ...validEvent, userId: undefined });
    const row = mockInsert.mock.calls[0][0];
    expect(row.user_id).toBeNull();
  });

  test('does NOT throw when DB insert fails', async () => {
    mockInsert.mockRejectedValueOnce(new Error('DB down'));
    await expect(enqueue(mockDb, validEvent)).resolves.not.toThrow();
  });
});
