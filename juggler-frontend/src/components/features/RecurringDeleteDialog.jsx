/**
 * RecurringDeleteDialog — skip-instance vs delete-series confirmation for recurring tasks
 */

import React from 'react';
import { getTheme } from '../../theme/colors';

export default function RecurringDeleteDialog({ taskName, onSkipInstance, onDeleteSeries, onCancel, darkMode, isMobile }) {
  var theme = getTheme(darkMode);
  var btnBase = {
    border: 'none', borderRadius: 8, padding: '10px 16px',
    fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', width: '100%',
    textAlign: 'left', lineHeight: 1.4,
  };
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', zIndex: 400, display: 'flex',
      alignItems: 'center', justifyContent: 'center'
    }} onClick={onCancel}>
      <div style={{
        background: theme.bgSecondary, borderRadius: isMobile ? 0 : 12,
        width: isMobile ? '100%' : 360, maxWidth: isMobile ? '100%' : '90vw',
        height: isMobile ? '100%' : undefined,
        padding: 24, boxShadow: isMobile ? 'none' : ('0 8px 32px ' + theme.shadow),
        display: isMobile ? 'flex' : undefined, flexDirection: isMobile ? 'column' : undefined,
        justifyContent: isMobile ? 'center' : undefined
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 4 }}>
          Delete "{(taskName || '').slice(0, 50)}"
        </div>
        <div style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 16 }}>
          This is a recurring task. What would you like to do?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <button onClick={onSkipInstance} style={{
            ...btnBase, background: theme.bgCard, border: '1px solid ' + theme.border, color: theme.text,
          }}>
            <span style={{ fontWeight: 600 }}>{'\u23ED'} Skip this instance</span>
            <br />
            <span style={{ fontSize: 11, color: theme.textSecondary }}>Mark this occurrence as skipped. The recurring task continues.</span>
          </button>
          <button onClick={onDeleteSeries} style={{
            ...btnBase, background: theme.errorBg || '#fef2f2', border: '1px solid ' + (theme.errorBorder || '#fca5a5'), color: theme.error || '#991b1b',
          }}>
            <span style={{ fontWeight: 600 }}>{'\uD83D\uDDD1'} Delete entire series</span>
            <br />
            <span style={{ fontSize: 11, opacity: 0.8 }}>Remove the recurring task and all future instances. Past instances are kept.</span>
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            border: '1px solid ' + theme.border, borderRadius: 8, padding: '8px 20px',
            background: 'transparent', color: theme.textSecondary, fontSize: 13,
            cursor: 'pointer', fontFamily: 'inherit'
          }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
