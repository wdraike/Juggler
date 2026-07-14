/**
 * AuthProvider Tests — Double Exchange Bug Prevention
 * 
 * Tests the fix for JUG-LOGIN-01: AuthProvider Double-Exchange Bug
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import AuthProvider, { useAuth } from '../AuthProvider';
import apiClient, { setAccessToken, clearAccessToken } from '../../../services/apiClient';

// Mock the auth service and API client
jest.mock('../../../services/apiClient');
global.fetch = jest.fn();

function TestComponent() {
  const { user, loading, isAuthenticated, login, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{loading ? 'true' : 'false'}</div>
      <div data-testid="authenticated">{isAuthenticated ? 'true' : 'false'}</div>
      <div data-testid="username">{user?.name || 'none'}</div>
      <button onClick={login} data-testid="login-btn">Login</button>
      <button onClick={logout} data-testid="logout-btn">Logout</button>
    </div>
  );
}

describe('AuthProvider — Double Exchange Prevention', () => {
  const originalLocation = window.location;
  const originalHistory = window.history;

  beforeAll(() => {
    // Mock window.location and window.history
    delete window.location;
    delete window.history;
    window.location = { ...originalLocation, search: '', pathname: '/' };
    window.history = { ...originalHistory, replaceState: jest.fn(), pushState: jest.fn() };
  });

  afterAll(() => {
    window.location = originalLocation;
    window.history = originalHistory;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock the apiClient functions properly
    require('../../../services/apiClient').clearAccessToken = jest.fn();
    require('../../../services/apiClient').setAccessToken = jest.fn();
    require('../../../services/apiClient').getAccessToken = jest.fn();
    localStorage.clear();
  });

  describe('Callback Handling — Double Exchange Prevention', () => {
    it('should prevent duplicate code exchanges when useEffect runs multiple times', async () => {
      // Mock successful token exchange
      const mockTokens = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token'
      };

      const mockUser = { id: 1, name: 'Test User', email: 'test@example.com' };

      // First call succeeds
      fetch.mockImplementationOnce(() =>
        Promise.resolve({
          json: () => Promise.resolve(mockTokens)
        })
      );

      // Second call (duplicate) should be prevented by the ref
      apiClient.get.mockResolvedValue({ data: { user: mockUser } });

      // Set up auth callback URL with code
      window.location.search = '?code=test-auth-code';
      window.location.pathname = '/auth/callback';

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      // Wait for the effect to run
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Should only call fetch once (not twice due to StrictMode)
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/oauth/token'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('test-auth-code')
        })
      );

      // Should have set the token
      expect(require('../../../services/apiClient').setAccessToken).toHaveBeenCalledWith('test-access-token');
      expect(localStorage.getItem('juggler-refresh-token')).toBe('test-refresh-token');
    });

    it('should handle duplicate effect runs without making duplicate API calls', async () => {
      const mockTokens = {
        access_token: 'test-access-token-2',
        refresh_token: 'test-refresh-token-2'
      };

      const mockUser = { id: 2, name: 'Test User 2', email: 'test2@example.com' };

      fetch.mockResolvedValue({
        json: () => Promise.resolve(mockTokens)
      });

      apiClient.get.mockResolvedValue({ data: { user: mockUser } });

      window.location.search = '?code=another-test-code';
      window.location.pathname = '/auth/callback';

      // Simulate React StrictMode by rendering twice
      const { rerender } = render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      // Simulate second render (StrictMode)
      await act(async () => {
        rerender(
          <AuthProvider>
            <TestComponent />
          </AuthProvider>
        );
      });

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Should only call fetch once despite multiple renders
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/oauth/token'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('another-test-code')
        })
      );
    });

    it('should clean up URL after successful exchange', async () => {
      const mockTokens = {
        access_token: 'test-access-token-3',
        refresh_token: 'test-refresh-token-3'
      };

      const mockUser = { id: 3, name: 'Test User 3', email: 'test3@example.com' };

      fetch.mockResolvedValue({
        json: () => Promise.resolve(mockTokens)
      });

      apiClient.get.mockResolvedValue({ data: { user: mockUser } });

      window.location.search = '?code=cleanup-test-code';
      window.location.pathname = '/auth/callback';

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Should clean up the URL
      expect(window.history.replaceState).toHaveBeenCalledWith(
        {}, 
        '', 
        '/' 
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle failed token exchange gracefully', async () => {
      const errorResponse = { error: 'invalid_grant', error_description: 'Invalid code' };

      fetch.mockResolvedValue({
        json: () => Promise.resolve(errorResponse)
      });

      window.location.search = '?code=invalid-code';
      window.location.pathname = '/auth/callback';

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Should not set any tokens
      expect(require('../../../services/apiClient').setAccessToken).not.toHaveBeenCalled();
      expect(localStorage.getItem('juggler-refresh-token')).toBeNull();

      // 999.1594 — the failure must be surfaced via the existing
      // /auth/callback?error=... "Authentication Failed" screen (App.js
      // AppContent), not silently wiped to '/' with no explanation.
      expect(window.history.replaceState).toHaveBeenCalledWith(
        {}, '', expect.stringMatching(/^\/auth\/callback\?error=/)
      );
    });

    it('should handle network errors during token exchange', async () => {
      fetch.mockRejectedValue(new Error('Network error'));

      window.location.search = '?code=network-error-code';
      window.location.pathname = '/auth/callback';

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });

      // Should not set any tokens
      expect(require('../../../services/apiClient').setAccessToken).not.toHaveBeenCalled();
      expect(localStorage.getItem('juggler-refresh-token')).toBeNull();

      // 999.1594 — network errors during the callback exchange must also land
      // on the visible error screen, not a silent bounce to '/'.
      expect(window.history.replaceState).toHaveBeenCalledWith(
        {}, '', expect.stringMatching(/^\/auth\/callback\?error=Network%20error$/)
      );
    });
  });
});
