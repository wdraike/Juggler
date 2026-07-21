/**
 * UnifiedTemplateTab — extracted from SettingsPanel (999.965).
 *
 * 999.2145: reads/writes the CANONICAL schedule-template trio
 * (config.scheduleTemplates / config.templateDefaults / config.templateOverrides)
 * instead of the derived-legacy `locSchedules` shape. The legacy shape has no
 * `blocks` key (useConfig.js deriveLocSchedules), so the old implementation
 * always rendered an empty template (looked "deleted") and every paint wrote
 * a `tag:'custom'/name:'Custom'` lump back through the LEGACY `loc_schedules`
 * key, which `initFromConfig` discards in favor of canonical `scheduleTemplates`
 * on the next load — edits silently vanished. All writes in this file go
 * through `updateScheduleTemplates`/`updateTemplateDefaults` (never
 * `updateLocSchedules` — that pathway is deleted from this tab AND from
 * useConfig.js itself, 999.2146: zero remaining consumers repo-wide).
 */
import React, { useState } from 'react';
import HelpIcon from '../HelpIcon';
import ConfirmDialog from '../../features/ConfirmDialog';
// 999.1245: use the canonical location→tint map. This file previously kept a
// private LOC_TINT copy that had drifted (errand was pink #EC4899 here while
// the grid fell back to purple — users learn location=color, forks break it).
import { LOC_TINT } from '../../../state/constants';

var DEFAULT_START = 360;
var DEFAULT_END = 1380;

function getTimeRange(blocks) {
  if (!blocks || blocks.length === 0) return { startMin: DEFAULT_START, endMin: DEFAULT_END };
  var earliest = DEFAULT_END, latest = DEFAULT_START;
  blocks.forEach(function(b) { if (b.start < earliest) earliest = b.start; if (b.end > latest) latest = b.end; });
  var startMin = Math.max(0, Math.floor((earliest - 60) / 60) * 60);
  var endMin = Math.min(1440, Math.ceil((latest + 60) / 60) * 60);
  return { startMin: startMin, endMin: endMin };
}

function pctOf(mins, startMin, totalMin) { return ((mins - startMin) / totalMin) * 100; }

function snapToSlot(clientX, barEl, startMin, endMin, totalMin) {
  var rect = barEl.getBoundingClientRect();
  var ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  var raw = ratio * totalMin + startMin;
  var snapped = Math.round(raw / 15) * 15;
  return Math.max(startMin, Math.min(endMin, snapped));
}

function buildEffectiveHours(blocks, locOverrides) {
  var hours = {};
  (blocks || []).forEach(function(b) { for (var m = b.start; m < b.end; m += 15) { hours[m] = b.loc || 'home'; } });
  if (locOverrides) { Object.keys(locOverrides).forEach(function(k) { hours[parseInt(k)] = locOverrides[k]; }); }
  return hours;
}

function buildSegments(hours, startMin, endMin) {
  var segs = [];
  for (var m = startMin; m < endMin; m += 15) {
    var loc = hours[m] || 'unset';
    var last = segs[segs.length - 1];
    if (last && last.loc === loc && last.end === m) { last.end = m + 15; }
    else { segs.push({ start: m, end: m + 15, loc: loc }); }
  }
  return segs;
}

