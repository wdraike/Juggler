import React, { useState, useRef, useEffect } from 'react';
import { Settings, CreditCard, Bug, LogOut } from 'lucide-react';
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
              <Settings size={16} style={{ opacity: 0.55, flexShrink: 0 }} />
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
            <CreditCard size={16} style={{ opacity: 0.55, flexShrink: 0 }} />
            Billing
          </button>

          {onReportIssue && (
            <button
              onClick={function() { setIsOpen(false); onReportIssue(); }}
              style={menuItem(theme)}
              onMouseEnter={function(e) { e.currentTarget.style.background = theme.bgHover; }}
              onMouseLeave={function(e) { e.currentTarget.style.background = 'transparent'; }}
            >
              <Bug size={16} style={{ opacity: 0.55, flexShrink: 0 }} />
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
            <LogOut size={16} style={{ opacity: 0.8, flexShrink: 0 }} />
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
