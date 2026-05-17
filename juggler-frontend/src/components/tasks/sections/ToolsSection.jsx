import React from 'react';

export default function ToolsSection({ tools, taskTools, onChange, TH, isMobile }) {
  var BTN_H = isMobile ? 30 : 26;
  function togStyle(on) {
    return {
      height: BTN_H, padding: '0 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
      fontWeight: on ? 600 : 400, fontFamily: 'inherit', boxSizing: 'border-box',
      border: on ? '2px solid ' + TH.accent : '1px solid ' + TH.btnBorder,
      background: on ? TH.accent + '22' : TH.bgCard,
      color: on ? TH.accent : TH.textMuted,
    };
  }

  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {(tools || []).map(function(tool) {
        var isOn = taskTools.indexOf(tool.id) !== -1;
        return (
          <button key={tool.id} title={'Requires ' + tool.name}
            onClick={() => onChange(isOn ? taskTools.filter(function(x) { return x !== tool.id; }) : [...taskTools, tool.id])}
            style={togStyle(isOn)}>
            {tool.icon} {tool.name}
          </button>
        );
      })}
    </div>
  );
}
