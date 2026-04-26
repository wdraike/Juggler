import { apiBase } from '../proxy-config';

const IMPERSONATION_KEY = 'juggler-impersonation';
const ACCESS_TOKEN_KEY = 'juggler-access-token';
const REFRESH_TOKEN_KEY = 'juggler-refresh-token';

export async function startImpersonation(targetUserId, reason) {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!token) throw new Error('No authentication token');

  const response = await fetch(`${apiBase}/impersonation/start`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUserId, reason: reason || null })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || err.message || 'Failed to start impersonation');
  }

  const result = await response.json();

  const adminAccessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
  const adminRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);

  localStorage.setItem(IMPERSONATION_KEY, JSON.stringify({
    adminAccessToken,
    adminRefreshToken: adminRefreshToken || null,
    targetId: result.impersonating?.id || null,
    targetEmail: result.impersonating?.email || null,
    targetName: result.impersonating?.name || null,
    startedAt: new Date().toISOString()
  }));

  localStorage.setItem(ACCESS_TOKEN_KEY, result.accessToken);
  localStorage.removeItem(REFRESH_TOKEN_KEY);

  return result;
}

export async function stopImpersonation() {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);

  const stored = (() => {
    try { return JSON.parse(localStorage.getItem(IMPERSONATION_KEY) || 'null'); }
    catch (e) { return null; }
  })();

  try {
    if (token) {
      await fetch(`${apiBase}/impersonation/stop`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
    }
  } catch (err) {
    console.warn('[juggler/impersonation] stop audit call failed:', err.message);
  }

  localStorage.removeItem(IMPERSONATION_KEY);

  if (stored?.adminAccessToken) {
    localStorage.setItem(ACCESS_TOKEN_KEY, stored.adminAccessToken);
  } else {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
  }
  if (stored?.adminRefreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, stored.adminRefreshToken);
  } else {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  return { message: 'Impersonation stopped' };
}

export function getStoredImpersonation() {
  try { return JSON.parse(localStorage.getItem(IMPERSONATION_KEY) || 'null'); }
  catch (e) { return null; }
}

export function isImpersonating() {
  return !!getStoredImpersonation();
}

export async function getImpersonationTargets(search = '', limit = 50, offset = 0) {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!token) throw new Error('No authentication token');

  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) params.append('search', search);

  const response = await fetch(`${apiBase}/impersonation/targets?${params}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to get impersonation targets');
  }
  return response.json();
}

export async function getImpersonationLog(options = {}) {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (!token) throw new Error('No authentication token');

  const { limit = 50, offset = 0, adminUserId, targetUserId } = options;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (adminUserId) params.append('adminUserId', adminUserId);
  if (targetUserId) params.append('targetUserId', targetUserId);

  const response = await fetch(`${apiBase}/impersonation/log?${params}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to get impersonation log');
  }
  return response.json();
}
