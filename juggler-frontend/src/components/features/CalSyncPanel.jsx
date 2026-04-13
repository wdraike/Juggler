/**
 * CalSyncPanel — Unified calendar sync panel showing all providers
 * Single Sync Now button, per-provider connect/disconnect + auto-sync toggles
 */

import React, { useState, useEffect } from 'react';
import apiClient from '../../services/apiClient';
import { getTheme } from '../../theme/colors';

function formatRelativeTime(isoString) {
  if (!isoString) return 'Never';
  var diff = Date.now() - new Date(isoString).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  var days = Math.floor(hours / 24);
  return days + 'd ago';
}

var FREQUENCY_OPTIONS = [
  { value: 0, label: 'Manual only' },
  { value: 60, label: 'Every 1 min' },
  { value: 120, label: 'Every 2 min' },
  { value: 300, label: 'Every 5 min' },
  { value: 600, label: 'Every 10 min' },
  { value: 1800, label: 'Every 30 min' }
];

export default function CalSyncPanel({
  onClose, darkMode, showToast, isMobile,
  gcalAutoSync, gcalLastSyncedAt, onGcalAutoSyncChange,
  msftAutoSync, msftLastSyncedAt, onMsftAutoSyncChange,
  appleAutoSync, appleLastSyncedAt, appleConnected, onAppleAutoSyncChange, onAppleConnectedChange,
  calSyncSettings, onCalSyncSettingsChange,
  onSyncStart, onSyncComplete
}) {
  var theme = getTheme(darkMode);
  var [syncing, setSyncing] = useState(false);
  var [results, setResults] = useState(null);
  var [showHistory, setShowHistory] = useState(false);
  // Apple Calendar connection state
  var [appleUsername, setAppleUsername] = useState('');
  var [applePassword, setApplePassword] = useState('');
  var [appleConnecting, setAppleConnecting] = useState(false);
  var [appleCalendars, setAppleCalendars] = useState(null); // discovered calendars
  var [history, setHistory] = useState(null);
  var [loadingHistory, setLoadingHistory] = useState(false);
  var [syncProgress, setSyncProgress] = useState(null); // { phase, detail, pct }

  // Listen for sync:progress SSE events
  useEffect(() => {
    function handleSseMessage(e) {
      try {
        if (e.type === 'sync:progress') {
          var data = JSON.parse(e.data);
          setSyncProgress(data);
          if (data.phase === 'done') {
            setTimeout(function() { setSyncProgress(null); }, 1500);
          }
        }
      } catch (err) { /* ignore */ }
    }
    // Find the existing EventSource from the app's SSE connection
    var eventSources = window.__jugglerEventSource;
    if (eventSources) {
      eventSources.addEventListener('sync:progress', handleSseMessage);
      return function() { eventSources.removeEventListener('sync:progress', handleSseMessage); };
    }
  }, []);

  function loadHistory() {
    setLoadingHistory(true);
    apiClient.get('/cal/sync-history?limit=100').then(function(r) {
      setHistory(r.data.items || []);
      setShowHistory(true);
    }).catch(function() {
      setHistory([]);
      setShowHistory(true);
    }).finally(function() { setLoadingHistory(false); });
  }

  // Per-provider connection state
  var [gcalConnected, setGcalConnected] = useState(null);
  var [gcalConnecting, setGcalConnecting] = useState(false);
  var [gcalTokenExpired, setGcalTokenExpired] = useState(false);
  var [msftConnected, setMsftConnected] = useState(null);
  var [msftConnecting, setMsftConnecting] = useState(false);
  var [msftTokenExpired, setMsftTokenExpired] = useState(false);

  // Check connection status on mount
  useEffect(() => {
    apiClient.get('/gcal/status')
      .then(function(r) {
        setGcalConnected(r.data.connected);
        setGcalTokenExpired(!!r.data.tokenExpired);
      })
      .catch(function() { setGcalConnected(false); });
    apiClient.get('/msft-cal/status')
      .then(function(r) {
        setMsftConnected(r.data.connected);
        setMsftTokenExpired(!!r.data.tokenExpired);
      })
      .catch(function() { setMsftConnected(false); });
  }, []);

  // Listen for popup messages
  useEffect(() => {
    function handleMessage(e) {
      if (e.data === 'gcal-connected') {
        setGcalConnected(true);
        setGcalConnecting(false);
        showToast('Google Calendar connected!', 'success');
      }
      if (e.data === 'msftcal-connected') {
        setMsftConnected(true);
        setMsftConnecting(false);
        showToast('Microsoft Calendar connected!', 'success');
      }
    }
    window.addEventListener('message', handleMessage);
    return function() { window.removeEventListener('message', handleMessage); };
  }, [showToast]);

  var anyConnected = gcalConnected || msftConnected;
  var lastSynced = gcalLastSyncedAt || msftLastSyncedAt;

  // --- GCal handlers ---
  async function handleGcalConnect() {
    try {
      setGcalConnecting(true);
      var { data } = await apiClient.get('/gcal/connect');
      var popup = window.open(data.authUrl, 'gcal-auth', 'width=500,height=600');
      var check = setInterval(function() {
        if (popup && popup.closed) {
          clearInterval(check);
          apiClient.get('/gcal/status')
            .then(function(r) {
              setGcalConnected(r.data.connected);
              setGcalConnecting(false);
              if (r.data.connected) showToast('Google Calendar connected!', 'success');
            })
            .catch(function() { setGcalConnecting(false); });
        }
      }, 500);
    } catch (e) {
      setGcalConnecting(false);
      showToast('Failed to start connection: ' + e.message, 'error');
    }
  }

  async function handleGcalDisconnect() {
    try {
      await apiClient.post('/gcal/disconnect');
      setGcalConnected(false);
      if (onGcalAutoSyncChange) onGcalAutoSyncChange(false);
      showToast('Google Calendar disconnected', 'success');
    } catch (e) {
      showToast('Failed to disconnect: ' + e.message, 'error');
    }
  }

  async function handleGcalAutoSync() {
    var newVal = !gcalAutoSync;
    try {
      await apiClient.post('/gcal/auto-sync', { enabled: newVal });
      if (onGcalAutoSyncChange) onGcalAutoSyncChange(newVal);
    } catch (e) {
      showToast('Failed to toggle auto-sync: ' + e.message, 'error');
    }
  }

  // --- MSFT handlers ---
  async function handleMsftConnect() {
    try {
      setMsftConnecting(true);
      var { data } = await apiClient.get('/msft-cal/connect');
      var popup = window.open(data.authUrl, 'msft-cal-auth', 'width=500,height=600');
      var check = setInterval(function() {
        if (popup && popup.closed) {
          clearInterval(check);
          apiClient.get('/msft-cal/status')
            .then(function(r) {
              setMsftConnected(r.data.connected);
              setMsftConnecting(false);
              if (r.data.connected) showToast('Microsoft Calendar connected!', 'success');
            })
            .catch(function() { setMsftConnecting(false); });
        }
      }, 500);
    } catch (e) {
      setMsftConnecting(false);
      showToast('Failed to start connection: ' + e.message, 'error');
    }
  }

  async function handleMsftDisconnect() {
    try {
      await apiClient.post('/msft-cal/disconnect');
      setMsftConnected(false);
      if (onMsftAutoSyncChange) onMsftAutoSyncChange(false);
      showToast('Microsoft Calendar disconnected', 'success');
    } catch (e) {
      showToast('Failed to disconnect: ' + e.message, 'error');
    }
  }

  async function handleMsftAutoSync() {
    var newVal = !msftAutoSync;
    try {
      await apiClient.post('/msft-cal/auto-sync', { enabled: newVal });
      if (onMsftAutoSyncChange) onMsftAutoSyncChange(newVal);
    } catch (e) {
      showToast('Failed to toggle auto-sync: ' + e.message, 'error');
    }
  }

  // --- Apple Calendar ---
  async function handleAppleConnect() {
    if (!appleUsername || !applePassword) {
      showToast('Enter your Apple ID and app-specific password', 'error');
      return;
    }
    setAppleConnecting(true);
    try {
      var r = await apiClient.post('/apple-cal/connect', {
        username: appleUsername,
        password: applePassword
      });
      setAppleCalendars(r.data.calendars || []);
      showToast('Connected! Select a calendar below.', 'success');
    } catch (e) {
      var msg = e.response?.data?.error || e.message;
      showToast('Apple Calendar: ' + msg, 'error');
    } finally {
      setAppleConnecting(false);
    }
  }

  async function handleAppleSelectCalendar(url) {
    try {
      await apiClient.post('/apple-cal/select-calendar', { calendarUrl: url });
      setAppleCalendars(null);
      if (onAppleConnectedChange) onAppleConnectedChange(true);
      showToast('Apple Calendar connected', 'success');
    } catch (e) {
      showToast('Failed to select calendar: ' + e.message, 'error');
    }
  }

  async function handleAppleDisconnect() {
    try {
      await apiClient.post('/apple-cal/disconnect');
      if (onAppleConnectedChange) onAppleConnectedChange(false);
      if (onAppleAutoSyncChange) onAppleAutoSyncChange(false);
      setAppleCalendars(null);
      setAppleUsername('');
      setApplePassword('');
      showToast('Apple Calendar disconnected', 'success');
    } catch (e) {
      showToast('Failed to disconnect: ' + e.message, 'error');
    }
  }

  async function handleAppleAutoSync() {
    var newVal = !appleAutoSync;
    try {
      await apiClient.post('/apple-cal/auto-sync', { enabled: newVal });
      if (onAppleAutoSyncChange) onAppleAutoSyncChange(newVal);
    } catch (e) {
      showToast('Failed to toggle auto-sync: ' + e.message, 'error');
    }
  }

  // --- Unified sync ---
  async function handleSyncNow() {
    try {
      setSyncing(true);
      setResults(null);
      if (onSyncStart) onSyncStart();
      var { data } = await apiClient.post('/cal/sync');
      setResults(data);
      // Build smart toast from summary
      var summary = data.summary || [];
      var hasIssue = summary.some(function(s) { return s.hasIssue; });
      var pins = summary.filter(function(s) { return s.type === 'pin'; });
      var toastMsg;
      if (summary.length === 0) {
        toastMsg = 'Already in sync';
      } else if (summary.length <= 2) {
        toastMsg = 'Synced: ' + summary.map(function(s) { return s.text ? "'" + s.text + "' " + s.message.toLowerCase() : s.message; }).join('. ');
      } else {
        var counts = [];
        var pullCount = summary.filter(function(s) { return s.type === 'pull' || s.type === 'create'; }).length;
        var pushCount = summary.filter(function(s) { return s.type === 'push'; }).length;
        if (pullCount) counts.push(pullCount + ' updated');
        if (pushCount) counts.push(pushCount + ' pushed');
        if (pins.length) counts.push(pins.length + ' pinned');
        toastMsg = 'Synced: ' + counts.join(', ');
      }
      if (hasIssue) toastMsg += '. Check Conflicts for dependency issues.';
      showToast(toastMsg, hasIssue ? 'warning' : 'success');
      if (onSyncComplete) onSyncComplete();
    } catch (e) {
      if (e.response?.status === 409) {
        showToast('Sync is already running — please wait for it to finish', 'info');
        setSyncing(false);
        return;
      } else {
        // Check if any provider had a token expiry
        var respData = e.response?.data;
        var hasTokenExpiry = respData?.errors?.some(function(err) { return err.tokenExpired; });
        if (hasTokenExpiry) {
          showToast('Calendar connection expired. Please reconnect below.', 'error');
          // Refresh connection status
          apiClient.get('/gcal/status').then(function(r) {
            setGcalConnected(r.data.connected);
            setGcalTokenExpired(!!r.data.tokenExpired);
          }).catch(function() {});
          apiClient.get('/msft-cal/status').then(function(r) {
            setMsftConnected(r.data.connected);
            setMsftTokenExpired(!!r.data.tokenExpired);
          }).catch(function() {});
        } else {
          showToast('Sync failed: ' + (respData?.error || e.message), 'error');
        }
      }
    } finally {
      setSyncing(false);
    }
  }

  function renderToggle(checked, onChange, accentColor) {
    return (
      <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!checked} onChange={onChange} style={{ opacity: 0, width: 0, height: 0 }} />
        <span style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: checked ? accentColor : theme.border,
          borderRadius: 11, transition: 'background 0.2s'
        }} />
        <span style={{
          position: 'absolute', top: 2, left: checked ? 20 : 2,
          width: 18, height: 18, background: '#FDFAF5', borderRadius: '50%',
          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
        }} />
      </label>
    );
  }

  var selectStyle = {
    fontSize: 11, fontFamily: 'inherit', padding: '3px 6px',
    borderRadius: 2, border: '1px solid ' + theme.border,
    background: theme.bgPrimary, color: theme.text, cursor: 'pointer'
  };

  function renderProvider(label, connected, connecting, accentColor, autoSync, onConnect, onDisconnect, onToggleAutoSync, tokenExpired, providerId) {
    var provSettings = (calSyncSettings || {})[providerId] || { mode: 'full', frequency: 120 };
    var statusColor = tokenExpired ? '#C8942A' : connected ? '#2D6A4F' : theme.border;
    return (
      <div style={{
        padding: '12px 0', borderBottom: '1px solid ' + theme.border
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: (connected || tokenExpired) ? 8 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: statusColor
            }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{label}</span>
            {tokenExpired && <span style={{ fontSize: 10, color: '#C8942A', fontWeight: 600 }}>Expired</span>}
          </div>
          {connected === null && (
            <span style={{ fontSize: 11, color: theme.textMuted }}>Checking...</span>
          )}
          {connected === false && (
            <button onClick={onConnect} disabled={connecting} style={{
              border: '1.5px solid ' + accentColor, borderRadius: 2, padding: '5px 14px',
              background: accentColor, color: '#FDFAF5', fontWeight: 600, fontSize: 11,
              cursor: 'pointer', fontFamily: "'Inter', sans-serif", opacity: connecting ? 0.5 : 1,
              letterSpacing: '0.05em', textTransform: 'uppercase'
            }}>
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          )}
          {connected === true && (
            <span style={{ fontSize: 11, color: '#2D6A4F', fontWeight: 500 }}>Connected</span>
          )}
        </div>
        {connected === true && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: theme.textMuted }}>Sync mode</span>
              <select value={provSettings.mode} onChange={function(e) {
                var newSettings = Object.assign({}, calSyncSettings || {});
                newSettings[providerId] = Object.assign({}, provSettings, { mode: e.target.value });
                if (onCalSyncSettingsChange) onCalSyncSettingsChange(newSettings);
              }} style={selectStyle}>
                <option value="full">Full sync</option>
                <option value="ingest">Ingest only</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: theme.textMuted }}>Auto-sync</span>
              <select value={provSettings.frequency} onChange={function(e) {
                var freq = parseInt(e.target.value, 10);
                var newSettings = Object.assign({}, calSyncSettings || {});
                newSettings[providerId] = Object.assign({}, provSettings, { frequency: freq });
                if (onCalSyncSettingsChange) onCalSyncSettingsChange(newSettings);
                // Also update the legacy auto-sync boolean
                if (onToggleAutoSync) onToggleAutoSync(freq > 0);
              }} style={selectStyle}>
                {FREQUENCY_OPTIONS.map(function(opt) {
                  return <option key={opt.value} value={opt.value}>{opt.label}</option>;
                })}
              </select>
            </div>
            {provSettings.mode === 'ingest' && (
              <div style={{ fontSize: 10, color: theme.textMuted, fontStyle: 'italic' }}>
                One-way: pulls events from calendar, never writes back
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
              <button onClick={onDisconnect} style={{
                border: 'none', background: 'transparent', color: theme.textMuted,
                fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline'
              }}>
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      <div style={{
        background: theme.bgSecondary, borderRadius: isMobile ? 0 : 2,
        width: isMobile ? '100%' : 420, maxWidth: isMobile ? '100%' : '95vw',
        height: isMobile ? '100%' : undefined, maxHeight: isMobile ? '100%' : '80vh',
        overflow: 'auto', padding: 20,
        boxShadow: isMobile ? 'none' : '0 2px 8px ' + theme.shadow
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 700, color: theme.text }}>Calendar Sync</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: theme.textMuted, fontSize: 20, cursor: 'pointer' }}>&times;</button>
        </div>

        {/* Provider sections */}
        {renderProvider('Google Calendar', gcalConnected, gcalConnecting, theme.accent,
          gcalAutoSync, handleGcalConnect, handleGcalDisconnect, handleGcalAutoSync, gcalTokenExpired, 'gcal')}
        {renderProvider('Microsoft Calendar', msftConnected, msftConnecting, '#2E4A7A',
          msftAutoSync, handleMsftConnect, handleMsftDisconnect, handleMsftAutoSync, msftTokenExpired, 'msft')}

        {/* Apple Calendar — custom section (CalDAV credential auth, not OAuth) */}
        <div style={{ padding: '12px 0', borderBottom: '1px solid ' + theme.border }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: appleConnected ? '#2D6A4F' : theme.border }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>Apple Calendar</span>
            </div>
            {appleConnected && <span style={{ fontSize: 11, color: '#2D6A4F', fontWeight: 500 }}>Connected</span>}
          </div>

          {appleConnected ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {(() => {
                var provSettings = (calSyncSettings || {}).apple || { mode: 'full', frequency: 120 };
                return <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: theme.textMuted }}>Sync mode</span>
                    <select value={provSettings.mode} onChange={function(e) {
                      var newSettings = Object.assign({}, calSyncSettings || {});
                      newSettings.apple = Object.assign({}, provSettings, { mode: e.target.value });
                      if (onCalSyncSettingsChange) onCalSyncSettingsChange(newSettings);
                    }} style={selectStyle}>
                      <option value="full">Full sync</option>
                      <option value="ingest">Ingest only</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: theme.textMuted }}>Auto-sync</span>
                    <select value={provSettings.frequency} onChange={function(e) {
                      var freq = parseInt(e.target.value, 10);
                      var newSettings = Object.assign({}, calSyncSettings || {});
                      newSettings.apple = Object.assign({}, provSettings, { frequency: freq });
                      if (onCalSyncSettingsChange) onCalSyncSettingsChange(newSettings);
                      handleAppleAutoSync();
                    }} style={selectStyle}>
                      {FREQUENCY_OPTIONS.map(function(opt) {
                        return <option key={opt.value} value={opt.value}>{opt.label}</option>;
                      })}
                    </select>
                  </div>
                  {provSettings.mode === 'ingest' && (
                    <div style={{ fontSize: 10, color: theme.textMuted, fontStyle: 'italic' }}>
                      One-way: pulls events from calendar, never writes back
                    </div>
                  )}
                </>;
              })()}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                <button onClick={handleAppleDisconnect} style={{
                  border: 'none', background: 'transparent', color: theme.textMuted,
                  fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline'
                }}>Disconnect</button>
              </div>
            </div>
          ) : appleCalendars ? (
            /* Calendar selection after credential validation */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, color: theme.text, fontWeight: 500 }}>Select a calendar:</span>
              {appleCalendars.map(function(cal) {
                return (
                  <button key={cal.url} onClick={function() { handleAppleSelectCalendar(cal.url); }} style={{
                    border: '1px solid ' + theme.border, borderRadius: 4, padding: '6px 10px',
                    background: theme.bgPrimary, color: theme.text, fontSize: 12,
                    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left'
                  }}>{cal.displayName}{cal.description ? ' — ' + cal.description : ''}</button>
                );
              })}
              <button onClick={function() { setAppleCalendars(null); }} style={{
                border: 'none', background: 'transparent', color: theme.textMuted,
                fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline'
              }}>Cancel</button>
            </div>
          ) : (
            /* Credential input form */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                type="email" placeholder="Apple ID email"
                value={appleUsername} onChange={function(e) { setAppleUsername(e.target.value); }}
                style={{
                  fontSize: 12, fontFamily: 'inherit', padding: '6px 8px',
                  borderRadius: 4, border: '1px solid ' + theme.border,
                  background: theme.bgPrimary, color: theme.text
                }}
              />
              <input
                type="password" placeholder="App-specific password"
                value={applePassword} onChange={function(e) { setApplePassword(e.target.value); }}
                style={{
                  fontSize: 12, fontFamily: 'inherit', padding: '6px 8px',
                  borderRadius: 4, border: '1px solid ' + theme.border,
                  background: theme.bgPrimary, color: theme.text
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <a href="https://support.apple.com/en-us/102654" target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: 10, color: theme.accent }}>How to create an app-specific password</a>
                <button onClick={handleAppleConnect} disabled={appleConnecting} style={{
                  border: '1.5px solid #555', borderRadius: 2, padding: '5px 14px',
                  background: '#333', color: '#FDFAF5', fontWeight: 600, fontSize: 11,
                  cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                  opacity: appleConnecting ? 0.5 : 1,
                  letterSpacing: '0.05em', textTransform: 'uppercase'
                }}>{appleConnecting ? 'Connecting...' : 'Connect'}</button>
              </div>
            </div>
          )}
        </div>

        {/* Token expired warning */}
        {(gcalTokenExpired || msftTokenExpired) && (
          <div style={{
            padding: '10px 12px', margin: '12px 0 0', borderRadius: 2,
            background: '#FEF3C7', border: '1px solid #C8942A',
            color: '#92400E', fontSize: 12, lineHeight: 1.5
          }}>
            <strong style={{ display: 'block', marginBottom: 2 }}>Calendar connection expired</strong>
            {gcalTokenExpired && 'Google Calendar authorization has expired. '}
            {msftTokenExpired && 'Microsoft Calendar authorization has expired. '}
            Please disconnect and reconnect to restore sync.
          </div>
        )}

        {/* Last synced */}
        <div style={{ padding: '12px 0', borderBottom: '1px solid ' + theme.border }}>
          <div style={{ fontSize: 12, color: theme.textMuted }}>
            Last synced: <span style={{ color: theme.text, fontWeight: 500 }}>{formatRelativeTime(lastSynced)}</span>
          </div>
        </div>

        {/* Progress bar */}
        {syncing && syncProgress && (
          <div style={{ padding: '8px 0 0' }}>
            <div style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 4 }}>
              {syncProgress.detail || 'Syncing...'}
            </div>
            <div style={{ height: 4, background: theme.border, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', background: theme.accent, borderRadius: 2,
                width: (syncProgress.pct || 0) + '%',
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>
        )}

        {/* Sync Now button */}
        <div style={{ padding: syncing && syncProgress ? '8px 0 16px' : '16px 0' }}>
          <button onClick={handleSyncNow} disabled={syncing || !anyConnected}
            title={anyConnected ? 'Sync all connected calendars now' : 'Connect a calendar first'}
            style={{
              border: '1.5px solid ' + theme.accent, borderRadius: 2, padding: '10px 20px', width: '100%',
              background: theme.accent, color: '#1A2B4A', fontWeight: 700, fontSize: 13,
              cursor: anyConnected ? 'pointer' : 'default', fontFamily: "'Inter', sans-serif",
              opacity: (syncing || !anyConnected) ? 0.5 : 1,
              letterSpacing: '0.08em', textTransform: 'uppercase'
            }}>
            {syncing ? (syncProgress ? syncProgress.detail : 'Syncing...') : 'Sync Now'}
          </button>
        </div>

        {/* Results — readable activity log */}
        {results && !showHistory && (function() {
          var summary = results.summary || [];
          var icons = { pin: '\uD83D\uDCCC', pull: '\u2B07', push: '\u2B06', create: '\u2795', delete: '\uD83D\uDDD1', error: '\u26A0', info: '\u2139\uFE0F' };
          var fromCal = summary.filter(function(s) { return s.type === 'pull' || s.type === 'pin' || s.type === 'create'; });
          var pushed = summary.filter(function(s) { return s.type === 'push'; });
          var deleted = summary.filter(function(s) { return s.type === 'delete'; });
          var errors = summary.filter(function(s) { return s.type === 'error'; });
          var issues = summary.filter(function(s) { return s.hasIssue && s.type !== 'error'; });

          function renderEntry(s, i) {
            var isError = s.type === 'error';
            var isIssue = s.hasIssue;
            return (
              <div key={i} style={{
                display: 'flex', gap: 6, alignItems: 'flex-start', padding: '4px 0',
                fontSize: 11, color: isError ? '#DC2626' : isIssue ? '#92400E' : theme.text
              }}>
                <span style={{ flexShrink: 0, fontSize: 10 }}>{icons[s.type] || icons.info}</span>
                <div>
                  {s.text && <strong>{s.text}</strong>}
                  {s.text && ' — '}
                  <span style={{ color: isError ? '#DC2626' : isIssue ? '#B45309' : theme.textSecondary }}>{s.message}</span>
                </div>
              </div>
            );
          }

          function renderSection(label, items, bg) {
            if (items.length === 0) return null;
            return (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
                <div style={{ background: bg || 'transparent', borderRadius: 4, padding: bg ? '4px 8px' : 0, maxHeight: 200, overflowY: 'auto' }}>
                  {items.map(renderEntry)}
                </div>
              </div>
            );
          }

          return (
            <div style={{
              padding: 12, background: theme.bgTertiary,
              borderRadius: 2, fontSize: 12, color: theme.text,
              border: '1px solid ' + theme.border
            }}>
              {summary.length === 0 ? (
                <div style={{ fontSize: 12, color: theme.textSecondary, textAlign: 'center', padding: 8 }}>
                  Everything is in sync
                </div>
              ) : (
                <>
                  {renderSection('From your calendars', fromCal)}
                  {renderSection('Pushed to calendars', pushed)}
                  {renderSection('Removed', deleted)}
                  {errors.length > 0 && renderSection('Errors', errors, '#FEE2E220')}
                  {issues.length > 0 && renderSection('Issues', issues, '#FEF3C720')}
                </>
              )}
            </div>
          );
        })()
        }

        {/* History view */}
        {showHistory && (function() {
          var icons = { pin: '\uD83D\uDCCC', pull: '\u2B07', push: '\u2B06', create: '\u2795', delete: '\uD83D\uDDD1', error: '\u26A0', info: '\u2139\uFE0F' };
          var actionToIcon = { promoted: 'pin', pulled: 'pull', pushed: 'push', created: 'create', deleted_remote: 'delete', deleted_local: 'delete', conflict_juggler: 'push', conflict_provider: 'pull', error: 'error' };
          // Group by sync_run_id
          var runs = [];
          var runMap = {};
          (history || []).forEach(function(h) {
            if (!runMap[h.sync_run_id]) {
              runMap[h.sync_run_id] = { id: h.sync_run_id, time: h.created_at, items: [] };
              runs.push(runMap[h.sync_run_id]);
            }
            runMap[h.sync_run_id].items.push(h);
          });

          return (
            <div style={{
              padding: 12, background: theme.bgTertiary,
              borderRadius: 2, fontSize: 12, color: theme.text,
              border: '1px solid ' + theme.border
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 12 }}>Sync History</div>
                <button onClick={function() { setShowHistory(false); }} style={{
                  border: 'none', background: 'transparent', color: theme.textMuted,
                  fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline'
                }}>Back</button>
              </div>
              {runs.length === 0 ? (
                <div style={{ fontSize: 11, color: theme.textSecondary, textAlign: 'center', padding: 8 }}>No sync history yet</div>
              ) : (
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {runs.map(function(run) {
                    var errorCount = run.items.filter(function(h) { return h.action === 'error'; }).length;
                    var pushCount = run.items.filter(function(h) { return h.action === 'pushed'; }).length;
                    var pullCount = run.items.filter(function(h) { return h.action === 'pulled' || h.action === 'created'; }).length;
                    var parts = [];
                    if (pushCount) parts.push(pushCount + ' pushed');
                    if (pullCount) parts.push(pullCount + ' pulled');
                    if (errorCount) parts.push(errorCount + ' error' + (errorCount > 1 ? 's' : ''));
                    return (
                      <details key={run.id} style={{ marginBottom: 4 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 11, padding: '4px 0', color: theme.text }}>
                          <span style={{ fontWeight: 600 }}>{formatRelativeTime(run.time)}</span>
                          <span style={{ color: theme.textMuted }}> — {parts.join(', ') || run.items.length + ' actions'}</span>
                        </summary>
                        <div style={{ paddingLeft: 12, paddingBottom: 6 }}>
                          {run.items.map(function(h, i) {
                            var icon = icons[actionToIcon[h.action]] || icons.info;
                            var isError = h.action === 'error';
                            return (
                              <div key={i} style={{
                                display: 'flex', gap: 6, alignItems: 'flex-start', padding: '2px 0',
                                fontSize: 10, color: isError ? '#DC2626' : theme.text
                              }}>
                                <span style={{ flexShrink: 0 }}>{icon}</span>
                                <div>
                                  {h.task_text && <strong>{h.task_text}</strong>}
                                  {h.task_text && ' — '}
                                  <span style={{ color: isError ? '#DC2626' : theme.textSecondary }}>{h.detail || h.action}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()
        }

        {/* View History button */}
        <div style={{ padding: '8px 0 0', textAlign: 'center' }}>
          <button onClick={showHistory ? function() { setShowHistory(false); } : loadHistory} disabled={loadingHistory} style={{
            border: 'none', background: 'transparent', color: theme.textMuted,
            fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline',
            opacity: loadingHistory ? 0.5 : 1
          }}>
            {loadingHistory ? 'Loading...' : showHistory ? 'Hide History' : 'View Sync History'}
          </button>
        </div>
      </div>
    </div>
  );
}
