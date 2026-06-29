/**
 * TaskEditFormMobileHeader — mobile sticky header extracted from TaskEditForm (999.965).
 */
import React from 'react';
import { BRAND } from '../../theme/colors';

export default function TaskEditFormMobileHeader({ isCreate, TH, onClose, isDirty, handleSave, handleCreate }) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10,
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px',
      background: TH.headerBg,
      borderBottom: '2px solid ' + TH.accent,
    }}>
      <button onClick={onClose} style={{
        border: 'none', background: 'transparent', color: TH.accent,
        fontSize: 20, cursor: 'pointer', padding: '2px 4px', lineHeight: 1
      }} aria-label="Go back">{'\u2190'}</button>
      <div style={{
        fontFamily: "'Playfair Display', serif",
        fontWeight: 700, fontSize: 16, color: TH.headerText, lineHeight: 1.1
      }}>
        Strive<span style={{ color: TH.accent }}>RS</span>
        <span style={{
          fontFamily: "'Inter', sans-serif", fontWeight: 400,
          fontSize: 11, color: TH.textMuted, marginLeft: 6
        }}>{'/ ' + (isCreate ? 'New Task' : 'Edit Task')}</span>
      </div>
      <div style={{ flex: 1 }} />
      {isCreate ? (
        <button onClick={handleCreate} style={{
          fontSize: 11, fontWeight: 700, padding: '5px 14px',
          border: 'none', borderRadius: 4,
          background: BRAND.success, color: BRAND.cream, cursor: 'pointer'
        }}>{'+ Create'}</button>
      ) : (
        isDirty && <button onClick={handleSave} style={{
          fontSize: 11, fontWeight: 700, padding: '5px 14px',
          border: 'none', borderRadius: 4,
          background: TH.accent, color: BRAND.cream, cursor: 'pointer'
        }}>{'\u2714 Save'}</button>
      )}
      <button onClick={onClose} style={{
        border: 'none', background: 'transparent', color: TH.textMuted,
        fontSize: 22, cursor: 'pointer', padding: '2px 4px', lineHeight: 1
      }} aria-label="Close">{'\u00D7'}</button>
    </div>
  );
}
