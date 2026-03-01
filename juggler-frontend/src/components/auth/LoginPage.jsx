/**
 * LoginPage — Google Sign-In button
 */

import React from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from './AuthProvider';

export default function LoginPage() {
  const { login } = useAuth();

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0F172A',
      fontFamily: "'DM Sans', system-ui, sans-serif",
      color: '#E2E8F0'
    }}>
      <div style={{
        textAlign: 'center',
        maxWidth: 400,
        padding: 40
      }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🤹</div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px', color: '#F1F5F9' }}>
          Juggler
        </h1>
        <p style={{ fontSize: 14, color: '#94A3B8', marginBottom: 32 }}>
          Task tracker & scheduler
        </p>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <GoogleLogin
            onSuccess={async (credentialResponse) => {
              try {
                await login(credentialResponse.credential);
              } catch (err) {
                console.error('Login failed:', err);
              }
            }}
            onError={() => {
              console.error('Google login failed');
            }}
            theme="filled_black"
            size="large"
            text="signin_with"
            shape="rectangular"
          />
        </div>
      </div>
    </div>
  );
}
