import React from 'react';

export default function WhereSection({ locations, taskLoc, onChange, TH, isMobile }) {
  var BTN_H = isMobile ? 30 : 26;
  function togStyle(on, color) {
    return {
      height: BTN_H, padding: '0 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
      fontWeight: on ? 600 : 400, fontFamily: 'inherit', boxSizing: 'border-box',
      border: on ? '2px solid ' + (color || TH.accent) : '1px solid ' + TH.btnBorder,
      background: on ? (color || TH.accent) + '22' : TH.bgCard,
      color: on ? (color || TH.accent) : TH.textMuted,
    };
  }

  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      <button onClick={() => onChange([])} title="Task can be done at any location"
        style={togStyle(taskLoc.length === 0, '#2D6A4F')}>🌍 Anywhere</button>
      {(locations || []).map(function(loc) {
        var isOn = taskLoc.indexOf(loc.id) !== -1;
        var anywhere = taskLoc.length === 0;
        return (
          <button key={loc.id} title={'Restrict to ' + loc.name}
            onClick={() => {
              if (anywhere) { onChange([loc.id]); }
              else { onChange(isOn ? taskLoc.filter(function(x) { return x !== loc.id; }) : [...taskLoc, loc.id]); }
            }}
            style={{ ...togStyle(isOn && !anywhere), opacity: anywhere ? 0.4 : 1 }}>
            {loc.icon} {loc.name}
          </button>
        );
      })}
    </div>
  );
}
