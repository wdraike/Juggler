/**
 * ConfirmDialog — modal replacement for window.confirm
 */

import React from 'react';
import { getTheme } from '../../theme/colors';

export default function ConfirmDialog({ message, onConfirm, onCancel, darkMode }) {
  var theme = getTheme(darkMode);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 400, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onCancel}>
      <div style={{
        background: theme.bgSecondary, borderRadius: 12, width: 360, maxWidth: '90vw',
        padding: 24, boxShadow: '0 8px 32px ' + theme.shadow
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, color: theme.text, marginBottom: 20, lineHeight: 1.5 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            border: '1px solid ' + theme.border, borderRadius: 8, padding: '8px 20px',
            background: 'transparent', color: theme.textSecondary, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            border: 'none', borderRadius: 8, padding: '8px 20px',
            background: '#EF4444', color: '#FFF', fontWeight: 600, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}
