/**
 * GCalSyncPanel — Simplified auto-sync UI for bidirectional Google Calendar sync
 * Connect once, toggle auto-sync, see last-synced time + manual trigger
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

export default function GCalSyncPanel({ onClose, darkMode, showToast, autoSync, lastSyncedAt, onAutoSyncChange, onSyncStart, onSyncComplete, isMobile, scheduling }) {
  var theme = getTheme(darkMode);
  var [syncing, setSyncing] = useState(false);
  var [connected, setConnected] = useState(null); // null = loading
  var [connecting, setConnecting] = useState(false);
  var [results, setResults] = useState(null);

  // Check connection status on mount
  useEffect(() => {
    apiClient.get('/gcal/status')
      .then(function(r) { setConnected(r.data.connected); })
      .catch(function() { setConnected(false); });
  }, []);

  // Listen for popup message indicating successful connection
  useEffect(() => {
    function handleMessage(e) {
      if (e.data === 'gcal-connected') {
        setConnected(true);
        setConnecting(false);
        showToast('Google Calendar connected!', 'success');
      }
    }
    window.addEventListener('message', handleMessage);
    return function() { window.removeEventListener('message', handleMessage); };
  }, [showToast]);

  async function handleConnect() {
    try {
      setConnecting(true);
      var { data } = await apiClient.get('/gcal/connect');
      var popup = window.open(data.authUrl, 'gcal-auth', 'width=500,height=600');
      var check = setInterval(function() {
        if (popup && popup.closed) {
          clearInterval(check);
          apiClient.get('/gcal/status')
            .then(function(r) {
              setConnected(r.data.connected);
              setConnecting(false);
              if (r.data.connected) {
                showToast('Google Calendar connected!', 'success');
              }
            })
            .catch(function() { setConnecting(false); });
        }
      }, 500);
    } catch (e) {
      setConnecting(false);
      showToast('Failed to start connection: ' + e.message, 'error');
    }
  }

  async function handleDisconnect() {
    try {
      await apiClient.post('/gcal/disconnect');
      setConnected(false);
      if (onAutoSyncChange) onAutoSyncChange(false);
      showToast('Google Calendar disconnected', 'success');
    } catch (e) {
      showToast('Failed to disconnect: ' + e.message, 'error');
    }
  }

  async function handleToggleAutoSync() {
    var newVal = !autoSync;
    try {
      await apiClient.post('/gcal/auto-sync', { enabled: newVal });
      if (onAutoSyncChange) onAutoSyncChange(newVal);
      showToast('Auto-sync ' + (newVal ? 'enabled' : 'disabled'), 'success');
    } catch (e) {
      showToast('Failed to toggle auto-sync: ' + e.message, 'error');
    }
  }

  async function handleSyncNow() {
    if (scheduling) return;
    try {
      setSyncing(true);
      setResults(null);
      if (onSyncStart) onSyncStart();
      var { data } = await apiClient.post('/gcal/sync');
      setResults(data);
      var parts = [];
      if (data.pushed) parts.push(data.pushed + ' pushed');
      if (data.pulled) parts.push(data.pulled + ' pulled');
      var deleted = (data.deleted_local || 0) + (data.deleted_remote || 0);
      if (deleted) parts.push(deleted + ' deleted');
      showToast(parts.length > 0 ? 'Synced: ' + parts.join(', ') : 'Already in sync', 'success');
      if (onSyncComplete) onSyncComplete();
    } catch (e) {
      var msg = e.response?.data?.error || e.message;
      showToast('Sync failed: ' + msg, 'error');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      <div style={{
        background: theme.bgSecondary, borderRadius: isMobile ? 0 : 12,
        width: isMobile ? '100%' : 420, maxWidth: isMobile ? '100%' : '95vw',
        height: isMobile ? '100%' : undefined, maxHeight: isMobile ? '100%' : '80vh',
        overflow: 'auto', padding: 20,
        boxShadow: isMobile ? 'none' : `0 8px 32px ${theme.shadow}`
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: theme.text }}>Google Calendar Sync</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: theme.textMuted, fontSize: 20, cursor: 'pointer' }}>&times;</button>
        </div>

        {/* Loading state */}
        {connected === null && (
          <div style={{ fontSize: 12, color: theme.textMuted, textAlign: 'center', padding: 20 }}>
            Checking connection...
          </div>
        )}

        {/* Not connected */}
        {connected === false && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 13, color: theme.textMuted, marginBottom: 16 }}>
              Connect your Google Calendar to sync tasks and events bidirectionally.
            </div>
            <button onClick={handleConnect} disabled={connecting} title="Authorize Juggler to read and write your Google Calendar" style={{
              border: 'none', borderRadius: 8, padding: '10px 24px',
              background: theme.accent, color: '#FFF', fontWeight: 600, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit', opacity: connecting ? 0.5 : 1
            }}>
              {connecting ? 'Connecting...' : 'Connect Google Calendar'}
            </button>
          </div>
        )}

        {/* Connected — simplified sync UI */}
        {connected === true && (
          <>
            {/* Auto-sync toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 0', borderBottom: `1px solid ${theme.border}`
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>Auto-sync</div>
                <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>
                  Sync every 5 minutes while app is open
                </div>
              </div>
              <label title={autoSync ? 'Disable auto-sync' : 'Enable auto-sync \u2014 syncs every 5 minutes'} style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!autoSync} onChange={handleToggleAutoSync} style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{
                  position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                  background: autoSync ? theme.accent : theme.border,
                  borderRadius: 11, transition: 'background 0.2s'
                }} />
                <span style={{
                  position: 'absolute', top: 2, left: autoSync ? 20 : 2,
                  width: 18, height: 18, background: '#FFF', borderRadius: '50%',
                  transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                }} />
              </label>
            </div>

            {/* Last synced */}
            <div style={{ padding: '12px 0', borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: 12, color: theme.textMuted }}>
                Last synced: <span style={{ color: theme.text, fontWeight: 500 }}>{formatRelativeTime(lastSyncedAt)}</span>
              </div>
            </div>

            {/* Sync Now button */}
            <div style={{ padding: '16px 0' }}>
              <button onClick={handleSyncNow} disabled={syncing || scheduling} title="Manually trigger a sync with Google Calendar now" style={{
                border: 'none', borderRadius: 8, padding: '10px 20px', width: '100%',
                background: theme.accent, color: '#FFF', fontWeight: 600, fontSize: 13,
                cursor: 'pointer', fontFamily: 'inherit', opacity: (syncing || scheduling) ? 0.5 : 1
              }}>
                {scheduling ? 'Scheduling\u2026' : syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>

            {/* Results summary */}
            {results && (
              <div style={{
                padding: 12, background: theme.bgTertiary,
                borderRadius: 8, fontSize: 12, color: theme.text, marginBottom: 12
              }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Sync Results</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 11, color: theme.textSecondary }}>
                  <div title="Tasks sent from Juggler to Google Calendar">Pushed: <strong style={{ color: theme.text }}>{results.pushed || 0}</strong></div>
                  <div title="Events imported from Google Calendar into Juggler">Pulled: <strong style={{ color: theme.text }}>{results.pulled || 0}</strong></div>
                  <div title="Items deleted locally to match Google Calendar">Deleted (local): <strong style={{ color: theme.text }}>{results.deleted_local || 0}</strong></div>
                  <div title="Items deleted from Google Calendar to match Juggler">Deleted (remote): <strong style={{ color: theme.text }}>{results.deleted_remote || 0}</strong></div>
                </div>
                {results.errors && results.errors.length > 0 && (
                  <div style={{ marginTop: 6, color: '#e74c3c', fontSize: 11 }}>
                    {results.errors.length} error(s) during sync
                  </div>
                )}
              </div>
            )}

            {/* Disconnect */}
            <div style={{ textAlign: 'center' }}>
              <button onClick={handleDisconnect} title="Revoke access and stop syncing with Google Calendar" style={{
                border: 'none', background: 'transparent', color: theme.textMuted,
                fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                textDecoration: 'underline'
              }}>
                Disconnect Google Calendar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
