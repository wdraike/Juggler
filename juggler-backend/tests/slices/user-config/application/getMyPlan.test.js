/**
 * GetMyPlan — use-case unit tests against injected fakes (999.1196). No DB
 * needed — `db` is a minimal knex-chain stub, entityCounters/getPlanName/
 * getSubscriptionStatus are plain injected functions, mirroring the
 * extraction from my-plan.routes.js GET /.
 */

'use strict';

const GetMyPlan =
  require('../../../../src/slices/user-config/application/queries/GetMyPlan');

function makeDb(responses) {
  // FIFO queue of .first() results, keyed loosely by call order — mirrors the
  // test-bed mockChainDb idiom used across the route-level jest suites.
  const queue = responses.slice();
  const chain = {
    where: jest.fn(() => chain),
    count: jest.fn(() => chain),
    first: jest.fn(() => Promise.resolve(queue.shift())),
  };
  return jest.fn(() => chain);
}

describe('GetMyPlan', () => {
  test('unlimited (-1) entity limit: still counts via entityCounters, unlimited:true', async () => {
    const db = makeDb([]);
    const countActiveTasks = jest.fn(async () => 7);
    const useCase = new GetMyPlan({
      db,
      entityCounters: { 'limits.active_tasks': countActiveTasks },
      getPlanName: jest.fn(async (id) => `Plan ${id}`),
      getSubscriptionStatus: jest.fn(async () => null),
    });

    const result = await useCase.execute({
      userId: 'u1', planId: 'enterprise', features: { limits: { active_tasks: -1 } }
    });

    expect(countActiveTasks).toHaveBeenCalledWith('u1');
    expect(result.usage['limits.active_tasks']).toEqual({
      used: 7, limit: null, unlimited: true, resets_at: null
    });
    expect(result.plan_name).toBe('Plan enterprise');
    expect(result.plan_id).toBe('enterprise');
  });

  test('entity-based limit: used/limit/unlimited:false; counter failure falls back to used:0', async () => {
    const db = makeDb([]);
    const countProjects = jest.fn(async () => { throw new Error('db down'); });
    const useCase = new GetMyPlan({
      db,
      entityCounters: { 'limits.projects': countProjects },
      getPlanName: jest.fn(async (id) => id),
      getSubscriptionStatus: jest.fn(async () => null),
    });

    const result = await useCase.execute({
      userId: 'u1', planId: 'free', features: { limits: { projects: 5 } }
    });

    expect(result.usage['limits.projects']).toEqual({
      used: 0, limit: 5, unlimited: false, resets_at: null
    });
  });

  test('rate-based limit (no matching entityCounter): reads plan_usage via db, resets_at from period end', async () => {
    const db = makeDb([{ count: 3 }]);
    const useCase = new GetMyPlan({
      db,
      entityCounters: {},
      getPlanName: jest.fn(async (id) => id),
      getSubscriptionStatus: jest.fn(async () => null),
    });

    const result = await useCase.execute({
      userId: 'u1', planId: 'free', features: { ai: { commands_per_month: 100 } }
    });

    expect(db).toHaveBeenCalledWith('plan_usage');
    expect(result.usage['ai.commands_per_month'].used).toBe(3);
    expect(result.usage['ai.commands_per_month'].limit).toBe(100);
    expect(result.usage['ai.commands_per_month'].resets_at).not.toBeNull();
  });

  test('subscription status + trial_end pass through from getSubscriptionStatus; null when unavailable', async () => {
    const db = makeDb([{ count: '0' }]); // disabled_items query
    const getSubscriptionStatus = jest.fn(async () => ({ status: 'trialing', trial_end: '2026-08-01' }));
    const useCase = new GetMyPlan({
      db,
      entityCounters: {},
      getPlanName: jest.fn(async (id) => id),
      getSubscriptionStatus,
    });

    const result = await useCase.execute({ userId: 'u1', planId: 'free', features: {} });

    expect(result.subscription_status).toBe('trialing');
    expect(result.trial_end).toBe('2026-08-01');
    expect(result.disabled_items).toBe(0);
  });

  test('disabled_items count: parses the tasks_v count row', async () => {
    const db = makeDb([{ count: '4' }]);
    const useCase = new GetMyPlan({
      db,
      entityCounters: {},
      getPlanName: jest.fn(async (id) => id),
      getSubscriptionStatus: jest.fn(async () => null),
    });

    const result = await useCase.execute({ userId: 'u1', planId: 'free', features: {} });

    expect(db).toHaveBeenCalledWith('tasks_v');
    expect(result.disabled_items).toBe(4);
  });

  test('disabled_items query failure is swallowed — falls back to 0 (verbatim legacy try/catch)', async () => {
    const db = jest.fn(() => { throw new Error('boom'); });
    const useCase = new GetMyPlan({
      db,
      entityCounters: {},
      getPlanName: jest.fn(async (id) => id),
      getSubscriptionStatus: jest.fn(async () => null),
    });

    const result = await useCase.execute({ userId: 'u1', planId: 'free', features: {} });

    expect(result.disabled_items).toBe(0);
  });

  test('defaults planId to "free" when input.planId is falsy', async () => {
    const db = makeDb([{ count: '0' }]);
    const useCase = new GetMyPlan({
      db,
      entityCounters: {},
      getPlanName: jest.fn(async (id) => id),
      getSubscriptionStatus: jest.fn(async () => null),
    });

    const result = await useCase.execute({ userId: 'u1', planId: undefined, features: {} });

    expect(result.plan_id).toBe('free');
  });
});
