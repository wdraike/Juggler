/**
 * ImportExportPanel — JSON import/export, ICS import/export
 */

import React, { useState, useRef } from 'react';
import apiClient from '../../services/apiClient';
import { getTheme } from '../../theme/colors';

/* ── ICS helpers ──────────────────────────────────────── */

function escICS(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;')
    .replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function foldLine(line) {
  // ICS spec: lines must be <= 75 octets; fold with CRLF + space
  var out = [];
  while (line.length > 75) {
    out.push(line.slice(0, 75));
    line = ' ' + line.slice(75);
  }
  out.push(line);
  return out.join('\r\n');
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function parseTime12(timeStr) {
  if (!timeStr) return null;
  var m = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!m) return null;
  var h = parseInt(m[1]), min = parseInt(m[2]);
  if (m[3]) {
    var ampm = m[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
  }
  return { h: h, m: min };
}

function dateToICS(year, month, day, h, m) {
  return '' + year + pad2(month) + pad2(day) + 'T' + pad2(h) + pad2(m) + '00';
}

function priToIcal(pri) {
  // ICS PRIORITY: 1=highest, 5=normal, 9=lowest
  if (pri === 'P1') return '1';
  if (pri === 'P2') return '3';
  if (pri === 'P3') return '5';
  if (pri === 'P4') return '9';
  return '5';
}

function icalToPri(val) {
  var n = parseInt(val);
  if (n <= 1) return 'P1';
  if (n <= 3) return 'P2';
  if (n <= 5) return 'P3';
  return 'P4';
}

function statusToIcal(st) {
  if (st === 'done') return 'COMPLETED';
  if (st === 'cancel') return 'CANCELLED';
  if (st === 'wip') return 'IN-PROCESS';
  return 'NEEDS-ACTION';
}

function icalToStatus(val) {
  if (!val) return '';
  var v = val.toUpperCase();
  if (v === 'COMPLETED') return 'done';
  if (v === 'CANCELLED') return 'cancel';
  if (v === 'IN-PROCESS') return 'wip';
  return '';
}

function recurToRRULE(recur) {
  if (!recur || !recur.type) return null;
  if (recur.type === 'daily') {
    var every = recur.every || 1;
    return 'FREQ=DAILY' + (every > 1 ? ';INTERVAL=' + every : '');
  }
  if (recur.type === 'weekly' && recur.days && recur.days.length > 0) {
    var dayMap = { Mon: 'MO', Tue: 'TU', Wed: 'WE', Thu: 'TH', Fri: 'FR', Sat: 'SA', Sun: 'SU' };
    var byDay = recur.days.map(function(d) { return dayMap[d] || d; }).join(',');
    return 'FREQ=WEEKLY;BYDAY=' + byDay + (recur.every > 1 ? ';INTERVAL=' + recur.every : '');
  }
  return null;
}

function rruleToRecur(rrule) {
  if (!rrule) return null;
  var parts = {};
  rrule.split(';').forEach(function(p) {
    var kv = p.split('=');
    if (kv.length === 2) parts[kv[0].toUpperCase()] = kv[1];
  });
  var freq = parts.FREQ;
  var interval = parseInt(parts.INTERVAL || '1');
  if (freq === 'DAILY') {
    return { type: 'daily', every: interval };
  }
  if (freq === 'WEEKLY' && parts.BYDAY) {
    var dayMap = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };
    var days = parts.BYDAY.split(',').map(function(d) { return dayMap[d.trim()] || d; });
    return { type: 'weekly', days: days, every: interval };
  }
  return null;
}

/* ── ICS Export ────────────────────────────────────────── */

function buildICS(tasks, statuses) {
  var lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Raike and Sons//WorkRS//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];
  var now = new Date();
  var stamp = '' + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) +
    'T' + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());

  tasks.forEach(function(t) {
    if (!t.date || t.date === 'TBD') return;
    var parts = t.date.split('/');
    if (parts.length !== 2) return;
    var month = parseInt(parts[0]), day = parseInt(parts[1]);
    var year = now.getFullYear();

    var time = parseTime12(t.time);
    var startH = time ? time.h : 9, startM = time ? time.m : 0;
    var dur = t.dur || 30;
    var totalEndM = startH * 60 + startM + dur;
    var endH = Math.floor(totalEndM / 60), endM = totalEndM % 60;

    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + t.id + '@raikeandsons');
    lines.push('DTSTAMP:' + stamp);
    lines.push('DTSTART:' + dateToICS(year, month, day, startH, startM));
    lines.push('DTEND:' + dateToICS(year, month, day, endH, endM));
    lines.push(foldLine('SUMMARY:' + escICS(t.text)));

    // Description: notes + metadata
    var descParts = [];
    if (t.notes) descParts.push(t.notes);
    if (t.project) descParts.push('Project: ' + t.project);
    if (t.section) descParts.push('Section: ' + t.section);
    if (t.dependsOn && t.dependsOn.length > 0) descParts.push('Depends on: ' + t.dependsOn.join(', '));
    if (descParts.length > 0) {
      lines.push(foldLine('DESCRIPTION:' + escICS(descParts.join('\n'))));
    }

    // Location
    if (t.location && t.location.length > 0) {
      lines.push('LOCATION:' + escICS(t.location.join(', ')));
    }

    // Categories = project
    if (t.project) {
      lines.push('CATEGORIES:' + escICS(t.project));
    }

    // Priority
    if (t.pri) {
      lines.push('PRIORITY:' + priToIcal(t.pri));
    }

    // Status
    var st = (statuses && statuses[t.id]) || '';
    lines.push('STATUS:' + statusToIcal(st));

    // Recurrence
    var rrule = recurToRRULE(t.recur);
    if (rrule) lines.push('RRULE:' + rrule);

    // Custom X-properties for Juggler-specific fields
    if (t.pri) lines.push('X-JUGGLER-PRI:' + t.pri);
    if (t.when) lines.push('X-JUGGLER-WHEN:' + t.when);
    if (t.dayReq) lines.push('X-JUGGLER-DAYREQ:' + t.dayReq);
    if (t.habit) lines.push('X-JUGGLER-HABIT:TRUE');
    if (t.rigid) lines.push('X-JUGGLER-RIGID:TRUE');
    if (t.split) lines.push('X-JUGGLER-SPLIT:TRUE');
    if (t.splitMin) lines.push('X-JUGGLER-SPLITMIN:' + t.splitMin);
    if (t.due) lines.push('X-JUGGLER-DUE:' + t.due);
    if (t.startAfter) lines.push('X-JUGGLER-STARTAFTER:' + t.startAfter);
    if (t.tools && t.tools.length > 0) lines.push('X-JUGGLER-TOOLS:' + t.tools.join(','));
    if (t.timeRemaining != null && t.timeRemaining !== t.dur) lines.push('X-JUGGLER-TIMEREMAINING:' + t.timeRemaining);

    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/* ── ICS Import (parser) ──────────────────────────────── */

function parseICSDate(val) {
  // Handles: 20260307T090000, 20260307T090000Z, 20260307
  if (!val) return null;
  var clean = val.replace(/^[^:]*:/, ''); // strip TZID=...: prefix
  var m = clean.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return null;
  return {
    year: parseInt(m[1]),
    month: parseInt(m[2]),
    day: parseInt(m[3]),
    hour: m[4] != null ? parseInt(m[4]) : null,
    min: m[5] != null ? parseInt(m[5]) : null
  };
}

function formatTime12(h, m) {
  if (h == null) return '';
  var ampm = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12 || 12;
  return h12 + ':' + pad2(m || 0) + ' ' + ampm;
}

function dayAbbrev(date) {
  var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[date.getDay()];
}

function unfoldICS(text) {
  // ICS folding: CRLF followed by a space or tab means continuation
  return text.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function unescICS(str) {
  if (!str) return '';
  return str.replace(/\\n/g, '\n').replace(/\\,/g, ',')
    .replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parseICS(text) {
  var unfolded = unfoldICS(text);
  var lines = unfolded.split('\n');
  var events = [];
  var current = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    // Parse property: NAME;params:value or NAME:value
    var colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    var propPart = line.slice(0, colonIdx);
    var value = line.slice(colonIdx + 1);
    // Strip parameters (e.g., DTSTART;TZID=America/New_York)
    var propName = propPart.split(';')[0].toUpperCase();

    // Keep the full property part for DTSTART/DTEND (may have TZID)
    if (propName === 'DTSTART' || propName === 'DTEND') {
      current[propName] = line.slice(colonIdx + 1); // just the value after colon, TZID is in propPart
    } else {
      current[propName] = value;
    }
  }

  return events;
}

function icsEventsToTasks(events, existingIds) {
  var tasks = [];
  var usedIds = new Set(existingIds || []);

  events.forEach(function(ev) {
    var start = parseICSDate(ev.DTSTART);
    if (!start) return; // skip events without a start date

    var id = (ev.UID || '').replace(/@.*$/, '');
    // Generate a unique ID if the UID is empty or already used
    if (!id || usedIds.has(id)) {
      id = 'ics_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }
    usedIds.add(id);

    var dateStr = start.month + '/' + start.day;
    var jsDate = new Date(start.year, start.month - 1, start.day);

    var dur = 30; // default
    var end = parseICSDate(ev.DTEND);
    if (end && start.hour != null) {
      dur = (end.hour * 60 + end.min) - (start.hour * 60 + start.min);
      if (dur <= 0) dur = 30;
    } else if (ev.DURATION) {
      // Parse ISO 8601 duration: PT1H30M, PT45M, PT2H
      var dm = ev.DURATION.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
      if (dm) dur = (parseInt(dm[1] || 0) * 60) + parseInt(dm[2] || 0);
    }

    var summary = unescICS(ev.SUMMARY || '');
    var description = unescICS(ev.DESCRIPTION || '');
    var location = ev.LOCATION ? unescICS(ev.LOCATION) : '';

    // Extract Juggler-specific fields from X-properties or description
    var pri = ev['X-JUGGLER-PRI'] || (ev.PRIORITY ? icalToPri(ev.PRIORITY) : 'P3');
    var status = icalToStatus(ev.STATUS);
    var project = ev.CATEGORIES ? unescICS(ev.CATEGORIES.split(',')[0]) : '';
    var when = ev['X-JUGGLER-WHEN'] || '';
    var dayReq = ev['X-JUGGLER-DAYREQ'] || '';
    var habit = ev['X-JUGGLER-HABIT'] === 'TRUE';
    var rigid = ev['X-JUGGLER-RIGID'] === 'TRUE';
    var split = ev['X-JUGGLER-SPLIT'] === 'TRUE';
    var splitMin = ev['X-JUGGLER-SPLITMIN'] ? parseInt(ev['X-JUGGLER-SPLITMIN']) : undefined;
    var due = ev['X-JUGGLER-DUE'] || '';
    var startAfter = ev['X-JUGGLER-STARTAFTER'] || '';
    var tools = ev['X-JUGGLER-TOOLS'] ? ev['X-JUGGLER-TOOLS'].split(',') : [];
    var timeRemaining = ev['X-JUGGLER-TIMEREMAINING'] ? parseInt(ev['X-JUGGLER-TIMEREMAINING']) : undefined;

    // Parse location into array
    var locArr = [];
    if (location) {
      locArr = location.split(',').map(function(s) { return s.trim(); });
    }

    // Parse recurrence
    var recur = rruleToRecur(ev.RRULE);

    // Extract project/section from description if not in categories
    var notes = description;
    if (!project && description) {
      var projMatch = description.match(/Project:\s*(.+)/);
      if (projMatch) {
        project = projMatch[1].trim();
        notes = notes.replace(/Project:\s*.+\n?/, '').trim();
      }
    }
    var section = '';
    if (description) {
      var secMatch = description.match(/Section:\s*(.+)/);
      if (secMatch) {
        section = secMatch[1].trim();
        notes = notes.replace(/Section:\s*.+\n?/, '').trim();
      }
    }

    var task = {
      id: id,
      text: summary || 'Untitled Event',
      date: dateStr,
      day: dayAbbrev(jsDate),
      time: start.hour != null ? formatTime12(start.hour, start.min) : '',
      dur: dur,
      pri: pri,
      project: project,
      section: section,
      notes: notes || '',
      location: locArr,
      tools: tools,
      when: when,
      dayReq: dayReq,
      habit: habit,
      rigid: rigid,
      split: split,
      recur: recur || undefined,
      due: due || undefined,
      startAfter: startAfter || undefined,
      status: status
    };
    if (splitMin) task.splitMin = splitMin;
    if (timeRemaining != null) task.timeRemaining = timeRemaining;

    tasks.push(task);
  });

  return tasks;
}

/* ── Component ────────────────────────────────────────── */

export default function ImportExportPanel({ onClose, darkMode, showToast, allTasks, statuses, dayPlacements, isMobile, addTasks }) {
  var theme = getTheme(darkMode);
  var [importText, setImportText] = useState('');
  var [importing, setImporting] = useState(false);
  var [exporting, setExporting] = useState(false);
  var [icsImporting, setIcsImporting] = useState(false);
  var [icsPreview, setIcsPreview] = useState(null); // { tasks, fileName }
  var fileInputRef = useRef(null);

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
      var icsContent = buildICS(allTasks || [], statuses || {});
      var blob = new Blob([icsContent], { type: 'text/calendar' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'workrs-' + new Date().toISOString().slice(0, 10) + '.ics';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exported .ics file', 'success');
    } catch (e) {
      showToast('ICS export failed: ' + e.message, 'error');
    }
  }

  function handleICSFileSelect(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var text = ev.target.result;
        var events = parseICS(text);
        if (events.length === 0) {
          showToast('No events found in .ics file', 'error');
          return;
        }
        var existingIds = (allTasks || []).map(function(t) { return t.id; });
        var tasks = icsEventsToTasks(events, existingIds);
        setIcsPreview({ tasks: tasks, fileName: file.name });
      } catch (err) {
        showToast('Failed to parse .ics file: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be selected again
    e.target.value = '';
  }

  async function handleICSImportConfirm() {
    if (!icsPreview || !addTasks) return;
    try {
      setIcsImporting(true);
      // Separate statuses from tasks
      var tasksToAdd = [];
      icsPreview.tasks.forEach(function(t) {
        var task = Object.assign({}, t);
        delete task.status; // status handled separately
        tasksToAdd.push(task);
      });
      await addTasks(tasksToAdd);
      // Set statuses for imported tasks
      var statusUpdates = icsPreview.tasks.filter(function(t) { return t.status; });
      for (var i = 0; i < statusUpdates.length; i++) {
        try {
          await apiClient.put('/tasks/' + statusUpdates[i].id + '/status', {
            status: statusUpdates[i].status, direction: ''
          });
        } catch (_) { /* ignore individual status failures */ }
      }
      showToast('Imported ' + tasksToAdd.length + ' events from ' + icsPreview.fileName, 'success');
      setIcsPreview(null);
    } catch (e) {
      showToast('ICS import failed: ' + e.message, 'error');
    } finally {
      setIcsImporting(false);
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
      a.download = 'workrs-export-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exported successfully', 'success');
    } catch (e) {
      showToast('Export failed: ' + e.message, 'error');
    } finally {
      setExporting(false);
    }
  }

  var btnStyle = {
    border: '1px solid ' + theme.border, borderRadius: 2, padding: '10px 20px',
    background: 'transparent', color: theme.text, fontWeight: 600, fontSize: 13,
    cursor: 'pointer', fontFamily: 'inherit'
  };

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
      }} onClick={function(e) { e.stopPropagation(); }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 700, color: theme.text }}>Import / Export</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: theme.textMuted, fontSize: 20, cursor: 'pointer' }}>&times;</button>
        </div>

        {/* Export */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Export</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={handleExport} disabled={exporting} style={{
              border: 'none', borderRadius: 2, padding: '10px 20px',
              background: theme.accent, color: '#FFF', fontWeight: 600, fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit', opacity: exporting ? 0.5 : 1
            }}>
              {exporting ? 'Exporting...' : 'Download JSON'}
            </button>
            <button onClick={handleCopySchedule} style={btnStyle}>
              &#x1F4CB; Copy Schedule
            </button>
            <button onClick={handleExportICS} style={btnStyle}>
              &#x1F4C5; Export .ics
            </button>
          </div>
        </div>

        {/* ICS Import */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 4 }}>Import .ics</div>
          <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 8 }}>
            Import events from an .ics file (Google Calendar, Outlook, Apple Calendar, etc.).
            Events will be added as new tasks.
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".ics,text/calendar"
            onChange={handleICSFileSelect}
            style={{ display: 'none' }}
          />
          <button onClick={function() { fileInputRef.current && fileInputRef.current.click(); }} style={btnStyle}>
            &#x1F4C1; Choose .ics File
          </button>

          {/* ICS Preview */}
          {icsPreview && (
            <div style={{ marginTop: 12, border: '1px solid ' + theme.border, borderRadius: 2, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 8 }}>
                {icsPreview.fileName}: {icsPreview.tasks.length} event{icsPreview.tasks.length !== 1 ? 's' : ''} found
              </div>
              <div style={{ maxHeight: 200, overflow: 'auto', fontSize: 11, color: theme.textMuted, marginBottom: 8 }}>
                {icsPreview.tasks.map(function(t, i) {
                  return (
                    <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid ' + theme.border }}>
                      <span style={{ color: theme.text, fontWeight: 500 }}>{t.text}</span>
                      <span style={{ marginLeft: 8 }}>{t.date} {t.time} ({t.dur}m)</span>
                      {t.project ? <span style={{ marginLeft: 8, opacity: 0.7 }}>[{t.project}]</span> : null}
                      {t.recur ? <span style={{ marginLeft: 4, opacity: 0.7 }}>&#x1F501;</span> : null}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleICSImportConfirm} disabled={icsImporting} style={{
                  border: 'none', borderRadius: 2, padding: '8px 16px',
                  background: '#10B981', color: '#FFF', fontWeight: 600, fontSize: 12,
                  cursor: 'pointer', fontFamily: 'inherit', opacity: icsImporting ? 0.5 : 1
                }}>
                  {icsImporting ? 'Importing...' : 'Import ' + icsPreview.tasks.length + ' Events'}
                </button>
                <button onClick={function() { setIcsPreview(null); }} style={{
                  border: '1px solid ' + theme.border, borderRadius: 2, padding: '8px 16px',
                  background: 'transparent', color: theme.textMuted, fontWeight: 600, fontSize: 12,
                  cursor: 'pointer', fontFamily: 'inherit'
                }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* JSON Import */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 4 }}>Import JSON</div>
          <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 8 }}>
            Paste the JSON from your old task tracker (window.storage format) to import all tasks, settings, and config.
            This will replace all existing data.
          </div>
          <textarea
            value={importText}
            onChange={function(e) { setImportText(e.target.value); }}
            placeholder='Paste JSON here...'
            style={{
              width: '100%', minHeight: 120, padding: '8px 10px',
              border: '1px solid ' + theme.inputBorder, borderRadius: 2,
              background: theme.input, color: theme.text, fontSize: 12,
              fontFamily: 'monospace', resize: 'vertical', outline: 'none',
              boxSizing: 'border-box'
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={handleImport} disabled={importing || !importText.trim()} style={{
              border: 'none', borderRadius: 2, padding: '10px 20px',
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
