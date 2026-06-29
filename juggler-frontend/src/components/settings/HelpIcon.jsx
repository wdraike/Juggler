/**
 * HelpIcon — click-to-toggle contextual help tooltip (999.965).
 */
import React, { useState, useRef, useEffect } from 'react';

export default function HelpIcon({ children, text, theme, style }) {
  var [open, setOpen] = useState(false);
  var ref = useRef(null);

  useEffect(function() {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return function() { document.removeEventListener('mousedown', handleClick); };
  }, [open]);

  useEffect(function() {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') { setOpen(false); }
    }
    document.addEventListener('keydown', handleKey);
    return function() { document.removeEventListener('keydown', handleKey); };
  }, [open]);

  return (
    <span ref={ref} style={Object.assign({ position: 'relative', display: 'inline-flex', alignItems: 'center' }, style || {})}>
      {children}
      <button
        onClick={function(e) { e.stopPropagation(); e.preventDefault(); setOpen(function(p) { return !p; }); }}
        onKeyDown={function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(function(p) { return !p; }); } }}
        title="Show help"
        aria-label="Show help"
        style={{
          border: '1px solid ' + (open ? theme.accent : theme.border),
          borderRadius: '50%', width: 16, height: 16,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: open ? theme.accent + '20' : 'transparent',
          color: open ? theme.accent : theme.textMuted,
          fontSize: 10, fontWeight: 700, cursor: 'pointer',
          padding: 0, lineHeight: 1, fontFamily: 'inherit', flexShrink: 0,
          marginLeft: 4, transition: 'all 0.15s'
        }}
      >?</button>
      {open && (
        <div role="tooltip" style={{
          position: 'absolute', left: 20, top: -6,
          background: theme.bgSecondary, border: '1px solid ' + theme.border,
          borderRadius: 6, padding: '6px 10px', fontSize: 11,
          color: theme.text, lineHeight: 1.45,
          boxShadow: '0 2px 10px ' + theme.shadow,
          zIndex: 500, maxWidth: 260, minWidth: 160,
          pointerEvents: 'auto'
        }}>
          {text}
        </div>
      )}
    </span>
  );
}
