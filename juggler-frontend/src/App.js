/**
 * Juggler App — main entry point
 * Auth handled by centralized auth-service via redirect flow
 */

import React from 'react';
import './theme/typography.css';
import AuthProvider, { useAuth } from './components/auth/AuthProvider';
import LoginPage from './components/auth/LoginPage';
import AppLayout from './components/layout/AppLayout';
import ErrorBoundary from './components/ErrorBoundary';
import UpgradePrompt from './components/billing/UpgradePrompt';
import SchedulerDebug from './components/admin/SchedulerDebug';
import SchedulerStepper from './components/admin/SchedulerStepper';
import ImpersonationPage from './components/admin/ImpersonationPage';

function AppContent() {
  const { user, loading } = useAuth();

  // Hidden admin route — scheduler debug visualization
  if (window.location.pathname === '/admin/scheduler-debug') {
    return user ? <SchedulerDebug /> : <LoginPage />;
  }
  // Hidden admin route — step-by-step scheduler stepper
  if (window.location.pathname === '/admin/scheduler-stepper') {
    return user ? <SchedulerStepper /> : <LoginPage />;
  }
  // Hidden admin route — user impersonation
  if (window.location.pathname === '/admin/impersonation') {
    return user ? <ImpersonationPage darkMode={true} /> : <LoginPage />;
  }

  // Handle auth callback route
  if (window.location.pathname === '/auth/callback') {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    // Valid callback with code — show authenticating state
    if (code) {
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

    // Auth provider returned an error
    if (error) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          background: '#1A2B4A',
          color: '#E8E0D0',
          fontFamily: "'Inter', system-ui, sans-serif"
        }}>
          <h1 style={{ color: '#ff6b6b', marginBottom: '1rem', fontSize: 24 }}>
            Authentication Failed
          </h1>
          <p style={{ color: '#A0A0A0', marginBottom: '2rem', maxWidth: '400px', textAlign: 'center', fontSize: 14 }}>
            {error === 'access_denied'
              ? 'You denied the authentication request. Please try again.'
              : `An error occurred during authentication: ${error}`}
          </p>
          <a
            href="/login"
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#4A90D9',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
              fontWeight: 500,
              fontSize: 14
            }}
          >
            Go to Login
          </a>
        </div>
      );
    }

    // No code, no error — dead-end guard
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background: '#1A2B4A',
        color: '#E8E0D0',
        fontFamily: "'Inter', system-ui, sans-serif"
      }}>
        <h1 style={{ color: '#A0A0A0', marginBottom: '1rem', fontSize: 24 }}>
          Invalid Authentication Request
        </h1>
        <p style={{ color: '#888', marginBottom: '2rem', maxWidth: '400px', textAlign: 'center', fontSize: 14 }}>
          You reached the authentication callback page without a valid login request.
          This usually happens if you navigated here directly or your session expired.
        </p>
        <a
          href="/login"
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: '#4A90D9',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '4px',
            fontWeight: 500,
            fontSize: 14
          }}
        >
          Go to Login
        </a>
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

  return (
    <>
      <AppLayout />
      <UpgradePrompt />
    </>
  );
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
