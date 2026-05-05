/**
 * SettingsPanel — tabbed container for locations, tools, matrix, time blocks, etc.
 */

import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { getTheme } from '../../theme/colors';
import { DEFAULT_WEEKDAY_BLOCKS, DEFAULT_WEEKEND_BLOCKS } from '../../state/constants';
import { TZ_OVERRIDE_KEY } from '../../services/apiClient';

// Deduplicated preset blocks from weekday + weekend defaults
var PRESET_BLOCKS = (function() {
  var all = DEFAULT_WEEKDAY_BLOCKS.concat(DEFAULT_WEEKEND_BLOCKS);
  var seen = {};
  var result = [];
  all.forEach(function(b) {
    var key = b.tag + '_' + b.name;
    if (!seen[key]) {
      seen[key] = true;
      result.push({ tag: b.tag, name: b.name, start: b.start, end: b.end, color: b.color, icon: b.icon, loc: b.loc });
    }
  });
  return result;
})();

var TABS = [
  { id: 'locations', label: 'Locations', tip: 'Locations — define places you work (home, office, gym, etc.)' },
  { id: 'tools', label: 'Tools', tip: 'Tools — define tools you use (laptop, phone, etc.)' },
  { id: 'matrix', label: 'Tool Matrix', tip: 'Tool Matrix — which tools are available at each location' },
  { id: 'templates', label: 'Templates', tip: 'Templates — define daily time blocks, locations, and schedule structure' },
  { id: 'projects', label: 'Projects', tip: 'Projects — manage project names and colors' },
  { id: 'preferences', label: 'Preferences', tip: 'Preferences — font size, grid zoom, task defaults' },
];

export default function SettingsPanel({ onClose, darkMode, config, allProjectNames, allTasks, isMobile, onRenameProject, showToast }) {
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
            <button key={t.id} onClick={() => setTab(t.id)} title={t.tip} style={{
              border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
              background: tab === t.id ? theme.accent : 'transparent',
              color: tab === t.id ? '#FDFAF5' : theme.textSecondary,
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
          {tab === 'projects' && <ProjectsTab config={config} theme={theme} allProjectNames={allProjectNames} allTasks={allTasks || []} onRenameProject={onRenameProject} />}
          {tab === 'preferences' && <PreferencesTab config={config} theme={theme} />}
          {tab === 'templates' && <UnifiedTemplateTab config={config} theme={theme} showToast={showToast} allTasks={allTasks} />}
        </div>
      </div>
    </div>
  );
}

// ─── Auto-ID and Icon Helpers ────────────────────────────────────

function generateId(name, existingIds) {
  var base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!base) base = 'item';
  var id = base;
  var n = 2;
  while (existingIds.indexOf(id) !== -1) { id = base + '_' + n; n++; }
  return id;
}

function pickUniqueIcon(name, iconMap, usedIcons, fallbacks) {
  var n = name.toLowerCase();
  var picked = null;
  for (var i = 0; i < iconMap.length; i++) {
    for (var j = 0; j < iconMap[i][0].length; j++) {
      if (n.includes(iconMap[i][0][j])) { picked = iconMap[i][1]; break; }
    }
    if (picked) break;
  }
  // If picked icon is unique, use it
  if (picked && usedIcons.indexOf(picked) === -1) return picked;
  // Otherwise cycle through fallbacks for a unique one
  var all = (picked ? [picked] : []).concat(fallbacks);
  for (var k = 0; k < all.length; k++) {
    if (usedIcons.indexOf(all[k]) === -1) return all[k];
  }
  // Last resort — return the picked icon even if duplicate (shouldn't happen with enough fallbacks)
  return picked || fallbacks[0];
}

var LOCATION_ICONS = [
  [['home', 'house', 'apt', 'apartment'], '\uD83C\uDFE0'],
  [['work', 'office', 'hq'], '\uD83C\uDFE2'],
  [['gym', 'fitness', 'workout'], '\uD83C\uDFCB\uFE0F'],
  [['school', 'university', 'campus', 'college'], '\uD83C\uDFEB'],
  [['cafe', 'coffee', 'starbucks'], '\u2615'],
  [['library'], '\uD83D\uDCDA'],
  [['park', 'outdoor'], '\uD83C\uDF33'],
  [['store', 'shop', 'mall'], '\uD83D\uDED2'],
  [['hospital', 'clinic', 'doctor'], '\uD83C\uDFE5'],
  [['church', 'temple', 'mosque'], '\u26EA'],
  [['airport', 'terminal'], '\u2708\uFE0F'],
  [['hotel', 'motel'], '\uD83C\uDFE8'],
  [['restaurant', 'dining'], '\uD83C\uDF7D\uFE0F'],
  [['transit', 'commute', 'bus', 'train', 'subway'], '\uD83D\uDE8C'],
  [['car', 'drive', 'parking'], '\uD83D\uDE97'],
  [['beach', 'pool'], '\uD83C\uDFD6\uFE0F'],
  [['downtown', 'city', 'urban'], '\uD83C\uDFD9\uFE0F'],
];
var LOCATION_FALLBACKS = ['\uD83D\uDCCD', '\uD83D\uDCCC', '\uD83C\uDFF7\uFE0F', '\uD83D\uDD16', '\uD83D\uDDFA\uFE0F', '\uD83C\uDFE1', '\u2B50'];

var TOOL_ICONS = [
  [['phone', 'mobile', 'cell', 'iphone', 'android'], '\uD83D\uDCF1'],
  [['laptop', 'macbook', 'notebook', 'personal pc', 'personal computer'], '\uD83D\uDCBB'],
  [['desktop', 'imac', 'work pc', 'workstation', 'monitor'], '\uD83D\uDDA5\uFE0F'],
  [['tablet', 'ipad'], '\uD83D\uDCF2'],
  [['printer', 'print'], '\uD83D\uDDA8\uFE0F'],
  [['car', 'vehicle'], '\uD83D\uDE97'],
  [['camera'], '\uD83D\uDCF7'],
  [['headphone', 'headset', 'earbuds'], '\uD83C\uDFA7'],
  [['keyboard'], '\u2328\uFE0F'],
  [['pen', 'pencil', 'stylus'], '\u270F\uFE0F'],
  [['book', 'notebook', 'journal'], '\uD83D\uDCD3'],
  [['key', 'badge', 'card'], '\uD83D\uDD11'],
  [['wifi', 'internet', 'hotspot'], '\uD83D\uDCF6'],
  [['charger', 'cable', 'adapter'], '\uD83D\uDD0C'],
];
var TOOL_FALLBACKS = ['\uD83D\uDD27', '\u2699\uFE0F', '\uD83D\uDEE0\uFE0F', '\uD83D\uDD29', '\uD83D\uDCE6', '\uD83D\uDCC0', '\uD83D\uDCBF'];

// ─── Locations Tab ───────────────────────────────────────────────

var hasGeolocation = typeof navigator !== 'undefined' && !!navigator.geolocation;

function LocationRow({ loc, config, theme }) {
  var [geocodeInput, setGeocodeInput] = useState(loc.displayName || '');
  var [displayName, setDisplayName] = useState(loc.displayName || '');
  var [loading, setLoading] = useState(false);
  var [geoError, setGeoError] = useState('');

  var hasCoords = loc.lat != null && loc.lon != null;

  function updateLocationCoords(lat, lon, dn) {
    var updated = config.locations.map(function(l) {
      return l.id === loc.id ? Object.assign({}, l, { lat: lat, lon: lon, displayName: dn }) : l;
    });
    config.updateLocations(updated);
    setDisplayName(dn);
    setGeoError('');
  }

  function clearCoords() {
    var updated = config.locations.map(function(l) {
      if (l.id !== loc.id) return l;
      var c = Object.assign({}, l);
      delete c.lat; delete c.lon; delete c.displayName;
      return c;
    });
    config.updateLocations(updated);
    setGeocodeInput('');
    setDisplayName('');
    setGeoError('');
  }

  async function handleGeocode() {
    var input = geocodeInput.trim();
    if (!input || loading) return;
    setLoading(true);
    setGeoError('');
    try {
      var { default: apiClient } = await import('../../services/apiClient');
      var resp = await apiClient.get('/weather/geocode', { params: { q: input } });
      var { lat, lon, displayName: dn } = resp.data;
      updateLocationCoords(lat, lon, dn || input);
      setGeocodeInput(dn || input);
    } catch (e) {
      setGeoError("Couldn't find that location");
    } finally {
      setLoading(false);
    }
  }

  function handleLocateMe() {
    if (!hasGeolocation) return;
    setLoading(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      function(pos) {
        setLoading(false);
        var lat = pos.coords.latitude;
        var lon = pos.coords.longitude;
        updateLocationCoords(lat, lon, '');
        setGeocodeInput('');
      },
      function() {
        setLoading(false);
        setGeoError("Location access denied");
      },
      { timeout: 10000 }
    );
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); handleGeocode(); }
  }

  return (
    <div style={{ background: theme.bgTertiary, borderRadius: 6, padding: '6px 8px', fontSize: 13 }}>
      {/* Top row: icon + name + delete */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{loc.icon}</span>
        <span style={{ color: theme.text, flex: 1 }}>{loc.name}</span>
        <button onClick={function() {
          config.updateLocations(config.locations.filter(function(l) { return l.id !== loc.id; }));
        }} title={'Delete location ' + loc.name} style={{ border: 'none', background: 'transparent', color: theme.redText, cursor: 'pointer', fontSize: 14 }}>&times;</button>
      </div>
      {/* Geocode row */}
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {hasCoords ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: theme.textMuted }}>
              {'📍 '}
              <span style={{ color: theme.text, fontWeight: 600 }}>{displayName || 'Current location'}</span>
              {' (' + loc.lat.toFixed(4) + ', ' + loc.lon.toFixed(4) + ')'}
            </span>
            <button onClick={clearCoords} title="Clear coordinates" style={{
              border: 'none', background: 'transparent', color: theme.textMuted,
              cursor: 'pointer', fontSize: 11, textDecoration: 'underline', fontFamily: 'inherit', padding: 0
            }}>Clear</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              value={geocodeInput}
              onChange={function(e) { setGeocodeInput(e.target.value); setGeoError(''); }}
              onBlur={handleGeocode}
              onKeyDown={handleKeyDown}
              placeholder="City, state — or ZIP code"
              disabled={loading}
              style={{
                flex: 1, padding: '3px 6px', fontSize: 11,
                border: '1px solid ' + (geoError ? theme.redText : theme.inputBorder),
                borderRadius: 4, background: theme.input, color: theme.text,
                opacity: loading ? 0.7 : 1
              }}
            />
            {hasGeolocation && (
              <button
                onClick={handleLocateMe}
                disabled={loading}
                title="Use your current device location"
                style={{
                  border: 'none', borderRadius: 4, padding: '3px 8px',
                  background: theme.accent, color: '#FDFAF5',
                  fontSize: 11, cursor: loading ? 'default' : 'pointer',
                  opacity: loading ? 0.7 : 1, whiteSpace: 'nowrap', fontFamily: 'inherit'
                }}
              >
                {loading ? 'Locating…' : '📍 Locate me'}
              </button>
            )}
          </div>
        )}
        {geoError && <div style={{ fontSize: 11, color: theme.redText }}>{geoError}</div>}
      </div>
    </div>
  );
}

