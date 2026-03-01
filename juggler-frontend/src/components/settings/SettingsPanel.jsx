/**
 * SettingsPanel — tabbed container for locations, tools, matrix, time blocks, etc.
 */

import React, { useState } from 'react';
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

export default function SettingsPanel({ onClose, darkMode, config, allProjectNames }) {
  var theme = getTheme(darkMode);
  var [tab, setTab] = useState('locations');

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      <div style={{
        background: theme.bgSecondary, borderRadius: 12, width: 700, maxWidth: '95vw',
        maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: `0 8px 32px ${theme.shadow}`
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

  // Build summary: group consecutive 15-min slots by location
  var segments = [];
  var sortedMins = Object.keys(hours).map(Number).sort(function(a, b) { return a - b; });
  sortedMins.forEach(function(m) {
    var loc = hours[m];
    var last = segments[segments.length - 1];
    if (last && last.loc === loc && last.end === m) {
      last.end = m + 15;
    } else {
      segments.push({ start: m, end: m + 15, loc: loc });
    }
  });

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

      {/* Template detail - location segments */}
      {template && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 6 }}>{template.icon} {template.name} — location by time of day</div>
          {/* Visual bar */}
          <div style={{ position: 'relative', height: 28, background: theme.bgTertiary, borderRadius: 6, marginBottom: 8, overflow: 'hidden' }}>
            {segments.map(function(seg, i) {
              var totalMin = 1080;
              var left = ((seg.start - 360) / totalMin) * 100;
              var width = ((seg.end - seg.start) / totalMin) * 100;
              if (left < 0) { width += left; left = 0; }
              if (left + width > 100) width = 100 - left;
              var loc = config.locations.find(function(l) { return l.id === seg.loc; });
              var tint = { home: '#3B82F6', work: '#F59E0B', transit: '#9CA3AF', downtown: '#10B981', gym: '#EF4444' };
              var color = tint[seg.loc] || '#8B5CF6';
              return (
                <div key={i} title={seg.loc + ' ' + minsToTime(seg.start) + '-' + minsToTime(seg.end)}
                  style={{
                    position: 'absolute', top: 2, bottom: 2, left: left + '%', width: width + '%',
                    background: color + '40', borderLeft: '2px solid ' + color, borderRadius: 3,
                    display: 'flex', alignItems: 'center', paddingLeft: 3, fontSize: 9, color: theme.text, overflow: 'hidden', whiteSpace: 'nowrap'
                  }}>
                  {loc?.icon || ''} {width > 6 ? seg.loc : ''}
                </div>
              );
            })}
            {[6,8,10,12,14,16,18,20,22].map(function(h) {
              var left = ((h * 60 - 360) / 1080) * 100;
              return (
                <div key={h} style={{ position: 'absolute', top: 0, bottom: 0, left: left + '%', borderLeft: '1px solid ' + theme.border, opacity: 0.3 }}>
                  <span style={{ fontSize: 7, color: theme.textMuted, position: 'absolute', top: 0, left: 2 }}>{minsToShort(h * 60)}</span>
                </div>
              );
            })}
          </div>
          {/* Segment list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {segments.map(function(seg, i) {
              var loc = config.locations.find(function(l) { return l.id === seg.loc; });
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', fontSize: 12, background: theme.bgTertiary, borderRadius: 4 }}>
                  <span style={{ fontSize: 11, color: theme.textMuted, width: 120 }}>{minsToTime(seg.start)} — {minsToTime(seg.end)}</span>
                  <span>{loc?.icon || '\u{1F4CD}'} {loc?.name || seg.loc}</span>
                </div>
              );
            })}
          </div>
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
