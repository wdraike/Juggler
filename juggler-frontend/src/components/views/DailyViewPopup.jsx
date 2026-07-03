/**
 * DailyViewPopup — the hover/focus popup card (FixedPopup) extracted
 * verbatim from DailyView.jsx (999.965 JUG-PERF-FE-GOD-COMPONENTS split,
 * WBS W3). No logic changes — see TRACEABILITY.md B2.
 */

import React from 'react';
import ReactDOM from 'react-dom';
import { PRI_COLORS, STATUS_MAP, locIcon } from '../../state/constants';
import { isTerminalStatus } from '../../shared/task-status';
import { getTaskIcon } from '../../utils/taskIcon';
import { minsToTime, durLabel, labelForStatus, formatCompletedAt } from './dailyViewHelpers';

/* ── Popup card rendered via portal ── */
export default function FixedPopup({ mousePos, item, status, theme, darkMode, cardRect, completedAt, statusReason }) {
  var t = item.task || item;
  var priColor = PRI_COLORS[t.pri] || PRI_COLORS.P3;
  var isDone = isTerminalStatus(status);
  var statusObj = STATUS_MAP[status || ''];
  var locIcons = (t.location || []).map(function (l) { return locIcon(l); }).filter(Boolean);

  if (!mousePos) return null;

  var viewW = window.innerWidth;
  var viewH = window.innerHeight;
  var popW = 240;

  var left;
  if (cardRect && cardRect.right + 8 + popW <= viewW - 8) {
    left = cardRect.right + 8;
  } else if (cardRect) {
    left = Math.max(8, cardRect.left - popW - 8);
  } else {
    left = Math.max(8, Math.min(mousePos.x + 14, viewW - popW - 8));
  }
  var posStyle = { top: Math.min(mousePos.y - 10, viewH - 220) };

  var popup = (
    <div style={Object.assign({
      position: 'fixed', zIndex: 9999,
      left: left,
      background: theme.bgCard,
      border: '1px solid ' + theme.border,
      borderLeft: '3px solid ' + priColor,
      borderRadius: 8,
      boxShadow: '0 8px 24px ' + theme.shadow,
      padding: '8px 10px',
      minWidth: 200, maxWidth: 280,
      pointerEvents: 'none',
      fontSize: 11, lineHeight: 1.4, color: theme.text
    }, posStyle)}>
      <div style={{
        fontWeight: 600, fontSize: 12, marginBottom: 4,
        textDecoration: isDone ? 'line-through' : 'none',
        color: isDone ? theme.textMuted : theme.text
      }}>
        {(function(){ var ic = getTaskIcon(t.text); return ic ? <span style={{marginRight:3,flexShrink:0}}>{ic}</span> : null; })()}{t.text}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {t.pri && (
          <span style={{ fontSize: 9, fontWeight: 700, color: priColor, background: priColor + '18', borderRadius: 3, padding: '0 4px' }}>
            {t.pri}
          </span>
        )}
        {statusObj && statusObj.value && (
          <span style={{
            fontSize: 9, fontWeight: 600, borderRadius: 3, padding: '0 5px',
            background: darkMode ? statusObj.bgDark : statusObj.bg,
            color: darkMode ? statusObj.colorDark : statusObj.color
          }}>
            {statusObj.label} {statusObj.value}
          </span>
        )}
        {t.project && (
          <span style={{
            fontSize: 9, fontWeight: 600,
            background: theme.projectBadgeBg,
            color: theme.projectBadgeText,
            borderRadius: 3, padding: '1px 5px'
          }}>
            {t.project}
          </span>
        )}
        {(t._unplacedTotalDur || t.dur) > 0 && (
          <span style={{ fontSize: 9, color: theme.textMuted }}>{durLabel(t._unplacedTotalDur || t.dur)}</span>
        )}
      </div>
      {item.start != null && (function() {
        var eEnd = (item.end != null)
          ? item.end
          : (item.dur != null ? item.start + item.dur : null);
        return (
          <div style={{ marginTop: 4, fontSize: 10, color: theme.textMuted }}>
            {minsToTime(item.start)}{eEnd != null ? ' – ' + minsToTime(eEnd) : ''}
          </div>
        );
      })()}
      {locIcons.length > 0 && (
        <div style={{ marginTop: 2, fontSize: 10 }}>
          {locIcons.join(' ')} <span style={{ color: theme.textMuted }}>{(t.location || []).join(', ')}</span>
        </div>
      )}
      {t.deadline && (
        <div style={{ marginTop: 2, fontSize: 10, color: theme.amberText }}>
          Deadline {t.deadline}
        </div>
      )}
      {t.notes && (
        <div style={{
          marginTop: 4, fontSize: 10, color: theme.textMuted,
          whiteSpace: 'pre-wrap', maxHeight: 48, overflow: 'hidden',
          borderTop: '1px solid ' + theme.border, paddingTop: 4
        }}>
          {t.notes.length > 120 ? t.notes.slice(0, 120) + '...' : t.notes}
        </div>
      )}
      {completedAt && isDone && (
        <div style={{ marginTop: 4, fontSize: 10, color: theme.textMuted, fontStyle: 'italic' }}>
          {labelForStatus(status)} {formatCompletedAt(completedAt)}
        </div>
      )}
      {statusReason && (
        <div style={{ marginTop: 2, fontSize: 10, color: theme.textMuted }}>
          {statusReason}
        </div>
      )}
    </div>
  );

  return ReactDOM.createPortal(popup, document.body);
}
