/**
 * ErrorBoundary — catches React render errors and shows recovery UI
 */

import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error: error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#0F172A', color: '#E2E8F0', fontFamily: "'DM Sans', system-ui"
        }}>
          <div style={{ textAlign: 'center', maxWidth: 480, padding: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#x1F6A8;</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h2>
            <p style={{ fontSize: 13, color: '#94A3B8', marginBottom: 16, lineHeight: 1.5 }}>
              Juggler encountered an unexpected error. Your data is safe.
            </p>
            <pre style={{
              textAlign: 'left', fontSize: 11, background: '#1E293B', padding: 12,
              borderRadius: 8, overflow: 'auto', maxHeight: 120, color: '#F87171',
              marginBottom: 16
            }}>
              {this.state.error?.message || 'Unknown error'}
            </pre>
            <button onClick={() => window.location.reload()} style={{
              border: 'none', borderRadius: 8, padding: '10px 24px',
              background: '#3B82F6', color: '#FFF', fontWeight: 600, fontSize: 14,
              cursor: 'pointer', fontFamily: 'inherit'
            }}>
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
