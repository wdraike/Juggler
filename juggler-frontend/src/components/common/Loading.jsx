/**
 * Loading — the one shared loading indicator (999.1226).
 *
 * Replaces the ad-hoc "Loading tasks..." / "Loading users..." / "Loading..." /
 * "Loading image…" text variants and the spin keyframes that were private to
 * HeaderBar. Inherits its color from the surrounding text by default (pass
 * `color` or wrap in a colored container to theme it).
 */

import React from 'react';

export default function Loading({ label, color, style }) {
  return (
    <div
      role="status"
      style={Object.assign(
        {
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, fontSize: 13, color: color || 'inherit'
        },
        style
      )}
    >
      <span aria-hidden="true" style={{
        width: 13, height: 13, flexShrink: 0, display: 'inline-block',
        border: '2px solid currentColor', borderTopColor: 'transparent',
        borderRadius: '50%', animation: 'shared-loading-spin 0.8s linear infinite'
      }} />
      <span>{label || 'Loading…'}</span>
      <style>{'@keyframes shared-loading-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}
