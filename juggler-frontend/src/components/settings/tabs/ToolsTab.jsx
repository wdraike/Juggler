/**
 * ToolsTab — extracted from SettingsPanel (999.965).
 */
import React, { useState } from 'react';
import HelpIcon from '../HelpIcon';

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

export default function ToolsTab({ config, theme }) {
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
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>
        <HelpIcon text="Tools — define the tools you use (laptop, phone, etc.). Each tool can be assigned to specific locations in the Tool Matrix tab." theme={theme}>
          <span>Tools</span>
        </HelpIcon>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {config.tools.map((tool, i) => (
          <div key={tool.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6, fontSize: 13 }}>
            <span>{tool.icon}</span>
            <span style={{ color: theme.text, flex: 1 }}>{tool.name}</span>
            <button onClick={() => { config.updateTools(config.tools.filter((_, idx) => idx !== i)); }}
              title={'Delete tool ' + tool.name} style={{ border: 'none', background: 'transparent', color: theme.redText, cursor: 'pointer', fontSize: 14 }}>&times;</button>
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
