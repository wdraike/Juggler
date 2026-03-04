/**
 * SettingsPanel — tabbed container for locations, tools, matrix, time blocks, etc.
 */

import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { getTheme } from '../../theme/colors';

var TABS = [
  { id: 'locations', label: 'Locations' },
  { id: 'tools', label: 'Tools' },
  { id: 'matrix', label: 'Tool Matrix' },
  { id: 'timeblocks', label: 'Time Blocks' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'projects', label: 'Projects' },
  { id: 'preferences', label: 'Preferences' },
];

export default function SettingsPanel({ onClose, darkMode, config, allProjectNames, isMobile }) {
  var theme = getTheme(darkMode);
  var [tab, setTab] = useState('locations');

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      <div style={{
        background: theme.bgSecondary, borderRadius: isMobile ? 0 : 12,
        width: isMobile ? '100%' : 700, maxWidth: isMobile ? '100%' : '95vw',
        height: isMobile ? '100%' : undefined, maxHeight: isMobile ? '100%' : '85vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: isMobile ? 'none' : `0 8px 32px ${theme.shadow}`
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: `1px solid ${theme.border}`
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: theme.text }}>Settings</div>
          <button onClick={onClose} style={{
            border: 'none', background: 'transparent', color: theme.textMuted,
            fontSize: 20, cursor: 'pointer'
          }}>&times;</button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: 2, padding: '8px 16px',
          borderBottom: `1px solid ${theme.border}`, overflowX: 'auto'
        }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
              background: tab === t.id ? theme.accent : 'transparent',
              color: tab === t.id ? '#FFF' : theme.textSecondary,
              fontSize: 12, fontWeight: tab === t.id ? 600 : 400, fontFamily: 'inherit',
              whiteSpace: 'nowrap'
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {tab === 'locations' && <LocationsTab config={config} theme={theme} />}
          {tab === 'tools' && <ToolsTab config={config} theme={theme} />}
          {tab === 'matrix' && <MatrixTab config={config} theme={theme} />}
          {tab === 'projects' && <ProjectsTab config={config} theme={theme} allProjectNames={allProjectNames} />}
          {tab === 'preferences' && <PreferencesTab config={config} theme={theme} />}
          {tab === 'timeblocks' && <TimeBlocksTab config={config} theme={theme} />}
          {tab === 'schedules' && <SchedulesTab config={config} theme={theme} />}
        </div>
      </div>
    </div>
  );
}

