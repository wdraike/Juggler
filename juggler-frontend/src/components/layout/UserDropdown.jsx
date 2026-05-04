import React, { useState, useRef, useEffect } from 'react';
import { services } from '../../proxy-config';

var BILLING_URL = services.billing.frontend;

export default function UserDropdown({ user, theme, isMobile, onShowSettings, logout, onReportIssue }) {
  var [isOpen, setIsOpen] = useState(false);
  var [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });
  var containerRef = useRef(null);
  var buttonRef = useRef(null);

  useEffect(function() {
    if (!isOpen) return;
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return function() { document.removeEventListener('mousedown', onDocClick); };
  }, [isOpen]);

  useEffect(function() {
    function onKeyDown(e) { if (e.key === 'Escape') setIsOpen(false); }
    document.addEventListener('keydown', onKeyDown);
    return function() { document.removeEventListener('keydown', onKeyDown); };
  }, []);

  if (!user) return null;

  var displayName = user.name || user.email || '';
  var initials = displayName ? displayName.charAt(0).toUpperCase() : 'U';

  function handleToggle(e) {
    var rect = e.currentTarget.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    setIsOpen(function(v) { return !v; });
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="true"
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: isOpen ? 'rgba(255,255,255,0.1)' : 'transparent',
          border: 'none', cursor: 'pointer',
          color: theme.headerText, padding: '5px 8px', borderRadius: 6,
          transition: 'background 0.2s',
          fontFamily: "'Inter', sans-serif"
        }}
        onMouseEnter={function(e) { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
        onMouseLeave={function(e) { e.currentTarget.style.background = isOpen ? 'rgba(255,255,255,0.1)' : 'transparent'; }}
      >
        {user.picture ? (
          <img src={user.picture} alt="" style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.25)', objectFit: 'cover' }} />
        ) : (
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 600, fontSize: 12, color: theme.headerText,
            border: '1.5px solid rgba(255,255,255,0.25)', flexShrink: 0
          }}>{initials}</div>
        )}
        {!isMobile && (
          <span style={{
            fontSize: 13, fontWeight: 500,
            maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: theme.headerTextMuted
          }}>{displayName}</span>
        )}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{
          opacity: 0.6,
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
          flexShrink: 0
        }}>
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {isOpen && (
        <div style={{
          position: 'fixed',
          top: dropdownPos.top + 'px',
          right: dropdownPos.right + 'px',
          zIndex: 10001,
          background: theme.bgCard,
          border: '1px solid ' + theme.border,
          borderRadius: 10,
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
          minWidth: 210,
          overflow: 'hidden'
        }}>
          {/* User info */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid ' + theme.border,
            display: 'flex', alignItems: 'center', gap: 10
          }}>
            {user.picture ? (
              <img src={user.picture} alt="" style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid ' + theme.border, objectFit: 'cover' }} />
            ) : (
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: theme.accent, opacity: 0.9,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 16, color: '#fff', flexShrink: 0
              }}>{initials}</div>
            )}
            <div style={{ minWidth: 0 }}>
              {user.name && <div style={{ fontWeight: 600, fontSize: 13, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>}
              {user.email && <div style={{ fontSize: 11, color: theme.textMuted, marginTop: user.name ? 1 : 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>}
            </div>
          </div>

          {/* Settings */}
          {onShowSettings && (
            <button
              onClick={function() { setIsOpen(false); onShowSettings(); }}
              style={menuItem(theme)}
              onMouseEnter={function(e) { e.currentTarget.style.background = theme.bgHover; }}
              onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.55, flexShrink: 0 }}>
                <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
              </svg>
              Settings
            </button>
          )}

          {/* Billing */}
          <button
            onClick={function() { setIsOpen(false); window.open(BILLING_URL + '/plans', '_blank'); }}
            style={menuItem(theme)}
            onMouseEnter={function(e) { e.currentTarget.style.background = theme.bgHover; }}
            onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.55, flexShrink: 0 }}>
              <path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/>
            </svg>
            Billing
          </button>

          {onReportIssue && (
            <button
              onClick={function() { setIsOpen(false); onReportIssue(); }}
              style={menuItem(theme)}
              onMouseEnter={function(e) { e.currentTarget.style.background = theme.bgHover; }}
              onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.55, flexShrink: 0 }}>
                <path d="M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5c-.49 0-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"/>
              </svg>
              Report Issue
            </button>
          )}

          <div style={{ height: 1, background: theme.border, margin: '4px 0' }} />

          {/* Sign Out */}
          <button
            onClick={function() { setIsOpen(false); logout(); }}
            style={{ ...menuItem(theme), color: theme.textMuted, transition: 'color 0.2s, background 0.15s' }}
            onMouseEnter={function(e) { e.currentTarget.style.color = '#8B2635'; e.currentTarget.style.background = theme.redBg; }}
            onMouseLeave={function(e) { e.currentTarget.style.color = theme.textMuted; e.currentTarget.style.background = 'transparent'; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.8, flexShrink: 0 }}>
              <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
            </svg>
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}

function menuItem(theme) {
  return {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
    padding: '11px 16px', background: 'transparent', border: 'none',
    color: theme.text, cursor: 'pointer', fontSize: 14, fontWeight: 500,
    fontFamily: "'Inter', sans-serif", textAlign: 'left', minHeight: 44,
  };
}
