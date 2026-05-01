/**
 * CalSyncPanel — Unified calendar sync panel showing all providers
 * Single Sync Now button, per-provider connect/disconnect + auto-sync toggles
 */

import React, { useState, useEffect, useRef } from 'react';
import apiClient from '../../services/apiClient';
import { getTheme } from '../../theme/colors';

// knex dateStrings:true returns MySQL format "2026-05-01 19:44:00" (UTC, no Z).
// Normalize to a proper UTC ISO string so browsers parse it correctly.
function parseDbDate(str) {
  if (!str) return null;
  var s = String(str);
  if (!s.includes('Z') && !s.includes('+') && s.includes(' ') && !s.includes('T')) {
    s = s.replace(' ', 'T') + 'Z';
  }
  return new Date(s);
}

function formatRelativeTime(isoString) {
  if (!isoString) return 'Never';
  var d = parseDbDate(isoString);
  if (!d || isNaN(d.getTime())) return 'Never';
  var diff = Date.now() - d.getTime();
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
  var [appleCalendarSelections, setAppleCalendarSelections] = useState({}); // { url: { enabled, syncDirection } }
  var [savingCalendars, setSavingCalendars] = useState(false);
  var [connectedAppleCalendars, setConnectedAppleCalendars] = useState([]); // saved calendar rows from DB
  var [history, setHistory] = useState(null);
  var [loadingHistory, setLoadingHistory] = useState(false);
  var [syncProgress, setSyncProgress] = useState(null); // { phase, detail, pct }
  var [lockConflictCountdown, setLockConflictCountdown] = useState(null); // seconds remaining, or null

  // Listen for sync SSE events
  useEffect(() => {
    function handleSseProgress(e) {
      try {
        var data = JSON.parse(e.data);
        setSyncProgress(data);
        if (data.phase === 'done') {
          setTimeout(function() { setSyncProgress(null); }, 1500);
        }
      } catch (err) { /* ignore */ }
    }
    function handleSseError(e) {
      try {
        var data = JSON.parse(e.data);
        setSyncing(false);
        setSyncProgress(null);
        showToast('Sync failed: ' + (data.error || 'Unknown error'), 'error');
      } catch (err) {
        setSyncing(false);
        setSyncProgress(null);
      }
    }
    function handleSseLockConflict(e) {
      try {
        var data = JSON.parse(e.data);
        setLockConflictCountdown(data.retryAfter || 30);
      } catch (err) { /* ignore */ }
    }
    var eventSources = window.__jugglerEventSource;
    if (eventSources) {
      eventSources.addEventListener('sync:progress', handleSseProgress);
      eventSources.addEventListener('sync:error', handleSseError);
      eventSources.addEventListener('sync:lock_conflict', handleSseLockConflict);
      return function() {
        eventSources.removeEventListener('sync:progress', handleSseProgress);
        eventSources.removeEventListener('sync:error', handleSseError);
        eventSources.removeEventListener('sync:lock_conflict', handleSseLockConflict);
      };
    }
  }, []); // eslint-disable-line

  // Tick down lock conflict countdown
  useEffect(() => {
    if (lockConflictCountdown === null || lockConflictCountdown <= 0) return;
    var timer = setTimeout(function() {
      setLockConflictCountdown(function(prev) { return prev <= 1 ? null : prev - 1; });
    }, 1000);
    return function() { clearTimeout(timer); };
  }, [lockConflictCountdown]);

  // Safety timeout: if syncing stays true for 120s with no SSE events, auto-reset
  useEffect(() => {
    if (!syncing) return;
    var timeout = setTimeout(function() {
      setSyncing(false);
      setSyncProgress(null);
      showToast('Sync timed out — no response from server', 'warning');
    }, 120000);
    return function() { clearTimeout(timeout); };
  }, [syncing]); // eslint-disable-line

  function loadHistory() {
    setLoadingHistory(true);
    apiClient.get('/cal/sync-history?runs=20').then(function(r) {
      setHistory(r.data.runs || []);
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
    // Load connected Apple calendars
    if (appleConnected) {
      loadAppleCalendars();
    }
  }, []); // eslint-disable-line

  function loadAppleCalendars() {
    apiClient.get('/apple-cal/calendars')
      .then(function(r) {
        setConnectedAppleCalendars(r.data.calendars || []);
      })
      .catch(function() { setConnectedAppleCalendars([]); });
  }

  async function handleAppleCalendarUpdate(calId, updates) {
    try {
      await apiClient.put('/apple-cal/calendars/' + calId, updates);
      loadAppleCalendars();
      showToast('Calendar updated', 'success');
    } catch (e) {
      showToast('Failed to update calendar: ' + e.message, 'error');
    }
  }

  async function handleAppleCalendarToggle(calId, currentlyEnabled) {
    try {
      await apiClient.put('/apple-cal/calendars/' + calId, { enabled: !currentlyEnabled });
      loadAppleCalendars();
    } catch (e) {
      showToast('Failed to update calendar: ' + e.message, 'error');
    }
  }

  async function handleAppleRefreshCalendars() {
    try {
      var r = await apiClient.get('/apple-cal/refresh-calendars');
      setConnectedAppleCalendars(r.data.calendars || []);
      showToast('Calendars refreshed', 'success');
    } catch (e) {
      showToast('Failed to refresh: ' + (e.response?.data?.error || e.message), 'error');
    }
  }

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
      var cals = r.data.calendars || [];
      setAppleCalendars(cals);
      // Initialize selections from server state (existing selections preserved)
      var selections = {};
      cals.forEach(function(c) {
        selections[c.url] = {
          enabled: c.enabled || false,
          syncDirection: c.syncDirection || 'full'
        };
      });
      setAppleCalendarSelections(selections);
      showToast('Connected! Select calendars below.', 'success');
    } catch (e) {
      var msg = e.response?.data?.error || e.message;
      showToast('Apple Calendar: ' + msg, 'error');
    } finally {
      setAppleConnecting(false);
    }
  }

  function toggleAppleCalendar(url) {
    setAppleCalendarSelections(function(prev) {
      var next = Object.assign({}, prev);
      next[url] = Object.assign({}, next[url], { enabled: !next[url].enabled });
      return next;
    });
  }

  function setAppleCalSyncDirection(url, direction) {
    setAppleCalendarSelections(function(prev) {
      var next = Object.assign({}, prev);
      next[url] = Object.assign({}, next[url], { syncDirection: direction });
      return next;
    });
  }

  async function handleAppleSaveCalendars() {
    var selected = appleCalendars.map(function(cal) {
      var sel = appleCalendarSelections[cal.url] || {};
      return {
        url: cal.url,
        displayName: cal.displayName,
        enabled: !!sel.enabled,
        syncDirection: sel.syncDirection || 'full'
      };
    });

    var anyEnabled = selected.some(function(c) { return c.enabled; });
    if (!anyEnabled) {
      showToast('Select at least one calendar', 'error');
      return;
    }

    setSavingCalendars(true);
    try {
      await apiClient.post('/apple-cal/select-calendars', { calendars: selected });
      setAppleCalendars(null);
      if (onAppleConnectedChange) onAppleConnectedChange(true);
      loadAppleCalendars();
      showToast('Apple Calendar connected', 'success');
    } catch (e) {
      showToast('Failed to save calendars: ' + e.message, 'error');
    } finally {
      setSavingCalendars(false);
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
  var syncRetryAttempted = useRef(false);
  async function handleSyncNow() {
    try {
      syncRetryAttempted.current = false;
      setSyncing(true);
      setLockConflictCountdown(null);
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
        var retryAfter = e.response?.data?.retryAfter || 30;
        var jitter = Math.floor(Math.random() * 10);
        var retryDelay = retryAfter + jitter;
        if (!syncRetryAttempted.current) {
          showToast('Sync in progress — retrying in ~' + retryDelay + 's', 'info');
          syncRetryAttempted.current = true;
          setTimeout(function() { handleSyncNow(); }, retryDelay * 1000);
        } else {
          showToast('Sync is busy — please try again later', 'info');
          setSyncing(false);
        }
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
      if (!syncRetryAttempted.current) setLockConflictCountdown(null);
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
        width: isMobile ? '100%' : 560, maxWidth: isMobile ? '100%' : '95vw',
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {/* Connected calendars list */}
              {connectedAppleCalendars.length > 0 && connectedAppleCalendars.map(function(cal) {
                var isEnabled = !!cal.enabled;
                return (
                  <div key={cal.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '5px 8px', borderRadius: 4,
                    background: isEnabled
                      ? (darkMode ? 'rgba(200,175,120,0.06)' : 'rgba(200,175,120,0.04)')
                      : 'transparent',
                    border: '1px solid ' + (isEnabled ? theme.border : (darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)')),
                    opacity: isEnabled ? 1 : 0.5
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1, overflow: 'hidden' }}>
                      <input type="checkbox" checked={isEnabled} onChange={function() {
                        handleAppleCalendarToggle(cal.id, isEnabled);
                      }} style={{ margin: 0, accentColor: theme.accent }} />
                      <span style={{ fontSize: 11, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cal.display_name || cal.calendar_id}
                      </span>
                    </label>
                    {isEnabled && (
                      <div style={{ flexShrink: 0, marginLeft: 6 }}>
                        <select value={cal.sync_direction} onChange={function(e) {
                          handleAppleCalendarUpdate(cal.id, { syncDirection: e.target.value });
                        }} style={Object.assign({}, selectStyle, { fontSize: 10 })}>
                          <option value="full">Full</option>
                          <option value="ingest">Ingest</option>
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
              {connectedAppleCalendars.length === 0 && (
                <div style={{ fontSize: 11, color: theme.textMuted, fontStyle: 'italic' }}>
                  No calendars found
                </div>
              )}
              {/* Auto-sync frequency */}
              {(() => {
                var provSettings = (calSyncSettings || {}).apple || { mode: 'full', frequency: 120 };
                return (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
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
                );
              })()}
              {/* Manage / Disconnect */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                <button onClick={handleAppleRefreshCalendars} style={{
                  border: 'none', background: 'transparent', color: theme.accent,
                  fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline'
                }}>Manage calendars</button>
                <button onClick={handleAppleDisconnect} style={{
                  border: 'none', background: 'transparent', color: theme.textMuted,
                  fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline'
                }}>Disconnect all</button>
              </div>
            </div>
          ) : appleCalendars ? (
            /* Calendar selection after credential validation — multi-select with toggles */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, color: theme.text, fontWeight: 500 }}>Select calendars to sync:</span>
              {appleCalendars.map(function(cal) {
                var sel = appleCalendarSelections[cal.url] || { enabled: false, syncDirection: 'full' };
                return (
                  <div key={cal.url} style={{
                    border: '1px solid ' + (sel.enabled ? theme.accent : theme.border),
                    borderRadius: 4, padding: '8px 10px',
                    background: sel.enabled ? (darkMode ? 'rgba(200,175,120,0.08)' : 'rgba(200,175,120,0.05)') : theme.bgPrimary
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}>
                        <input type="checkbox" checked={sel.enabled}
                          onChange={function() { toggleAppleCalendar(cal.url); }}
                          style={{ accentColor: theme.accent }} />
                        <span style={{ fontSize: 12, color: theme.text }}>
                          {cal.displayName}{cal.description ? ' — ' + cal.description : ''}
                        </span>
                      </label>
                    </div>
                    {sel.enabled && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, paddingLeft: 24 }}>
                        <span style={{ fontSize: 10, color: theme.textMuted }}>Sync</span>
                        <select value={sel.syncDirection}
                          onChange={function(e) { setAppleCalSyncDirection(cal.url, e.target.value); }}
                          style={selectStyle}>
                          <option value="full">Full (read + write)</option>
                          <option value="ingest">Ingest only (read)</option>
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <button onClick={function() { setAppleCalendars(null); }} style={{
                  border: 'none', background: 'transparent', color: theme.textMuted,
                  fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline'
                }}>Cancel</button>
                <button onClick={handleAppleSaveCalendars} disabled={savingCalendars} style={{
                  border: '1.5px solid #555', borderRadius: 2, padding: '5px 14px',
                  background: '#333', color: '#FDFAF5', fontWeight: 600, fontSize: 11,
                  cursor: 'pointer', fontFamily: "'Inter', sans-serif",
                  opacity: savingCalendars ? 0.5 : 1,
                  letterSpacing: '0.05em', textTransform: 'uppercase'
                }}>{savingCalendars ? 'Saving...' : 'Save'}</button>
              </div>
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
            <div style={{ fontSize: 11, color: theme.textSecondary, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              {syncProgress.provider && (
                <span style={{
                  display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                  background: syncProgress.provider === 'gcal' ? theme.accent
                    : syncProgress.provider === 'msft' ? '#2E4A7A'
                    : syncProgress.provider === 'apple' ? '#2D6A4F' : theme.textMuted
                }} />
              )}
              <span>
                {syncProgress.provider && <strong style={{ fontWeight: 600 }}>
                  {syncProgress.provider === 'gcal' ? 'Google' : syncProgress.provider === 'msft' ? 'Microsoft' : syncProgress.provider === 'apple' ? 'Apple' : ''}
                  {syncProgress.calendar ? ' (' + syncProgress.calendar + ')' : ''}
                </strong>}
                {syncProgress.provider && ' — '}
                {syncProgress.detail || 'Syncing...'}
              </span>
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
          {lockConflictCountdown !== null && (
            <div style={{ marginTop: 6, fontSize: 11, color: theme.textSecondary, textAlign: 'center' }}>
              Scheduler busy — retrying in {lockConflictCountdown}s…
            </div>
          )}
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
          var PROVIDER_LABELS = { gcal: 'Google', msft: 'Microsoft', apple: 'Apple' };
          var ACTION_LABELS = {
            pushed: 'Pushed to calendar', pulled: 'Updated from calendar',
            promoted: 'Pinned to calendar time', created: 'Task created from event',
            deleted_local: 'Removed from calendar', deleted_remote: 'Task deleted (event gone)',
            conflict_juggler: 'Conflict: Juggler wins', conflict_provider: 'Conflict: calendar wins',
            repush: 'Re-created event', error: 'Error'
          };
          var ACTION_ICONS = {
            pushed: '⬆', pulled: '⬇', promoted: '📌',
            created: '➕', deleted_local: '🗑', deleted_remote: '🗑',
            conflict_juggler: '⬆', conflict_provider: '⬇',
            repush: '♻', error: '⚠'
          };

          function formatAbsTime(isoString) {
            if (!isoString) return '';
            var d = parseDbDate(isoString);
            if (!d || isNaN(d.getTime())) return '';
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          }

          function formatEventTime(input) {
            if (!input) return null;
            var d = input instanceof Date ? input : new Date(input);
            if (isNaN(d.getTime())) return null;
            return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
              + ', ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }

          function summarizeRun(counts) {
            var parts = [];
            var pushCount = (counts.pushed || 0) + (counts.conflict_juggler || 0) + (counts.repush || 0);
            var pullCount = (counts.pulled || 0) + (counts.promoted || 0) + (counts.created || 0) + (counts.conflict_provider || 0);
            var orphanCount = counts.deleted_local || 0;
            var deleteCount = counts.deleted_remote || 0;
            var errorCount = counts.error || 0;
            if (pushCount) parts.push(pushCount + ' pushed');
            if (pullCount) parts.push(pullCount + ' pulled');
            if (orphanCount) parts.push(orphanCount + ' cleaned up');
            if (deleteCount) parts.push(deleteCount + ' deleted');
            if (errorCount) parts.push(errorCount + ' error' + (errorCount > 1 ? 's' : ''));
            return parts.length ? parts.join(' · ') : 'No changes';
          }

          function renderItem(h, i) {
            var isError = h.action === 'error';
            var icon = ACTION_ICONS[h.action] || 'ℹ️';
            var label = ACTION_LABELS[h.action] || h.action;
            var ed = isError ? h.error_detail : null;
            // scheduled_at is a MySQL UTC string — must use parseDbDate to avoid local-time misparse.
            // startDateTime is a provider-native string already in local tz — use new Date() directly.
            var oldTime = h.old_values
              ? formatEventTime(h.old_values.scheduled_at ? parseDbDate(h.old_values.scheduled_at) : h.old_values.startDateTime)
              : null;
            var newTime = h.new_values && h.new_values.scheduled_at
              ? formatEventTime(parseDbDate(h.new_values.scheduled_at))
              : null;
            // Suppress the arrow when both sides show the same time (format-only difference in DB).
            if (oldTime && newTime && oldTime === newTime) { oldTime = null; newTime = null; }

            return (
              <div key={i} style={{
                display: 'flex', gap: 6, alignItems: 'flex-start',
                padding: '4px 0',
                borderTop: i > 0 ? '1px solid ' + (darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)') : 'none',
                fontSize: 10, color: isError ? '#DC2626' : theme.text
              }}>
                <span style={{ flexShrink: 0, fontSize: 10, marginTop: 1 }}>{icon}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  {ed ? (
                    <>
                      <div style={{ color: '#DC2626', fontWeight: 500 }}>{ed.summary || label}</div>
                      {ed.affectedTasks && ed.affectedTasks.length > 0 && (
                        <div style={{ color: theme.textSecondary, marginTop: 1 }}>
                          {ed.affectedTasks.map(function(t) { return t.title; }).join(', ')}
                        </div>
                      )}
                      {!ed.retryable && ed.userAction && (
                        <div style={{
                          marginTop: 2, padding: '2px 5px', borderRadius: 2,
                          background: darkMode ? 'rgba(220,38,38,0.12)' : '#FEE2E2',
                          color: '#B91C1C', fontWeight: 600
                        }}>{ed.userAction}</div>
                      )}
                      {ed.retryable && (
                        <div style={{ color: theme.textMuted, fontStyle: 'italic', marginTop: 1 }}>Will retry automatically</div>
                      )}
                    </>
                  ) : (
                    <>
                      <div>
                        {h.task_text && <span style={{ fontWeight: 600 }}>{h.task_text}</span>}
                        {h.task_text && <span style={{ color: theme.textMuted }}> — </span>}
                        <span style={{ color: theme.textSecondary }}>{label}</span>
                        {h.calendar_name && <span style={{ color: theme.textMuted }}> ({h.calendar_name})</span>}
                      </div>
                      {(oldTime || newTime) && (
                        <div style={{ color: theme.textMuted, marginTop: 1 }}>
                          {oldTime && newTime ? oldTime + ' → ' + newTime : oldTime ? 'was ' + oldTime : 'now ' + newTime}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          }

          var runs = history || [];

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
                <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                  {runs.map(function(run) {
                    var providerLabel = (run.providers || []).map(function(p) { return PROVIDER_LABELS[p] || p; }).join(' + ');
                    var calLabel = (run.calendar_names || []).length ? ' (' + run.calendar_names.join(', ') + ')' : '';
                    var triggerLabel = run.trigger_type === 'auto' ? 'Auto' : 'Manual';
                    var hasErrors = (run.counts && run.counts.error) > 0;
                    var summary = summarizeRun(run.counts || {});
                    var errorItems = (run.items || []).filter(function(h) { return h.action === 'error'; });
                    var cleanedItems = (run.items || []).filter(function(h) { return h.action === 'deleted_local'; });
                    var meaningfulItems = (run.items || []).filter(function(h) { return h.action !== 'error' && h.action !== 'deleted_local'; });

                    // Deduplicate errors by summary message
                    var errorGroups = {};
                    errorItems.forEach(function(h) {
                      var ed = h.error_detail || {};
                      var key = ed.summary || 'Sync error';
                      if (!errorGroups[key]) {
                        errorGroups[key] = { summary: key, count: 0, userAction: ed.userAction || null, retryable: !!ed.retryable, tasks: [] };
                      }
                      errorGroups[key].count++;
                      if (ed.affectedTasks) {
                        ed.affectedTasks.forEach(function(t) {
                          if (errorGroups[key].tasks.length < 3 && errorGroups[key].tasks.indexOf(t.title) < 0) {
                            errorGroups[key].tasks.push(t.title);
                          }
                        });
                      }
                    });
                    var errorGroupList = Object.values(errorGroups);

                    return (
                      <details key={run.sync_run_id} style={{ marginBottom: 6, borderBottom: '1px solid ' + theme.border, paddingBottom: 4 }}>
                        <summary style={{ cursor: 'pointer', padding: '4px 0', listStyle: 'none', userSelect: 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <span style={{
                              fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                              color: run.trigger_type === 'auto' ? theme.textMuted : theme.accent,
                              border: '1px solid ' + (run.trigger_type === 'auto' ? theme.border : theme.accent),
                              borderRadius: 2, padding: '1px 4px', flexShrink: 0
                            }}>{triggerLabel}</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: theme.text }}>
                              {formatAbsTime(run.created_at)}
                            </span>
                            <span style={{ fontSize: 10, color: theme.textMuted }}>
                              ({formatRelativeTime(run.created_at)})
                            </span>
                          </div>
                          <div style={{ fontSize: 10, paddingLeft: 2 }}>
                            {providerLabel && <span style={{ color: theme.textMuted }}>{providerLabel}{calLabel} — </span>}
                            <span style={{ color: hasErrors ? '#DC2626' : theme.textSecondary }}>{summary}</span>
                          </div>
                        </summary>
                        <div style={{ paddingLeft: 8, paddingTop: 4 }}>
                          {errorGroupList.map(function(group, gi) {
                            return (
                              <div key={gi} style={{
                                display: 'flex', gap: 6, alignItems: 'flex-start',
                                padding: '4px 0',
                                borderTop: gi > 0 ? '1px solid ' + (darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)') : 'none',
                                fontSize: 10
                              }}>
                                <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
                                <div>
                                  <div>
                                    <span style={{ color: '#DC2626', fontWeight: 500 }}>{group.summary}</span>
                                    {group.count > 1 && <span style={{ color: '#DC2626' }}> ×{group.count}</span>}
                                  </div>
                                  {group.tasks.length > 0 && (
                                    <div style={{ color: theme.textMuted, marginTop: 1 }}>
                                      {group.tasks.join(', ')}{group.count > group.tasks.length ? '…' : ''}
                                    </div>
                                  )}
                                  {group.userAction && !group.retryable && (
                                    <div style={{
                                      marginTop: 2, padding: '2px 5px', borderRadius: 2,
                                      background: darkMode ? 'rgba(220,38,38,0.12)' : '#FEE2E2',
                                      color: '#B91C1C', fontWeight: 600
                                    }}>{group.userAction}</div>
                                  )}
                                  {group.retryable && (
                                    <div style={{ color: theme.textMuted, fontStyle: 'italic', marginTop: 1 }}>Will retry automatically</div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {cleanedItems.length > 0 && (
                            <div style={{ fontSize: 10, color: theme.textMuted, padding: '3px 0', borderTop: (errorGroupList.length > 0 || meaningfulItems.length > 0) ? '1px solid ' + (darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)') : 'none' }}>
                              + {cleanedItems.length} orphan event{cleanedItems.length > 1 ? 's' : ''} cleaned up
                            </div>
                          )}
                          {meaningfulItems.map(renderItem)}
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