function LocationsTab({ config, theme }) {
  var [newName, setNewName] = useState('');
  var [newId, setNewId] = useState('');
  var [newIcon, setNewIcon] = useState('');

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Locations</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {config.locations.map((loc, i) => (
          <div key={loc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6, fontSize: 13 }}>
            <span>{loc.icon}</span>
            <span style={{ color: theme.text, flex: 1 }}>{loc.name}</span>
            <span style={{ fontSize: 10, color: theme.textMuted }}>{loc.id}</span>
            <button onClick={() => {
              var updated = config.locations.filter((_, idx) => idx !== i);
              config.updateLocations(updated);
            }} style={{ border: 'none', background: 'transparent', color: '#EF4444', cursor: 'pointer', fontSize: 14 }}>&times;</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={newIcon} onChange={e => setNewIcon(e.target.value)} placeholder="Icon" style={{ width: 40, padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <input value={newId} onChange={e => setNewId(e.target.value)} placeholder="ID" style={{ width: 80, padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name" style={{ flex: 1, padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <button onClick={() => {
          if (!newId || !newName) return;
          config.updateLocations([...config.locations, { id: newId, name: newName, icon: newIcon || '\uD83D\uDCCD' }]);
          setNewId(''); setNewName(''); setNewIcon('');
        }} style={{ border: 'none', borderRadius: 4, padding: '4px 12px', background: theme.accent, color: '#FFF', fontSize: 12, cursor: 'pointer' }}>Add</button>
      </div>
    </div>
  );
}

function ToolsTab({ config, theme }) {
  var [newName, setNewName] = useState('');
  var [newId, setNewId] = useState('');
  var [newIcon, setNewIcon] = useState('');

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Tools</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {config.tools.map((tool, i) => (
          <div key={tool.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6, fontSize: 13 }}>
            <span>{tool.icon}</span>
            <span style={{ color: theme.text, flex: 1 }}>{tool.name}</span>
            <span style={{ fontSize: 10, color: theme.textMuted }}>{tool.id}</span>
            <button onClick={() => {
              config.updateTools(config.tools.filter((_, idx) => idx !== i));
            }} style={{ border: 'none', background: 'transparent', color: '#EF4444', cursor: 'pointer', fontSize: 14 }}>&times;</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={newIcon} onChange={e => setNewIcon(e.target.value)} placeholder="Icon" style={{ width: 40, padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <input value={newId} onChange={e => setNewId(e.target.value)} placeholder="ID" style={{ width: 80, padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name" style={{ flex: 1, padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <button onClick={() => {
          if (!newId || !newName) return;
          config.updateTools([...config.tools, { id: newId, name: newName, icon: newIcon || '\uD83D\uDD27' }]);
          setNewId(''); setNewName(''); setNewIcon('');
        }} style={{ border: 'none', borderRadius: 4, padding: '4px 12px', background: theme.accent, color: '#FFF', fontSize: 12, cursor: 'pointer' }}>Add</button>
      </div>
    </div>
  );
}

function MatrixTab({ config, theme }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Tool Availability Matrix</div>
      <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 12 }}>Which tools are available at each location</div>
      {config.locations.map(loc => (
        <div key={loc.id} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 4 }}>{loc.icon} {loc.name}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {config.tools.map(tool => {
              var available = (config.toolMatrix[loc.id] || []).includes(tool.id);
              return (
                <button key={tool.id} onClick={() => {
                  var matrix = { ...config.toolMatrix };
                  var arr = [...(matrix[loc.id] || [])];
                  if (available) { arr = arr.filter(t => t !== tool.id); }
                  else { arr.push(tool.id); }
                  matrix[loc.id] = arr;
                  config.updateToolMatrix(matrix);
                }} style={{
                  border: `1px solid ${available ? theme.accent : theme.border}`,
                  background: available ? theme.accent + '20' : 'transparent',
                  color: available ? theme.accent : theme.textMuted,
                  borderRadius: 12, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit'
                }}>
                  {tool.icon} {tool.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectsTab({ config, theme, allProjectNames }) {
  var [newName, setNewName] = useState('');
  var [newColor, setNewColor] = useState('#3B82F6');

  // Merge DB projects with task-derived project names
  var dbProjectNames = new Set(config.projects.map(function(p) { return p.name; }));
  var taskOnlyNames = (allProjectNames || []).filter(function(n) { return !dbProjectNames.has(n); });

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Projects</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {config.projects.map(p => (
          <div key={p.id || p.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6, fontSize: 13 }}>
            {p.color && <div style={{ width: 12, height: 12, borderRadius: 3, background: p.color }} />}
            <span style={{ color: theme.text, flex: 1 }}>{p.name}</span>
            <button onClick={async () => {
              if (!p.id) return;
              try {
                var { default: apiClient } = await import('../../services/apiClient');
                await apiClient.delete('/projects/' + p.id);
                config.setProjects(config.projects.filter(function(x) { return x.id !== p.id; }));
              } catch (e) { console.error(e); }
            }} style={{ border: 'none', background: 'transparent', color: '#EF4444', cursor: 'pointer', fontSize: 14 }}>&times;</button>
          </div>
        ))}
        {taskOnlyNames.map(name => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6, fontSize: 13, opacity: 0.7 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: theme.textMuted, opacity: 0.3 }} />
            <span style={{ color: theme.text, flex: 1 }}>{name}</span>
            <span style={{ fontSize: 10, color: theme.textMuted }}>from tasks</span>
          </div>
        ))}
      </div>
      {config.projects.length === 0 && taskOnlyNames.length === 0 && (
        <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 12 }}>No projects yet. Add one below or assign a project to a task.</div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} style={{ width: 32, height: 28, border: 'none', cursor: 'pointer' }} />
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Project name" style={{ flex: 1, padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <button onClick={async () => {
          if (!newName) return;
          try {
            var { default: apiClient } = await import('../../services/apiClient');
            var res = await apiClient.post('/projects', { name: newName, color: newColor });
            config.setProjects([...config.projects, res.data.project]);
            setNewName('');
          } catch (e) { console.error(e); }
        }} style={{ border: 'none', borderRadius: 4, padding: '4px 12px', background: theme.accent, color: '#FFF', fontSize: 12, cursor: 'pointer' }}>Add</button>
      </div>
    </div>
  );
}

function PreferencesTab({ config, theme }) {
  function savePrefs(patch) {
    config.updatePreferences({
      gridZoom: config.gridZoom, splitDefault: config.splitDefault,
      splitMinDefault: config.splitMinDefault, schedFloor: config.schedFloor,
      fontSize: config.fontSize,
      ...patch
    });
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 12 }}>Preferences</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          Font size:
          <input type="range" min={80} max={140} value={config.fontSize} onChange={e => { var v = parseInt(e.target.value); config.setFontSize(v); savePrefs({ fontSize: v }); }} />
          <span style={{ fontSize: 11, color: theme.textMuted }}>{config.fontSize}%</span>
        </label>
        <label style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          Grid zoom (px/hour):
          <input type="range" min={30} max={120} value={config.gridZoom} onChange={e => { var v = parseInt(e.target.value); config.setGridZoom(v); savePrefs({ gridZoom: v }); }} />
          <span style={{ fontSize: 11, color: theme.textMuted }}>{config.gridZoom}px</span>
        </label>
        <label style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={config.splitDefault} onChange={e => { var v = e.target.checked; config.setSplitDefault(v); savePrefs({ splitDefault: v }); }} />
          Split tasks by default
        </label>
        <label style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          Min chunk (min):
          <input type="number" value={config.splitMinDefault} onChange={e => { var v = parseInt(e.target.value) || 15; config.setSplitMinDefault(v); savePrefs({ splitMinDefault: v }); }} style={{ width: 60, padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        </label>
        <label style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          Earliest scheduling time:
          <select value={config.schedFloor} onChange={e => { var v = parseInt(e.target.value); config.setSchedFloor(v); savePrefs({ schedFloor: v }); }}
            style={{ padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }}>
            {[360,420,480,540,600,660,720].map(m => (
              <option key={m} value={m}>{Math.floor(m/60) % 12 || 12}:{(m%60) < 10 ? '0' : ''}{m%60} {m < 720 ? 'AM' : 'PM'}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function minsToTime(m) {
  var h = Math.floor(m / 60);
  var mm = m % 60;
  var ampm = h >= 12 ? 'PM' : 'AM';
  var hh = h % 12 || 12;
  return hh + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ampm;
}

function minsToShort(m) {
  var h = Math.floor(m / 60);
  var mm = m % 60;
  var ampm = h >= 12 ? 'p' : 'a';
  var hh = h % 12 || 12;
  return mm === 0 ? hh + ampm : hh + ':' + (mm < 10 ? '0' : '') + mm + ampm;
}

function TimeBlocksTab({ config, theme }) {
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var [selectedDay, setSelectedDay] = useState('Mon');
  var [editingIdx, setEditingIdx] = useState(null);
  var blocks = config.timeBlocks[selectedDay] || [];

  function updateBlocks(day, newBlocks) {
    var updated = { ...config.timeBlocks, [day]: newBlocks };
    config.updateTimeBlocks(updated);
  }

  function addBlock() {
    var last = blocks[blocks.length - 1];
    var start = last ? last.end : 360;
    var newBlock = {
      id: 'block_' + Date.now(),
      tag: 'custom',
      name: 'New Block',
      start: start,
      end: Math.min(start + 60, 1440),
      color: '#6B7280',
      icon: '\u{1F4CB}',
      loc: config.locations[0]?.id || 'home'
    };
    updateBlocks(selectedDay, [...blocks, newBlock]);
    setEditingIdx(blocks.length);
  }

  function removeBlock(idx) {
    updateBlocks(selectedDay, blocks.filter(function(_, i) { return i !== idx; }));
    setEditingIdx(null);
  }

  function updateBlock(idx, field, value) {
    var updated = blocks.map(function(b, i) {
      if (i !== idx) return b;
      var next = { ...b, [field]: value };
      if (field === 'start' || field === 'end') next[field] = parseInt(value) || 0;
      return next;
    });
    updateBlocks(selectedDay, updated);
  }

  function copyToAllWeekdays() {
    var updated = { ...config.timeBlocks };
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach(function(d) { updated[d] = [...blocks]; });
    config.updateTimeBlocks(updated);
  }

  function copyToWeekends() {
    var updated = { ...config.timeBlocks };
    ['Sat', 'Sun'].forEach(function(d) { updated[d] = [...blocks]; });
    config.updateTimeBlocks(updated);
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Time Blocks</div>
      <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 12 }}>Define time blocks for each day of the week</div>

      {/* Day selector */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 12 }}>
        {DAYS.map(function(d) {
          return (
            <button key={d} onClick={function() { setSelectedDay(d); setEditingIdx(null); }} style={{
              border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
              background: selectedDay === d ? theme.accent : theme.bgTertiary,
              color: selectedDay === d ? '#FFF' : theme.textSecondary,
              fontSize: 12, fontWeight: selectedDay === d ? 600 : 400, fontFamily: 'inherit'
            }}>{d}</button>
          );
        })}
      </div>

      {/* Visual timeline */}
      <div style={{ position: 'relative', height: 36, background: theme.bgTertiary, borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
        {blocks.map(function(b, i) {
          var totalMin = 1080; // 6am to midnight = 18 hours
          var left = ((b.start - 360) / totalMin) * 100;
          var width = ((b.end - b.start) / totalMin) * 100;
          if (left < 0) left = 0;
          if (left + width > 100) width = 100 - left;
          return (
            <div key={i} onClick={function() { setEditingIdx(editingIdx === i ? null : i); }}
              title={b.name + ' (' + minsToTime(b.start) + ' - ' + minsToTime(b.end) + ')'}
              style={{
                position: 'absolute', top: 2, bottom: 2, left: left + '%', width: width + '%',
                background: b.color + '40', borderLeft: '3px solid ' + b.color,
                borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center',
                paddingLeft: 4, fontSize: 10, color: theme.text, overflow: 'hidden', whiteSpace: 'nowrap',
                outline: editingIdx === i ? '2px solid ' + theme.accent : 'none'
              }}>
              {b.icon} {width > 8 ? b.name : ''}
            </div>
          );
        })}
        {/* Hour markers */}
        {[6,8,10,12,14,16,18,20,22].map(function(h) {
          var left = ((h * 60 - 360) / 1080) * 100;
          return (
            <div key={h} style={{ position: 'absolute', top: 0, bottom: 0, left: left + '%', borderLeft: '1px solid ' + theme.border, opacity: 0.3 }}>
              <span style={{ fontSize: 8, color: theme.textMuted, position: 'absolute', top: 0, left: 2 }}>{minsToShort(h * 60)}</span>
            </div>
          );
        })}
      </div>

      {/* Block list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {blocks.map(function(b, i) {
          var isEditing = editingIdx === i;
          return (
            <div key={i}>
              <div onClick={function() { setEditingIdx(isEditing ? null : i); }} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                background: isEditing ? b.color + '15' : theme.bgTertiary,
                border: isEditing ? '1px solid ' + b.color : '1px solid transparent',
                borderRadius: 6, fontSize: 13, cursor: 'pointer'
              }}>
                <div style={{ width: 4, height: 20, borderRadius: 2, background: b.color }} />
                <span>{b.icon}</span>
                <span style={{ color: theme.text, flex: 1, fontWeight: 500 }}>{b.name}</span>
                <span style={{ fontSize: 11, color: theme.textMuted }}>{minsToTime(b.start)} - {minsToTime(b.end)}</span>
                <span style={{ fontSize: 10, color: theme.textMuted, background: theme.bgTertiary, padding: '1px 6px', borderRadius: 8 }}>
                  {config.locations.find(function(l) { return l.id === b.loc; })?.icon || ''} {b.loc}
                </span>
                <button onClick={function(e) { e.stopPropagation(); removeBlock(i); }} style={{
                  border: 'none', background: 'transparent', color: '#EF4444', cursor: 'pointer', fontSize: 14
                }}>&times;</button>
              </div>
              {isEditing && (
                <div style={{ padding: '8px 12px', display: 'flex', flexWrap: 'wrap', gap: 8, background: theme.bgTertiary, borderRadius: '0 0 6px 6px', marginTop: -2 }}>
                  <label style={{ fontSize: 11, color: theme.textSecondary }}>
                    Name
                    <input value={b.name} onChange={function(e) { updateBlock(i, 'name', e.target.value); }}
                      style={{ display: 'block', width: 100, padding: '3px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
                  </label>
                  <label style={{ fontSize: 11, color: theme.textSecondary }}>
                    Start (min)
                    <input type="number" value={b.start} step={15} onChange={function(e) { updateBlock(i, 'start', e.target.value); }}
                      style={{ display: 'block', width: 70, padding: '3px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
                  </label>
                  <label style={{ fontSize: 11, color: theme.textSecondary }}>
                    End (min)
                    <input type="number" value={b.end} step={15} onChange={function(e) { updateBlock(i, 'end', e.target.value); }}
                      style={{ display: 'block', width: 70, padding: '3px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
                  </label>
                  <label style={{ fontSize: 11, color: theme.textSecondary }}>
                    Location
                    <select value={b.loc} onChange={function(e) { updateBlock(i, 'loc', e.target.value); }}
                      style={{ display: 'block', padding: '3px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }}>
                      {config.locations.map(function(l) { return <option key={l.id} value={l.id}>{l.icon} {l.name}</option>; })}
                    </select>
                  </label>
                  <label style={{ fontSize: 11, color: theme.textSecondary }}>
                    Color
                    <input type="color" value={b.color} onChange={function(e) { updateBlock(i, 'color', e.target.value); }}
                      style={{ display: 'block', width: 32, height: 24, border: 'none', cursor: 'pointer' }} />
                  </label>
                  <label style={{ fontSize: 11, color: theme.textSecondary }}>
                    Icon
                    <input value={b.icon} onChange={function(e) { updateBlock(i, 'icon', e.target.value); }}
                      style={{ display: 'block', width: 40, padding: '3px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={addBlock} style={{
          border: 'none', borderRadius: 4, padding: '5px 12px', background: theme.accent, color: '#FFF', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit'
        }}>+ Add Block</button>
        <button onClick={copyToAllWeekdays} style={{
          border: '1px solid ' + theme.border, borderRadius: 4, padding: '5px 12px', background: 'transparent', color: theme.textSecondary, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit'
        }}>Copy to Mon-Fri</button>
        <button onClick={copyToWeekends} style={{
          border: '1px solid ' + theme.border, borderRadius: 4, padding: '5px 12px', background: 'transparent', color: theme.textSecondary, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit'
        }}>Copy to Sat-Sun</button>
      </div>
    </div>
  );
}

var LOC_TINT = { home: '#3B82F6', work: '#F59E0B', transit: '#9CA3AF', downtown: '#10B981', gym: '#EF4444', errand: '#EC4899' };
var TOTAL_MIN = 1080; // 6AM (360) to midnight (1440)
var START_MIN = 360;
var END_MIN = 1440;

function buildSegments(hours) {
  var segs = [];
  for (var m = START_MIN; m < END_MIN; m += 15) {
    var loc = hours[m] || 'unset';
    var last = segs[segs.length - 1];
    if (last && last.loc === loc && last.end === m) {
      last.end = m + 15;
    } else {
      segs.push({ start: m, end: m + 15, loc: loc });
    }
  }
  return segs;
}

function snapToSlot(clientX, barEl) {
  var rect = barEl.getBoundingClientRect();
  var ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  var raw = ratio * TOTAL_MIN + START_MIN;
  var snapped = Math.round(raw / 15) * 15;
  return Math.max(START_MIN, Math.min(END_MIN, snapped));
}

function ScheduleTemplateBar({ hours, locations, theme, onCommit }) {
  var [activeLoc, setActiveLoc] = useState(locations[0]?.id || null);
  var [, forceRender] = useState(0);
  var barRef = useRef(null);
  var previewRef = useRef(null);
  var dragRef = useRef(null);

  var segments = useMemo(function() { return buildSegments(hours); }, [hours]);

  var locIds = useMemo(function() { return locations.map(function(l) { return l.id; }); }, [locations]);
  var locMap = useMemo(function() {
    var m = {};
    locations.forEach(function(l) { m[l.id] = l; });
    return m;
  }, [locations]);

  // Reset activeLoc if locations change
  useEffect(function() {
    if (activeLoc && !locMap[activeLoc] && locations.length > 0) {
      setActiveLoc(locations[0].id);
    }
  }, [locations, activeLoc, locMap]);

  var pctOf = useCallback(function(mins) {
    return ((mins - START_MIN) / TOTAL_MIN) * 100;
  }, []);

  // --- Find segment at a minute ---
  function segmentAt(minute) {
    for (var i = 0; i < segments.length; i++) {
      if (minute >= segments[i].start && minute < segments[i].end) return { seg: segments[i], idx: i };
    }
    return null;
  }

  // --- Hit test: near edge? ---
  function hitTest(clientX) {
    var bar = barRef.current;
    if (!bar) return null;
    var rect = bar.getBoundingClientRect();
    var minute = snapToSlot(clientX, bar);
    var pxPerMin = rect.width / TOTAL_MIN;

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (seg.loc === 'unset') continue;
      // Check left edge (but not the very first segment edge at 360)
      var leftPx = rect.left + (seg.start - START_MIN) * pxPerMin;
      if (i > 0 && Math.abs(clientX - leftPx) < 8) {
        return { type: 'resize', edge: 'left', segIdx: i, seg: seg };
      }
      // Check right edge
      var rightPx = rect.left + (seg.end - START_MIN) * pxPerMin;
      if (Math.abs(clientX - rightPx) < 8) {
        return { type: 'resize', edge: 'right', segIdx: i, seg: seg };
      }
    }
    // Check if on a segment body vs unset
    var found = segmentAt(minute);
    if (found && found.seg.loc !== 'unset') {
      return { type: 'segment', segIdx: found.idx, seg: found.seg, minute: minute };
    }
    return { type: 'empty', minute: minute };
  }

  // --- Write slots into hours object ---
  function writeSlots(startMin, endMin, locId) {
    var newHours = {};
    // Copy existing
    Object.keys(hours).forEach(function(k) { newHours[parseInt(k)] = hours[k]; });
    for (var m = startMin; m < endMin; m += 15) {
      if (locId === 'unset') {
        delete newHours[m];
      } else {
        newHours[m] = locId;
      }
    }
    return newHours;
  }

  // --- Pointer handlers ---
  function onPointerDown(e) {
    if (e.button !== 0) return;
    var bar = barRef.current;
    if (!bar) return;
    bar.setPointerCapture(e.pointerId);

    var hit = hitTest(e.clientX);
    if (!hit) return;

    var startX = e.clientX;
    var startMinute = snapToSlot(e.clientX, bar);

    if (hit.type === 'resize') {
      dragRef.current = {
        mode: 'resize',
        edge: hit.edge,
        segIdx: hit.segIdx,
        origStart: hit.seg.start,
        origEnd: hit.seg.end,
        loc: hit.seg.loc,
        startX: startX,
        currentMinute: hit.edge === 'left' ? hit.seg.start : hit.seg.end
      };
    } else if (hit.type === 'empty') {
      if (!activeLoc) return;
      dragRef.current = {
        mode: 'create',
        startMinute: startMinute,
        currentMinute: startMinute,
        loc: activeLoc,
        startX: startX
      };
      // Show preview
      if (previewRef.current) {
        var tint = LOC_TINT[activeLoc] || '#8B5CF6';
        previewRef.current.style.display = 'block';
        previewRef.current.style.background = tint + '50';
        previewRef.current.style.borderColor = tint;
        previewRef.current.style.left = pctOf(startMinute) + '%';
        previewRef.current.style.width = pctOf(startMinute + 15) - pctOf(startMinute) + '%';
      }
    } else if (hit.type === 'segment') {
      dragRef.current = {
        mode: 'click',
        segIdx: hit.segIdx,
        seg: hit.seg,
        startX: startX,
        minute: hit.minute
      };
    }
  }

  function onPointerMove(e) {
    var drag = dragRef.current;
    var bar = barRef.current;
    if (!drag || !bar) return;

    var currentMinute = snapToSlot(e.clientX, bar);

    if (drag.mode === 'click') {
      // Upgrade to drag if moved enough
      if (Math.abs(e.clientX - drag.startX) > 4) {
        // Cancel click, don't start drag from segment
        dragRef.current = null;
      }
      return;
    }

    if (drag.mode === 'create') {
      drag.currentMinute = currentMinute;
      var minM = Math.min(drag.startMinute, currentMinute);
      var maxM = Math.max(drag.startMinute, currentMinute);
      if (maxM === minM) maxM = minM + 15;
      // Clamp to not overlap existing segments
      for (var i = 0; i < segments.length; i++) {
        var s = segments[i];
        if (s.loc === 'unset') continue;
        if (s.start >= minM && s.start < maxM) { maxM = s.start; }
        if (s.end > minM && s.end <= maxM) { minM = s.end; }
        if (s.start <= minM && s.end >= maxM) { minM = maxM; break; }
      }
      if (previewRef.current) {
        previewRef.current.style.left = pctOf(minM) + '%';
        previewRef.current.style.width = (pctOf(maxM) - pctOf(minM)) + '%';
      }
      return;
    }

    if (drag.mode === 'resize') {
      drag.currentMinute = currentMinute;
      // Find neighbor constraints
      var prevEnd = START_MIN;
      var nextStart = END_MIN;
      for (var j = 0; j < segments.length; j++) {
        var seg = segments[j];
        if (seg.loc === 'unset') continue;
        if (j < drag.segIdx && seg.end > prevEnd) prevEnd = seg.end;
        if (j > drag.segIdx && seg.start < nextStart) nextStart = seg.start;
      }

      if (drag.edge === 'left') {
        var newStart = Math.max(prevEnd, Math.min(currentMinute, drag.origEnd - 15));
        drag.currentMinute = newStart;
      } else {
        var newEnd = Math.min(nextStart, Math.max(currentMinute, drag.origStart + 15));
        drag.currentMinute = newEnd;
      }
      forceRender(function(n) { return n + 1; });
      return;
    }
  }

  function onPointerUp(e) {
    var drag = dragRef.current;
    var bar = barRef.current;
    dragRef.current = null;
    if (previewRef.current) previewRef.current.style.display = 'none';
    if (!drag || !bar) return;

    if (drag.mode === 'click') {
      // Cycle location
      var seg = drag.seg;
      var idx = locIds.indexOf(seg.loc);
      var nextLoc = locIds[(idx + 1) % locIds.length];
      onCommit(writeSlots(seg.start, seg.end, nextLoc));
      return;
    }

    if (drag.mode === 'create') {
      var minM = Math.min(drag.startMinute, drag.currentMinute);
      var maxM = Math.max(drag.startMinute, drag.currentMinute);
      if (maxM === minM) maxM = minM + 15;
      // Re-clamp
      for (var i = 0; i < segments.length; i++) {
        var s = segments[i];
        if (s.loc === 'unset') continue;
        if (s.start >= minM && s.start < maxM) { maxM = s.start; }
        if (s.end > minM && s.end <= maxM) { minM = s.end; }
        if (s.start <= minM && s.end >= maxM) { minM = maxM; break; }
      }
      if (maxM > minM) {
        onCommit(writeSlots(minM, maxM, drag.loc));
      }
      return;
    }

    if (drag.mode === 'resize') {
      var newHours = {};
      Object.keys(hours).forEach(function(k) { newHours[parseInt(k)] = hours[k]; });
      // Clear old range
      for (var m = drag.origStart; m < drag.origEnd; m += 15) {
        delete newHours[m];
      }
      // Write new range
      var nStart = drag.edge === 'left' ? drag.currentMinute : drag.origStart;
      var nEnd = drag.edge === 'right' ? drag.currentMinute : drag.origEnd;
      if (nEnd <= nStart) nEnd = nStart + 15;
      for (var m2 = nStart; m2 < nEnd; m2 += 15) {
        newHours[m2] = drag.loc;
      }
      onCommit(newHours);
      return;
    }
  }

  // --- Compute effective segments for rendering (account for in-progress resize) ---
  var renderSegments = segments;
  var drag = dragRef.current;
  if (drag && drag.mode === 'resize') {
    var tempHours = {};
    Object.keys(hours).forEach(function(k) { tempHours[parseInt(k)] = hours[k]; });
    for (var m = drag.origStart; m < drag.origEnd; m += 15) delete tempHours[m];
    var ns = drag.edge === 'left' ? drag.currentMinute : drag.origStart;
    var ne = drag.edge === 'right' ? drag.currentMinute : drag.origEnd;
    if (ne <= ns) ne = ns + 15;
    for (var m2 = ns; m2 < ne; m2 += 15) tempHours[m2] = drag.loc;
    renderSegments = buildSegments(tempHours);
  }

  // --- Cursor logic ---
  function onBarMouseMove(e) {
    if (dragRef.current) return; // already dragging
    var bar = barRef.current;
    if (!bar) return;
    var hit = hitTest(e.clientX);
    if (hit && hit.type === 'resize') {
      bar.style.cursor = 'col-resize';
    } else if (hit && hit.type === 'empty') {
      bar.style.cursor = activeLoc ? 'crosshair' : 'default';
    } else {
      bar.style.cursor = 'pointer';
    }
  }

  return (
    <div>
      {/* Bar */}
      <div ref={barRef}
        onPointerDown={onPointerDown}
        onPointerMove={function(e) { onPointerMove(e); onBarMouseMove(e); }}
        onPointerUp={onPointerUp}
        style={{
          position: 'relative', height: 48, background: theme.bgTertiary,
          borderRadius: 8, touchAction: 'none', userSelect: 'none',
          overflow: 'hidden'
        }}>
        {/* Rendered segments */}
        {renderSegments.map(function(seg, i) {
          var left = pctOf(seg.start);
          var width = pctOf(seg.end) - pctOf(seg.start);
          var isUnset = seg.loc === 'unset';
          var loc = isUnset ? null : locMap[seg.loc];
          var tint = LOC_TINT[seg.loc] || '#8B5CF6';
          var widthMin = seg.end - seg.start;
          var narrowThreshold = 60; // less than 60min = narrow

          return (
            <div key={i} style={{
              position: 'absolute', top: 2, bottom: 2,
              left: left + '%', width: width + '%',
              background: isUnset ? 'transparent' : tint + '40',
              borderLeft: isUnset ? '1px dashed ' + theme.border : '2px solid ' + tint,
              borderRadius: 3,
              display: 'flex', alignItems: 'center', paddingLeft: 4, gap: 3,
              fontSize: 10, color: isUnset ? theme.textMuted : theme.text,
              overflow: 'hidden', whiteSpace: 'nowrap',
              pointerEvents: 'none'
            }}>
              {isUnset ? (
                widthMin >= 120 ? <span style={{ opacity: 0.5, fontSize: 9 }}>drag to set</span> : null
              ) : (
                <>
                  <span style={{ fontSize: 12 }}>{loc?.icon || ''}</span>
                  {widthMin >= narrowThreshold && <span style={{ fontSize: 10 }}>{loc?.name || seg.loc}</span>}
                </>
              )}
            </div>
          );
        })}

        {/* Resize handles (invisible hit zones) */}
        {renderSegments.map(function(seg, i) {
          if (seg.loc === 'unset') return null;
          return [
            <div key={'lh-' + i} style={{
              position: 'absolute', top: 0, bottom: 0,
              left: 'calc(' + pctOf(seg.start) + '% - 4px)', width: 8,
              cursor: 'col-resize', pointerEvents: 'auto', zIndex: 2
            }} />,
            <div key={'rh-' + i} style={{
              position: 'absolute', top: 0, bottom: 0,
              left: 'calc(' + pctOf(seg.end) + '% - 4px)', width: 8,
              cursor: 'col-resize', pointerEvents: 'auto', zIndex: 2
            }} />
          ];
        })}

        {/* Hour ticks */}
        {[6,8,10,12,14,16,18,20,22].map(function(h) {
          var left = pctOf(h * 60);
          return (
            <div key={h} style={{
              position: 'absolute', top: 0, bottom: 0, left: left + '%',
              borderLeft: '1px solid ' + theme.border, opacity: 0.3,
              pointerEvents: 'none'
            }}>
              <span style={{ fontSize: 8, color: theme.textMuted, position: 'absolute', top: 1, left: 2 }}>
                {minsToShort(h * 60)}
              </span>
            </div>
          );
        })}

        {/* Preview overlay for drag-to-create */}
        <div ref={previewRef} style={{
          display: 'none', position: 'absolute', top: 2, bottom: 2,
          borderRadius: 3, borderLeft: '2px solid transparent',
          pointerEvents: 'none', zIndex: 3
        }} />
      </div>

      {/* Legend row */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: theme.textMuted }}>Brush:</span>
        {locations.map(function(loc) {
          var tint = LOC_TINT[loc.id] || '#8B5CF6';
          var isActive = activeLoc === loc.id;
          return (
            <button key={loc.id} onClick={function() { setActiveLoc(loc.id); }} style={{
              border: isActive ? '2px solid ' + tint : '1px solid ' + theme.border,
              borderRadius: 12, padding: '2px 10px', fontSize: 11,
              background: isActive ? tint + '25' : 'transparent',
              color: isActive ? tint : theme.textSecondary,
              cursor: 'pointer', fontFamily: 'inherit', fontWeight: isActive ? 600 : 400
            }}>
              {loc.icon} {loc.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SchedulesTab({ config, theme }) {
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var scheduleIds = Object.keys(config.locSchedules || {});
  var [selectedTemplate, setSelectedTemplate] = useState(scheduleIds[0] || 'weekday');
  var [newId, setNewId] = useState('');
  var [newName, setNewName] = useState('');

  function setDayDefault(day, templateId) {
    var updated = { ...config.locScheduleDefaults, [day]: templateId };
    config.updateLocScheduleDefaults(updated);
  }

  function addTemplate() {
    if (!newId || !newName) return;
    var updated = { ...config.locSchedules };
    updated[newId] = { name: newName, icon: '\u{1F4C5}', hours: {} };
    config.updateLocSchedules(updated);
    setNewId('');
    setNewName('');
    setSelectedTemplate(newId);
  }

  function removeTemplate(id) {
    if (id === 'weekday' || id === 'weekend') return; // protect system templates
    var updated = { ...config.locSchedules };
    delete updated[id];
    config.updateLocSchedules(updated);
    // Remove any defaults/overrides pointing to this template
    var defs = { ...config.locScheduleDefaults };
    Object.keys(defs).forEach(function(d) { if (defs[d] === id) defs[d] = 'weekday'; });
    config.updateLocScheduleDefaults(defs);
    var ovr = { ...config.locScheduleOverrides };
    Object.keys(ovr).forEach(function(d) { if (ovr[d] === id) delete ovr[d]; });
    config.updateLocScheduleOverrides(ovr);
    if (selectedTemplate === id) setSelectedTemplate(scheduleIds[0] || 'weekday');
  }

  var template = (config.locSchedules || {})[selectedTemplate];
  var hours = template?.hours || {};

  function commitHours(newHours) {
    var updated = { ...config.locSchedules };
    updated[selectedTemplate] = { ...updated[selectedTemplate], hours: newHours };
    config.updateLocSchedules(updated);
  }

  // Date overrides
  var overrideEntries = Object.entries(config.locScheduleOverrides || {});
  var [newOverrideDate, setNewOverrideDate] = useState('');
  var [newOverrideTemplate, setNewOverrideTemplate] = useState(scheduleIds[0] || 'weekday');

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Schedule Templates</div>
      <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 12 }}>Define location schedules and assign them to days</div>

      {/* Day defaults */}
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 6 }}>Day Defaults</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {DAYS.map(function(d) {
          var current = config.locScheduleDefaults[d] || 'weekday';
          var tmpl = (config.locSchedules || {})[current];
          return (
            <div key={d} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: theme.textSecondary }}>{d}</span>
              <select value={current} onChange={function(e) { setDayDefault(d, e.target.value); }}
                style={{ padding: '3px 4px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 11, width: 80 }}>
                {scheduleIds.map(function(id) {
                  var s = (config.locSchedules || {})[id];
                  return <option key={id} value={id}>{s?.icon || ''} {s?.name || id}</option>;
                })}
              </select>
            </div>
          );
        })}
      </div>

      {/* Template selector */}
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 6 }}>Templates</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {scheduleIds.map(function(id) {
          var s = (config.locSchedules || {})[id];
          return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button onClick={function() { setSelectedTemplate(id); }} style={{
                border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                background: selectedTemplate === id ? theme.accent : theme.bgTertiary,
                color: selectedTemplate === id ? '#FFF' : theme.textSecondary,
                fontSize: 12, fontFamily: 'inherit'
              }}>{s?.icon || ''} {s?.name || id}</button>
              {id !== 'weekday' && id !== 'weekend' && (
                <button onClick={function() { removeTemplate(id); }} style={{
                  border: 'none', background: 'transparent', color: '#EF4444', cursor: 'pointer', fontSize: 12
                }}>&times;</button>
              )}
            </div>
          );
        })}
      </div>

      {/* Template detail — interactive bar editor */}
      {template && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 6 }}>
            {template.icon} {template.name} — drag to create, drag edges to resize, click to cycle location
          </div>
          <ScheduleTemplateBar
            hours={hours}
            locations={config.locations}
            theme={theme}
            onCommit={commitHours}
          />
        </div>
      )}

      {/* Add template */}
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 6, marginTop: 16 }}>Add Template</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <input value={newId} onChange={function(e) { setNewId(e.target.value); }} placeholder="ID (e.g. holiday)"
          style={{ width: 100, padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <input value={newName} onChange={function(e) { setNewName(e.target.value); }} placeholder="Name"
          style={{ flex: 1, padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <button onClick={addTemplate} style={{
          border: 'none', borderRadius: 4, padding: '4px 12px', background: theme.accent, color: '#FFF', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit'
        }}>Add</button>
      </div>

      {/* Date overrides */}
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 6 }}>Date Overrides</div>
      <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 8 }}>Override the default template for specific dates</div>
      {overrideEntries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
          {overrideEntries.map(function(entry) {
            var date = entry[0], tmplId = entry[1];
            var tmpl2 = (config.locSchedules || {})[tmplId];
            return (
              <div key={date} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', fontSize: 12, background: theme.bgTertiary, borderRadius: 4 }}>
                <span style={{ color: theme.text, fontWeight: 500 }}>{date}</span>
                <span style={{ color: theme.textMuted }}>{tmpl2?.icon || ''} {tmpl2?.name || tmplId}</span>
                <button onClick={function() {
                  var updated = { ...config.locScheduleOverrides };
                  delete updated[date];
                  config.updateLocScheduleOverrides(updated);
                }} style={{ border: 'none', background: 'transparent', color: '#EF4444', cursor: 'pointer', fontSize: 12, marginLeft: 'auto' }}>&times;</button>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={newOverrideDate} onChange={function(e) { setNewOverrideDate(e.target.value); }} placeholder="M/D (e.g. 3/15)"
          style={{ width: 80, padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <select value={newOverrideTemplate} onChange={function(e) { setNewOverrideTemplate(e.target.value); }}
          style={{ padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }}>
          {scheduleIds.map(function(id) {
            var s = (config.locSchedules || {})[id];
            return <option key={id} value={id}>{s?.icon || ''} {s?.name || id}</option>;
          })}
        </select>
        <button onClick={function() {
          if (!newOverrideDate) return;
          var updated = { ...config.locScheduleOverrides, [newOverrideDate]: newOverrideTemplate };
          config.updateLocScheduleOverrides(updated);
          setNewOverrideDate('');
        }} style={{
          border: 'none', borderRadius: 4, padding: '4px 12px', background: theme.accent, color: '#FFF', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit'
        }}>Add Override</button>
      </div>
    </div>
  );
}

function PlaceholderTab({ label, theme }) {
  return (
    <div style={{ textAlign: 'center', padding: 40, color: theme.textMuted, fontSize: 13 }}>
      {label} editor — coming soon
    </div>
  );
}
