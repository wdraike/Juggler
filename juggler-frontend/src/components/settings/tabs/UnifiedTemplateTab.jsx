/**
 * UnifiedTemplateTab — extracted from SettingsPanel (999.965).
 * Stub — full implementation was in SettingsPanel.jsx.
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import HelpIcon from '../HelpIcon';

var PRESET_BLOCKS = (function() {
  var { DEFAULT_WEEKDAY_BLOCKS, DEFAULT_WEEKEND_BLOCKS } = require('../../../state/constants');
  var all = DEFAULT_WEEKDAY_BLOCKS.concat(DEFAULT_WEEKEND_BLOCKS);
  var seen = {};
  var result = [];
  all.forEach(function(b) {
    var key = b.tag + '_' + b.name;
    if (!seen[key]) { seen[key] = true; result.push({ tag: b.tag, name: b.name, start: b.start, end: b.end, color: b.color, icon: b.icon, loc: b.loc }); }
  });
  return result;
})();

var LOC_TINT = { home: '#2E4A7A', work: '#C8942A', transit: '#5C5A55', downtown: '#2D6A4F', gym: '#8B2635', errand: '#EC4899' };
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
  var barRef = useRef(null);
  var dragRef = useRef(null);
  var hoursRef = useRef(hours);
  var onCommitRef = useRef(onCommit);
  hoursRef.current = hours;
  onCommitRef.current = onCommit;

  var range = useMemo(function() { return getTimeRange(blocks); }, [blocks]);
  var startMin = range.startMin, endMin = range.endMin, totalMin = endMin - startMin;
  var rangeRef = useRef({ startMin: startMin, endMin: endMin, totalMin: totalMin });
  rangeRef.current = { startMin: startMin, endMin: endMin, totalMin: totalMin };

  function pct(mins) { return pctOf(mins, startMin, totalMin); }

  var hourTicks = useMemo(function() { var ticks = []; var first = Math.ceil(startMin / 120) * 120; for (var h = first; h <= endMin; h += 120) { ticks.push(h); } return ticks; }, [startMin, endMin]);
  var segments = useMemo(function() { return buildSegments(hours, startMin, endMin); }, [hours, startMin, endMin]);
  var locMap = useMemo(function() { var m = {}; locations.forEach(function(l) { m[l.id] = l; }); return m; }, [locations]);

  useEffect(function() { if (activeLoc && !locMap[activeLoc] && locations.length > 0) { setActiveLoc(locations[0].id); } }, [locations, activeLoc, locMap]);

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
    var block = blocks[blockIdx];
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
      <div ref={barRef} onMouseDown={onMouseDown} onTouchStart={onTouchStart} style={{ position: 'relative', height: 40, background: theme.bgTertiary, borderRadius: 6, cursor: activeLoc ? 'pointer' : 'default', overflow: 'hidden', userSelect: 'none' }}>
        {segments.map(function(s, i) { return (<div key={i} style={{ position: 'absolute', left: pct(s.start) + '%', width: pct(s.end) - pct(s.start) + '%', top: 0, bottom: 0, background: LOC_TINT[s.loc] || theme.border, opacity: s.loc === 'unset' ? 0.15 : 0.4 }} />); })}
        {blocks.map(function(b, i) { return (<div key={i} style={{ position: 'absolute', left: pct(b.start) + '%', width: pct(b.end) - pct(b.start) + '%', top: 0, bottom: 0, border: '2px solid ' + (b.color || theme.accent), borderRadius: 4, boxSizing: 'border-box', pointerEvents: 'none' }}><div style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', pointerEvents: 'auto' }} onMouseDown={function(e) { onBlockEdgeDown(e, i, 'start'); }} /><div style={{ position: 'absolute', right: -3, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', pointerEvents: 'auto' }} onMouseDown={function(e) { onBlockEdgeDown(e, i, 'end'); }} /></div>); })}
        {hourTicks.map(function(h) { return (<div key={h} style={{ position: 'absolute', left: pct(h) + '%', top: 0, bottom: 0, borderLeft: '1px solid ' + theme.border, opacity: 0.3 }} />); })}
      </div>
    </div>
  );
}

export default function UnifiedTemplateTab({ config, theme, showToast, allTasks }) {
  var [selectedDay, setSelectedDay] = useState('Mon');
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  var locations = config.locations || [];
  var locSchedules = config.locSchedules || {};
  var locScheduleDefaults = config.locScheduleDefaults || {};
  var locScheduleOverrides = config.locScheduleOverrides || {};

  var currentTemplateId = locScheduleDefaults[selectedDay] || 'weekday';
  var currentTemplate = locSchedules[currentTemplateId] || { name: selectedDay, blocks: [], locOverrides: {} };
  var hours = buildEffectiveHours(currentTemplate.blocks || [], currentTemplate.locOverrides || {});

  function commitHours(newHours) {
    var newBlocks = [];
    var newOverrides = {};
    var inBlock = false;
    var blockStart = null;
    var blockLoc = null;
    for (var m = 0; m < 1440; m += 15) {
      var loc = newHours[m] || 'unset';
      if (loc !== 'unset' && !inBlock) { inBlock = true; blockStart = m; blockLoc = loc; }
      else if ((loc === 'unset' || loc !== blockLoc) && inBlock) {
        newBlocks.push({ start: blockStart, end: m, loc: blockLoc, tag: 'custom', name: 'Custom', color: LOC_TINT[blockLoc] || theme.accent });
        inBlock = false;
      }
    }
    if (inBlock) { newBlocks.push({ start: blockStart, end: 1440, loc: blockLoc, tag: 'custom', name: 'Custom', color: LOC_TINT[blockLoc] || theme.accent }); }
    var updated = Object.assign({}, locSchedules, { [currentTemplateId]: Object.assign({}, currentTemplate, { blocks: newBlocks, locOverrides: newOverrides }) });
    config.updateLocSchedules(updated);
  }

  function handleBlocksChange(newBlocks) {
    var updated = Object.assign({}, locSchedules, { [currentTemplateId]: Object.assign({}, currentTemplate, { blocks: newBlocks }) });
    config.updateLocSchedules(updated);
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>
        <HelpIcon text="Templates — define daily time blocks, locations, and schedule structure." theme={theme}><span>Schedule Templates</span></HelpIcon>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {DAY_NAMES.map(function(d) { return (<button key={d} onClick={function() { setSelectedDay(d); }} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', border: '1px solid ' + (selectedDay === d ? theme.accent : theme.border), background: selectedDay === d ? theme.accent : 'transparent', color: selectedDay === d ? '#FDFAF5' : theme.textSecondary, fontFamily: 'inherit', fontWeight: selectedDay === d ? 600 : 400 }}>{d}</button>); })}
      </div>
      <div style={{ marginBottom: 8, fontSize: 11, color: theme.textMuted }}>Template: {currentTemplate.name}</div>
      <ScheduleTemplateBar hours={hours} locations={locations} theme={theme} onCommit={commitHours} blocks={currentTemplate.blocks || []} onBlocksChange={handleBlocksChange} />
    </div>
  );
}
