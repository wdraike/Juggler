/**
 * MatrixTab — extracted from SettingsPanel (999.965).
 */
import React from 'react';
import HelpIcon from '../HelpIcon';

export default function MatrixTab({ config, theme }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>
        <HelpIcon text="Tool Matrix — control which tools are available at each location." theme={theme}>
          <span>Tool Availability Matrix</span>
        </HelpIcon>
      </div>
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
