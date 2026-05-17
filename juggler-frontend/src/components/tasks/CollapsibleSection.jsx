// src/components/tasks/CollapsibleSection.jsx
import React from 'react';

export default function CollapsibleSection({ id, label, isOpen, onToggle, badge, TH, children }) {
  return (
    <div style={{ borderTop: '1px solid ' + TH.border }}>
      <button
        onClick={() => onToggle(id)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '7px 12px', border: 'none', background: 'transparent', cursor: 'pointer',
          color: TH.text, fontFamily: 'inherit', fontSize: 11, fontWeight: 600, textAlign: 'left'
        }}
      >
        <span>{isOpen ? '▼' : '▶'} {label}</span>
        {badge && (
          <span style={{
            fontSize: 10, color: TH.textMuted, background: TH.bgCard,
            borderRadius: 3, padding: '1px 6px', fontWeight: 400
          }}>
            {badge}
          </span>
        )}
      </button>
      {isOpen && (
        <div style={{ padding: '2px 12px 12px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
