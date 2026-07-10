/**
 * UpdateUserTimezone — use-case unit tests against the InMemory
 * UserRepositoryPort adapter (999.1447). No DB needed.
 */

'use strict';

const UpdateUserTimezone =
  require('../../../../src/slices/user-config/application/commands/UpdateUserTimezone');
const InMemoryUserRepository =
  require('../../../../src/slices/user-config/adapters/InMemoryUserRepository');

function makeUseCase(repo) {
  return new UpdateUserTimezone({ userRepository: repo });
}

describe('UpdateUserTimezone', () => {
  test('valid IANA zone is persisted to users.timezone', async () => {
    const repo = new InMemoryUserRepository();
    await repo.insertUser({ id: 'u1', email: 'a@test.com', timezone: 'America/New_York' });

    const result = await makeUseCase(repo).execute({ userId: 'u1', timezone: 'Europe/Berlin' });

    expect(result.status).toBe(200);
    expect(result.body.timezone).toBe('Europe/Berlin');
    expect((await repo.findById('u1')).timezone).toBe('Europe/Berlin');
  });

  test('invalid IANA zone is rejected with 400, no write', async () => {
    const repo = new InMemoryUserRepository();
    await repo.insertUser({ id: 'u1', email: 'a@test.com', timezone: 'America/New_York' });
    const updateSpy = jest.spyOn(repo, 'updateTimezone');

    const result = await makeUseCase(repo).execute({ userId: 'u1', timezone: 'Not/A_Zone' });

    expect(result.status).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
    expect((await repo.findById('u1')).timezone).toBe('America/New_York');
  });

  test('non-string / empty timezone is rejected with 400, no write', async () => {
    const repo = new InMemoryUserRepository();
    await repo.insertUser({ id: 'u1', email: 'a@test.com', timezone: 'America/New_York' });
    const updateSpy = jest.spyOn(repo, 'updateTimezone');

    const result = await makeUseCase(repo).execute({ userId: 'u1', timezone: '' });

    expect(result.status).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test('constructor requires userRepository', () => {
    expect(() => new UpdateUserTimezone({})).toThrow('userRepository');
  });
});
