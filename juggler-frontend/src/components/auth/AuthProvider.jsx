/**
 * AuthProvider — JWT auth state via centralized auth-service
 *
 * Flow: Redirect to auth-service login → user authenticates → redirect back
 * with auth code → exchange for tokens → store in localStorage
 */

import React, { createContext, useState, useEffect, useCallback, useContext } from 'react';
import apiClient, { setAccessToken, getAccessToken, clearAccessToken } from '../../services/apiClient';

const AuthContext = createContext(null);

const { authServiceUrl, authFrontendUrl } = require('../../proxy-config');
const AUTH_SERVICE_URL = authServiceUrl;
const AUTH_FRONTEND_URL = authFrontendUrl;
const APP_URL = window.location.origin;

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Handle auth callback — exchange code for tokens
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code && window.location.pathname === '/auth/callback') {
      // Exchange authorization code for tokens
      fetch(`${AUTH_SERVICE_URL}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, app: 'juggler' })
      })
        .then(res => res.json())
        .then(data => {
          if (data.access_token) {
            setAccessToken(data.access_token);
            localStorage.setItem('juggler-refresh-token', data.refresh_token);
            // Clean URL
            window.history.replaceState({}, '', '/');
            // Fetch user profile
            return apiClient.get('/auth/me');
          }
          throw new Error('No access token in response');
        })
        .then(res => {
          setUser(res.data.user);
          setLoading(false);
        })
        .catch(err => {
          console.error('Auth callback failed:', err);
          clearAccessToken();
          window.history.replaceState({}, '', '/');
          setLoading(false);
        });
      return;
    }
  }, []);

  // Try to restore session on mount
  useEffect(() => {
    // Skip if we're handling a callback
    if (window.location.pathname === '/auth/callback') return;

    let cancelled = false;

    async function restoreSession() {
      try {
        if (getAccessToken()) {
          try {
            const meRes = await apiClient.get('/auth/me');
            if (!cancelled) {
              setUser(meRes.data.user);
              setLoading(false);
            }
            return;
          } catch {
            // Token invalid/expired — try refresh
          }
        }

        // Try refresh via auth-service
        const refreshToken = localStorage.getItem('juggler-refresh-token');
        if (refreshToken) {
          try {
            const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken })
            });

            if (res.ok) {
              const data = await res.json();
              if (!cancelled) {
                setAccessToken(data.tokens.accessToken);
                localStorage.setItem('juggler-refresh-token', data.tokens.refreshToken);
                const meRes = await apiClient.get('/auth/me');
                if (!cancelled) {
                  setUser(meRes.data.user);
                }
              }
              return;
            }
          } catch {
            // Refresh failed
          }
        }

        // No local tokens — try SSO cookie (user may be logged in via another app)
        try {
          const ssoRes = await fetch(`${AUTH_SERVICE_URL}/api/auth/sso-check`, {
            credentials: 'include'
          });
          if (ssoRes.ok) {
            const ssoData = await ssoRes.json();
            if (ssoData.authenticated) {
              const tokenRes = await fetch(`${AUTH_SERVICE_URL}/api/auth/sso-token`, {
                method: 'POST',
                credentials: 'include'
              });
              if (tokenRes.ok) {
                const tokenData = await tokenRes.json();
                if (!cancelled && tokenData.tokens?.accessToken) {
                  setAccessToken(tokenData.tokens.accessToken);
                  if (tokenData.tokens.refreshToken) localStorage.setItem('juggler-refresh-token', tokenData.tokens.refreshToken);
                  const meRes = await apiClient.get('/auth/me');
                  if (!cancelled) setUser(meRes.data.user);
                  return;
                }
              }
            }
          }
        } catch {
          // SSO check failed — not critical
        }

        // No valid session
        if (!cancelled) {
          clearAccessToken();
          localStorage.removeItem('juggler-refresh-token');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    restoreSession();

    return () => { cancelled = true; };
  }, []);

  // Listen for forced logout
  useEffect(() => {
    function handleLogout() {
      setUser(null);
      clearAccessToken();
      localStorage.removeItem('juggler-refresh-token');
    }
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  // Session heartbeat — poll auth-service every 60s to detect sign-off from another app
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(async () => {
      const token = getAccessToken();
      if (!token) return;

      try {
        const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/session-alive`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.status === 401) {
          // Session ended from another app — clear local state and redirect through auth-service
          window.dispatchEvent(new Event('auth:logout'));
          window.location.href = `${AUTH_SERVICE_URL}/api/auth/logout-redirect?redirect=${encodeURIComponent(APP_URL)}`;
        }
      } catch {
        // Network error — skip this check, try again next interval
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [user]);

  // Redirect to auth-service login page
  const login = useCallback(() => {
    const callbackUrl = `${APP_URL}/auth/callback`;
    window.location.href = `${AUTH_FRONTEND_URL}/login?app=juggler&redirect=${encodeURIComponent(callbackUrl)}`;
  }, []);

  const logout = useCallback(async () => {
    // Grab token before clearing so auth-service can identify the user
    const token = getAccessToken();

    // Clear local tokens
    clearAccessToken();
    localStorage.removeItem('juggler-refresh-token');
    setUser(null);

    // Redirect to auth-service logout with token so it can deactivate the Redis session
    const logoutUrl = new URL(`${AUTH_SERVICE_URL}/api/auth/logout-redirect`);
    logoutUrl.searchParams.set('redirect', APP_URL);
    if (token) logoutUrl.searchParams.set('token', token);
    window.location.href = logoutUrl.toString();
  }, []);

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
    login,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
