/**
 * EmptyState — shared empty-state hint for the grid views (999.1235).
 *
 * The five time-grid views (Day, Flex, 3-Day, Week, Month, Timeline) used to
 * render a bare hour grid on a zero-task account — no hint of what to do next
 * or of the auto-scheduling value. This overlay gives each view a one-liner
 * (state + action) and the Day landing view a first-run CTA card.
 *
 * Non-interactive by design: pointerEvents 'none' so clicks, drags, and
 * drops on the grid underneath keep working. The parent must be positioned
 * (position: relative) for the overlay to center correctly.
 */
import React from 'react';

export default function EmptyState({ theme, title, hint }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 5,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none'
    }}>
      <div style={{
        maxWidth: 340, textAlign: 'center', padding: title ? '18px 22px' : '10px 16px',
        background: theme.bgSecondary, border: '1px dashed ' + theme.border,
        borderRadius: 8, boxShadow: title ? '0 2px 12px ' + (theme.shadow || 'rgba(0,0,0,0.08)') : 'none'
      }}>
        {title && (
          <div style={{ fontSize: 15, fontWeight: 700, color: theme.text, marginBottom: 6 }}>
            {title}
          </div>
        )}
        <div style={{ fontSize: 12, color: theme.textMuted, lineHeight: 1.5 }}>
          {hint}
        </div>
      </div>
    </div>
  );
}
