/**
 * AuthProvider — JWT auth state via centralized auth-service
 *
 * Flow: Redirect to auth-service login → user authenticates → redirect back
 * with auth code → exchange for tokens → store in localStorage
 */

import React, { createContext, useState, useEffect, useCallback, useContext } from 'react';
import apiClient, { setAccessToken, getAccessToken, clearAccessToken } from '../../services/apiClient';

const AuthContext = createContext(null);

const AUTH_SERVICE_URL = process.env.REACT_APP_AUTH_SERVICE_URL || 'http://localhost:5010';
const AUTH_FRONTEND_URL = process.env.REACT_APP_AUTH_FRONTEND_URL || 'http://localhost:3001';
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

  // Redirect to auth-service login page
  const login = useCallback(() => {
    const callbackUrl = `${APP_URL}/auth/callback`;
    window.location.href = `${AUTH_FRONTEND_URL}/login?app=juggler&redirect=${encodeURIComponent(callbackUrl)}`;
  }, []);

  const logout = useCallback(async () => {
    // Clear local tokens first
    clearAccessToken();
    localStorage.removeItem('juggler-refresh-token');
    setUser(null);

    // Redirect to auth-service logout, which clears the auth-service session
    // then redirects back to Juggler
    window.location.href = `${AUTH_SERVICE_URL}/api/auth/logout-redirect?redirect=${encodeURIComponent(APP_URL)}`;
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
