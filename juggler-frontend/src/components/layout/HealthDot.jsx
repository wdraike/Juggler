/**
 * HealthDot — small colored dot in the header reflecting backend health.
 *
 * Polls GET /api/health/detailed every 60s (authenticated). Hover for a
 * tooltip summary; click to pop a detail card with per-service status,
 * uptime, and a manual refresh.
 *
 * Status colors:
 *   OK        → green   — all services operational
 *   DEGRADED  → amber   — some service idle / not configured / unknown
 *   ERROR     → red     — any service in error; also set on network failure
 *   checking  → gray    — initial load, before first response
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import apiClient from '../../services/apiClient';

var POLL_INTERVAL_MS = 60 * 1000; // 60s — matches climbrs default cadence
var NETWORK_TIMEOUT_MS = 5000;

export default function HealthDot({ darkMode, theme }) {
  var [state, setState] = useState({ status: 'checking', data: null, error: null, lastChecked: null });
  var [expanded, setExpanded] = useState(false);
  var [isChecking, setIsChecking] = useState(false);
  var inflightRef = useRef(false);
  var popoverRef = useRef(null);

  var check = useCallback(async function() {
    if (inflightRef.current) return;
    inflightRef.current = true;
    setIsChecking(true);
    try {
      var controller = new AbortController();
      var timeoutId = setTimeout(function() { controller.abort(); }, NETWORK_TIMEOUT_MS);
      var res = await apiClient.get('/health/detailed', { signal: controller.signal });
      clearTimeout(timeoutId);
      var data = res.data;
      setState({ status: (data.status || 'UNKNOWN').toUpperCase(), data: data, error: null, lastChecked: new Date() });
    } catch (err) {
      // 401 before login or a network blip both collapse to 'ERROR' — the
      // user can't distinguish "backend is down" from "I'm logged out" at
      // the dot level, and a red dot for either is reasonable. The popover
      // shows the raw error text so the user can tell them apart.
      setState({ status: 'ERROR', data: null, error: (err && err.message) || 'Health check failed', lastChecked: new Date() });
    } finally {
      inflightRef.current = false;
      setIsChecking(false);
    }
  }, []);

  useEffect(function() {
    check();
    var timer = setInterval(check, POLL_INTERVAL_MS);
    return function() { clearInterval(timer); };
  }, [check]);

  // Close popover on outside click.
  useEffect(function() {
    if (!expanded) return undefined;
    function onDocClick(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) setExpanded(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return function() { document.removeEventListener('mousedown', onDocClick); };
  }, [expanded]);

  var color = (function() {
    if (state.status === 'OK') return '#43A047';       // green
    if (state.status === 'DEGRADED') return '#F9A825'; // amber
    if (state.status === 'ERROR') return '#E53935';    // red
    return theme ? theme.textMuted : '#888';           // checking
  })();

  var tooltip = (function() {
    if (state.status === 'checking') return 'Checking backend…';
    if (state.error) return 'Backend: ' + state.error;
    if (!state.data) return 'Backend status unknown';
    var svc = state.data.services || {};
    var lines = ['Status: ' + state.status];
    Object.keys(svc).forEach(function(k) { lines.push(k + ': ' + svc[k]); });
    // Surface pending sync retries in the tooltip (first amber-triggering
    // condition the user actually encounters). Saves a click to see why
    // the dot went amber.
    if (state.data.sync) {
      Object.keys(state.data.sync).forEach(function(p) {
        var s = state.data.sync[p];
        if (s && s.connected && s.pendingRetry > 0) {
          lines.push(p + ': ' + s.pendingRetry + ' task(s) retrying (provider throttling)');
        }
        if (s && s.connected && s.permanentError > 0) {
          lines.push(p + ': ' + s.permanentError + ' task(s) failed');
        }
      });
    }
    if (state.lastChecked) lines.push('Checked: ' + state.lastChecked.toLocaleTimeString());
    return lines.join('\n');
  })();

  function fmtUptime(sec) {
    if (sec == null) return '';
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.floor(sec / 60) + 'm';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h ' + Math.floor((sec % 3600) / 60) + 'm';
    return Math.floor(sec / 86400) + 'd ' + Math.floor((sec % 86400) / 3600) + 'h';
  }

  return (
    <div ref={popoverRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={function() { setExpanded(function(v) { return !v; }); check(); }}
        title={tooltip}
        aria-label="Backend health status"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 4, margin: 0, display: 'inline-flex', alignItems: 'center'
        }}
      >
        <span style={{
          display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
          background: color,
          boxShadow: isChecking ? ('0 0 6px ' + color) : ('0 0 2px ' + color),
          animation: isChecking ? 'health-dot-pulse 1.5s ease-in-out infinite' : 'none',
          transition: 'background 0.3s ease, box-shadow 0.3s ease'
        }} />
      </button>
      <style>{'@keyframes health-dot-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(1.15); } }'}</style>

      {expanded && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 1000,
          minWidth: 240, background: theme ? theme.bgCard : '#fff',
          color: theme ? theme.text : '#222',
          border: '1px solid ' + (theme ? theme.border : '#ddd'),
          borderRadius: 6, padding: 10,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontSize: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <strong>Backend health</strong>
            <button onClick={check} disabled={isChecking} title="Refresh now" style={{
              background: 'transparent', border: '1px solid ' + (theme ? theme.border : '#ccc'),
              borderRadius: 4, padding: '2px 6px', cursor: isChecking ? 'default' : 'pointer',
              fontSize: 11, color: theme ? theme.text : '#222', opacity: isChecking ? 0.5 : 1
            }}>{isChecking ? '…' : '↻'}</button>
          </div>
          <div style={{ marginBottom: 6 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 6 }} />
            <strong>{state.status}</strong>
          </div>
          {state.error && (
            <div style={{ color: '#E53935', marginBottom: 6 }}>{state.error}</div>
          )}
          {state.data && state.data.services && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <tbody>
                {Object.keys(state.data.services).map(function(name) {
                  var status = state.data.services[name];
                  var detail = state.data.detail && state.data.detail[name];
                  var cellColor = status === 'operational' ? '#43A047'
                    : status === 'error' ? '#E53935'
                    : status === 'degraded' ? '#F9A825'
                    : theme ? theme.textMuted : '#888';
                  return (
                    <tr key={name}>
                      <td style={{ padding: '2px 4px', textTransform: 'capitalize' }}>{name}</td>
                      <td style={{ padding: '2px 4px', color: cellColor, fontWeight: 500 }}>{status}</td>
                      <td style={{ padding: '2px 4px', color: theme ? theme.textMuted : '#888', fontStyle: 'italic' }}>{detail || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {state.data && state.data.sync && (
            <SyncTable sync={state.data.sync} theme={theme} />
          )}

          {state.data && (
            <div style={{ marginTop: 8, fontSize: 11, color: theme ? theme.textMuted : '#666' }}>
              Uptime: {fmtUptime(state.data.uptime)}
              {state.lastChecked && <span> · Checked {state.lastChecked.toLocaleTimeString()}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Per-provider sync state table in the Health popover. One row per
// connected provider; disconnected providers are listed dimmed at the
// bottom so the user knows they can still hook them up. Pending-retry
// counts appear in amber; permanent errors in red.
function SyncTable({ sync, theme }) {
  var providerLabels = { gcal: 'Google', msft: 'Microsoft', apple: 'Apple' };
  // Sort: connected first (alphabetical by label), then disconnected.
  var order = Object.keys(sync).slice().sort(function(a, b) {
    var ac = sync[a] && sync[a].connected ? 0 : 1;
    var bc = sync[b] && sync[b].connected ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return (providerLabels[a] || a).localeCompare(providerLabels[b] || b);
  });
  function fmtAgo(iso) {
    if (!iso) return '—';
    var diff = Date.now() - new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z')).getTime();
    if (isNaN(diff)) return '—';
    var m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }
  return (
    <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed ' + (theme ? theme.border : '#ddd') }}>
      <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 11 }}>Calendar sync</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ color: theme ? theme.textMuted : '#888', textAlign: 'left' }}>
            <th style={{ fontWeight: 500, padding: '2px 4px' }}>Provider</th>
            <th style={{ fontWeight: 500, padding: '2px 4px', textAlign: 'right' }}>Active</th>
            <th style={{ fontWeight: 500, padding: '2px 4px', textAlign: 'right' }}>Retry</th>
            <th style={{ fontWeight: 500, padding: '2px 4px', textAlign: 'right' }}>Err</th>
            <th style={{ fontWeight: 500, padding: '2px 4px' }}>Last</th>
          </tr>
        </thead>
        <tbody>
          {order.map(function(p) {
            var s = sync[p] || {};
            var dim = !s.connected;
            var retryColor = s.pendingRetry > 0 ? '#F9A825' : (theme ? theme.textMuted : '#888');
            var errColor = s.permanentError > 0 ? '#E53935' : (theme ? theme.textMuted : '#888');
            return (
              <tr key={p} style={{ opacity: dim ? 0.5 : 1 }}>
                <td style={{ padding: '2px 4px' }}>
                  {providerLabels[p] || p}{dim && <span style={{ fontSize: 9, marginLeft: 4, color: theme ? theme.textMuted : '#888' }}>(off)</span>}
                </td>
                <td style={{ padding: '2px 4px', textAlign: 'right' }}>{s.active || 0}</td>
                <td style={{ padding: '2px 4px', textAlign: 'right', color: retryColor, fontWeight: s.pendingRetry > 0 ? 600 : 400 }}>{s.pendingRetry || 0}</td>
                <td style={{ padding: '2px 4px', textAlign: 'right', color: errColor, fontWeight: s.permanentError > 0 ? 600 : 400 }}>{s.permanentError || 0}</td>
                <td style={{ padding: '2px 4px', color: theme ? theme.textMuted : '#888' }}>{s.lastSync ? fmtAgo(s.lastSync) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
