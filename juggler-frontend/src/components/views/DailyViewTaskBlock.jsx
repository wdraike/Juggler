/**
 * DailyViewTaskBlock — the scheduled task tile (TaskBlock) extracted
 * verbatim from DailyView.jsx (999.965 JUG-PERF-FE-GOD-COMPONENTS split,
 * WBS W4). No logic changes — see TRACEABILITY.md B3.
 */

import React, { useState, useRef } from 'react';
import { PRI_COLORS, WHEN_TAG_ICONS, DEFAULT_TOOLS, PAST_OPACITY, locIcon } from '../../state/constants';
import { isTerminalStatus } from '../../shared/task-status';
import { formatDateKey } from '../../scheduler/dateHelpers';
import { hasWeatherRestrictions, checkWeatherMatch } from '../../utils/weatherMatch';
import { isTaskOverdue } from '../../utils/overdue';
import { parseWhen } from '../../scheduler/timeBlockHelpers';
import { getTaskIcon } from '../../utils/taskIcon';
import StatusToggle from '../schedule/StatusToggle';
import FixedPopup from './DailyViewPopup';
import { minsToTime, durLabel, tileBg, getStatusReason } from './dailyViewHelpers';

/* ── Reactive task block — shows more info as height increases ── */
export default function TaskBlock({ item, status, top, height, col, totalCols, onExpand, onStatusChange, onDelete, theme, darkMode, isMobile, isBlocked, canDrag, gutterW, hourHeight, weatherDay }) {
  var t = item.task || item;
  var priColor = PRI_COLORS[t.pri] || PRI_COLORS.P3;
  var isDone = isTerminalStatus(status);
  // juggler-cal-history Plan E — past-fade (D-10).
  var dvTodayKey = formatDateKey(new Date());
  var isPast = !!t.scheduledAt && formatDateKey(new Date(t.scheduledAt)) < dvTodayKey;
  var weatherResult = hasWeatherRestrictions(t) ? checkWeatherMatch(t, weatherDay) : null;
  var isOverdue = isTaskOverdue(t, isDone);
  var [show, setShow] = useState(false);
  var innerRef = useRef(null);
  var [mousePos, setMousePos] = useState(null);
  var [cardRect, setCardRect] = useState(null);

  function onEnter(e) { setShow(true); setMousePos({ x: e.clientX, y: e.clientY }); if (innerRef.current) setCardRect(innerRef.current.getBoundingClientRect()); }
  function onMove(e) { setMousePos({ x: e.clientX, y: e.clientY }); }
  function onLeave() { setShow(false); setMousePos(null); setCardRect(null); }
  function onFocusIn(e) { setShow(true); if (innerRef.current) { var r = innerRef.current.getBoundingClientRect(); setMousePos({ x: r.left + r.width / 2, y: r.top }); setCardRect(r); } }
  function onFocusOut() { setShow(false); setMousePos(null); setCardRect(null); }

  var gutterRight = 8;
  var colWidth = totalCols > 1 ? 'calc((100% - ' + gutterW + 'px - ' + gutterRight + 'px) / ' + totalCols + ')' : undefined;
  var colLeft = totalCols > 1
    ? 'calc(' + gutterW + 'px + ' + col + ' * (100% - ' + gutterW + 'px - ' + gutterRight + 'px) / ' + totalCols + ')'
    : gutterW;

  var locIcons = (t.location || []).map(function (l) { return locIcon(l); }).filter(Boolean);
  var isFixed = t.placementMode === 'fixed' || t.placement_mode === 'fixed'; // 999.1241: legacy fixed/rigid pruned
  var isMarker = !!t.marker;
  // sched-audit REG-44/F3 (calLocked, David's Q8) — calendar-born tasks show a lock
  // glyph and can't be dragged; WhenSection.jsx:251 is the precedent for the flag.
  var isCalLocked = !!t.calLocked;
  var isWhenRelaxed = !!item._whenRelaxed;

  // Start–end time range anchored to the title row. Most-scanned field after
  // the title itself, so it's always visible when the card renders at all.
  // Fall back to start+dur when item.end isn't set — placements from the
  // scheduler only carry { start, dur }, so the end must be derived.
  var endMin = (item.end != null)
    ? item.end
    : (item.start != null && item.dur != null ? item.start + item.dur : null);
  var timeRange = item.start != null
    ? (minsToTime(item.start) + (endMin != null ? '\u2013' + minsToTime(endMin) : ''))
    : null;

  // Icon maps for the flow area.
  var TOOL_ICON_MAP = React.useMemo(function() {
    var m = {};
    (DEFAULT_TOOLS || []).forEach(function(tool) { m[tool.id] = tool.icon; });
    return m;
  }, []);
  var whenIcons = (function() {
    if (!t.when || t.when === 'anytime' || isWhenRelaxed) return '';
    var wp = parseWhen(t.when);
    return wp.map(function(w) { return WHEN_TAG_ICONS[w] || ''; }).filter(Boolean).join('');
  })();
  var toolIcons = (t.tools || []).map(function(tid) { return TOOL_ICON_MAP[tid] || ''; }).filter(Boolean).join(' ');

  // Preferred-time mismatch: recurring task scheduler-moved away from user's
  // preferred time — tell the user so the displaced placement doesn't surprise.
  var startLabel = item.start != null ? minsToTime(item.start) : null;
  var preferredMismatch = (t.recurring && t.time && startLabel && t.time !== startLabel)
    ? ('Preferred: ' + t.time)
    : null;

  // Build flow items in priority order. Each entry is { key, node }; nulls
  // are filtered out, and separators are inserted between non-null entries
  // during render so spacing stays consistent regardless of which items fire.
  var typeBadgeText = (
    (t.datePinned ? '\uD83D\uDCCD' : '') +
    (isFixed && !isMarker ? '\uD83D\uDCCC' : '') +
    (t.recurring ? '\uD83D\uDD01' : '') +
    (item.splitTotal > 1 ? '\u2702\uFE0F' : '')
  );
  var depCount = (t.dependsOn && t.dependsOn.length) || 0;
  var slackMins = (t.slackMins != null && t.slackMins < 1e9) ? t.slackMins : null;
  var notesSnippet = t.notes ? (t.notes.length > 60 ? t.notes.slice(0, 60) + '\u2026' : t.notes) : null;
  var placementReason = item._moveReason
    ? ('\u2192 ' + item._moveReason)
    : (item.placementReason || item._placementReason || null);

  return (
    <div
      draggable={!!canDrag && !isCalLocked}
      onDragStart={(canDrag && !isCalLocked) ? function (e) { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
      style={{
        position: 'absolute', top: top,
        left: colLeft, width: colWidth || undefined,
        right: totalCols > 1 ? undefined : gutterRight,
        height: Math.max(height, 18), zIndex: show ? 20 : 10
      }}
    >
      <div
        ref={innerRef}
        tabIndex={0}
        role="button"
        onClick={function (e) { e.stopPropagation(); onExpand(t.id); }}
        onMouseEnter={onEnter} onMouseMove={onMove} onMouseLeave={onLeave}
        onFocus={onFocusIn} onBlur={onFocusOut}
        onKeyDown={function (e) { if (e.key === 'Enter') { e.stopPropagation(); onExpand(t.id); } }}
        style={{
          height: '100%', boxSizing: 'border-box',
          position: 'relative',
          borderLeft: '3px solid ' + priColor,
          border: isOverdue
            ? ('2px solid ' + theme.error)
            : ('1px ' + (isMarker ? 'dotted' : (t.recurring ? 'dashed' : 'solid')) + ' ' + (isDone ? theme.border : (isMarker ? '#4338CA40' : priColor + '30'))),
          borderLeftWidth: 3,
          borderLeftColor: isOverdue ? theme.error : (isWhenRelaxed ? '#C8942A' : (isMarker ? '#4338CA' : priColor)),
          borderRadius: 5,
          background: tileBg(t, darkMode, show, theme),
          padding: height >= 42 ? '3px 6px' : '2px 6px',
          // sched-audit L3 bird WARN-2 — cursor must reflect actual drag
          // gating: draggable is `!!canDrag && !isCalLocked` (above), so the
          // cursor affordance has to check isCalLocked too, not just canDrag.
          cursor: isCalLocked ? 'not-allowed' : (canDrag ? 'grab' : 'pointer'),
          overflow: 'hidden',
          outline: show ? '2px solid ' + theme.accent : 'none',
          outlineOffset: -1,
          boxShadow: '0 1px 3px ' + theme.shadow,
          transition: 'background 0.1s, box-shadow 0.1s',
          opacity: (isDone && isPast) ? PAST_OPACITY : (isDone ? 0.5 : (isMarker ? 0.65 : 1))
        }}
      >
        {isOverdue && (
          <div style={{
            position: 'absolute', top: -1, left: -1,
            background: theme.error, color: '#FDFAF5',
            fontSize: 8, fontWeight: 700, padding: '1px 4px',
            borderRadius: '4px 0 4px 0', letterSpacing: 0.3,
            zIndex: 2, pointerEvents: 'none'
          }} title="This task's scheduled window has passed — mark done/skip or reschedule.">
            {'\u26A0'} OVERDUE
          </div>
        )}
        {/* Title row: prefix + title + time (flex-shrinking left group) |
            inline flow of interactive items (flex-shrinking, overflow clipped) |
            project + priority (right-anchored, never shrinks). */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          overflow: 'hidden', minWidth: 0
        }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 4,
            flex: '1 1 auto', minWidth: 0, overflow: 'hidden',
            fontSize: isMobile ? 10 : 11,
            color: isDone ? theme.textMuted : theme.text,
            lineHeight: 1.3
          }}>
            {isMarker && <span style={{ fontSize: 9, flexShrink: 0, opacity: 0.7 }}>{'\u25C7'}</span>}
            {status === 'done' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u2713'}</span>}
            {status === 'skip' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u23ED'}</span>}
            {status === 'cancel' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u2717'}</span>}
            {status === 'cancelled' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u2717'}</span>}
            {status === 'pause' && <span style={{ fontSize: 9, flexShrink: 0 }}>{'\u23F8'}</span>}
            {weatherResult && (
              <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, flexShrink: 0 }}
                title={weatherResult.ok === false ? weatherResult.reason : 'Forecast OK'}>
                <span style={{ fontSize: 10, filter: weatherResult.ok ? 'drop-shadow(0 0 2px #2D9E6B88)' : 'none' }}>{'\u26c5'}</span>
                {weatherResult.ok === false && (
                  <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#e05252', textShadow: '0 0 3px #1a1a1a', lineHeight: 1, pointerEvents: 'none' }}>{'\u2298'}</span>
                )}
              </span>
            )}
            <span style={{
              fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', textDecoration: (isDone && status !== 'pause') ? 'line-through' : 'none'
            }}>
              {(function(){ var ic = getTaskIcon(t.text); return ic ? <span style={{marginRight:2,flexShrink:0}}>{ic}</span> : null; })()}{t.text}
            </span>
            {timeRange && (
              <span style={{ fontSize: 9, color: theme.textMuted, flexShrink: 0, fontWeight: 500 }}>
                {timeRange}
              </span>
            )}
          </div>
          {/* Inline flow: interactive + compact items flow right after the
              title when width allows. When the title is long enough to consume
              the space, this group shrinks to zero and nothing shows — no
              partial clipping. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            flex: '0 1 auto', minWidth: 0, overflow: 'hidden',
            fontSize: 9, color: theme.textMuted
          }}>
            {onStatusChange && (
              <span onClick={function(e) { e.stopPropagation(); }} style={{ display: 'inline-flex', flexShrink: 0 }}>
                <StatusToggle value={status} onChange={onStatusChange} onDelete={onDelete ? function() { onDelete(t.id); } : null} darkMode={darkMode} compact disableTerminal={!t.scheduledAt} />
              </span>
            )}
            {t.dur > 0 && (
              <span style={{
                fontSize: 8, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap',
                color: theme.badgeText, background: theme.badgeBg,
                borderRadius: 3, padding: '0 4px'
              }}>{durLabel(t.dur)}</span>
            )}
            {isBlocked && <span title="Blocked" style={{ fontSize: 10, flexShrink: 0 }}>{'\uD83D\uDEAB'}</span>}
            {isCalLocked && <span role="img" aria-label="Calendar-locked \u2014 cannot be dragged" title="Calendar-locked \u2014 cannot be dragged" style={{ fontSize: 10, flexShrink: 0 }}>{'\uD83D\uDD12'}</span>}
            {typeBadgeText && <span style={{ fontSize: 10, flexShrink: 0, whiteSpace: 'nowrap' }}>{typeBadgeText}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {t.project && (
              <span style={{
                fontSize: 8, fontWeight: 600,
                background: theme.projectBadgeBg, color: theme.projectBadgeText,
                borderRadius: 3, padding: '0 4px', whiteSpace: 'nowrap'
              }}>{t.project}</span>
            )}
            {t.pri && (
              <span title={'Priority ' + t.pri} style={{
                fontSize: 8, fontWeight: 700, color: priColor,
                background: priColor + '18', borderRadius: 3, padding: '0 3px'
              }}>{t.pri}</span>
            )}
          </div>
        </div>

        {/* Flow area: everything else in priority order. Only renders when
            the card is tall enough for a FULL second line — below that
            threshold, partial rendering shows as clipped content (bad UX),
            so we hide it entirely and rely on the title row alone. */}
        {height >= 36 && (function() {
          // Interactive items (status toggle, dur, blocked, type badges)
          // render inline on the title row above — don't duplicate here.
          // This row holds the reference/meta items: deadline, location, when,
          // tools, deps, time remaining, notes, scheduler reasons, etc.
          var items = [];
          if (t.deadline) items.push({ key: 'deadline', node: (
            <span style={{
              fontSize: 8, fontWeight: 600,
              color: theme.amberText, background: theme.amberBg,
              borderRadius: 3, padding: '0 4px', whiteSpace: 'nowrap'
            }}>{'\uD83D\uDCC5'} {t.deadline}</span>
          )});
          if (locIcons.length > 0) items.push({ key: 'loc', node: (
            <span style={{ fontSize: 10 }}>{locIcons.join(' ')}</span>
          )});
          if (whenIcons) items.push({ key: 'when', node: (
            <span style={{ fontSize: 10 }}>{whenIcons}</span>
          )});
          if (toolIcons) items.push({ key: 'tools', node: (
            <span style={{ fontSize: 10 }}>{toolIcons}</span>
          )});
          if (depCount > 0) items.push({ key: 'deps', node: (
            <span>{'\u26D3'} {depCount}</span>
          )});
          if (t.timeRemaining != null) items.push({ key: 'remaining', node: (
            <span style={{ fontWeight: 700, color: theme.amberText }}>{t.timeRemaining}m left</span>
          )});
          if (isWhenRelaxed) items.push({ key: 'relaxed', node: (
            <span style={{ color: '#C8942A', fontWeight: 600 }}>~ flexed</span>
          )});
          if (notesSnippet) items.push({ key: 'notes', node: (
            <span style={{ fontStyle: 'italic', opacity: 0.85 }}>{notesSnippet}</span>
          )});
          if (placementReason) items.push({ key: 'move', node: (
            <span style={{ opacity: 0.8 }}>{placementReason}</span>
          )});
          if (preferredMismatch) items.push({ key: 'pref', node: (
            <span style={{ opacity: 0.8 }}>{preferredMismatch}</span>
          )});
          if (slackMins != null) items.push({ key: 'slack', node: (
            <span>slack {slackMins}m</span>
          )});
          if (item.travelBefore > 0) items.push({ key: 'tb', node: (
            <span>+{item.travelBefore}m before</span>
          )});
          if (item.travelAfter > 0) items.push({ key: 'ta', node: (
            <span>+{item.travelAfter}m after</span>
          )});
          if (items.length === 0) return null;
          return (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
              marginTop: 2, fontSize: 9, color: theme.textMuted,
              overflow: 'hidden', lineHeight: 1.4
            }}>
              {items.map(function(it, i) {
                return (
                  <React.Fragment key={it.key}>
                    {i > 0 && <span style={{ color: theme.border, userSelect: 'none' }}>{'\u00B7'}</span>}
                    {it.node}
                  </React.Fragment>
                );
              })}
            </div>
          );
        })()}
      </div>
      {show && <FixedPopup mousePos={mousePos} item={item} status={status} theme={theme} darkMode={darkMode} cardRect={cardRect} completedAt={item.task?.completedAt} statusReason={getStatusReason(item.task, status)} />}
      {/* Travel buffer zones — hatched strips above/below the task card */}
      {item.travelBefore > 0 && hourHeight > 0 && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, right: 0,
          height: (item.travelBefore / 60) * hourHeight,
          background: 'repeating-linear-gradient(45deg, transparent, transparent 3px, ' + priColor + '18 3px, ' + priColor + '18 5px)',
          borderRadius: '4px 4px 0 0',
          borderLeft: '3px solid ' + priColor + '40',
          pointerEvents: 'none'
        }} />
      )}
      {item.travelAfter > 0 && hourHeight > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          height: (item.travelAfter / 60) * hourHeight,
          background: 'repeating-linear-gradient(45deg, transparent, transparent 3px, ' + priColor + '18 3px, ' + priColor + '18 5px)',
          borderRadius: '0 0 4px 4px',
          borderLeft: '3px solid ' + priColor + '40',
          pointerEvents: 'none'
        }} />
      )}
    </div>
  );
}
