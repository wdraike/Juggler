import React, { useState, useEffect, useRef } from 'react';

var STORAGE_KEY = 'juggler-font-size';
var LEVELS = [
  { key: 'small',       label: 'Small',       scale: 0.85 },
  { key: 'medium',      label: 'Medium',      scale: 1.0  },
  { key: 'large',       label: 'Large',       scale: 1.15 },
  { key: 'extra-large', label: 'Extra Large', scale: 1.25 },
];

function getSavedLevel() {
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    return LEVELS.find(function(l) { return l.key === saved; }) || LEVELS[1];
  } catch (e) {
    return LEVELS[1];
  }
}

export default function FontSizeControl({ theme, isMobile }) {
  var [level, setLevel] = useState(getSavedLevel);
  var [isOpen, setIsOpen] = useState(false);
  var [menuPos, setMenuPos] = useState({ top: 0, right: 0 });
  var containerRef = useRef(null);
  var toggleRef = useRef(null);

  useEffect(function() {
    document.documentElement.style.zoom = level.scale;
    try { localStorage.setItem(STORAGE_KEY, level.key); } catch (e) {}
  }, [level]);

  useEffect(function() {
    if (isOpen && toggleRef.current) {
      var rect = toggleRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 5, right: window.innerWidth - rect.right });
    }
  }, [isOpen]);

  useEffect(function() {
    if (!isOpen) return;
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return function() { document.removeEventListener('mousedown', onDocClick); };
  }, [isOpen]);

  function select(l) {
    setLevel(l);
    setIsOpen(false);
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        ref={toggleRef}
        onClick={function() { setIsOpen(function(v) { return !v; }); }}
        title="Adjust UI text size"
        style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: theme.headerTextMuted, fontSize: 13, fontWeight: 700,
          padding: isMobile ? '8px' : '4px 6px',
          borderRadius: 2, fontFamily: "'Inter', sans-serif",
          minWidth: isMobile ? 36 : undefined,
          minHeight: isMobile ? 36 : undefined,
          letterSpacing: '-0.02em',
        }}
      >
        Aa
      </button>

      {isOpen && (
        <div style={{
          position: 'fixed',
          top: menuPos.top + 'px',
          right: menuPos.right + 'px',
          zIndex: 10001,
          background: theme.bgCard,
          border: '1px solid ' + theme.border,
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          minWidth: 160,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 16px 8px',
            fontSize: 11, fontWeight: 600,
            color: theme.textMuted,
            borderBottom: '1px solid ' + theme.border,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Font Size
          </div>
          {LEVELS.map(function(l) {
            var isActive = level.key === l.key;
            return (
              <button
                key={l.key}
                onClick={function() { select(l); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '10px 16px',
                  background: isActive ? (theme.bgHover || 'rgba(0,0,0,0.06)') : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: isActive ? theme.text : theme.textMuted,
                  fontFamily: "'Inter', sans-serif", fontSize: 14,
                  fontWeight: isActive ? 600 : 400, textAlign: 'left',
                }}
                onMouseEnter={function(e) { if (!isActive) e.currentTarget.style.background = theme.bgHover || 'rgba(0,0,0,0.04)'; }}
                onMouseLeave={function(e) { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <span>{l.label}</span>
                {isActive && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: theme.accent, flexShrink: 0 }}>
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
