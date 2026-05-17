import React from 'react';

export default function DependsOnSection({ task, onShowChain, TH, isMobile }) {
  if (task.recurring) return null;

  var BTN_H = isMobile ? 30 : 26;
  var depCount = task.dependsOn && task.dependsOn.length > 0 ? task.dependsOn.length : 0;

  return (
    <button onClick={onShowChain} style={{
      border: '1px solid #0EA5E9', borderRadius: 4, padding: '4px 10px',
      background: 'transparent', color: '#0EA5E9', fontSize: 10, fontWeight: 600,
      cursor: 'pointer', fontFamily: 'inherit', width: '100%',
      height: BTN_H, boxSizing: 'border-box'
    }}>
      🔗 Dependencies{depCount > 0 ? ' (' + depCount + ')' : ''}
    </button>
  );
}
