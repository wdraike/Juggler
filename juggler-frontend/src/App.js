/**
 * Juggler App — main entry point
 * Auth handled by centralized auth-service via redirect flow
 */

import React from 'react';
import AuthProvider, { useAuth } from './components/auth/AuthProvider';
import LoginPage from './components/auth/LoginPage';
import AppLayout from './components/layout/AppLayout';
import ErrorBoundary from './components/ErrorBoundary';

function AppContent() {
  const { user, loading } = useAuth();

  // Handle auth callback route
  if (window.location.pathname === '/auth/callback') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1A2B4A',
        color: '#E8E0D0',
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 14
      }}>
        Completing sign in...
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1A2B4A',
        color: '#E8E0D0',
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 14
      }}>
        Loading...
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <AppLayout />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}
