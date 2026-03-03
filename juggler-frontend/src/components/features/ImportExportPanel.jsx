/**
 * ImportExportPanel — JSON import from old format, JSON export
 */

import React, { useState } from 'react';
import apiClient from '../../services/apiClient';
import { getTheme } from '../../theme/colors';

export default function ImportExportPanel({ onClose, darkMode, showToast, allTasks, statuses, dayPlacements, isMobile }) {
  var theme = getTheme(darkMode);
  var [importText, setImportText] = useState('');
  var [importing, setImporting] = useState(false);
  var [exporting, setExporting] = useState(false);

  async function handleImport() {
    if (!importText.trim()) return;
    try {
      setImporting(true);
      var data = JSON.parse(importText);
      await apiClient.post('/data/import', data);
      showToast('Import successful! Reload to see changes.', 'success');
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      showToast('Import failed: ' + e.message, 'error');
    } finally {
      setImporting(false);
    }
  }

  function handleCopySchedule() {
    try {
      var tasks = allTasks || [];
      var sts = statuses || {};
      // Group by date
      var byDate = {};
      tasks.forEach(function(t) {
        var key = t.date || 'TBD';
        if (!byDate[key]) byDate[key] = [];
        byDate[key].push(t);
      });
      var lines = [];
      Object.keys(byDate).sort().forEach(function(dateKey) {
        lines.push('\n' + dateKey + ':');
        byDate[dateKey].forEach(function(t) {
          var st = sts[t.id] || '';
          var statusLabel = st === 'done' ? '[DONE]' : st === 'wip' ? '[WIP]' : st === 'cancel' ? '[CANCEL]' : st === 'skip' ? '[SKIP]' : '';
          lines.push('  ' + (t.time || '') + ' ' + statusLabel + ' ' + t.text + ' (' + (t.dur || 30) + 'm)');
        });
      });
      navigator.clipboard.writeText(lines.join('\n'));
      showToast('Schedule copied to clipboard', 'success');
    } catch (e) {
      showToast('Copy failed: ' + e.message, 'error');
    }
  }

  function handleExportICS() {
    try {
      var tasks = allTasks || [];
      var lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Juggler//Task Tracker//EN',
        'CALSCALE:GREGORIAN'
      ];
      tasks.forEach(function(t) {
        if (!t.date || t.date === 'TBD') return;
        var parts = t.date.split('/');
        if (parts.length !== 2) return;
        var month = parseInt(parts[0]);
        var day = parseInt(parts[1]);
        var year = new Date().getFullYear();
        var mm = month < 10 ? '0' + month : '' + month;
        var dd = day < 10 ? '0' + day : '' + day;
        var startH = 9, startM = 0;
        if (t.time) {
          var tm = t.time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
          if (tm) {
            startH = parseInt(tm[1]);
            startM = parseInt(tm[2]);
            if (tm[3] && tm[3].toUpperCase() === 'PM' && startH !== 12) startH += 12;
            if (tm[3] && tm[3].toUpperCase() === 'AM' && startH === 12) startH = 0;
          }
        }
        var dur = t.dur || 30;
        var endH = startH + Math.floor((startM + dur) / 60);
        var endM = (startM + dur) % 60;
        var sh = startH < 10 ? '0' + startH : '' + startH;
        var sm = startM < 10 ? '0' + startM : '' + startM;
        var eh = endH < 10 ? '0' + endH : '' + endH;
        var em = endM < 10 ? '0' + endM : '' + endM;
        lines.push('BEGIN:VEVENT');
        lines.push('DTSTART:' + year + mm + dd + 'T' + sh + sm + '00');
        lines.push('DTEND:' + year + mm + dd + 'T' + eh + em + '00');
        lines.push('SUMMARY:' + (t.text || '').replace(/[,;\\]/g, ' '));
        if (t.notes) lines.push('DESCRIPTION:' + t.notes.replace(/\n/g, '\\n').replace(/[,;\\]/g, ' '));
        lines.push('UID:' + t.id + '@juggler');
        lines.push('END:VEVENT');
      });
      lines.push('END:VCALENDAR');
      var icsContent = lines.join('\r\n');
      var blob = new Blob([icsContent], { type: 'text/calendar' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'juggler-' + new Date().toISOString().slice(0, 10) + '.ics';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exported .ics file', 'success');
    } catch (e) {
      showToast('ICS export failed: ' + e.message, 'error');
    }
  }

  async function handleExport() {
    try {
      setExporting(true);
      var { data } = await apiClient.get('/data/export');
      var json = JSON.stringify(data, null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'juggler-export-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exported successfully', 'success');
    } catch (e) {
      showToast('Export failed: ' + e.message, 'error');
    } finally {
      setExporting(false);
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
        width: isMobile ? '100%' : 560, maxWidth: isMobile ? '100%' : '95vw',
        height: isMobile ? '100%' : undefined, maxHeight: isMobile ? '100%' : '80vh',
        overflow: 'auto', padding: 20,
        boxShadow: isMobile ? 'none' : `0 8px 32px ${theme.shadow}`
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: theme.text }}>Import / Export</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: theme.textMuted, fontSize: 20, cursor: 'pointer' }}>&times;</button>
        </div>

        {/* Export */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Export</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={handleExport} disabled={exporting} style={{
              border: 'none', borderRadius: 8, padding: '10px 20px',
              background: theme.accent, color: '#FFF', fontWeight: 600, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit', opacity: exporting ? 0.5 : 1
            }}>
              {exporting ? 'Exporting...' : 'Download JSON'}
            </button>
            <button onClick={handleCopySchedule} style={{
              border: `1px solid ${theme.border}`, borderRadius: 8, padding: '10px 20px',
              background: 'transparent', color: theme.text, fontWeight: 600, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit'
            }}>
              &#x1F4CB; Copy Schedule
            </button>
            <button onClick={handleExportICS} style={{
              border: `1px solid ${theme.border}`, borderRadius: 8, padding: '10px 20px',
              background: 'transparent', color: theme.text, fontWeight: 600, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit'
            }}>
              &#x1F4C5; Export .ics
            </button>
          </div>
        </div>

        {/* Import */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 4 }}>Import</div>
          <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 8 }}>
            Paste the JSON from your old task tracker (window.storage format) to import all tasks, settings, and config.
            This will replace all existing data.
          </div>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder='Paste JSON here...'
            style={{
              width: '100%', minHeight: 120, padding: '8px 10px',
              border: `1px solid ${theme.inputBorder}`, borderRadius: 8,
              background: theme.input, color: theme.text, fontSize: 12,
              fontFamily: 'monospace', resize: 'vertical', outline: 'none'
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={handleImport} disabled={importing || !importText.trim()} style={{
              border: 'none', borderRadius: 8, padding: '10px 20px',
              background: '#10B981', color: '#FFF', fontWeight: 600, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit',
              opacity: importing || !importText.trim() ? 0.5 : 1
            }}>
              {importing ? 'Importing...' : 'Import Data'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
