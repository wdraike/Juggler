/**
 * UpgradePrompt — shown when a user hits a premium feature without a subscription.
 * Listens for 'subscription:required' events dispatched by the API client.
 */

import React, { useState, useEffect } from 'react';
import { getTheme } from '../../theme/colors';

var BILLING_URL = process.env.REACT_APP_BILLING_URL || 'http://localhost:3003';

export default function UpgradePrompt({ darkMode }) {
  var [show, setShow] = useState(false);
  var [product, setProduct] = useState('juggler');
  var theme = getTheme(darkMode);

  useEffect(function() {
    function handleRequired(e) {
      setProduct(e.detail?.product || 'juggler');
      setShow(true);
    }
    window.addEventListener('subscription:required', handleRequired);
    return function() { window.removeEventListener('subscription:required', handleRequired); };
  }, []);

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }} onClick={() => setShow(false)}>
      <div style={{
        background: theme.bgSecondary, borderRadius: 12, padding: 32,
        maxWidth: 420, width: '90%', textAlign: 'center',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>&#x1F680;</div>
        <h2 style={{ color: theme.text, margin: '0 0 8px', fontSize: 22 }}>
          Upgrade to Pro
        </h2>
        <p style={{ color: theme.textMuted, margin: '0 0 24px', fontSize: 14, lineHeight: 1.5 }}>
          This feature requires a Pro subscription. Upgrade now to unlock AI-powered features, calendar sync, and more.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={() => { window.open(BILLING_URL + '/plans?product=' + product, '_blank'); setShow(false); }}
            style={{
              padding: '10px 24px', borderRadius: 6, border: 'none',
              background: theme.accent, color: '#fff', fontSize: 14,
              fontWeight: 600, cursor: 'pointer'
            }}
          >
            View Plans
          </button>
          <button
            onClick={() => setShow(false)}
            style={{
              padding: '10px 24px', borderRadius: 6,
              border: '1px solid ' + theme.border, background: 'transparent',
              color: theme.textMuted, fontSize: 14, cursor: 'pointer'
            }}
          >
            Not Now
          </button>
        </div>
      </div>
    </div>
  );
}