function ScheduleTemplateBar({ hours, locations, theme, onCommit, blocks, onBlocksChange }) {
  var [activeLoc, setActiveLoc] = useState(locations[0]?.id || null);
  var barRef = React.useRef(null);
  var dragRef = React.useRef(null);
  var hoursRef = React.useRef(hours);
  var onCommitRef = React.useRef(onCommit);
  hoursRef.current = hours;
  onCommitRef.current = onCommit;

  var range = React.useMemo(function() { return getTimeRange(blocks); }, [blocks]);
  var startMin = range.startMin, endMin = range.endMin, totalMin = endMin - startMin;
  var rangeRef = React.useRef({ startMin: startMin, endMin: endMin, totalMin: totalMin });
  rangeRef.current = { startMin: startMin, endMin: endMin, totalMin: totalMin };

  function pct(mins) { return pctOf(mins, startMin, totalMin); }

  var hourTicks = React.useMemo(function() { var ticks = []; var first = Math.ceil(startMin / 120) * 120; for (var h = first; h <= endMin; h += 120) { ticks.push(h); } return ticks; }, [startMin, endMin]);
  var segments = React.useMemo(function() { return buildSegments(hours, startMin, endMin); }, [hours, startMin, endMin]);
  var locMap = React.useMemo(function() { var m = {}; locations.forEach(function(l) { m[l.id] = l; }); return m; }, [locations]);

  React.useEffect(function() { if (activeLoc && !locMap[activeLoc] && locations.length > 0) { setActiveLoc(locations[0].id); } }, [locations, activeLoc, locMap]);

  function slotAt(clientX) { var bar = barRef.current; var r = rangeRef.current; if (!bar) return r.startMin; return snapToSlot(clientX, bar, r.startMin, r.endMin, r.totalMin); }

  function commitPaint(fromMin, toMin, locId) {
    var h = hoursRef.current;
    var lo = Math.min(fromMin, toMin), hi = Math.max(fromMin, toMin) + 15;
    var newHours = {};
    Object.keys(h).forEach(function(k) { newHours[parseInt(k)] = h[k]; });
    for (var m = lo; m < hi; m += 15) { newHours[m] = locId; }
    onCommitRef.current(newHours);
  }

  function onMouseDown(e) {
    if (e.button !== 0 || !activeLoc) return;
    e.preventDefault();
    var minute = slotAt(e.clientX);
    dragRef.current = { startMinute: minute, lastMinute: minute, loc: activeLoc };
    commitPaint(minute, minute, activeLoc);
    function onMove(ev) { var drag = dragRef.current; if (!drag) return; var m = slotAt(ev.clientX); if (m !== drag.lastMinute) { drag.lastMinute = m; commitPaint(drag.startMinute, m, drag.loc); } }
    function onUp() { dragRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }

  function onTouchStart(e) {
    if (!activeLoc) return;
    e.preventDefault();
    var touch = e.touches[0];
    var minute = slotAt(touch.clientX);
    dragRef.current = { startMinute: minute, lastMinute: minute, loc: activeLoc };
    commitPaint(minute, minute, activeLoc);
    function onTouchMove(ev) { var drag = dragRef.current; if (!drag) return; var t = ev.touches[0]; var m = slotAt(t.clientX); if (m !== drag.lastMinute) { drag.lastMinute = m; commitPaint(drag.startMinute, m, drag.loc); } }
    function onTouchEnd() { dragRef.current = null; document.removeEventListener('touchmove', onTouchMove); document.removeEventListener('touchend', onTouchEnd); }
    document.addEventListener('touchmove', onTouchMove, { passive: false }); document.addEventListener('touchend', onTouchEnd);
  }

  function onBlockEdgeDown(e, blockIdx, edge) {
    if (e.button !== 0 || !onBlocksChange) return;
    e.preventDefault(); e.stopPropagation();
    var startEdge = edge === 'start';
    function onMove(ev) {
      var m = slotAt(ev.clientX);
      var newBlocks = blocks.map(function(b, i) {
        if (i !== blockIdx) return b;
        if (startEdge) { return Object.assign({}, b, { start: Math.min(m, b.end - 15) }); }
        return Object.assign({}, b, { end: Math.max(m, b.start + 15) });
      });
      onBlocksChange(newBlocks);
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {locations.map(function(l) { return (<button key={l.id} onClick={function() { setActiveLoc(l.id); }} style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, cursor: 'pointer', border: '1px solid ' + (activeLoc === l.id ? theme.accent : theme.border), background: activeLoc === l.id ? theme.accent + '20' : 'transparent', color: activeLoc === l.id ? theme.accent : theme.textMuted, fontFamily: 'inherit' }}>{l.icon} {l.name}</button>); })}
      </div>
      <div ref={barRef} data-testid="schedule-template-bar" onMouseDown={onMouseDown} onTouchStart={onTouchStart} style={{ position: 'relative', height: 40, background: theme.bgTertiary, borderRadius: 6, cursor: activeLoc ? 'pointer' : 'default', overflow: 'hidden', userSelect: 'none' }}>
        {segments.map(function(s, i) { return (<div key={i} style={{ position: 'absolute', left: pct(s.start) + '%', width: pct(s.end) - pct(s.start) + '%', top: 0, bottom: 0, background: LOC_TINT[s.loc] || theme.border, opacity: s.loc === 'unset' ? 0.15 : 0.4 }} />); })}
        {blocks.map(function(b, i) { return (<div key={i} data-testid="template-block" style={{ position: 'absolute', left: pct(b.start) + '%', width: pct(b.end) - pct(b.start) + '%', top: 0, bottom: 0, border: '2px solid ' + (b.color || theme.accent), borderRadius: 4, boxSizing: 'border-box', pointerEvents: 'none' }}><div style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', pointerEvents: 'auto' }} onMouseDown={function(e) { onBlockEdgeDown(e, i, 'start'); }} /><div style={{ position: 'absolute', right: -3, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', pointerEvents: 'auto' }} onMouseDown={function(e) { onBlockEdgeDown(e, i, 'end'); }} /></div>); })}
        {hourTicks.map(function(h) { return (<div key={h} style={{ position: 'absolute', left: pct(h) + '%', top: 0, bottom: 0, borderLeft: '1px solid ' + theme.border, opacity: 0.3 }} />); })}
      </div>
    </div>
  );
}

