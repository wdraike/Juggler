/**
 * AuthBootstrapScreen (999.2120) — sanctioned full-page auth-bootstrap wait
 * per the brand "Loading & Busy-State Standard": session state is unknowable
 * client-side, so a skeleton cannot match the destination. Brand treatment:
 * navy page, thin gold indeterminate bar + polite role=status text inside an
 * aria-busy region — never a bare text div. Mirrors payment-frontend's
 * AuthBootstrapScreen (999.2130) in juggler's no-MUI inline-style idiom.
 */

import React from 'react';

export default function AuthBootstrapScreen({ message }) {
  var msg = message || 'Loading…';
  return (
    <>
    <div
      data-testid="auth-bootstrap"
      aria-busy="true"
      style={{
        minHeight: '100vh', background: '#1A2B4A',
        fontFamily: "'Inter', system-ui, sans-serif",
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center'
      }}
    >
      <div
        data-testid="auth-bootstrap-bar"
        aria-hidden="true"
        style={{
          width: 220, height: 4, borderRadius: 2, overflow: 'hidden',
          position: 'relative', background: 'rgba(255, 255, 255, 0.08)',
          marginBottom: 16
        }}
      >
        <span className="auth-boot-fill" style={{
          position: 'absolute', top: 0, bottom: 0, width: '40%',
          background: '#C8942A', borderRadius: 2
        }} />
      </div>
      <style>{
        '@keyframes auth-boot-slide { 0% { left: -40%; } 100% { left: 100%; } }' +
        '.auth-boot-fill { animation: auth-boot-slide 1.4s ease-in-out infinite; }' +
        '@media (prefers-reduced-motion: reduce) { .auth-boot-fill { animation: none; left: 30%; } }'
      }</style>
    </div>
    <div
      role="status"
      style={{
        position: 'absolute',
        top: 'calc(50% + 20px)',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        color: '#E8E0D0',
        fontSize: 14,
        fontFamily: "'Inter', system-ui, sans-serif"
      }}
    >
      {msg}
    </div>
    </>
  );
}
