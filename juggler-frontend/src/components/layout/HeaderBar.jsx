/**
 * HeaderBar — AI input, menu buttons, dark mode toggle
 * On mobile: overflow menu hides infrequent buttons behind "..."
 */

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { getTheme, BRAND } from '../../theme/colors';
import { DAY_NAMES } from '../../state/constants';
import { formatDateKey } from '../../scheduler/dateHelpers';
import usePlanInfo from '../../hooks/usePlanInfo';
import { getTimezoneAbbr } from '../../utils/timezone';
import PlanUsagePanel from '../billing/PlanUsagePanel';
import FeedbackButton from '../feedback/FeedbackButton';
import FeedbackDialog from '../feedback/FeedbackDialog';
import HealthDot from './HealthDot';

import { services, homeUrl } from '../../proxy-config';
var BILLING_URL = services.billing.frontend;

export default function HeaderBar({ darkMode, setDarkMode, saving, selectedDateKey, statuses, tasksByDate, onShowSettings, onShowExport, onShowGCalSync, gcalSyncing, onShowMsftCalSync, msftCalSyncing, calSyncing, calSyncProgress, schedulerRunning, onShowCalSync, onShowHelp, onAddTask, isMobile, isCompact, aiPanel, weekStripDates, selectedDate, dayOffset, setDayOffset, today, activeTimezone, tzSource, onManageDisabled }) {
  // `isCompact` collapses the right-button bank into an overflow menu and
  // hides the inline week strip — same pattern as mobile, triggered earlier
  // so tablet/narrow-laptop widths don't cram every header element onto
  // one unreadable row. Pure mobile styling (fonts, paddings, small logo)
  // stays tied to `isMobile`.
  var useOverflow = isMobile || isCompact;
  var theme = getTheme(darkMode);
  var { user, logout } = useAuth();
  var [showOverflow, setShowOverflow] = useState(false);
  var [showPlanPanel, setShowPlanPanel] = useState(false);
  var [showFeedback, setShowFeedback] = useState(false);
  var planPanelRef = useRef(null);
  var overflowRef = useRef(null);
  var { planName, usageSummary, trialInfo, loading: planLoading, hasSubscription, disabledItems } = usePlanInfo();

  // Close plan panel on outside click
  useEffect(function() {
    if (!showPlanPanel) return;
    function handleClick(e) {
      if (planPanelRef.current && !planPanelRef.current.contains(e.target)) setShowPlanPanel(false);
    }
    document.addEventListener('mousedown', handleClick);
    return function() { document.removeEventListener('mousedown', handleClick); };
  }, [showPlanPanel]);

  // Close overflow on outside click
  useEffect(function() {
    if (!showOverflow) return;
    function handleClick(e) {
      if (overflowRef.current && !overflowRef.current.contains(e.target)) setShowOverflow(false);
    }
    document.addEventListener('mousedown', handleClick);
    return function() { document.removeEventListener('mousedown', handleClick); };
  }, [showOverflow]);

  // Overflow menu items — shown at mobile AND tablet-ish widths
  var overflowItems = [];
  if (useOverflow) {
    overflowItems.push({ label: 'Settings', icon: '\u2699\uFE0F', onClick: onShowSettings });
    overflowItems.push({ label: 'Import/Export', icon: '\uD83D\uDCE6', onClick: onShowExport });
    if (onShowCalSync || onShowGCalSync || onShowMsftCalSync) overflowItems.push({ label: 'Calendar Sync', icon: '\uD83D\uDCC5', onClick: onShowCalSync || onShowGCalSync || onShowMsftCalSync });
    if (onShowHelp) overflowItems.push({ label: 'Help', icon: '\u2753', onClick: onShowHelp });
    overflowItems.push({ label: 'Report Issue', icon: '\uD83D\uDC1B', onClick: function() { setShowFeedback(true); } });
    overflowItems.push({ label: (planName || 'Free') + ' Plan', icon: '\uD83D\uDCB3', onClick: function() { setShowPlanPanel(function(v) { return !v; }); } });
    overflowItems.push({ label: darkMode ? 'Light Mode' : 'Dark Mode', icon: darkMode ? '\u2600\uFE0F' : '\uD83C\uDF19', onClick: function() { setDarkMode(function(d) { return !d; }); } });
    if (user) overflowItems.push({ label: 'Sign Out', icon: '\uD83D\uDEAA', onClick: logout });
  }

  return (
    <>
    {(gcalSyncing || schedulerRunning) && <style>{`@keyframes gcal-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } @keyframes sched-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.7); } }`}</style>}
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: isMobile ? 6 : 12,
      padding: isMobile ? '6px 8px' : '8px 16px',
      background: theme.headerBg, borderBottom: '2px solid ' + theme.accent + '4D',
      position: 'sticky', top: 0, zIndex: 300, overflowX: 'auto'
    }}>
      <a href={homeUrl} style={{ textDecoration: 'none', display: 'inline-flex' }}>
      {!isMobile && <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '4px 10px', borderLeft: '2px solid ' + theme.accent }}>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 8, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: theme.accent, opacity: 0.7 }}>by Raike &amp; Sons</div>
        <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 20, color: theme.headerText, letterSpacing: '-0.02em', lineHeight: 1.1 }}>Strive<span style={{ color: theme.accent }}>RS</span></div>
      </div>}
      {isMobile && <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0, padding: '2px 6px', borderLeft: '2px solid ' + theme.accent }}>
        <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 6, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: theme.accent, opacity: 0.7 }}>R&amp;S</div>
        <div style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 15, color: theme.headerText, letterSpacing: '-0.02em', lineHeight: 1.1 }}>Strive<span style={{ color: theme.accent }}>RS</span></div>
      </div>}
      </a>

      {/* AI command input — inline in header */}
      {aiPanel}

      {/* Inline week strip — fills the gap between AI input and action buttons */}
      {!useOverflow && weekStripDates && (function() {
        var todayKey = formatDateKey(today);
        var SHORT_DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
        var dateInputValue = selectedDate.getFullYear() + '-' +
          String(selectedDate.getMonth() + 1).padStart(2, '0') + '-' +
          String(selectedDate.getDate()).padStart(2, '0');
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, justifyContent: 'center' }}>
            <button onClick={function() { setDayOffset(function(d) { return d - 7; }); }} style={weekNavBtn(theme)} title="Previous week">&laquo;</button>
            <button onClick={function() { setDayOffset(function(d) { return d - 1; }); }} style={weekNavBtn(theme)} title="Previous day">&lsaquo;</button>
            {weekStripDates.map(function(d, i) {
              var key = formatDateKey(d);
              var isSelected = d.getTime() === selectedDate.getTime();
              var isToday = key === todayKey;
              var dayTasks = tasksByDate[key] || [];
              var doneCount = dayTasks.filter(function(t) { return statuses[t.id] === 'done'; }).length;
              var totalCount = dayTasks.length;
              return (
                <button key={i} onClick={function() { setDayOffset(Math.round((d - today) / 86400000)); }}
                  title={DAY_NAMES[d.getDay()] + ' ' + (d.getMonth()+1) + '/' + d.getDate() + (totalCount > 0 ? ' (' + doneCount + '/' + totalCount + ')' : '')}
                  style={{
                    border: 'none', borderRadius: 2, padding: '2px 6px', cursor: 'pointer',
                    background: isSelected ? theme.accent : 'transparent',
                    color: isSelected ? BRAND.navy : isToday ? BRAND.goldLight : theme.headerTextMuted,
                    fontWeight: isSelected || isToday ? 700 : 400,
                    fontSize: 11, fontFamily: "'Inter', sans-serif", textAlign: 'center',
                    minWidth: 36, lineHeight: 1.2
                  }}>
                  <div style={{ fontSize: 9, opacity: 0.6 }}>{DAY_NAMES[d.getDay()]}</div>
                  <div>{d.getDate()}</div>
                  {totalCount > 0 && (
                    <div style={{ fontSize: 7, opacity: 0.5 }}>{doneCount}/{totalCount}</div>
                  )}
                </button>
              );
            })}
            <button onClick={function() { setDayOffset(function(d) { return d + 1; }); }} style={weekNavBtn(theme)} title="Next day">&rsaquo;</button>
            <button onClick={function() { setDayOffset(function(d) { return d + 7; }); }} style={weekNavBtn(theme)} title="Next week">&raquo;</button>
            <input type="date" value={dateInputValue} onChange={function(e) {
              var parts = e.target.value.split('-');
              var d2 = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
              d2.setHours(0, 0, 0, 0);
              if (!isNaN(d2)) setDayOffset(Math.round((d2 - today) / 86400000));
            }} style={{
              padding: '2px 3px', borderRadius: 2, fontSize: 10,
              border: '1px solid ' + theme.headerTrack,
              background: theme.headerTrack, color: theme.headerTextMuted,
              cursor: 'pointer', fontFamily: "'Inter', sans-serif"
            }} title="Jump to any date" />
            <button onClick={function() { setDayOffset(0); }} style={{
              ...weekNavBtn(theme), fontSize: 10, padding: '3px 8px', fontWeight: 600
            }} title="Go to today">Today</button>
          </div>
        );
      })()}

      <div style={{ display: 'flex', alignItems: 'center', gap: 'inherit', flexShrink: 0, ...(useOverflow ? { marginLeft: 'auto' } : {}) }}>
        {/* Backend health dot (#35). Polls /api/health/detailed every 60s
            and shows a colored indicator + popover with per-service status. */}
        <HealthDot darkMode={darkMode} theme={theme} />
        {saving && <span style={{ fontSize: 11, color: theme.textMuted }}>Saving...</span>}
        {schedulerRunning && (
          <span title="Scheduler is running" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: theme.textMuted }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: theme.accent, animation: 'sched-pulse 1s ease-in-out infinite',
              boxShadow: '0 0 6px ' + theme.accent
            }} />
            {!isMobile && <span>Scheduling...</span>}
          </span>
        )}

        {onAddTask && <button onClick={onAddTask} style={{ ...btnStyle(theme, isMobile), fontSize: 20, fontWeight: 700, color: '#2D6A4F' }} title="Add task">+</button>}

        {/* Desktop: show all buttons inline */}
        {!useOverflow && (
          <>
            <button onClick={onShowSettings} style={btnStyle(theme, isMobile)} title="Settings — locations, tools, templates, and preferences">&#x2699;&#xFE0F;</button>
            <button onClick={onShowExport} style={btnStyle(theme, isMobile)} title="Import/Export — save or load tasks as JSON">&#x1F4E6;</button>
            {(onShowGCalSync || onShowMsftCalSync) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {(function() {
                  var syncProvider = calSyncing && calSyncProgress && calSyncProgress.provider;
                  var syncIcon = syncProvider === 'gcal' ? 'G'
                    : syncProvider === 'msft' ? 'M'
                    : syncProvider === 'apple' ? '\uD83C\uDF4E'
                    : '\uD83D\uDCC5';
                  var iconColor = syncProvider === 'gcal' ? '#4285F4'
                    : syncProvider === 'msft' ? '#00A4EF'
                    : syncProvider === 'apple' ? '#A3AAAE'
                    : undefined;
                  var provLabel = syncProvider === 'gcal' ? 'Google' : syncProvider === 'msft' ? 'Microsoft' : syncProvider === 'apple' ? 'Apple' : '';
                  var tipText = calSyncing && calSyncProgress
                    ? provLabel + ': ' + (calSyncProgress.detail || 'Syncing...') + ' (' + (calSyncProgress.pct || 0) + '%)'
                    : 'Calendar Sync';
                  return (
                    <button onClick={onShowCalSync || onShowGCalSync || onShowMsftCalSync} style={{ ...btnStyle(theme, isMobile), position: 'relative' }} title={tipText}>
                      <span style={Object.assign(
                        { fontWeight: iconColor ? 700 : undefined, color: iconColor || undefined },
                        calSyncing ? { display: 'inline-block', animation: 'gcal-spin 1s linear infinite' } : {}
                      )}>{syncIcon}</span>
                      {calSyncing && <span style={{ position: 'absolute', top: -2, right: -2, width: 6, height: 6, borderRadius: '50%', background: iconColor || theme.accent }} />}
                    </button>
                  );
                })()}
                {calSyncing && !isMobile && (
                  <span style={{ fontSize: 10, color: theme.headerText, opacity: 0.7, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {calSyncProgress && calSyncProgress.detail || 'Syncing...'}
                  </span>
                )}
              </div>
            )}
            {onShowHelp && <button onClick={onShowHelp} style={btnStyle(theme, isMobile)} title="Help guide — how the scheduler works, task properties, keyboard shortcuts">&#x2753;</button>}
            <FeedbackButton darkMode={darkMode} theme={theme} isMobile={isMobile} />
            {hasSubscription && (
            <div ref={planPanelRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={function() { setShowPlanPanel(function(v) { return !v; }); }} style={{ ...btnStyle(theme, isMobile), position: 'relative' }} title={'Plan: ' + (planName || 'Free')}>
                &#x1F4B3;
                {usageSummary.some(function(u) { return u.nearLimit || u.atLimit; }) && (
                  <span style={{ position: 'absolute', top: -1, right: -1, width: 7, height: 7, borderRadius: '50%', background: usageSummary.some(function(u) { return u.atLimit; }) ? '#C62828' : '#E65100' }} />
                )}
              </button>
              {showPlanPanel && <PlanUsagePanel planName={planName} usageSummary={usageSummary} trialInfo={trialInfo} loading={planLoading} theme={theme} onClose={function() { setShowPlanPanel(false); }} disabledItems={disabledItems} onManageDisabled={onManageDisabled} />}
            </div>
            )}
            {activeTimezone && (
              <span title={activeTimezone + ' (' + (tzSource || 'auto') + ')'}
                style={{
                  fontSize: 10, fontWeight: 600, color: theme.headerTextMuted,
                  background: theme.headerBg, border: '1px solid ' + (theme.headerBorder || theme.border),
                  borderRadius: 3, padding: '2px 5px', letterSpacing: '0.04em',
                  cursor: 'default', whiteSpace: 'nowrap'
                }}>
                {getTimezoneAbbr(activeTimezone)}
              </span>
            )}
            <button onClick={() => setDarkMode(d => !d)} style={btnStyle(theme, isMobile)} title="Toggle dark mode">
              {darkMode ? '\u2600\uFE0F' : '\uD83C\uDF19'}
            </button>
            {user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {user.picture && (
                  <img src={user.picture} alt="" style={{ width: 24, height: 24, borderRadius: 12 }} />
                )}
                <button onClick={logout} title="Sign out of your account" style={{
                  ...btnStyle(theme, isMobile), fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
                  transition: 'color 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#8B2635'}
                onMouseLeave={e => e.currentTarget.style.color = theme.headerTextMuted}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
                  </svg>
                  Sign Out
                </button>
              </div>
            )}
          </>
        )}

        {/* Compact (mobile + tablet-narrow): overflow menu button */}
        {useOverflow && (
          <div ref={overflowRef} style={{ position: 'relative' }}>
            <button onClick={function() { setShowOverflow(function(v) { return !v; }); }} style={{ ...btnStyle(theme, isMobile), fontSize: 18, fontWeight: 700 }} title="More options">
              &#x22EF;
            </button>
            {showOverflow && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 4,
                background: theme.bgSecondary, border: '1px solid ' + theme.border,
                borderRadius: 2, boxShadow: '0 2px 8px ' + theme.shadow,
                zIndex: 200, minWidth: 180, overflow: 'hidden'
              }}>
                {user && user.picture && (
                  <div style={{ padding: '8px 14px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <img src={user.picture} alt="" style={{ width: 24, height: 24, borderRadius: 12 }} />
                    <span style={{ fontSize: 12, color: theme.textMuted }}>{user.name || user.email || ''}</span>
                  </div>
                )}
                {overflowItems.map(function(item, i) {
                  return (
                    <button key={i} onClick={function() { if (item.disabled) return; setShowOverflow(false); item.onClick(); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        border: 'none', background: 'transparent', cursor: item.disabled ? 'default' : 'pointer',
                        padding: '12px 14px', fontSize: 14, color: item.disabled ? theme.textMuted : theme.text,
                        fontFamily: 'inherit', textAlign: 'left',
                        minHeight: 44, opacity: item.disabled ? 0.6 : 1,
                        borderTop: i === 0 && !(user && user.picture) ? 'none' : undefined
                      }}>
                      <span style={{ fontSize: 16, width: 24, textAlign: 'center' }}>{item.icon}</span>
                      {item.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    {showFeedback && (
      <FeedbackDialog
        open={showFeedback}
        onClose={function() { setShowFeedback(false); }}
        darkMode={darkMode}
        theme={theme}
      />
    )}
    </>
  );
}

function btnStyle(theme, isMobile) {
  return {
    border: 'none', background: 'transparent', cursor: 'pointer',
    color: theme.headerTextMuted, fontSize: 16,
    padding: isMobile ? '8px' : '4px 6px',
    borderRadius: 2, fontFamily: "'Inter', sans-serif",
    minWidth: isMobile ? 36 : undefined,
    minHeight: isMobile ? 36 : undefined
  };
}

function weekNavBtn(theme) {
  return {
    border: '1px solid ' + theme.headerTrack, borderRadius: 2, background: 'transparent',
    color: theme.headerTextMuted, cursor: 'pointer',
    padding: '3px 6px', fontSize: 14, fontFamily: "'Inter', sans-serif", fontWeight: 600,
    minHeight: 28, minWidth: 24,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  };
}
