/**
 * GetStepperSessionOwner — use-case unit tests against an injected fake
 * (999.1196). No DB needed.
 */

'use strict';

const GetStepperSessionOwner =
  require('../../../../src/slices/scheduler/application/GetStepperSessionOwner');

describe('GetStepperSessionOwner', () => {
  test('delegates to the injected findOwner with the session id, returns its result', async () => {
    const row = { session_id: 'sess-1', user_id: 'user-1' };
    const findOwner = jest.fn(async () => row);
    const useCase = new GetStepperSessionOwner({ findOwner });

    const result = await useCase.execute('sess-1');

    expect(findOwner).toHaveBeenCalledWith('sess-1');
    expect(result).toBe(row);
  });

  test('returns undefined/falsy as-is when no row is found (route treats this as "gone")', async () => {
    const findOwner = jest.fn(async () => undefined);
    const useCase = new GetStepperSessionOwner({ findOwner });

    const result = await useCase.execute('missing-session');

    expect(result).toBeUndefined();
  });
});
