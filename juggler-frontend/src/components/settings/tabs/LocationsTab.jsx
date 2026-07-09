/**
 * LocationsTab — extracted from SettingsPanel (999.965).
 */
import React, { useState } from 'react';
import HelpIcon from '../HelpIcon';
import ConfirmDialog from '../../features/ConfirmDialog';

var hasGeolocation = typeof navigator !== 'undefined' && !!navigator.geolocation;

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
  if (picked && usedIcons.indexOf(picked) === -1) return picked;
  var all = (picked ? [picked] : []).concat(fallbacks);
  for (var k = 0; k < all.length; k++) {
    if (usedIcons.indexOf(all[k]) === -1) return all[k];
  }
  return picked || fallbacks[0];
}

function LocationRow({ loc, config, theme, onRequestDelete }) {
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
      var { default: apiClient } = await import('../../../services/apiClient');
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
        updateLocationCoords(pos.coords.latitude, pos.coords.longitude, '');
        setGeocodeInput('');
      },
      function() { setLoading(false); setGeoError("Location access denied"); },
      { timeout: 10000 }
    );
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); handleGeocode(); }
  }

  return (
    <div style={{ background: theme.bgTertiary, borderRadius: 6, padding: '6px 8px', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{loc.icon}</span>
        <span style={{ color: theme.text, flex: 1 }}>{loc.name}</span>
        <button onClick={function() { onRequestDelete(loc); }}
          title={'Delete location ' + loc.name} style={{ border: 'none', background: 'transparent', color: theme.redText, cursor: 'pointer', fontSize: 14 }}>&times;</button>
      </div>
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
            <input value={geocodeInput} onChange={function(e) { setGeocodeInput(e.target.value); setGeoError(''); }}
              onBlur={handleGeocode} onKeyDown={handleKeyDown} placeholder="City, state — or ZIP code" disabled={loading}
              style={{ flex: 1, padding: '3px 6px', fontSize: 11, border: '1px solid ' + (geoError ? theme.redText : theme.inputBorder), borderRadius: 4, background: theme.input, color: theme.text, opacity: loading ? 0.7 : 1 }} />
            {hasGeolocation && (
              <button onClick={handleLocateMe} disabled={loading} title="Use your current device location"
                style={{ border: 'none', borderRadius: 4, padding: '3px 8px', background: theme.accent, color: '#FDFAF5', fontSize: 11, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1, whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
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

export default function LocationsTab({ config, theme, darkMode, isMobile }) {
  var [newName, setNewName] = useState('');
  var [error, setError] = useState('');
  // 999.1228 — deleting a location is irreversible; gate it behind the shared
  // ConfirmDialog like every other unrecoverable delete.
  var [pendingDelete, setPendingDelete] = useState(null); // location object

  function handleAdd() {
    var name = newName.trim();
    if (!name) return;
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
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>
        <HelpIcon text="Locations — define places you work (home, office, gym, etc.) and optionally set their coordinates for weather data" theme={theme}>
          <span>Locations</span>
        </HelpIcon>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {config.locations.map(function(loc) {
          return <LocationRow key={loc.id} loc={loc} config={config} theme={theme} onRequestDelete={setPendingDelete} />;
        })}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={newName} onChange={e => { setNewName(e.target.value); setError(''); }} placeholder="Location name" onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          style={{ flex: 1, padding: '4px 6px', border: `1px solid ${error ? theme.redText : theme.inputBorder}`, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <button onClick={handleAdd} title="Add a new location" style={{ border: 'none', borderRadius: 4, padding: '4px 12px', background: theme.accent, color: '#FDFAF5', fontSize: 12, cursor: 'pointer' }}>Add</button>
      </div>
      {error && <div style={{ fontSize: 11, color: theme.redText, marginTop: 4 }}>{error}</div>}
      {pendingDelete && (
        <ConfirmDialog
          title="Delete location?"
          message={'Delete "' + pendingDelete.name + '"? This cannot be undone.'}
          onConfirm={function() {
            config.updateLocations(config.locations.filter(function(l) { return l.id !== pendingDelete.id; }));
            setPendingDelete(null);
          }}
          onCancel={function() { setPendingDelete(null); }}
          darkMode={darkMode}
          isMobile={isMobile}
        />
      )}
    </div>
  );
}
