/**
 * GetFeatureEventsReport — use-case unit tests against an injected knex-chain
 * fake (999.1196). No DB needed — mirrors the extraction from
 * feature-events.routes.js GET /.
 */

'use strict';

const GetFeatureEventsReport =
  require('../../../../src/slices/user-config/application/queries/GetFeatureEventsReport');

function makeDb({ events, aggregated }) {
  let callIndex = 0;
  const results = [events, aggregated];
  const chain = {
    where: jest.fn(() => chain),
    orderBy: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    select: jest.fn(() => chain),
    groupBy: jest.fn(() => chain),
    count: jest.fn(() => chain),
    then: (resolve) => resolve(results[callIndex++]),
  };
  return jest.fn(() => chain);
}

describe('GetFeatureEventsReport', () => {
  test('returns events + aggregated with success:true and period_days/total_events', async () => {
    const events = [
      { id: 1, feature_key: 'ai.commands', event_type: 'used', value: '{"selected":1}', created_at: '2026-07-01' }
    ];
    const aggregated = [{ feature_key: 'ai.commands', event_type: 'used', count: 1 }];
    const db = makeDb({ events, aggregated });
    const useCase = new GetFeatureEventsReport({ db });

    const result = await useCase.execute({});

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.total_events).toBe(1);
    expect(result.body.aggregated).toEqual(aggregated);
    expect(result.body.period_days).toBe(30); // default
  });

  test('JSON-parses a string `value` column, leaves a non-string value as-is', async () => {
    const events = [
      { id: 1, feature_key: 'k', event_type: 'used', value: '{"a":1}' },
      { id: 2, feature_key: 'k', event_type: 'used', value: null },
    ];
    const db = makeDb({ events, aggregated: [] });
    const useCase = new GetFeatureEventsReport({ db });

    const result = await useCase.execute({});

    expect(result.body.events[0].value).toEqual({ a: 1 });
    expect(result.body.events[1].value).toBeNull();
  });

  test('rejects an invalid event_type with 400, before touching the db', async () => {
    const db = jest.fn(() => { throw new Error('should not be called'); });
    const useCase = new GetFeatureEventsReport({ db });

    const result = await useCase.execute({ event_type: 'not-a-real-type' });

    expect(result).toEqual({ status: 400, body: { error: 'Invalid event_type' } });
  });

  test('clamps days above MAX_DAYS(90) and limit above MAX_LIMIT(1000)', async () => {
    const db = makeDb({ events: [], aggregated: [] });
    const useCase = new GetFeatureEventsReport({ db });

    const result = await useCase.execute({ days: 999, limit: 99999 });

    expect(result.body.period_days).toBe(90);
  });

  test('non-numeric days/limit fall back to defaults (30 / 100)', async () => {
    const db = makeDb({ events: [], aggregated: [] });
    const useCase = new GetFeatureEventsReport({ db });

    const result = await useCase.execute({ days: 'nope', limit: 'nope' });

    expect(result.body.period_days).toBe(30);
  });
});
