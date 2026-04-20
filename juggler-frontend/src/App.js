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