/** Slugify a user-entered template name into a stable object-key id. */
function slugify(name) {
  var slug = (name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug || 'template';
}

export default function UnifiedTemplateTab({ config, theme, darkMode, isMobile, showToast }) {
  var [selectedDay, setSelectedDay] = useState('Mon');
  var [renamingId, setRenamingId] = useState(null);
  var [renameValue, setRenameValue] = useState('');
  var [creatingTemplate, setCreatingTemplate] = useState(false);
  var [newTemplateName, setNewTemplateName] = useState('');
  var [pendingDeleteId, setPendingDeleteId] = useState(null);
  var [pendingReset, setPendingReset] = useState(false);
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  var locations = config.locations || [];
  var scheduleTemplates = config.scheduleTemplates || {};
  var templateDefaults = config.templateDefaults || {};
  var templateOverrides = config.templateOverrides || {};
  var templateIds = Object.keys(scheduleTemplates);

  var currentTemplateId = templateDefaults[selectedDay] || 'weekday';
  var currentTemplate = scheduleTemplates[currentTemplateId] || { name: selectedDay, blocks: [], locOverrides: {} };
  var hours = buildEffectiveHours(currentTemplate.blocks || [], currentTemplate.locOverrides || {});

  function persistTemplates(nextTemplates) {
    return config.updateScheduleTemplates(nextTemplates, templateDefaults, templateOverrides);
  }

  // Painting a location must NEVER rebuild `blocks` (that destroyed ids/tags/
  // names/icons and renamed every block to tag:'custom'/name:'Custom' —
  // the exact corruption this ticket fixes). Instead it recomputes
  // `locOverrides` as the diff between the painted effective hours and the
  // block-derived base hours (blocks unchanged, no overrides applied): a slot
  // painted back to its block's own location drops out of the override map,
  // a slot painted to something else gets an override — untouched blocks and
  // slots are carried through unchanged either way.
  function commitHours(newHours) {
    var blocks = currentTemplate.blocks || [];
    var baseHours = buildEffectiveHours(blocks, {});
    var newOverrides = {};
    Object.keys(newHours).forEach(function(k) {
      var m = parseInt(k, 10);
      var loc = newHours[k];
      if (baseHours[m] !== loc) newOverrides[m] = loc;
    });
    var updatedTemplate = Object.assign({}, currentTemplate, { locOverrides: newOverrides });
    persistTemplates(Object.assign({}, scheduleTemplates, { [currentTemplateId]: updatedTemplate }));
  }

  function handleBlocksChange(newBlocks) {
    var updatedTemplate = Object.assign({}, currentTemplate, { blocks: newBlocks });
    persistTemplates(Object.assign({}, scheduleTemplates, { [currentTemplateId]: updatedTemplate }));
  }

  function handleAssignDay(templateId) {
    var updated = Object.assign({}, templateDefaults, { [selectedDay]: templateId });
    config.updateTemplateDefaults(updated);
  }

  function uniqueTemplateId(base) {
    var id = base, n = 1;
    while (scheduleTemplates[id]) { id = base + '_' + n; n += 1; }
    return id;
  }

  function handleCreateTemplate() {
    var trimmed = (newTemplateName || '').trim();
    if (!trimmed) return;
    var sourceBlocks = (scheduleTemplates.weekday && scheduleTemplates.weekday.blocks) || [];
    var newId = uniqueTemplateId(slugify(trimmed));
    var newTemplate = {
      name: trimmed,
      icon: '📅',
      system: false,
      blocks: sourceBlocks.map(function(b) { return Object.assign({}, b); }),
      locOverrides: {}
    };
    persistTemplates(Object.assign({}, scheduleTemplates, { [newId]: newTemplate }));
    setNewTemplateName('');
    setCreatingTemplate(false);
  }

  function handleStartRename(templateId) {
    var tmpl = scheduleTemplates[templateId];
    setRenamingId(templateId);
    setRenameValue((tmpl && tmpl.name) || '');
  }

  function handleCommitRename() {
    var trimmed = (renameValue || '').trim();
    var tmpl = scheduleTemplates[renamingId];
    if (!trimmed || !tmpl) { setRenamingId(null); return; }
    var updated = Object.assign({}, tmpl, { name: trimmed });
    persistTemplates(Object.assign({}, scheduleTemplates, { [renamingId]: updated }));
    setRenamingId(null);
  }

  function handleDuplicate(templateId) {
    var tmpl = scheduleTemplates[templateId];
    if (!tmpl) return;
    var newId = uniqueTemplateId(templateId + '_copy');
    var newTemplate = {
      name: tmpl.name + ' copy',
      icon: tmpl.icon,
      system: false,
      blocks: (tmpl.blocks || []).map(function(b) { return Object.assign({}, b); }),
      locOverrides: Object.assign({}, tmpl.locOverrides || {})
    };
    persistTemplates(Object.assign({}, scheduleTemplates, { [newId]: newTemplate }));
  }

  function handleRequestDelete(templateId) {
    var tmpl = scheduleTemplates[templateId];
    if (!tmpl || tmpl.system) return; // system templates are never deletable
    setPendingDeleteId(templateId);
  }

  function handleDeleteConfirmed() {
    var templateId = pendingDeleteId;
    var tmpl = scheduleTemplates[templateId];
    setPendingDeleteId(null);
    if (!tmpl || tmpl.system) return;

    var nextTemplates = Object.assign({}, scheduleTemplates);
    delete nextTemplates[templateId];

    var nextDefaults = Object.assign({}, templateDefaults);
    Object.keys(nextDefaults).forEach(function(day) {
      if (nextDefaults[day] === templateId) nextDefaults[day] = 'weekday';
    });

    var nextOverrides = Object.assign({}, templateOverrides);
    var overridesChanged = false;
    Object.keys(nextOverrides).forEach(function(dateKey) {
      if (nextOverrides[dateKey] === templateId) { nextOverrides[dateKey] = 'weekday'; overridesChanged = true; }
    });

    config.updateScheduleTemplates(nextTemplates, nextDefaults, nextOverrides);
    config.updateTemplateDefaults(nextDefaults);
    if (overridesChanged) config.updateTemplateOverrides(nextOverrides);
  }

  async function handleReset() {
    setPendingReset(false);
    try {
      var { default: apiClient } = await import('../../../services/apiClient');
      var resp = await apiClient.post('/config/templates/reset');
      config.applyScheduleTemplatesResponse(resp.data);
    } catch (error) {
      var responseData = error && error.response && error.response.data;
      var serverMsg = responseData && responseData.error;
      var details = responseData && responseData.details;
      var msg = serverMsg || 'Failed to reset templates';
      if (Array.isArray(details) && details.length > 0) msg = msg + ': ' + details.join(', ');
      if (typeof showToast === 'function') showToast(msg, 'error');
    }
  }

  var rowStyle = { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6, fontSize: 13, marginBottom: 4 };
  var iconBtnStyle = { border: 'none', background: 'transparent', color: theme.textMuted, cursor: 'pointer', fontSize: 12 };

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>
        <HelpIcon text="Templates — define daily time blocks, locations, and schedule structure." theme={theme}><span>Schedule Templates</span></HelpIcon>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {DAY_NAMES.map(function(d) { return (<button key={d} onClick={function() { setSelectedDay(d); }} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid ' + (selectedDay === d ? theme.accent : theme.border), background: selectedDay === d ? theme.accent : 'transparent', color: selectedDay === d ? '#FDFAF5' : theme.textSecondary, fontFamily: 'inherit', fontWeight: selectedDay === d ? 600 : 400 }}>{d}</button>); })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <label htmlFor="template-day-assign" style={{ fontSize: 11, color: theme.textMuted }}>Uses template:</label>
        <select
          id="template-day-assign"
          aria-label={'Template for ' + selectedDay}
          value={currentTemplateId}
          onChange={function(e) { handleAssignDay(e.target.value); }}
          style={{ padding: '3px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }}
        >
          {templateIds.map(function(id) { return (<option key={id} value={id}>{scheduleTemplates[id].name}</option>); })}
        </select>
      </div>
      <ScheduleTemplateBar hours={hours} locations={locations} theme={theme} onCommit={commitHours} blocks={currentTemplate.blocks || []} onBlocksChange={handleBlocksChange} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>Manage templates</div>
        <button onClick={function() { setCreatingTemplate(true); }} aria-label="New template" style={{ border: 'none', borderRadius: 4, padding: '4px 10px', background: theme.accent, color: '#FDFAF5', fontSize: 12, cursor: 'pointer' }}>+ New Template</button>
      </div>

      {creatingTemplate && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            aria-label="New template name"
            value={newTemplateName}
            onChange={function(e) { setNewTemplateName(e.target.value); }}
            onKeyDown={function(e) { if (e.key === 'Enter') handleCreateTemplate(); if (e.key === 'Escape') { setCreatingTemplate(false); setNewTemplateName(''); } }}
            placeholder="Template name"
            autoFocus
            style={{ flex: 1, padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }}
          />
          <button onClick={handleCreateTemplate} style={{ border: 'none', borderRadius: 4, padding: '4px 10px', background: '#2D6A4F', color: '#FDFAF5', fontSize: 12, cursor: 'pointer' }}>Create</button>
          <button onClick={function() { setCreatingTemplate(false); setNewTemplateName(''); }} style={{ border: 'none', background: 'transparent', color: theme.textMuted, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        {templateIds.map(function(id) {
          var t = scheduleTemplates[id];
          if (renamingId === id) {
            return (
              <div key={id} style={rowStyle}>
                <input
                  aria-label={'Rename template ' + t.name}
                  value={renameValue}
                  onChange={function(e) { setRenameValue(e.target.value); }}
                  onKeyDown={function(e) { if (e.key === 'Enter') handleCommitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                  autoFocus
                  style={{ flex: 1, padding: '2px 4px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }}
                />
                <button onClick={handleCommitRename} style={{ border: 'none', borderRadius: 4, padding: '2px 8px', background: '#2D6A4F', color: '#FDFAF5', fontSize: 11, cursor: 'pointer' }}>Save</button>
                <button onClick={function() { setRenamingId(null); }} style={{ border: 'none', background: 'transparent', color: theme.textMuted, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
              </div>
            );
          }
          return (
            <div key={id} style={rowStyle}>
              <span style={{ color: theme.text, flex: 1 }}>{t.icon} {t.name}{t.system ? ' (system)' : ''}</span>
              <button aria-label={'Rename template ' + t.name} onClick={function() { handleStartRename(id); }} style={iconBtnStyle}>&#x270E;</button>
              <button aria-label={'Duplicate template ' + t.name} onClick={function() { handleDuplicate(id); }} style={iconBtnStyle}>&#x29C9;</button>
              {!t.system && (
                <button aria-label={'Delete template ' + t.name} onClick={function() { handleRequestDelete(id); }} style={Object.assign({}, iconBtnStyle, { color: theme.redText, fontSize: 14 })}>&times;</button>
              )}
            </div>
          );
        })}
      </div>

      <button
        aria-label="Reset templates to defaults"
        onClick={function() { setPendingReset(true); }}
        style={{ border: '1px solid ' + theme.border, borderRadius: 4, padding: '4px 10px', background: 'transparent', color: theme.textSecondary, fontSize: 12, cursor: 'pointer' }}
      >
        Reset to defaults
      </button>

      {pendingDeleteId && (
        <ConfirmDialog
          title="Delete template?"
          message={'Delete template "' + ((scheduleTemplates[pendingDeleteId] && scheduleTemplates[pendingDeleteId].name) || '') + '"? Days using it will switch to Weekday.'}
          onConfirm={handleDeleteConfirmed}
          onCancel={function() { setPendingDeleteId(null); }}
          darkMode={darkMode}
          isMobile={isMobile}
        />
      )}
      {pendingReset && (
        <ConfirmDialog
          title="Reset templates?"
          message="Restore all schedule templates to their defaults? Custom templates and edits will be lost."
          confirmLabel="Reset"
          onConfirm={handleReset}
          onCancel={function() { setPendingReset(false); }}
          darkMode={darkMode}
          isMobile={isMobile}
        />
      )}
    </div>
  );
}
