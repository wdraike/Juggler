import { startImpersonation, stopImpersonation, getStoredImpersonation, isImpersonating } from '../impersonationService';

const ACCESS_TOKEN_KEY = 'juggler-access-token';
const REFRESH_TOKEN_KEY = 'juggler-refresh-token';
const IMPERSONATION_KEY = 'juggler-impersonation';

beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn();
});

describe('startImpersonation', () => {
  it('backs up admin tokens and switches to impersonation token', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'admin-tok');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'admin-refresh');

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accessToken: 'imp-tok',
        expiresIn: 3600,
        impersonating: { id: 'u2', email: 'user@test.com', name: 'User' }
      })
    });

    const result = await startImpersonation('u2');

    const stored = JSON.parse(localStorage.getItem(IMPERSONATION_KEY));
    expect(stored.adminAccessToken).toBe('admin-tok');
    expect(stored.adminRefreshToken).toBe('admin-refresh');
    expect(stored.targetId).toBe('u2');
    expect(stored.targetEmail).toBe('user@test.com');
    expect(stored.targetName).toBe('User');
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('imp-tok');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(result.accessToken).toBe('imp-tok');
  });

  it('throws on non-ok response', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'admin-tok');
    global.fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Cannot impersonate admin' })
    });
    await expect(startImpersonation('u2')).rejects.toThrow('Cannot impersonate admin');
  });
});

describe('stopImpersonation', () => {
  it('restores admin tokens from backup', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'imp-tok');
    localStorage.setItem(IMPERSONATION_KEY, JSON.stringify({
      adminAccessToken: 'admin-tok',
      adminRefreshToken: 'admin-refresh',
      targetId: 'u2',
      targetEmail: 'user@test.com',
      targetName: 'User',
      startedAt: new Date().toISOString()
    }));

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: 'stopped' })
    });

    await stopImpersonation();

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('admin-tok');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('admin-refresh');
    expect(localStorage.getItem(IMPERSONATION_KEY)).toBeNull();
  });

  it('restores tokens even if audit call fails', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'imp-tok');
    localStorage.setItem(IMPERSONATION_KEY, JSON.stringify({
      adminAccessToken: 'admin-tok',
      adminRefreshToken: null,
      targetId: 'u2',
      targetEmail: 'user@test.com',
      targetName: 'User',
      startedAt: new Date().toISOString()
    }));

    global.fetch.mockRejectedValueOnce(new Error('network error'));

    await stopImpersonation();

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('admin-tok');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(IMPERSONATION_KEY)).toBeNull();
  });
});

describe('getStoredImpersonation', () => {
  it('returns null when not impersonating', () => {
    expect(getStoredImpersonation()).toBeNull();
  });

  it('returns stored impersonation data', () => {
    const data = { adminAccessToken: 'tok', targetId: 'u2', targetEmail: 'x@test.com', targetName: 'X', startedAt: '2026-01-01' };
    localStorage.setItem(IMPERSONATION_KEY, JSON.stringify(data));
    expect(getStoredImpersonation()).toEqual(data);
  });
});

describe('isImpersonating', () => {
  it('returns false when not impersonating', () => {
    expect(isImpersonating()).toBe(false);
  });

  it('returns true when impersonation data is stored', () => {
    localStorage.setItem(IMPERSONATION_KEY, JSON.stringify({ adminAccessToken: 'tok' }));
    expect(isImpersonating()).toBe(true);
  });
});
