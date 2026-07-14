/**
 * AuthProvider — JWT auth state via centralized auth-service
 *
 * Flow: Redirect to auth-service login → user authenticates → redirect back
 * with auth code → exchange for tokens → store in localStorage
 */

import React, { createContext, useState, useEffect, useCallback, useContext, useRef } from 'react';
import apiClient, { setAccessToken, getAccessToken, clearAccessToken } from '../../services/apiClient';

import { authServiceUrl, authFrontendUrl, appId as APP_ID } from '../../proxy-config';

const AuthContext = createContext(null);
const AUTH_SERVICE_URL = authServiceUrl;
const AUTH_FRONTEND_URL = authFrontendUrl;
const APP_URL = window.location.origin;

// PKCE (RFC 7636) — juggler is the public client that redeems the auth code, so it owns
// the verifier. It generates verifier+challenge, passes the challenge through auth-frontend
// to the authorize endpoint, and sends the verifier at /oauth/token. This satisfies the
// auth-service AC5 guard (token.js) via PKCE rather than a client_secret.
const PKCE_VERIFIER_KEY = 'juggler-pkce-verifier';

function base64UrlEncode(bytes) {
  let str = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateCodeVerifier() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function deriveCodeChallenge(verifier) {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const codeExchangeRef = useRef(false);

  // Handle auth callback — exchange code for tokens
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code && window.location.pathname === '/auth/callback') {
      // Prevent double-exchange in React StrictMode (dev only)
      // Also prevent duplicate exchanges if this effect runs multiple times
      if (codeExchangeRef.current) {
        console.warn('AuthProvider: preventing duplicate code exchange');
        return;
      }
      codeExchangeRef.current = true;

      // PKCE: retrieve the verifier stashed by login() before the auth-frontend redirect.
      const codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
      sessionStorage.removeItem(PKCE_VERIFIER_KEY);

      // Exchange authorization code for tokens
      fetch(`${AUTH_SERVICE_URL}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: code,
          client_id: 'auth-frontend',
          ...(codeVerifier ? { code_verifier: codeVerifier } : {})
        })
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
          throw new Error(data.error || 'No access token in response');
        })
        .then(res => {
          setUser(res.data.user);
          setLoading(false);
        })
        .catch(err => {
          console.error('Auth callback failed:', err);
          clearAccessToken();
          // fail-closed parity with the session-restore catches below — clear the
          // refresh token too so no auth state survives a failed exchange (law review)
          localStorage.removeItem('juggler-refresh-token');
          // 999.1594 — surface the failure via the existing /auth/callback?error=...
          // "Authentication Failed" screen (App.js AppContent) instead of silently
          // wiping the query string and landing back on '/' with no explanation.
          // This is the exact silent-bounce shape that made a backend 403 look like
          // a dead login button for hours (999.1574 reference incident).
          var message = (err && err.message) ? err.message : 'exchange_failed';
          window.history.replaceState({}, '', '/auth/callback?error=' + encodeURIComponent(message));
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
          // 401 has two causes: SESSION_ENDED (signed off elsewhere — force
          // logout) vs TOKEN_EXPIRED (access token aged out — next apiClient
          // request will auto-refresh via the interceptor, so skip this tick).
          // Without the distinction, every token expiry looked like a session
          // kill and users were bounced back to login on the 60s heartbeat.
          let code = null;
          try { code = (await res.json()).code; } catch { /* no body */ }
          if (code === 'SESSION_ENDED') {
            window.dispatchEvent(new Event('auth:logout'));
            window.location.href = `${AUTH_SERVICE_URL}/api/auth/logout-redirect?redirect=${encodeURIComponent(APP_URL)}`;
          }
          // TOKEN_EXPIRED / unspecified: do nothing — refresh path handles it.
        }
      } catch {
        // Network error — skip this check, try again next interval
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [user]);

  // Redirect to auth-service login page
  const login = useCallback(async () => {
    const callbackUrl = `${APP_URL}/auth/callback`;
    // PKCE: generate the verifier, stash it for the callback, pass the challenge along.
    // FIX(ernie F-1/F-2): wrap crypto.subtle usage in try/catch — window.crypto.subtle
    // is undefined on non-secure (plain http, non-localhost) origins, which would produce
    // an unhandled rejection and a silently dead Sign-In button. On failure we surface
    // the error to the caller (rethrow) so LoginPage.jsx can show user-visible feedback.
    // We do NOT silently redirect without PKCE — that would skip the AC5 verifier check
    // and reintroduce the login loop for PKCE-bound codes.
    let verifier, challenge;
    try {
      verifier = generateCodeVerifier();
      challenge = await deriveCodeChallenge(verifier);
    } catch (err) {
      console.error('[AuthProvider] PKCE generation failed — crypto.subtle may be unavailable (non-secure origin):', err);
      throw err;
    }
    sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
    const url = `${AUTH_FRONTEND_URL}/login?app=${APP_ID}`
      + `&redirect=${encodeURIComponent(callbackUrl)}`
      + `&code_challenge=${encodeURIComponent(challenge)}`
      + `&code_challenge_method=S256`;
    window.location.href = url;
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
