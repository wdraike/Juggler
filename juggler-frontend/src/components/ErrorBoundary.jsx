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
          background: '#1A2B4A', color: '#E8E0D0', fontFamily: "'Inter', system-ui"
        }}>
          <div style={{ textAlign: 'center', maxWidth: 480, padding: 32 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>&#x1F6A8;</div>
            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h2>
            <p style={{ fontSize: 13, color: '#B0A898', marginBottom: 16, lineHeight: 1.5 }}>
              Raike &amp; Sons encountered an unexpected error. Your data is safe.
            </p>
            <pre style={{
              textAlign: 'left', fontSize: 11, background: '#0F1520', padding: 12,
              borderRadius: 2, overflow: 'auto', maxHeight: 120, color: '#FCA5A5',
              marginBottom: 16, border: '1px solid #2E4A7A'
            }}>
              {this.state.error?.message || 'Unknown error'}
            </pre>
            <button onClick={() => window.location.reload()} style={{
              border: '1.5px solid #C8942A', borderRadius: 2, padding: '10px 24px',
              background: '#C8942A', color: '#1A2B4A', fontWeight: 700, fontSize: 14,
              cursor: 'pointer', fontFamily: "'Inter', sans-serif",
              letterSpacing: '0.08em', textTransform: 'uppercase'
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