function LocationsTab({ config, theme }) {
  var [newName, setNewName] = useState('');
  var [error, setError] = useState('');

  function handleAdd() {
    var name = newName.trim();
    if (!name) return;
    // Check name uniqueness (case-insensitive)
    if (config.locations.some(function(l) { return l.name.toLowerCase() === name.toLowerCase(); })) {
      setError('A location named "' + name + '" already exists');
      return;
    }
    var existingIds = config.locations.map(function(l) { return l.id; });
    var usedIcons = config.locations.map(function(l) { return l.icon; });
    var id = generateId(name, existingIds);
    var icon = pickUniqueIcon(name, LOCATION_ICONS, usedIcons, LOCATION_FALLBACKS);
    config.updateLocations([...config.locations, { id: id, name: name, icon: icon }]);
    setNewName('');
    setError('');
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Locations</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {config.locations.map(function(loc, i) {
          return <LocationRow key={loc.id} loc={loc} config={config} theme={theme} />;
        })}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={newName} onChange={e => { setNewName(e.target.value); setError(''); }} placeholder="Location name" onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          style={{ flex: 1, padding: '4px 6px', border: `1px solid ${error ? theme.redText : theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <button onClick={handleAdd} title="Add a new location" style={{ border: 'none', borderRadius: 4, padding: '4px 12px', background: theme.accent, color: '#FDFAF5', fontSize: 12, cursor: 'pointer' }}>Add</button>
      </div>
      {error && <div style={{ fontSize: 11, color: theme.redText, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

// ─── Tools Tab ───────────────────────────────────────────────────

function ToolsTab({ config, theme }) {
  var [newName, setNewName] = useState('');
  var [error, setError] = useState('');

  function handleAdd() {
    var name = newName.trim();
    if (!name) return;
    if (config.tools.some(function(t) { return t.name.toLowerCase() === name.toLowerCase(); })) {
      setError('A tool named "' + name + '" already exists');
      return;
    }
    var existingIds = config.tools.map(function(t) { return t.id; });
    var usedIcons = config.tools.map(function(t) { return t.icon; });
    var id = generateId(name, existingIds);
    var icon = pickUniqueIcon(name, TOOL_ICONS, usedIcons, TOOL_FALLBACKS);
    config.updateTools([...config.tools, { id: id, name: name, icon: icon }]);
    setNewName('');
    setError('');
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Tools</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {config.tools.map((tool, i) => (
          <div key={tool.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6, fontSize: 13 }}>
            <span>{tool.icon}</span>
            <span style={{ color: theme.text, flex: 1 }}>{tool.name}</span>
            <button onClick={() => {
              config.updateTools(config.tools.filter((_, idx) => idx !== i));
            }} title={'Delete tool ' + tool.name} style={{ border: 'none', background: 'transparent', color: theme.redText, cursor: 'pointer', fontSize: 14 }}>&times;</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={newName} onChange={e => { setNewName(e.target.value); setError(''); }} placeholder="Tool name" onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          style={{ flex: 1, padding: '4px 6px', border: `1px solid ${error ? theme.redText : theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <button onClick={handleAdd} title="Add a new tool" style={{ border: 'none', borderRadius: 4, padding: '4px 12px', background: theme.accent, color: '#FDFAF5', fontSize: 12, cursor: 'pointer' }}>Add</button>
      </div>
      {error && <div style={{ fontSize: 11, color: theme.redText, marginTop: 4 }}>{error}</div>}
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
                }} title={(available ? 'Remove' : 'Add') + ' ' + tool.name + ' from ' + loc.name} style={{
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

function ProjectRow({ p, config, theme, onRename, taskCount, canReorder, isFirst, isLast, onMoveUp, onMoveDown }) {
  var [editing, setEditing] = useState(false);
  var [editName, setEditName] = useState(p.name);
  var [editColor, setEditColor] = useState(p.color || '#2E4A7A');

  async function handleSave() {
    if (!editName || editName === p.name && editColor === p.color) { setEditing(false); return; }
    try {
      var { default: apiClient } = await import('../../services/apiClient');
      var oldName = p.name;
      await apiClient.put('/projects/' + p.id, { name: editName, color: editColor, icon: p.icon, oldName: oldName });
      config.setProjects(config.projects.map(function(x) {
        return x.id === p.id ? { ...x, name: editName, color: editColor } : x;
      }));
      if (editName !== oldName && onRename) onRename(oldName, editName);
      setEditing(false);
    } catch (e) { console.error(e); }
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6, fontSize: 13 }}>
        <input type="color" value={editColor} onChange={function(e) { setEditColor(e.target.value); }}
          style={{ width: 24, height: 24, border: 'none', cursor: 'pointer', padding: 0 }} />
        <input value={editName} onChange={function(e) { setEditName(e.target.value); }}
          onKeyDown={function(e) { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus
          style={{ flex: 1, padding: '2px 4px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <button onClick={handleSave} style={{ border: 'none', borderRadius: 4, padding: '2px 8px', background: '#2D6A4F', color: '#FDFAF5', fontSize: 11, cursor: 'pointer' }}>Save</button>
        <button onClick={function() { setEditing(false); setEditName(p.name); setEditColor(p.color || '#2E4A7A'); }}
          style={{ border: 'none', background: 'transparent', color: theme.textMuted, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
      </div>
    );
  }

  var arrowBtn = {
    border: 'none', background: 'transparent', cursor: 'pointer',
    fontSize: 11, lineHeight: 1, padding: '2px 4px',
    color: theme.textMuted
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6, fontSize: 13 }}>
      {canReorder && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginRight: -4 }}>
          <button onClick={onMoveUp} disabled={isFirst} title="Move up"
            style={Object.assign({}, arrowBtn, { opacity: isFirst ? 0.25 : 1, cursor: isFirst ? 'default' : 'pointer' })}>{'▲'}</button>
          <button onClick={onMoveDown} disabled={isLast} title="Move down"
            style={Object.assign({}, arrowBtn, { opacity: isLast ? 0.25 : 1, cursor: isLast ? 'default' : 'pointer' })}>{'▼'}</button>
        </div>
      )}
      {p.color && <div style={{ width: 12, height: 12, borderRadius: 3, background: p.color }} />}
      <span style={{ color: theme.text, flex: 1 }}>{p.name}</span>
      <span style={{ fontSize: 11, color: theme.textMuted, minWidth: 28, textAlign: 'right' }}>{taskCount}</span>
      <button onClick={function() { setEditing(true); }} title="Edit project"
        style={{ border: 'none', background: 'transparent', color: theme.textMuted, cursor: 'pointer', fontSize: 12 }}>&#x270E;</button>
      <button onClick={async function() {
        if (!p.id) return;
        try {
          var { default: apiClient } = await import('../../services/apiClient');
          await apiClient.delete('/projects/' + p.id);
          config.setProjects(config.projects.filter(function(x) { return x.id !== p.id; }));
        } catch (e) { console.error(e); }
      }} style={{ border: 'none', background: 'transparent', color: theme.redText, cursor: 'pointer', fontSize: 14 }}>&times;</button>
    </div>
  );
}

function ProjectsTab({ config, theme, allProjectNames, allTasks, onRenameProject }) {
  var [newName, setNewName] = useState('');
  var [newColor, setNewColor] = useState('#2E4A7A');
  // 'custom' respects the user-chosen sort_order persisted on the server and
  // is the default — matches #6's "implement sort order for projects" ask.
  // Switching to name/tasks/color is still handy for browsing large lists.
  var [sortBy, setSortBy] = useState('custom');
  var [sortDir, setSortDir] = useState('asc');
  var [filter, setFilter] = useState('');

  // Build task counts per project
  var taskCounts = useMemo(function() {
    var counts = {};
    (allTasks || []).forEach(function(t) {
      if (t.project) counts[t.project] = (counts[t.project] || 0) + 1;
    });
    return counts;
  }, [allTasks]);

  // Merge DB projects with task-derived project names
  var dbProjectNames = new Set(config.projects.map(function(p) { return p.name; }));
  var taskOnlyNames = (allProjectNames || []).filter(function(n) { return !dbProjectNames.has(n); });

  // Filter projects
  var filterLower = filter.toLowerCase();
  var filteredProjects = config.projects.filter(function(p) {
    return !filter || p.name.toLowerCase().includes(filterLower);
  });
  var filteredTaskOnly = taskOnlyNames.filter(function(n) {
    return !filter || n.toLowerCase().includes(filterLower);
  });

  // Sort managed projects. 'custom' preserves the server's sort_order
  // (DB already returned projects in sort_order) and ignores sortDir.
  var sortedProjects = filteredProjects.slice().sort(function(a, b) {
    if (sortBy === 'custom') {
      var sa = a.sortOrder != null ? a.sortOrder : 0;
      var sb = b.sortOrder != null ? b.sortOrder : 0;
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name); // stable tie-break
    }
    var dir = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'tasks') {
      return ((taskCounts[a.name] || 0) - (taskCounts[b.name] || 0)) * dir;
    }
    if (sortBy === 'color') {
      return (a.color || '').localeCompare(b.color || '') * dir;
    }
    return a.name.localeCompare(b.name) * dir;
  });

  // Move a project up or down in custom-sort mode. Persists to the server
  // via a single reorder call and optimistically updates local state.
  async function moveProject(projectId, delta) {
    if (!filter && sortBy === 'custom') {
      var full = config.projects.slice().sort(function(a, b) {
        var sa = a.sortOrder != null ? a.sortOrder : 0;
        var sb = b.sortOrder != null ? b.sortOrder : 0;
        if (sa !== sb) return sa - sb;
        return a.name.localeCompare(b.name);
      });
      var idx = full.findIndex(function(p) { return p.id === projectId; });
      if (idx < 0) return;
      var newIdx = idx + delta;
      if (newIdx < 0 || newIdx >= full.length) return;
      var reordered = full.slice();
      var moved = reordered.splice(idx, 1)[0];
      reordered.splice(newIdx, 0, moved);
      // Re-index sort_order locally so the list redraws immediately.
      var withOrder = reordered.map(function(p, i) { return Object.assign({}, p, { sortOrder: i }); });
      config.setProjects(withOrder);
      try {
        var { default: apiClient } = await import('../../services/apiClient');
        await apiClient.put('/projects/reorder', { ids: withOrder.map(function(p) { return p.id; }) });
      } catch (e) {
        console.error('reorder failed:', e);
        // Revert on failure by re-sorting to the server's view (which we just
        // invalidated locally, so the next config refresh will correct this).
      }
    }
  }

  // Sort task-only names
  var sortedTaskOnly = filteredTaskOnly.slice().sort(function(a, b) {
    var dir = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'tasks') {
      return ((taskCounts[a] || 0) - (taskCounts[b] || 0)) * dir;
    }
    return a.localeCompare(b) * dir;
  });

  function toggleSort(field) {
    if (sortBy === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir('asc'); }
  }

  async function promoteTaskProject(name) {
    try {
      var { default: apiClient } = await import('../../services/apiClient');
      var res = await apiClient.post('/projects', { name: name, color: '#2E4A7A' });
      config.setProjects([...config.projects, res.data.project]);
    } catch (e) { console.error(e); }
  }

  var sortArrow = sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  var btnStyle = function(active) {
    return {
      border: 'none', background: active ? theme.accent + '22' : 'transparent',
      color: active ? theme.accent : theme.textMuted, cursor: 'pointer',
      fontSize: 11, fontWeight: active ? 600 : 400, borderRadius: 4, padding: '2px 6px'
    };
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>Projects</div>
        <span style={{ fontSize: 11, color: theme.textMuted }}>({config.projects.length + taskOnlyNames.length})</span>
      </div>

      {/* Filter + Sort controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <input value={filter} onChange={function(e) { setFilter(e.target.value); }} placeholder="Filter projects\u2026"
          style={{ flex: 1, padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        {filter && <button onClick={function() { setFilter(''); }} style={{ border: 'none', background: 'transparent', color: theme.textMuted, cursor: 'pointer', fontSize: 14 }}>&times;</button>}
        <span style={{ fontSize: 11, color: theme.textMuted }}>Sort:</span>
        <button onClick={function() { setSortBy('custom'); }} style={btnStyle(sortBy === 'custom')} title="Use the order you've arranged with the up/down arrows">Custom</button>
        <button onClick={function() { toggleSort('name'); }} style={btnStyle(sortBy === 'name')}>Name{sortBy === 'name' ? sortArrow : ''}</button>
        <button onClick={function() { toggleSort('tasks'); }} style={btnStyle(sortBy === 'tasks')}>Tasks{sortBy === 'tasks' ? sortArrow : ''}</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {sortedProjects.map(function(p, i) {
          // Show reorder arrows only when the user is viewing the custom order
          // (otherwise moving by arrows wouldn't visibly track) and not
          // filtering (a filtered view hides some rows — moving within it
          // would be confusing).
          var canReorder = sortBy === 'custom' && !filter;
          return <ProjectRow key={p.id || p.name} p={p} config={config} theme={theme} onRename={onRenameProject} taskCount={taskCounts[p.name] || 0}
            canReorder={canReorder}
            isFirst={i === 0}
            isLast={i === sortedProjects.length - 1}
            onMoveUp={function() { moveProject(p.id, -1); }}
            onMoveDown={function() { moveProject(p.id, 1); }} />;
        })}
        {sortedTaskOnly.map(function(name) {
          return (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6, fontSize: 13, opacity: 0.7 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: theme.textMuted, opacity: 0.3 }} />
              <span style={{ color: theme.text, flex: 1 }}>{name}</span>
              <span style={{ fontSize: 11, color: theme.textMuted, minWidth: 28, textAlign: 'right' }}>{taskCounts[name] || 0}</span>
              <button onClick={function() { promoteTaskProject(name); }} title="Add as managed project"
                style={{ border: 'none', background: 'transparent', color: theme.accent, cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>+ Add</button>
              <span style={{ fontSize: 10, color: theme.textMuted }}>from tasks</span>
            </div>
          );
        })}
      </div>
      {config.projects.length === 0 && taskOnlyNames.length === 0 && (
        <div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 12 }}>No projects yet. Add one below or assign a project to a task.</div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} style={{ width: 32, height: 28, border: 'none', cursor: 'pointer' }} />
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Project name"
          onKeyDown={function(e) { if (e.key === 'Enter') document.getElementById('add-project-btn').click(); }}
          style={{ flex: 1, padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <button id="add-project-btn" onClick={async () => {
          if (!newName) return;
          try {
            var { default: apiClient } = await import('../../services/apiClient');
            var res = await apiClient.post('/projects', { name: newName, color: newColor });
            config.setProjects([...config.projects, res.data.project]);
            setNewName('');
          } catch (e) { console.error(e); }
        }} style={{ border: 'none', borderRadius: 4, padding: '4px 12px', background: theme.accent, color: '#FDFAF5', fontSize: 12, cursor: 'pointer' }}>Add</button>
      </div>
    </div>
  );
}

function TimezoneCombobox({ value, browserTz, allTimezones, theme, onChange }) {
  var [text, setText] = useState(value ? value.replace(/_/g, ' ') : '');
  var [open, setOpen] = useState(false);
  var ref = useRef(null);

  useEffect(function() { setText(value ? value.replace(/_/g, ' ') : ''); }, [value]);

  useEffect(function() {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return function() { document.removeEventListener('mousedown', handleClick); };
  }, [open]);

  var filtered = allTimezones.filter(function(tz) {
    if (!text) return true;
    return tz.toLowerCase().indexOf(text.toLowerCase().replace(/ /g, '_')) !== -1
      || tz.replace(/_/g, ' ').toLowerCase().indexOf(text.toLowerCase()) !== -1;
  });
  if (filtered.length > 50) filtered = filtered.slice(0, 50);

  function select(tz) {
    setText(tz ? tz.replace(/_/g, ' ') : '');
    onChange(tz);
    setOpen(false);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <span style={{ fontWeight: 500 }}>Timezone:</span>
      <div ref={ref} style={{ position: 'relative', flex: 1 }}>
        <input
          type="text" value={text}
          onChange={function(e) { setText(e.target.value); setOpen(true); }}
          onFocus={function() { setOpen(true); }}
          onKeyDown={function(e) {
            if (e.key === 'Enter' && filtered.length === 1) { select(filtered[0]); }
            else if (e.key === 'Escape') { setOpen(false); }
          }}
          placeholder={'Browser' + (browserTz ? ' (' + browserTz + ')' : '')}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '4px 24px 4px 6px', border: '1px solid ' + theme.inputBorder,
            borderRadius: 4, background: theme.input, color: theme.text,
            fontSize: 12, fontFamily: 'inherit', outline: 'none'
          }}
        />
        {value && (
          <button onClick={function() { select(''); }} style={{
            position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: theme.textMuted, fontSize: 14, padding: 0, lineHeight: 1, fontFamily: 'inherit'
          }} title="Clear override">&times;</button>
        )}
        {open && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
            background: theme.bgSecondary, border: '1px solid ' + theme.border,
            borderRadius: 4, boxShadow: '0 2px 8px ' + theme.shadow,
            zIndex: 300, maxHeight: 200, overflowY: 'auto'
          }}>
            <button onClick={function() { select(''); }} style={{
              display: 'block', width: '100%', border: 'none', cursor: 'pointer',
              padding: '5px 8px', fontSize: 11, fontFamily: 'inherit', textAlign: 'left',
              background: !value ? theme.accent + '15' : 'transparent',
              color: !value ? theme.accent : theme.textMuted
            }}>Browser default{browserTz ? ' (' + browserTz + ')' : ''}</button>
            {filtered.map(function(tz) {
              return (
                <button key={tz} onClick={function() { select(tz); }} style={{
                  display: 'block', width: '100%', border: 'none', cursor: 'pointer',
                  padding: '5px 8px', fontSize: 11, fontFamily: 'inherit', textAlign: 'left',
                  background: value === tz ? theme.accent + '15' : 'transparent',
                  color: value === tz ? theme.accent : theme.text
                }}>{tz.replace(/_/g, ' ')}</button>
              );
            })}
            {filtered.length === 0 && (
              <div style={{ padding: '5px 8px', fontSize: 11, color: theme.textMuted }}>No matches</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PreferencesTab({ config, theme }) {
  function savePrefs(patch) {
    config.updatePreferences({
      gridZoom: config.gridZoom, splitDefault: config.splitDefault,
      splitMinDefault: config.splitMinDefault, schedFloor: config.schedFloor, schedCeiling: config.schedCeiling,
      fontSize: config.fontSize, pullForwardDampening: config.pullForwardDampening,
      timezoneOverride: config.timezoneOverride, calCompletedBehavior: config.calCompletedBehavior,
      ...patch
    });
  }

  // Common timezones for the dropdown
  var commonTimezones = [
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'America/Anchorage', 'Pacific/Honolulu', 'America/Phoenix',
    'America/Toronto', 'America/Vancouver', 'America/Edmonton',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Asia/Dubai',
    'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland',
    'America/Sao_Paulo', 'America/Mexico_City', 'America/Bogota'
  ];
  // Try to get full list from browser, fall back to common list
  var allTimezones = commonTimezones;
  try {
    if (typeof Intl !== 'undefined' && Intl.supportedValuesOf) {
      allTimezones = Intl.supportedValuesOf('timeZone');
    }
  } catch (e) { /* ignore */ }

  var browserTz = null;
  try { browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 12 }}>Preferences</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

        <div style={{ fontSize: 12, color: theme.text }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 500 }}>Timezone:</span>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                list="tz-list"
                value={config.timezoneOverride ? config.timezoneOverride.replace(/_/g, ' ') : ''}
                onChange={function(e) {
                  var raw = e.target.value.replace(/ /g, '_');
                  // Check if it's a valid timezone
                  var match = allTimezones.find(function(tz) { return tz === raw; });
                  if (match) {
                    config.setTimezoneOverride(match);
                    savePrefs({ timezoneOverride: match });
                    try { localStorage.setItem(TZ_OVERRIDE_KEY, match); } catch (err) { /* ignore */ }
                  } else if (!e.target.value) {
                    config.setTimezoneOverride(null);
                    savePrefs({ timezoneOverride: null });
                    try { localStorage.removeItem(TZ_OVERRIDE_KEY); } catch (err) { /* ignore */ }
                  }
                }}
                placeholder={'Browser' + (browserTz ? ' (' + browserTz + ')' : '')}
                style={{ width: '100%', boxSizing: 'border-box', padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12, fontFamily: 'inherit' }}
              />
              <datalist id="tz-list">
                {allTimezones.map(function(tz) {
                  return <option key={tz} value={tz.replace(/_/g, ' ')} />;
                })}
              </datalist>
            </div>
          </div>
          <div style={{ fontSize: 10, color: theme.textMuted }}>
            {config.timezoneOverride
              ? 'Manual override active. All times displayed as ' + config.timezoneOverride + '.'
              : browserTz
                ? 'Auto-detected: ' + browserTz + '. All times displayed in local timezone.'
                : 'No timezone detected. Defaulting to America/New_York.'}
          </div>
        </div>

        <label title="Scale the entire UI font size" style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          Font size:
          <input type="range" min={80} max={140} value={config.fontSize} onChange={e => { var v = parseInt(e.target.value); config.setFontSize(v); savePrefs({ fontSize: v }); }} />
          <span style={{ fontSize: 11, color: theme.textMuted }}>{config.fontSize}%</span>
        </label>
        <label title="Height in pixels per hour on the timeline grid" style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          Grid zoom (px/hour):
          <input type="range" min={30} max={120} value={config.gridZoom} onChange={e => { var v = parseInt(e.target.value); config.setGridZoom(v); savePrefs({ gridZoom: v }); }} />
          <span style={{ fontSize: 11, color: theme.textMuted }}>{config.gridZoom}px</span>
        </label>
        <label title="When enabled, new tasks default to splittable (can be broken into chunks)" style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={config.splitDefault} onChange={e => { var v = e.target.checked; config.setSplitDefault(v); savePrefs({ splitDefault: v }); }} />
          Split tasks by default
        </label>
        <label title="Smallest chunk size when splitting tasks" style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          Min chunk (min):
          <input type="number" value={config.splitMinDefault} onChange={e => { var v = parseInt(e.target.value) || 15; config.setSplitMinDefault(v); savePrefs({ splitMinDefault: v }); }} style={{ width: 60, padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        </label>
        <label title="The scheduler won't place tasks earlier than this time" style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          Earliest scheduling time:
          <select value={config.schedFloor} onChange={e => { var v = parseInt(e.target.value); config.setSchedFloor(v); savePrefs({ schedFloor: v }); }}
            style={{ padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }}>
            {[360,420,480,540,600,660,720].map(m => (
              <option key={m} value={m}>{Math.floor(m/60) % 12 || 12}:{(m%60) < 10 ? '0' : ''}{m%60} {m < 720 ? 'AM' : 'PM'}</option>
            ))}
          </select>
        </label>
        <label title="The scheduler won't place tasks later than this time" style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          Latest scheduling time:
          <select value={config.schedCeiling} onChange={e => { var v = parseInt(e.target.value); config.setSchedCeiling(v); savePrefs({ schedCeiling: v }); }}
            style={{ padding: '4px 6px', border: `1px solid ${theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }}>
            {[1080,1140,1200,1260,1320,1380,1440].map(m => (
              <option key={m} value={m}>{m === 1440 ? '12:00 AM' : (Math.floor(m/60) % 12 || 12) + ':' + ((m%60) < 10 ? '0' : '') + (m%60) + (m < 720 ? ' AM' : ' PM')}</option>
            ))}
          </select>
        </label>
        <label title="When enabled, tasks pull forward less aggressively when the calendar has plenty of free time"
          style={{ fontSize: 12, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox"
            checked={config.pullForwardDampening || false}
            onChange={e => { var v = e.target.checked; config.setPullForwardDampening(v); savePrefs({ pullForwardDampening: v }); }} />
          Dampen pull-forward (less aggressive when calendar is open)
        </label>

        <div style={{ fontSize: 12, color: theme.text }}>
          <span style={{ fontWeight: 500 }}>Done tasks on calendar:</span>
          <select
            value={config.calCompletedBehavior || 'update'}
            onChange={function(e) { var v = e.target.value; config.setCalCompletedBehavior(v); savePrefs({ calCompletedBehavior: v }); }}
            style={{ marginLeft: 8, padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12, fontFamily: 'inherit' }}>
            <option value="update">Mark as done</option>
            <option value="delete">Remove from calendar</option>
            <option value="keep">Keep as-is</option>
          </select>
        </div>
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

/** Convert minutes-since-midnight to HH:MM for <input type="time"> */
function minsToTimeInput(m) {
  var h = Math.floor(m / 60);
  var mm = m % 60;
  return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
}

/** Convert HH:MM from <input type="time"> to minutes-since-midnight */
function timeInputToMins(val) {
  if (!val) return 0;
  var parts = val.split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

var LOC_TINT = { home: '#2E4A7A', work: '#C8942A', transit: '#5C5A55', downtown: '#2D6A4F', gym: '#8B2635', errand: '#EC4899' };

// Default fallbacks if no blocks configured
var DEFAULT_START = 360;  // 6 AM
var DEFAULT_END = 1380;   // 11 PM

/** Compute timeline range from blocks — pad 1 hour before/after, snap to even hours */
function getTimeRange(blocks) {
  if (!blocks || blocks.length === 0) return { startMin: DEFAULT_START, endMin: DEFAULT_END };
  var earliest = DEFAULT_END;
  var latest = DEFAULT_START;
  blocks.forEach(function(b) {
    if (b.start < earliest) earliest = b.start;
    if (b.end > latest) latest = b.end;
  });
  // Pad 1 hour and snap to even hours
  var startMin = Math.max(0, Math.floor((earliest - 60) / 60) * 60);
  var endMin = Math.min(1440, Math.ceil((latest + 60) / 60) * 60);
  return { startMin: startMin, endMin: endMin };
}

function pctOf(mins, startMin, totalMin) {
  return ((mins - startMin) / totalMin) * 100;
}

function snapToSlot(clientX, barEl, startMin, endMin, totalMin) {
  var rect = barEl.getBoundingClientRect();
  var ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  var raw = ratio * totalMin + startMin;
  var snapped = Math.round(raw / 15) * 15;
  return Math.max(startMin, Math.min(endMin, snapped));
}

/** Build effective hours map from blocks + locOverrides */
function buildEffectiveHours(blocks, locOverrides) {
  var hours = {};
  (blocks || []).forEach(function(b) {
    for (var m = b.start; m < b.end; m += 15) {
      hours[m] = b.loc || 'home';
    }
  });
  if (locOverrides) {
    Object.keys(locOverrides).forEach(function(k) {
      hours[parseInt(k)] = locOverrides[k];
    });
  }
  return hours;
}

/** Build location segments from hours map */
function buildSegments(hours, startMin, endMin) {
  var segs = [];
  for (var m = startMin; m < endMin; m += 15) {
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

/** ScheduleTemplateBar — paint locations onto a timeline with a brush.
 *  Click or drag to paint 15-min slots with the active location.
 *  Block overlay at top is draggable to adjust block start/end times.
 */
function ScheduleTemplateBar({ hours, locations, theme, onCommit, blocks, onBlocksChange }) {
  var [activeLoc, setActiveLoc] = useState(locations[0]?.id || null);
  var barRef = useRef(null);
  var dragRef = useRef(null);
  var hoursRef = useRef(hours);
  var onCommitRef = useRef(onCommit);
  hoursRef.current = hours;
  onCommitRef.current = onCommit;

  // Dynamic time range based on configured blocks
  var range = useMemo(function() { return getTimeRange(blocks); }, [blocks]);
  var startMin = range.startMin;
  var endMin = range.endMin;
  var totalMin = endMin - startMin;
  var rangeRef = useRef({ startMin: startMin, endMin: endMin, totalMin: totalMin });
  rangeRef.current = { startMin: startMin, endMin: endMin, totalMin: totalMin };

  // Helper to compute pct with current range
  function pct(mins) { return pctOf(mins, startMin, totalMin); }

  // Generate hour tick values for the current range
  var hourTicks = useMemo(function() {
    var ticks = [];
    // Start at next even hour at or after startMin
    var first = Math.ceil(startMin / 120) * 120;
    for (var h = first; h <= endMin; h += 120) {
      ticks.push(h);
    }
    return ticks;
  }, [startMin, endMin]);

  var segments = useMemo(function() { return buildSegments(hours, startMin, endMin); }, [hours, startMin, endMin]);

  var locMap = useMemo(function() {
    var m = {};
    locations.forEach(function(l) { m[l.id] = l; });
    return m;
  }, [locations]);

  useEffect(function() {
    if (activeLoc && !locMap[activeLoc] && locations.length > 0) {
      setActiveLoc(locations[0].id);
    }
  }, [locations, activeLoc, locMap]);

  /** Get the 15-min slot minute at a given clientX */
  function slotAt(clientX) {
    var bar = barRef.current;
    var r = rangeRef.current;
    if (!bar) return r.startMin;
    return snapToSlot(clientX, bar, r.startMin, r.endMin, r.totalMin);
  }

  /** Paint a range of 15-min slots with a location and commit */
  function commitPaint(fromMin, toMin, locId) {
    var h = hoursRef.current;
    var lo = Math.min(fromMin, toMin);
    var hi = Math.max(fromMin, toMin) + 15; // inclusive of the slot at toMin
    var newHours = {};
    Object.keys(h).forEach(function(k) { newHours[parseInt(k)] = h[k]; });
    for (var m = lo; m < hi; m += 15) {
      newHours[m] = locId;
    }
    onCommitRef.current(newHours);
  }

  function onMouseDown(e) {
    if (e.button !== 0 || !activeLoc) return;
    e.preventDefault();
    var minute = slotAt(e.clientX);
    dragRef.current = { startMinute: minute, lastMinute: minute, loc: activeLoc };

    // Immediately paint the clicked slot
    commitPaint(minute, minute, activeLoc);

    function onMove(ev) {
      var drag = dragRef.current;
      if (!drag) return;
      var m = slotAt(ev.clientX);
      if (m !== drag.lastMinute) {
        drag.lastMinute = m;
        commitPaint(drag.startMinute, m, drag.loc);
      }
    }
    function onUp() {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Touch support for location painting
  function onTouchStart(e) {
    if (!activeLoc) return;
    e.preventDefault();
    var touch = e.touches[0];
    var minute = slotAt(touch.clientX);
    dragRef.current = { startMinute: minute, lastMinute: minute, loc: activeLoc };
    commitPaint(minute, minute, activeLoc);

    function onTouchMove(ev) {
      var drag = dragRef.current;
      if (!drag) return;
      var t = ev.touches[0];
      var m = slotAt(t.clientX);
      if (m !== drag.lastMinute) {
        drag.lastMinute = m;
        commitPaint(drag.startMinute, m, drag.loc);
      }
    }
    function onTouchEnd() {
      dragRef.current = null;
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    }
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }

  /** Start dragging a block edge to resize it */
  function onBlockEdgeDown(e, blockIdx, edge) {
    if (e.button !== 0 || !onBlocksChange) return;
    e.preventDefault();
    e.stopPropagation(); // don't trigger location painting

    var origBlocks = blocks;
    var b = origBlocks[blockIdx];
    var origVal = edge === 'start' ? b.start : b.end;

    function onMove(ev) {
      var m = slotAt(ev.clientX);
      // Clamp: start can't go past end-15, end can't go before start+15
      if (edge === 'start') {
        m = Math.min(m, b.end - 15);
        m = Math.max(m, rangeRef.current.startMin);
      } else {
        m = Math.max(m, b.start + 15);
        m = Math.min(m, rangeRef.current.endMin);
      }
      if (m === (edge === 'start' ? b.start : b.end)) return;
      var newBlocks = origBlocks.map(function(bl, idx) {
        if (idx !== blockIdx) return bl;
        var updated = Object.assign({}, bl);
        updated[edge] = m;
        return updated;
      });
      onBlocksChange(newBlocks);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  var BLOCK_OVERLAY_H = blocks && blocks.length > 0 ? 20 : 0;

  return (
    <div>
      {/* Time labels above the bar */}
      <div style={{ position: 'relative', height: 16, marginBottom: 2 }}>
        {hourTicks.map(function(mins) {
          var left = pct(mins);
          return (
            <span key={mins} style={{
              position: 'absolute', left: left + '%',
              fontSize: 11, fontWeight: 700, color: '#333',
              transform: 'translateX(-50%)'
            }}>
              {minsToShort(mins)}
            </span>
          );
        })}
      </div>
      <div ref={barRef}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        style={{
          position: 'relative', height: 48 + BLOCK_OVERLAY_H, background: theme.bgTertiary,
          borderRadius: 8, touchAction: 'none', userSelect: 'none', overflow: 'hidden',
          cursor: activeLoc ? 'crosshair' : 'default'
        }}>

        {/* Block boundary overlay (top strip) — draggable edges */}
        {blocks && blocks.map(function(b, i) {
          var left = pct(b.start);
          var width = pct(b.end) - left;
          if (width <= 0) return null;
          return (
            <div key={'blk-' + i} style={{
              position: 'absolute', top: 0, height: BLOCK_OVERLAY_H,
              left: left + '%', width: width + '%',
              background: b.color + '40',
              borderBottom: '2px solid ' + b.color,
              display: 'flex', alignItems: 'center', paddingLeft: 6, gap: 2,
              fontSize: 9, color: theme.text, overflow: 'hidden', whiteSpace: 'nowrap',
              pointerEvents: 'none'
            }}>
              <span>{b.icon}</span>
              {width > 6 && <span style={{ fontWeight: 500 }}>{b.name}</span>}
            </div>
          );
        })}

        {/* Drag handles at block edges */}
        {blocks && onBlocksChange && blocks.map(function(b, i) {
          var handles = [];
          // Left (start) handle
          handles.push(
            <div key={'bh-s-' + i}
              onMouseDown={function(e) { onBlockEdgeDown(e, i, 'start'); }}
              style={{
                position: 'absolute', top: 0, height: BLOCK_OVERLAY_H,
                left: 'calc(' + pct(b.start) + '% - 4px)', width: 8,
                cursor: 'ew-resize', zIndex: 5
              }} />
          );
          // Right (end) handle
          handles.push(
            <div key={'bh-e-' + i}
              onMouseDown={function(e) { onBlockEdgeDown(e, i, 'end'); }}
              style={{
                position: 'absolute', top: 0, height: BLOCK_OVERLAY_H,
                left: 'calc(' + pct(b.end) + '% - 4px)', width: 8,
                cursor: 'ew-resize', zIndex: 5
              }} />
          );
          return handles;
        })}

        {/* Location segments */}
        {segments.map(function(seg, i) {
          var left = pct(seg.start);
          var width = pct(seg.end) - pct(seg.start);
          var isUnset = seg.loc === 'unset';
          var loc = isUnset ? null : locMap[seg.loc];
          var tint = LOC_TINT[seg.loc] || '#9E6B3B';
          var widthMin = seg.end - seg.start;
          return (
            <div key={i} style={{
              position: 'absolute', top: 2 + BLOCK_OVERLAY_H, bottom: 2,
              left: left + '%', width: width + '%',
              background: isUnset ? 'transparent' : tint + '40',
              borderLeft: isUnset ? '1px dashed ' + theme.border : '2px solid ' + tint,
              borderRadius: 3,
              display: 'flex', alignItems: 'center', paddingLeft: 4, gap: 3,
              fontSize: 10, color: isUnset ? theme.textMuted : theme.text,
              overflow: 'hidden', whiteSpace: 'nowrap',
              pointerEvents: 'none'
            }}>
              {isUnset ? null : (
                <>
                  <span style={{ fontSize: 12 }}>{loc?.icon || ''}</span>
                  {widthMin >= 60 && <span style={{ fontSize: 10 }}>{loc?.name || seg.loc}</span>}
                </>
              )}
            </div>
          );
        })}

        {/* Block boundary lines through location area */}
        {blocks && blocks.map(function(b, i) {
          if (i === 0) return null;
          return (
            <div key={'bline-' + i} style={{
              position: 'absolute', top: BLOCK_OVERLAY_H, bottom: 0, left: pct(b.start) + '%',
              borderLeft: '1px dashed ' + (b.color || theme.border),
              opacity: 0.4, pointerEvents: 'none'
            }} />
          );
        })}

        {/* Hour tick lines */}
        {hourTicks.map(function(mins) {
          var left = pct(mins);
          return (
            <div key={mins} style={{
              position: 'absolute', top: 0, bottom: 0, left: left + '%',
              borderLeft: '1px solid ' + theme.border, opacity: 0.3, pointerEvents: 'none'
            }} />
          );
        })}
      </div>

      {/* Brush selector */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: theme.textMuted }}>Brush:</span>
        {locations.map(function(loc) {
          var tint = LOC_TINT[loc.id] || '#9E6B3B';
          var isActive = activeLoc === loc.id;
          return (
            <button key={loc.id} onClick={function() { setActiveLoc(loc.id); }} title={'Paint with ' + loc.name + ' — click/drag on timeline to set location'} style={{
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

/** Expanded location editor pop-out */
function ExpandedLocationEditor({ blocks, locOverrides, locations, theme, onLocOverridesChange, onBlocksChange, onClose }) {
  var hours = useMemo(function() { return buildEffectiveHours(blocks, locOverrides); }, [blocks, locOverrides]);

  var locMap = useMemo(function() {
    var m = {};
    locations.forEach(function(l) { m[l.id] = l; });
    return m;
  }, [locations]);

  function setSlotLoc(minute, locId) {
    var newOverrides = Object.assign({}, locOverrides || {});
    var block = null;
    for (var i = 0; i < blocks.length; i++) {
      if (minute >= blocks[i].start && minute < blocks[i].end) { block = blocks[i]; break; }
    }
    if (block && locId === (block.loc || 'home')) {
      delete newOverrides[minute];
    } else {
      newOverrides[minute] = locId;
    }
    onLocOverridesChange(newOverrides);
  }

  // Group slots by block
  var slotGroups = useMemo(function() {
    var groups = [];
    var uncovered = [];
    blocks.forEach(function(b) {
      var slots = [];
      for (var m = b.start; m < b.end; m += 15) {
        slots.push({ minute: m, loc: hours[m] || b.loc || 'home', isOverride: !!(locOverrides && locOverrides[m] !== undefined) });
      }
      groups.push({ block: b, slots: slots });
    });
    // Add slots outside blocks
    for (var m = 0; m < 1440; m += 15) {
      var inBlock = false;
      for (var i = 0; i < blocks.length; i++) {
        if (m >= blocks[i].start && m < blocks[i].end) { inBlock = true; break; }
      }
      if (!inBlock && hours[m]) {
        uncovered.push({ minute: m, loc: hours[m], isOverride: true });
      }
    }
    if (uncovered.length > 0) {
      groups.push({ block: { name: 'Other', icon: '', color: '#5C5A55' }, slots: uncovered });
    }
    return groups;
  }, [blocks, hours, locOverrides]);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.6)', zIndex: 400,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      <div style={{
        background: theme.bgSecondary, borderRadius: 12,
        width: 650, maxWidth: '95vw', maxHeight: '80vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px ' + theme.shadow
      }} onClick={function(e) { e.stopPropagation(); }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid ' + theme.border }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>Location Details</div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: theme.textMuted, fontSize: 18, cursor: 'pointer' }}>&times;</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {/* Full-width bar */}
          <ScheduleTemplateBar
            hours={hours}
            locations={locations}
            theme={theme}
            onCommit={function(newHours) {
              // Convert hours back to locOverrides
              var newOverrides = {};
              Object.keys(newHours).forEach(function(k) {
                var m = parseInt(k);
                var loc = newHours[k];
                var block = null;
                for (var i = 0; i < blocks.length; i++) {
                  if (m >= blocks[i].start && m < blocks[i].end) { block = blocks[i]; break; }
                }
                if (block) {
                  if (loc !== (block.loc || 'home')) newOverrides[m] = loc;
                } else {
                  newOverrides[m] = loc;
                }
              });
              onLocOverridesChange(newOverrides);
            }}
            blocks={blocks}
            onBlocksChange={onBlocksChange}
          />

          {/* Slot grid grouped by block */}
          <div style={{ marginTop: 16 }}>
            {slotGroups.map(function(group, gi) {
              return (
                <div key={gi} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: group.block.color || theme.text, marginBottom: 4 }}>
                    {group.block.icon} {group.block.name}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    {group.slots.map(function(slot) {
                      var tint = LOC_TINT[slot.loc] || '#9E6B3B';
                      var loc = locMap[slot.loc];
                      return (
                        <div key={slot.minute} style={{ position: 'relative' }}>
                          <select value={slot.loc} onChange={function(e) { setSlotLoc(slot.minute, e.target.value); }}
                            title={minsToTime(slot.minute)}
                            style={{
                              width: 50, padding: '2px 1px', fontSize: 9,
                              border: slot.isOverride ? '2px solid ' + tint : '1px solid ' + theme.border,
                              borderRadius: 3, background: tint + '20',
                              color: theme.text, cursor: 'pointer', fontFamily: 'inherit'
                            }}>
                            {locations.map(function(l) { return <option key={l.id} value={l.id}>{l.icon}{l.name}</option>; })}
                          </select>
                          <div style={{ fontSize: 7, color: theme.textMuted, textAlign: 'center' }}>{minsToShort(slot.minute)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function UnifiedTemplateTab({ config, theme, showToast, allTasks }) {
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var templates = config.scheduleTemplates || {};
  var templateIds = Object.keys(templates);
  var [selectedTemplate, setSelectedTemplate] = useState(templateIds[0] || 'weekday');
  var [editingBlockIdx, setEditingBlockIdx] = useState(null);
  var [showExpanded, setShowExpanded] = useState(false);
  var [newName, setNewName] = useState('');
  var [newOverrideDate, setNewOverrideDate] = useState('');
  var [newOverrideTemplate, setNewOverrideTemplate] = useState(templateIds[0] || 'weekday');

  var tmpl = templates[selectedTemplate];
  var blocks = tmpl?.blocks || [];
  var locOverrides = tmpl?.locOverrides || {};

  async function handleOrphanedWarnings(result) {
    if (!result || !result.warnings || result.warnings.length === 0) return;
    var warning = result.warnings.find(function(w) { return w.type === 'orphanedWhenTags'; });
    if (!warning || warning.tasks.length === 0) return;
    var names = warning.tasks.map(function(t) { return '"' + (t.text || '').slice(0, 30) + '"'; }).join(', ');
    if (showToast) showToast(warning.tasks.length + ' task(s) reassigned to anytime: ' + names, 'info');
    // Auto-fix: batch update orphaned tasks' when to empty (anytime)
    try {
      var { default: apiClient } = await import('../../services/apiClient');
      await apiClient.put('/tasks/batch', {
        updates: warning.tasks.map(function(t) { return { id: t.id, when: '' }; })
      });
    } catch (err) {
      console.error('Failed to auto-fix orphaned when-tags:', err);
    }
  }

  async function saveTemplate(id, patch) {
    var updated = {};
    Object.keys(templates).forEach(function(k) { updated[k] = Object.assign({}, templates[k]); });
    updated[id] = Object.assign({}, updated[id], patch);
    var result = await config.updateScheduleTemplates(updated);
    handleOrphanedWarnings(result);
  }

  async function saveAllTemplates(newTemplates) {
    var result = await config.updateScheduleTemplates(newTemplates);
    handleOrphanedWarnings(result);
  }

  // --- Day defaults ---
  function setDayDefault(day, tmplId) {
    var updated = Object.assign({}, config.templateDefaults, { [day]: tmplId });
    config.updateTemplateDefaults(updated);
  }

  // --- Template CRUD ---
  var TEMPLATE_ICONS = [
    [['work', 'office', 'biz'], '\uD83C\uDFE2'],
    [['home', 'remote', 'wfh'], '\uD83C\uDFE0'],
    [['travel', 'trip', 'flight'], '\u2708\uFE0F'],
    [['vacation', 'holiday', 'pto', 'off'], '\uD83C\uDFD6\uFE0F'],
    [['weekend'], '\u2600\uFE0F'],
    [['school', 'class', 'study'], '\uD83C\uDFEB'],
    [['meeting', 'conference'], '\uD83D\uDCBC'],
    [['gym', 'fitness', 'training'], '\uD83C\uDFCB\uFE0F'],
    [['night', 'late', 'evening'], '\uD83C\uDF19'],
    [['early', 'morning'], '\uD83C\uDF05'],
  ];
  var TEMPLATE_FALLBACKS = ['\uD83D\uDCC5', '\uD83D\uDDD3\uFE0F', '\uD83D\uDCCB', '\uD83D\uDD52', '\u2B50', '\uD83D\uDCC6'];

  function addTemplate() {
    var name = newName.trim();
    if (!name) return;
    var existingIds = Object.keys(templates);
    var usedIcons = existingIds.map(function(k) { return templates[k].icon; });
    var id = generateId(name, existingIds);
    var icon = pickUniqueIcon(name, TEMPLATE_ICONS, usedIcons, TEMPLATE_FALLBACKS);
    var updated = {};
    Object.keys(templates).forEach(function(k) { updated[k] = templates[k]; });
    var defaultBlocks = (templates['weekday']?.blocks || []).map(function(b) { return Object.assign({}, b, { id: b.id + '_' + Date.now() }); });
    updated[id] = { name: name, icon: icon, system: false, blocks: defaultBlocks, locOverrides: {} };
    saveAllTemplates(updated);
    setNewName('');
    setSelectedTemplate(id);
  }

  function removeTemplate(id) {
    if (templates[id]?.system) return;
    var updated = {};
    Object.keys(templates).forEach(function(k) { if (k !== id) updated[k] = templates[k]; });
    saveAllTemplates(updated);
    // Fix defaults/overrides
    var defs = Object.assign({}, config.templateDefaults);
    Object.keys(defs).forEach(function(d) { if (defs[d] === id) defs[d] = 'weekday'; });
    config.updateTemplateDefaults(defs);
    var ovr = Object.assign({}, config.templateOverrides);
    Object.keys(ovr).forEach(function(d) { if (ovr[d] === id) delete ovr[d]; });
    config.updateTemplateOverrides(ovr);
    if (selectedTemplate === id) setSelectedTemplate(Object.keys(updated)[0] || 'weekday');
  }

  // --- Block CRUD ---
  function addBlock() {
    var last = blocks[blocks.length - 1];
    var start = last ? last.end : 360;
    var newBlock = {
      id: 'block_' + Date.now(),
      tag: 'custom',
      name: 'New Block',
      start: start,
      end: Math.min(start + 60, 1440),
      color: '#5C5A55',
      icon: '\uD83D\uDCCB',
      loc: config.locations[0]?.id || 'home'
    };
    saveTemplate(selectedTemplate, { blocks: blocks.concat([newBlock]) });
    setEditingBlockIdx(blocks.length);
  }

  function removeBlock(idx) {
    var removed = blocks[idx];
    var newBlocks = blocks.filter(function(_, i) { return i !== idx; });
    // Clean up locOverrides in removed block's range
    var newOverrides = Object.assign({}, locOverrides);
    for (var m = removed.start; m < removed.end; m += 15) {
      delete newOverrides[m];
    }
    saveTemplate(selectedTemplate, { blocks: newBlocks, locOverrides: newOverrides });
    setEditingBlockIdx(null);
  }

  function updateBlock(idx, field, value) {
    var oldBlock = blocks[idx];
    var newBlocks = blocks.map(function(b, i) {
      if (i !== idx) return b;
      var next = Object.assign({}, b, { [field]: value });
      if (field === 'start' || field === 'end') next[field] = parseInt(value) || 0;
      return next;
    });
    var newBlock = newBlocks[idx];
    var newOverrides = Object.assign({}, locOverrides);

    if (field === 'loc') {
      // When block loc changes, remove overrides in its range that now match new default
      for (var m = newBlock.start; m < newBlock.end; m += 15) {
        if (newOverrides[m] === value) delete newOverrides[m];
      }
    }
    if (field === 'start' || field === 'end') {
      // Fill newly covered time with block's loc, remove orphaned overrides
      var oldStart = oldBlock.start, oldEnd = oldBlock.end;
      var ns = newBlock.start, ne = newBlock.end;
      // Remove overrides in old range that are now outside
      for (var m2 = oldStart; m2 < oldEnd; m2 += 15) {
        if (m2 < ns || m2 >= ne) {
          delete newOverrides[m2];
        }
      }
      // New slots that were not in old range: remove any override that matches block's loc
      for (var m3 = ns; m3 < ne; m3 += 15) {
        if (m3 < oldStart || m3 >= oldEnd) {
          if (newOverrides[m3] === newBlock.loc) delete newOverrides[m3];
        }
      }
    }
    saveTemplate(selectedTemplate, { blocks: newBlocks, locOverrides: newOverrides });
  }

  function handleLocOverridesChange(newOverrides) {
    saveTemplate(selectedTemplate, { locOverrides: newOverrides });
  }

  // Compute effective hours for the bar from blocks + locOverrides
  var effectiveHours = useMemo(function() {
    return buildEffectiveHours(blocks, locOverrides);
  }, [blocks, locOverrides]);

  // Convert flat hours map back to locOverrides by diffing against block defaults
  function handleHoursCommit(newHours) {
    var newOverrides = {};
    Object.keys(newHours).forEach(function(k) {
      var m = parseInt(k);
      var loc = newHours[k];
      var block = null;
      for (var i = 0; i < blocks.length; i++) {
        if (m >= blocks[i].start && m < blocks[i].end) { block = blocks[i]; break; }
      }
      if (block) {
        if (loc !== (block.loc || 'home')) {
          newOverrides[m] = loc;
        }
      } else {
        newOverrides[m] = loc;
      }
    });
    handleLocOverridesChange(newOverrides);
  }

  // Date overrides
  var overrideEntries = Object.entries(config.templateOverrides || {});

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 4 }}>Schedule Templates</div>
      <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 12 }}>Define time blocks and locations for each template</div>

      {/* Day Defaults */}
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 6 }}>Day Defaults</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 16 }}>
        {DAYS.map(function(d) {
          var current = (config.templateDefaults || {})[d] || 'weekday';
          return (
            <div key={d} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: theme.textSecondary }}>{d}</span>
              <select value={current} onChange={function(e) { setDayDefault(d, e.target.value); }}
                title={'Default template for ' + d}
                style={{ padding: '3px 4px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 11, width: '100%', minWidth: 0 }}>
                {templateIds.map(function(id) {
                  var s = templates[id];
                  return <option key={id} value={id}>{(s?.icon || '') + ' ' + (s?.name || id)}</option>;
                })}
              </select>
            </div>
          );
        })}
      </div>

      {/* Template list */}
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 6 }}>Templates</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
        {templateIds.map(function(id) {
          var s = templates[id];
          var isSelected = selectedTemplate === id;
          return (
            <div key={id} onClick={function() { setSelectedTemplate(id); setEditingBlockIdx(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                background: isSelected ? theme.accent + '18' : theme.bgTertiary,
                border: isSelected ? '1px solid ' + theme.accent : '1px solid transparent',
                borderRadius: 6, cursor: 'pointer', fontSize: 12
              }}>
              <span>{s?.icon || '\uD83D\uDCC5'}</span>
              <span style={{ flex: 1, fontWeight: isSelected ? 600 : 400, color: theme.text }}>{s?.name || id}</span>
              <span style={{ fontSize: 10, color: theme.textMuted }}>{(s?.blocks || []).length} blocks</span>
              {!s?.system && (
                <button onClick={function(e) { e.stopPropagation(); removeTemplate(id); }} title={'Delete ' + (s?.name || id)}
                  style={{ border: 'none', background: 'transparent', color: theme.redText, cursor: 'pointer', fontSize: 13, padding: '0 2px' }}>&times;</button>
              )}
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
          <input value={newName} onChange={function(e) { setNewName(e.target.value); }} placeholder="Template name"
            onKeyDown={function(e) { if (e.key === 'Enter') addTemplate(); }}
            style={{ flex: 1, padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 11 }} />
          <button onClick={addTemplate} title="Create a new schedule template" style={{
            border: 'none', borderRadius: 4, padding: '4px 10px', background: theme.accent, color: '#FDFAF5', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit'
          }}>+ New</button>
        </div>
      </div>

      {/* Combined bar */}
      {tmpl && (
        <div style={{ marginBottom: 12 }}>
          <ScheduleTemplateBar
            hours={effectiveHours}
            locations={config.locations}
            theme={theme}
            onCommit={handleHoursCommit}
            blocks={blocks}
            onBlocksChange={function(newBlocks) { saveTemplate(selectedTemplate, { blocks: newBlocks }); }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button onClick={function() { setShowExpanded(true); }} title="Expand — open detailed slot-by-slot location editor" style={{
              border: '1px solid ' + theme.border, borderRadius: 4, padding: '2px 8px',
              background: 'transparent', color: theme.textSecondary, fontSize: 10,
              cursor: 'pointer', fontFamily: 'inherit'
            }}>Expand</button>
          </div>
        </div>
      )}

      {/* Block list + editor */}
      {tmpl && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 6 }}>Blocks</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
            {blocks.slice().sort(function(a, b) { return a.start - b.start || a.end - b.end; }).map(function(b) {
              var i = blocks.indexOf(b);
              var isEditing = editingBlockIdx === i;
              return (
                <div key={b.id || i}>
                  <div onClick={function() { setEditingBlockIdx(isEditing ? null : i); }} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                    background: isEditing ? b.color + '15' : theme.bgTertiary,
                    border: isEditing ? '1px solid ' + b.color : '1px solid transparent',
                    borderRadius: 6, fontSize: 12, cursor: 'pointer'
                  }}>
                    <div style={{ width: 4, height: 18, borderRadius: 2, background: b.color }} />
                    <span>{b.icon}</span>
                    <span style={{ color: theme.text, flex: 1, fontWeight: 500 }}>{b.name}</span>
                    <span style={{ fontSize: 10, color: theme.textMuted }}>{minsToTime(b.start)} - {minsToTime(b.end)}</span>
                    <span style={{ fontSize: 10, color: theme.textMuted, background: theme.bgTertiary, padding: '1px 6px', borderRadius: 8 }}>
                      {(config.locations.find(function(l) { return l.id === b.loc; }) || {}).icon || ''} {b.loc}
                    </span>
                    <button onClick={function(e) { e.stopPropagation(); removeBlock(i); }} style={{
                      border: 'none', background: 'transparent', color: theme.redText, cursor: 'pointer', fontSize: 13
                    }}>&times;</button>
                  </div>
                  {isEditing && (
                    <div style={{ padding: '6px 10px', display: 'flex', flexWrap: 'wrap', gap: 6, background: theme.bgTertiary, borderRadius: '0 0 6px 6px', marginTop: -2, alignItems: 'flex-end' }}>
                      <label style={{ fontSize: 11, color: theme.textSecondary }}>
                        Name
                        <input value={b.name} onChange={function(e) { updateBlock(i, 'name', e.target.value); }}
                          style={{ display: 'block', width: 80, padding: '3px 5px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 11 }} />
                      </label>
                      <label style={{ fontSize: 11, color: theme.textSecondary }}>
                        Tag
                        <input value={b.tag || ''} onChange={function(e) { updateBlock(i, 'tag', e.target.value); }}
                          style={{ display: 'block', width: 60, padding: '3px 5px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 11 }} />
                      </label>
                      <label style={{ fontSize: 11, color: theme.textSecondary }}>
                        Start
                        <input type="time" value={minsToTimeInput(b.start)} onChange={function(e) { updateBlock(i, 'start', timeInputToMins(e.target.value)); }}
                          style={{ display: 'block', padding: '3px 4px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 11 }} />
                      </label>
                      <label style={{ fontSize: 11, color: theme.textSecondary }}>
                        End
                        <input type="time" value={minsToTimeInput(b.end)} onChange={function(e) { updateBlock(i, 'end', timeInputToMins(e.target.value)); }}
                          style={{ display: 'block', padding: '3px 4px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 11 }} />
                      </label>
                      <label style={{ fontSize: 11, color: theme.textSecondary }}>
                        Loc
                        <select value={b.loc} onChange={function(e) { updateBlock(i, 'loc', e.target.value); }}
                          style={{ display: 'block', padding: '3px 4px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 11 }}>
                          {config.locations.map(function(l) { return <option key={l.id} value={l.id}>{l.icon + ' ' + l.name}</option>; })}
                        </select>
                      </label>
                      <label style={{ fontSize: 11, color: theme.textSecondary }}>
                        <span style={{ visibility: 'hidden' }}>C</span>
                        <input type="color" value={b.color} onChange={function(e) { updateBlock(i, 'color', e.target.value); }}
                          style={{ display: 'block', width: 28, height: 24, border: 'none', cursor: 'pointer', padding: 0 }} />
                      </label>
                      <label style={{ fontSize: 11, color: theme.textSecondary }}>
                        <span style={{ visibility: 'hidden' }}>I</span>
                        <input value={b.icon} onChange={function(e) { updateBlock(i, 'icon', e.target.value); }}
                          style={{ display: 'block', width: 34, padding: '3px 4px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12, textAlign: 'center' }} />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <button onClick={addBlock} title="Add a custom time block" style={{
              border: 'none', borderRadius: 4, padding: '4px 10px', background: theme.accent, color: '#FDFAF5', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit'
            }}>+ Custom</button>
            {PRESET_BLOCKS.map(function(preset) {
              return (
                <button key={preset.tag + '_' + preset.start} onClick={function() {
                  var newBlock = Object.assign({}, preset, { id: preset.tag + '_' + Date.now(), loc: preset.loc || config.locations[0]?.id || 'home' });
                  saveTemplate(selectedTemplate, { blocks: blocks.concat([newBlock]) });
                }} title={'Add preset block: ' + preset.name + ' (' + minsToTime(preset.start) + ' \u2013 ' + minsToTime(preset.end) + ')'} style={{
                  border: '1px solid ' + preset.color + '40', borderRadius: 4, padding: '3px 8px',
                  background: preset.color + '15', color: theme.text, fontSize: 10,
                  cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 3
                }}>
                  <span>{preset.icon}</span>
                  <span>{preset.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Date Overrides */}
      <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, marginBottom: 6, marginTop: 8 }}>Date Overrides</div>
      <div style={{ fontSize: 11, color: theme.textMuted, marginBottom: 8 }}>Override the default template for specific dates</div>
      {overrideEntries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
          {overrideEntries.map(function(entry) {
            var date = entry[0], tmplId = entry[1];
            var t = templates[tmplId];
            return (
              <div key={date} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', fontSize: 12, background: theme.bgTertiary, borderRadius: 4 }}>
                <span style={{ color: theme.text, fontWeight: 500 }}>{date}</span>
                <span style={{ color: theme.textMuted }}>{(t?.icon || '') + ' ' + (t?.name || tmplId)}</span>
                <button onClick={function() {
                  var updated = Object.assign({}, config.templateOverrides);
                  delete updated[date];
                  config.updateTemplateOverrides(updated);
                }} title={'Remove date override for ' + date} style={{ border: 'none', background: 'transparent', color: theme.redText, cursor: 'pointer', fontSize: 12, marginLeft: 'auto' }}>&times;</button>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="date" value={newOverrideDate} onChange={function(e) { setNewOverrideDate(e.target.value); }}
          style={{ padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <select value={newOverrideTemplate} onChange={function(e) { setNewOverrideTemplate(e.target.value); }}
          style={{ padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }}>
          {templateIds.map(function(id) {
            var s = templates[id];
            return <option key={id} value={id}>{(s?.icon || '') + ' ' + (s?.name || id)}</option>;
          })}
        </select>
        <button onClick={function() {
          if (!newOverrideDate) return;
          // Convert YYYY-MM-DD to M/D
          var parts = newOverrideDate.split('-');
          var dateKey = parseInt(parts[1]) + '/' + parseInt(parts[2]);
          var updated = Object.assign({}, config.templateOverrides, { [dateKey]: newOverrideTemplate });
          config.updateTemplateOverrides(updated);
          setNewOverrideDate('');
        }} title="Override the default template for a specific date" style={{
          border: 'none', borderRadius: 4, padding: '4px 12px', background: theme.accent, color: '#FDFAF5', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit'
        }}>Add Override</button>
      </div>

      {/* Expanded location editor */}
      {showExpanded && tmpl && (
        <ExpandedLocationEditor
          blocks={blocks}
          locOverrides={locOverrides}
          locations={config.locations}
          theme={theme}
          onLocOverridesChange={handleLocOverridesChange}
          onBlocksChange={function(newBlocks) { saveTemplate(selectedTemplate, { blocks: newBlocks }); }}
          onClose={function() { setShowExpanded(false); }}
        />
      )}
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
