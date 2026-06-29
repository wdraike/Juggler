/**
 * NotificationsTab — extracted from SettingsPanel (999.965).
 */
import React, { useState, useEffect } from 'react';
import { isPushSupported, getSubscriptionState, subscribeToPush, unsubscribeFromPush } from '../../../services/pushNotifications';

export default function NotificationsTab({ theme, showToast }) {
  var [supported] = useState(function() { return isPushSupported(); });
  var [permission, setPermission] = useState('default');
  var [subscribed, setSubscribed] = useState(false);
  var [busy, setBusy] = useState(false);
  var [loaded, setLoaded] = useState(false);

  useEffect(function() {
    var cancelled = false;
    getSubscriptionState().then(function(state) {
      if (cancelled) return;
      setPermission(state.permission);
      setSubscribed(state.subscribed);
      setLoaded(true);
    }).catch(function() {
      if (!cancelled) setLoaded(true);
    });
    return function() { cancelled = true; };
  }, []);

  function notify(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type);
  }

  async function handleEnable() {
    setBusy(true);
    try {
      await subscribeToPush();
      setSubscribed(true);
      setPermission('granted');
      notify('Push notifications enabled', 'success');
    } catch (err) {
      if (typeof Notification !== 'undefined') setPermission(Notification.permission);
      notify(err && err.message ? err.message : 'Could not enable notifications', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    try {
      await unsubscribeFromPush();
      setSubscribed(false);
      notify('Push notifications disabled', 'info');
    } catch (err) {
      notify(err && err.message ? err.message : 'Could not disable notifications', 'error');
    } finally {
      setBusy(false);
    }
  }

  var cardStyle = { border: '1px solid ' + theme.border, borderRadius: 8, padding: 16, background: theme.bgCard, maxWidth: 520 };
  var pStyle = { color: theme.textSecondary, fontSize: 13, lineHeight: 1.5, margin: '8px 0 0' };

  if (!supported) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>Browser notifications</div>
        <p style={pStyle}>This browser does not support push notifications.</p>
      </div>
    );
  }

  var denied = permission === 'denied';
  var btnBase = { border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 };

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 15, fontWeight: 600, color: theme.text }}>Browser notifications</div>
      <p style={pStyle}>Get a notification when a task reminder fires — even when Juggler is not the active tab.</p>
      {denied && (<p style={Object.assign({}, pStyle, { color: theme.danger || '#C0392B' })}>Notifications are blocked for this site.</p>)}
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
        {!loaded ? (<span style={{ color: theme.textMuted, fontSize: 13 }}>Checking status…</span>)
        : subscribed ? (<><span style={{ color: theme.success || '#1E7E34', fontSize: 13, fontWeight: 600 }}>✓ Enabled on this device</span>
          <button onClick={handleDisable} disabled={busy} style={Object.assign({}, btnBase, { background: 'transparent', color: theme.textSecondary, border: '1px solid ' + theme.border })}>{busy ? 'Working…' : 'Disable'}</button></>)
        : (<button onClick={handleEnable} disabled={busy || denied}
            style={Object.assign({}, btnBase, { background: denied ? theme.border : theme.accent, color: denied ? theme.textMuted : '#FDFAF5', cursor: denied ? 'not-allowed' : (busy ? 'wait' : 'pointer') })}>{busy ? 'Enabling…' : 'Enable notifications'}</button>)}
      </div>
    </div>
  );
}
