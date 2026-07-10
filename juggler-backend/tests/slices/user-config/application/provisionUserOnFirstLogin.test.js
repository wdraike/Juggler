/**
 * ProvisionUserOnFirstLogin — use-case unit tests against the InMemory
 * UserRepositoryPort adapter (999.1197). No DB needed (safe outside test-bed).
 *
 * The provisioning rules pinned here (tz seed from X-Browser-Timezone, NY
 * default, no-write for existing users) mirror the 999.1222 ruling; the
 * middleware wiring end-to-end stays covered by
 * tests/unit/jwt-auth-timezone.test.js (kept green, unchanged).
 */

'use strict';

const ProvisionUserOnFirstLogin =
  require('../../../../src/slices/user-config/application/commands/ProvisionUserOnFirstLogin');
const InMemoryUserRepository =
  require('../../../../src/slices/user-config/adapters/InMemoryUserRepository');
const KnexUserRepository =
  require('../../../../src/slices/user-config/adapters/KnexUserRepository');
const { UserRepositoryPort, USER_REPOSITORY_PORT_METHODS } =
  require('../../../../src/slices/user-config/domain/ports/UserRepositoryPort');

const CLAIMS = { id: 'auth-user-1', email: 'p@test.com', name: 'Prov Test', picture: null };

function makeUseCase(repo, logger) {
  return new ProvisionUserOnFirstLogin({
    userRepository: repo,
    logger: logger || { warn: jest.fn() },
  });
}

describe('ProvisionUserOnFirstLogin', () => {
  test('existing user: returned as-is, NO write (999.1222 Settings-only tz)', async () => {
    const repo = new InMemoryUserRepository();
    await repo.insertUser({
      id: 'local-1', email: CLAIMS.email, name: 'Existing', timezone: 'America/New_York',
    });
    const insertSpy = jest.spyOn(repo, 'insertUser');
    const user = await makeUseCase(repo).execute({
      authUser: CLAIMS,
      browserTimezone: 'Europe/Berlin', // must be ignored for existing users
    });
    expect(user.id).toBe('local-1');
    expect(user.timezone).toBe('America/New_York');
    expect(insertSpy).not.toHaveBeenCalled();
  });

  test('first login: provisions with auth-service id as local id (INVARIANT)', async () => {
    const repo = new InMemoryUserRepository();
    const user = await makeUseCase(repo).execute({ authUser: CLAIMS });
    expect(user.id).toBe(CLAIMS.id); // auth-service id == local id
    expect(user.email).toBe(CLAIMS.email);
    expect(user.name).toBe(CLAIMS.name);
    expect(user.picture_url).toBeNull();
    expect(await repo.findById(CLAIMS.id)).toBeDefined();
  });

  test('tz seed: valid X-Browser-Timezone IANA zone is stored', async () => {
    const repo = new InMemoryUserRepository();
    const user = await makeUseCase(repo).execute({
      authUser: CLAIMS, browserTimezone: 'Europe/Berlin',
    });
    expect(user.timezone).toBe('Europe/Berlin');
  });

  test('tz seed: absent header → America/New_York schema-approved default', async () => {
    const repo = new InMemoryUserRepository();
    const user = await makeUseCase(repo).execute({ authUser: CLAIMS });
    expect(user.timezone).toBe('America/New_York');
  });

  test('tz seed: invalid IANA name → America/New_York', async () => {
    const repo = new InMemoryUserRepository();
    const user = await makeUseCase(repo).execute({
      authUser: CLAIMS, browserTimezone: 'Not/A_Zone',
    });
    expect(user.timezone).toBe('America/New_York');
  });

  test('duplicate race: Duplicate insert error → warn + returns the winner row', async () => {
    const repo = new InMemoryUserRepository();
    const realInsert = repo.insertUser.bind(repo);
    // Simulate a concurrent first-login landing between findByEmail and insert:
    // the competing row exists, so our insert rejects ER_DUP_ENTRY-style.
    repo.insertUser = async (row) => {
      await realInsert({ ...row, name: 'Race Winner' });
      throw new Error("Duplicate entry 'p@test.com' for key 'users.email'");
    };
    const warn = jest.fn();
    const user = await makeUseCase(repo, { warn }).execute({ authUser: CLAIMS });
    expect(user.name).toBe('Race Winner');
    expect(user.id).toBe(CLAIMS.id);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('first-login insert race'),
      { email: CLAIMS.email },
    );
  });

  test('non-duplicate insert error is rethrown (fail loud)', async () => {
    const repo = new InMemoryUserRepository();
    repo.insertUser = async () => { throw new Error('connection lost'); };
    await expect(makeUseCase(repo).execute({ authUser: CLAIMS }))
      .rejects.toThrow('connection lost');
  });

  test('post-insert fetch missing → throws User provision failed (fail loud)', async () => {
    const repo = new InMemoryUserRepository();
    repo.findById = async () => undefined;
    await expect(makeUseCase(repo).execute({ authUser: CLAIMS }))
      .rejects.toThrow('User provision failed');
  });
});

describe('UserRepositoryPort contract surface', () => {
  test('base port throws not-implemented for every declared method', () => {
    const port = new UserRepositoryPort();
    USER_REPOSITORY_PORT_METHODS.forEach((m) => {
      expect(() => port[m]()).toThrow('not implemented');
    });
  });

  test('both adapters implement every declared method', () => {
    const inMem = new InMemoryUserRepository();
    const knex = new KnexUserRepository({ db: () => {} }); // injected handle — no pool
    USER_REPOSITORY_PORT_METHODS.forEach((m) => {
      expect(typeof inMem[m]).toBe('function');
      expect(typeof knex[m]).toBe('function');
    });
  });
});
