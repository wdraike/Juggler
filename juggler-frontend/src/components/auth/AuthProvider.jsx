/**
 * AuthProvider — Context for JWT auth state, login/logout/refresh
 */

import React, { createContext, useState, useEffect, useCallback, useContext } from 'react';
import apiClient, { setAccessToken, clearAccessToken } from '../../services/apiClient';

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Try to restore session on mount
  useEffect(() => {
    async function tryRefresh() {
      try {
        const { data } = await apiClient.post('/auth/refresh');
        setAccessToken(data.accessToken);
        const meRes = await apiClient.get('/auth/me');
        setUser(meRes.data.user);
      } catch {
        // No valid session — that's fine
      } finally {
        setLoading(false);
      }
    }
    tryRefresh();
  }, []);

  // Listen for forced logout
  useEffect(() => {
    function handleLogout() {
      setUser(null);
      clearAccessToken();
    }
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  const login = useCallback(async (googleIdToken) => {
    const { data } = await apiClient.post('/auth/google', { idToken: googleIdToken });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore errors
    }
    clearAccessToken();
    setUser(null);
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
