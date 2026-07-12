/**
 * ConflictsView — two-tier collapsible tree:
 *   Action Required: overdue, unplaced, data issues
 *   Informational: past scheduled date, blocked by deps, backlog
 * All nodes default to collapsed; state persists in localStorage.
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import TaskCard from '../tasks/TaskCard';
import { getTheme } from '../../theme/colors';
import { getTaskIcon } from '../../utils/taskIcon';
import { formatDateKey } from '../../scheduler/dateHelpers';
import { computeConflictBuckets } from '../../scheduler/conflictBuckets';
import WeatherBadge from '../features/WeatherBadge';
import { labelFor } from '../../scheduler/reasonCodes';

var STORAGE_KEY = 'juggler-issues-collapsed';

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch (e) { return {}; }
}

function saveCollapsed(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { /* quota exceeded */ }
}

export default function ConflictsView({ allTasks, statuses, unplaced, backlog, schedulerWarnings, onStatusChange, onExpand, onUpdateTask, onDelete, darkMode, isMobile, todayDate, weatherByDate }) {
  var theme = getTheme(darkMode);
  var today = todayDate || (function() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
  var todayKey = formatDateKey(today);

  var [collapsed, setCollapsed] = useState(function() {
    var saved = loadCollapsed();
    var defaults = {
      actionGroup: false, infoGroup: true,
      overdue: true, unplaced: true, dataIssues: true,
      blocked: true, unscheduled: true, stale: true
    };
    return Object.assign(defaults, saved);
  });

  useEffect(function() { saveCollapsed(collapsed); }, [collapsed]);

  var toggle = useCallback(function(key) {
    setCollapsed(function(prev) {
      var next = Object.assign({}, prev);
      next[key] = !prev[key];
      return next;
    });
  }, []);

  // Single source of truth shared with the Issues-tab badge (999.862) — see
  // scheduler/conflictBuckets.js. The badge and this page consume the identical
  // computation, so they can never disagree on what counts as an issue.
  var issues = useMemo(
    () => computeConflictBuckets({ allTasks, statuses, unplaced, backlog, schedulerWarnings, today }),
    [allTasks, statuses, unplaced, backlog, schedulerWarnings, today]
  );

  var warnings = issues.warnings;

  var actionSections = [
    {
      key: 'overdue', title: 'Overdue', tasks: issues.overdue, color: theme.redText,
      empty: 'All clear — nothing is overdue.',
      tip: 'Tasks past their due date/time that aren\'t done',
      help: 'These tasks are past their due date/time and still open — including calendar events and recurring instances whose date has already passed. They stay pinned on the calendar at their original time, flagged overdue. Mark them done, reschedule to a new date, or cancel them.'
    },
    {
      // sched-audit L3 ernie BLOCK (l3-ernie-1) — use the deduped
      // issues.unplacedForDisplay (not the raw `unplaced` prop) so a row that is
      // BOTH overdue and unplaced renders ONCE, under Overdue (the canonical
      // bucket for a dual-shape row per conflictBuckets.js), keeping this page's
      // count and rendered rows in agreement with the badge (999.862 invariant).
      key: 'unplaced', title: 'Unscheduled', tasks: issues.unplacedForDisplay, color: theme.amberText,
      empty: 'All clear — the scheduler found a slot for every task.',
      tip: 'Tasks the scheduler couldn\'t fit into any available time slot',
      help: 'The scheduler tried to place these tasks but ran out of room. Common causes: the day is too full, time window constraints are too narrow, a non-splittable task is too long for any available gap, or no suitable weather window exists within the 14-day horizon. Try shortening the task, enabling splitting, relaxing the time window, adjusting weather conditions, or moving other tasks to free up space.'
    },
  ];

  var infoSections = [
    {
      key: 'stale', title: 'Past Scheduled Date', tasks: issues.stale, color: theme.amberText,
      empty: 'All clear — nothing is lingering past its scheduled date.',
      tip: 'Tasks whose scheduled date has passed but have no hard deadline',
      help: "These tasks have a past scheduled date and no hard deadline. Flexible tasks roll forward on the next scheduler run; fixed-time tasks and calendar-linked events stay pinned at their original date. Reschedule manually when you're ready."
    },
    {
      key: 'blocked', title: 'Blocked by Dependencies', tasks: issues.blocked, color: theme.purpleText,
      empty: 'All clear — no tasks are waiting on prerequisites.',
      tip: 'Tasks waiting on other tasks to be done first',
      help: 'These tasks depend on other tasks that aren\'t done yet. They\'ll become schedulable once their prerequisites are done.'
    },
    {
      key: 'unscheduled', title: 'Backlog (no date)', tasks: backlog || [], color: theme.muted2,
      empty: 'Backlog is empty — every task has a date.',
      tip: 'Tasks with no date assigned — not on the schedule yet',
      help: 'These tasks have no date set, so they don\'t appear on the schedule. This is normal for backlog items. Assign a date when you\'re ready to work on them.'
    },
  ];

  var actionCount = actionSections.reduce(function(s, sec) { return s + sec.tasks.length; }, 0) + warnings.length;
  var infoCount = infoSections.reduce(function(s, sec) { return s + sec.tasks.length; }, 0);

  var helpStyle = { fontSize: 11, color: theme.textMuted, padding: '2px 0 6px 0', lineHeight: 1.4 };
  var sugBtnStyle = {
    fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
    border: '1px solid ' + theme.amberBorder, background: theme.amberBg, color: theme.amberText,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap'
  };
  var taskLinkStyle = {
    fontWeight: 500, color: theme.accent, cursor: 'pointer',
    textDecoration: 'underline', textDecorationColor: theme.accent + '60',
    textUnderlineOffset: 2
  };

  function renderToggle(key, isOpen) {
    return (
      <span style={{
        fontSize: 10, color: theme.textMuted, width: 14, textAlign: 'center',
        transition: 'transform 0.15s',
        transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
        display: 'inline-block', flexShrink: 0
      }}>{'\u25B6'}</span>
    );
  }

  function renderTaskSection(sec) {
    var isOpen = !collapsed[sec.key];
    var count = sec.tasks.length;
    return (
      <div key={sec.key} style={{ marginBottom: 2 }}>
        <button
          onClick={function() { toggle(sec.key); }}
          title={sec.tip}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            padding: '5px 4px', border: 'none', background: 'transparent',
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left'
          }}
        >
          {renderToggle(sec.key, isOpen)}
          <span style={{ fontSize: 12, fontWeight: 600, color: count > 0 ? sec.color : theme.textMuted }}>
            {sec.title}
          </span>
          {count > 0 ? (
            <span style={{
              background: sec.color, color: '#FFF', borderRadius: 8,
              padding: '0 5px', fontSize: 9, fontWeight: 700, lineHeight: '15px',
              minWidth: 16, textAlign: 'center'
            }}>{count}</span>
          ) : (
            <span style={{ fontSize: 10, color: theme.textMuted }}>(0)</span>
          )}
        </button>
        {isOpen && (
          <div style={{ paddingLeft: 18, paddingBottom: 6 }}>
            <div style={helpStyle}>{sec.help}</div>
            {count > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sec.tasks.map(t => (
                  <div key={t.id}>
                    <TaskCard
                      task={t}
                      status={statuses[t.id] || ''}
                      onStatusChange={onStatusChange}
                      onDelete={onDelete ? function(id) { onDelete(id); } : null}
                      onExpand={onExpand}
                      darkMode={darkMode}
                      showDate
                      isMobile={isMobile}
                      allTasks={allTasks} statuses={statuses}
                      todayDate={todayDate}
                    />
                    {/* juggler-issues-split-overdue-collapse (W2) — chunk-count indicator
                        for a collapsed split-occurrence row, Overdue section only (matches
                        the established _unplacedChunkCount badge pattern already used in
                        DailyViewUnschedEntry.jsx for the Unscheduled lane). */}
                    {sec.key === 'overdue' && t._overdueChunkCount > 1 && (
                      <div style={{ fontSize: 9, color: theme.textMuted, padding: '0 8px 2px' }}>
                        {t._overdueChunkCount} chunks overdue
                      </div>
                    )}
                    {/* ernie-info-unplaced-count-indicator-gap fix — matching chunk-count
                        indicator for a collapsed split-occurrence row, Unscheduled section
                        only (same wording convention as DailyViewUnschedEntry.jsx's
                        _unplacedChunkCount badge for the Unscheduled lane). */}
                    {sec.key === 'unplaced' && t._unplacedChunkCount > 1 && (
                      <div style={{ fontSize: 9, color: theme.textMuted, padding: '0 8px 2px' }}>
                        {t._unplacedChunkCount} chunks unplaced
                      </div>
                    )}
                    {/* Every unplaced task shows a reason chip — fall back to no_slot when
                        the backend left it unset (legacy rows; new rows always carry one). */}
                    {(
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px 0', flexWrap: 'wrap' }}>
                        {/* AC4.2 — friendly reason label chip for every reason code */}
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                          background: theme.amberBg,
                          color: theme.amberText,
                          border: '1px solid ' + theme.amberBorder,
                          whiteSpace: 'nowrap'
                        }}>
                          {(t._unplacedReason === 'weather' || t._unplacedReason === 'weather_unavailable') ? '🌤 ' : ''}
                          {labelFor(t._unplacedReason || 'no_slot')}
                        </span>
                        {/* AC4.1 — where/when the instance wanted to be placed */}
                        {(t.date || t.earliestStart || t.when) && (
                          <span style={{ fontSize: 9, color: theme.textMuted, whiteSpace: 'nowrap' }}>
                            {'wanted: '}
                            {(t.date || t.earliestStart) && (
                              <span style={{ fontWeight: 500 }}>{t.date || t.earliestStart}</span>
                            )}
                            {t.when && t.when.trim() !== '' && (
                              <span>{(t.date || t.earliestStart) ? ' · ' : ''}{t.when}</span>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                    {/* AC4.3 — detail string rendered for all reason codes */}
                    {t._unplacedDetail && (
                      <div style={{ fontSize: 10, color: theme.textMuted, padding: '2px 12px', marginTop: -2 }}>
                        <span>{t._unplacedDetail}</span>
                      </div>
                    )}
                    {t._suggestions && t._suggestions.length > 0 && (
                      <div style={{ padding: '2px 12px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {t._suggestions.map(function(sug, si) {
                          var hasAction = sug.action && onUpdateTask;
                          return (
                            <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                              <span style={{ color: '#F59E0B', fontSize: 11 }}>{'\u2192'}</span>
                              <span style={{ color: theme.textSecondary }}>{(function(){ var ic = getTaskIcon(sug.text); return ic ? <span style={{marginRight:2,flexShrink:0}}>{ic}</span> : null; })()}{sug.text}</span>
                              {hasAction && sug.action === 'flexWhen' && !t.flexWhen && (
                                <button onClick={function(e) { e.stopPropagation(); onUpdateTask(t.id, { flexWhen: true }); }}
                                  style={sugBtnStyle}>Enable Flex</button>
                              )}
                              {hasAction && sug.action === 'split' && !t.split && (
                                <button onClick={function(e) { e.stopPropagation(); onUpdateTask(t.id, { split: true, splitMin: 30 }); }}
                                  style={sugBtnStyle}>Enable Split</button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              // 999.1235 (3): per-section state line instead of a bare 'None'.
              <div style={{ fontSize: 12, color: theme.textMuted }}>{sec.empty || 'None'}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderDataIssues() {
    var isOpen = !collapsed.dataIssues;
    var count = warnings.length;
    if (count === 0) return null;
    // Every warning type MUST have a render branch below; KNOWN_DATA_ISSUE_TYPES
    // gates the catch-all so a future/unhandled type never renders as a blank
    // yellow bar (the symptom this list fixes). Keep in sync with the branches.
    var KNOWN_DATA_ISSUE_TYPES = ['backwardsDep', 'fixedOverlap', 'impossibleDayReq',
      'orphanedWhenTag', 'recurringConflict', 'recurring_split_overflow'];
    var dataHelp = 'Conflicting or impossible constraints detected in your task data. The scheduler works around these, but fixing them will improve your schedule.';
    var dataTip = 'Task data that contains conflicting constraints the scheduler had to work around';
    return (
      <div style={{ marginBottom: 2 }}>
        <button
          onClick={function() { toggle('dataIssues'); }}
          title={dataTip}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
            padding: '5px 4px', border: 'none', background: 'transparent',
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left'
          }}
        >
          {renderToggle('dataIssues', isOpen)}
          <span style={{ fontSize: 12, fontWeight: 600, color: '#D97706' }}>
            Data Issues
          </span>
          <span style={{
            background: '#D97706', color: '#FFF', borderRadius: 8,
            padding: '0 5px', fontSize: 9, fontWeight: 700, lineHeight: '15px',
            minWidth: 16, textAlign: 'center'
          }}>{count}</span>
        </button>
        {isOpen && (
          <div style={{ paddingLeft: 18, paddingBottom: 6 }}>
            <div style={helpStyle}>{dataHelp}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {warnings.map((w, i) => {
                var taskA = w.taskId ? allTasks.find(t => t.id === w.taskId) : null;
                var taskB = w.depId ? allTasks.find(t => t.id === w.depId) : (w.taskB ? allTasks.find(t => t.id === w.taskB) : null);
                return (
                  <div key={i} style={{
                    fontSize: 12, padding: '6px 10px', borderRadius: 6,
                    background: theme.amberBg,
                    border: '1px solid #D9770630',
                    color: theme.text
                  }}>
                    {w.type === 'backwardsDep' && (
                      <div>
                        <span style={{ fontWeight: 600 }}>Backwards dependency: </span>
                        <span style={taskLinkStyle} onClick={function() { if (w.taskId && onExpand) onExpand(w.taskId); }} title="Open task details">{taskA ? taskA.text : w.taskId}</span>
                        <span style={{ color: theme.textMuted }}> ({w.taskDate})</span>
                        {' depends on '}
                        <span style={taskLinkStyle} onClick={function() { if (w.depId && onExpand) onExpand(w.depId); }} title="Open task details">{taskB ? taskB.text : w.depId}</span>
                        <span style={{ color: theme.textMuted }}> ({w.depDate})</span>
                        <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
                          This task is scheduled before the task it depends on, so the dependency can't be satisfied. Remove the dependency or move one of the tasks so the dates make sense.
                        </div>
                      </div>
                    )}
                    {w.type === 'fixedOverlap' && (
                      <div>
                        <span style={{ fontWeight: 600 }}>Fixed tasks overlap: </span>
                        <span style={taskLinkStyle} onClick={function() { if (w.taskA && onExpand) onExpand(w.taskA); }} title="Open task details">{(allTasks.find(t => t.id === w.taskA) || {}).text || w.taskA}</span>
                        {' and '}
                        <span style={taskLinkStyle} onClick={function() { if (w.taskB && onExpand) onExpand(w.taskB); }} title="Open task details">{(allTasks.find(t => t.id === w.taskB) || {}).text || w.taskB}</span>
                        <span style={{ color: theme.textMuted }}> on {w.dateKey}</span>
                        <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
                          Two fixed-time events are scheduled at overlapping times. The scheduler can't move fixed tasks, so adjust the time on one of them to resolve the conflict.
                        </div>
                      </div>
                    )}
                    {w.type === 'impossibleDayReq' && (
                      <div>
                        <span style={{ fontWeight: 600 }}>No eligible days: </span>
                        <span style={taskLinkStyle} onClick={function() { if (w.taskId && onExpand) onExpand(w.taskId); }} title="Open task details">{taskA ? taskA.text : w.taskId}</span>
                        <span style={{ color: theme.textMuted }}> requires {w.dayReq}</span>
                        <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
                          This task can only be scheduled on {w.dayReq} days, but there are none between {w.earliest} and the deadline ({w.deadline}). Extend the deadline or change the day requirement.
                        </div>
                      </div>
                    )}
                    {w.type === 'orphanedWhenTag' && (
                      <div>
                        <span style={{ fontWeight: 600 }}>Unknown time block: </span>
                        <span style={taskLinkStyle} onClick={function() { if (w.taskId && onExpand) onExpand(w.taskId); }} title="Open task details">{taskA ? taskA.text : w.taskId}</span>
                        <span style={{ color: theme.textMuted }}> has when="{w.originalWhen}"</span>
                        <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
                          This tag doesn't match any time block in your schedule templates. The scheduler is treating it as "anytime". Update the task's time preference or add a matching template.
                        </div>
                      </div>
                    )}
                    {w.type === 'recurringConflict' && (
                      <div>
                        <span style={{ fontWeight: 600 }}>Recurring conflict: </span>
                        <span style={taskLinkStyle} onClick={function() { if (w.taskId && onExpand) onExpand(w.taskId); }} title="Open task details">{taskA ? taskA.text : w.taskId}</span>
                        <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
                          A recurring instance couldn't be placed without colliding with another fixed or recurring task on the same day, so the scheduler left it unscheduled. Adjust its time, day requirement, or recurrence so it has a free slot.
                        </div>
                      </div>
                    )}
                    {w.type === 'recurring_split_overflow' && (
                      <div>
                        <span style={{ fontWeight: 600 }}>Recurring split overflow: </span>
                        <span style={taskLinkStyle} onClick={function() { if (w.taskId && onExpand) onExpand(w.taskId); }} title="Open task details">{taskA ? taskA.text : w.taskId}</span>
                        <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
                          This recurring task is split into more chunks than fit before its deadline, so some chunks couldn't be scheduled. Allow more time, extend the deadline, or split the task less finely.
                        </div>
                      </div>
                    )}
                    {KNOWN_DATA_ISSUE_TYPES.indexOf(w.type) === -1 && (
                      <div>
                        <span style={{ fontWeight: 600 }}>Scheduling constraint: </span>
                        <span style={taskLinkStyle} onClick={function() { if (w.taskId && onExpand) onExpand(w.taskId); }} title="Open task details">{taskA ? taskA.text : (w.taskId || w.type)}</span>
                        <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
                          The scheduler flagged a constraint it had to work around ({w.type}). Open this task to review and resolve it.
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  var actionGroupOpen = !collapsed.actionGroup;
  var infoGroupOpen = !collapsed.infoGroup;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? 8 : 12 }}>
      {weatherByDate && weatherByDate[todayKey] && (
        <div style={{ padding: '0 4px 8px' }}>
          <WeatherBadge weatherDay={weatherByDate[todayKey]} showLow darkMode={darkMode} />
        </div>
      )}
      {/* Page-level explanation */}
      <div style={{ fontSize: 11, color: theme.textMuted, padding: '0 4px 10px', lineHeight: 1.5 }}>
        Tasks that need attention are under Action Required. Informational sections show context that may be useful but doesn't need immediate action.
      </div>

      {actionCount === 0 && infoCount === 0 && (
        <div style={{ fontSize: 13, color: theme.textMuted, padding: 20, textAlign: 'center' }}>No issues found</div>
      )}

      {/* ── Action Required group ── */}
      <div style={{ marginBottom: 8 }}>
        <button
          onClick={function() { toggle('actionGroup'); }}
          title="Issues that need you to take action to resolve"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '7px 4px', border: 'none', background: 'transparent',
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left'
          }}
        >
          {renderToggle('actionGroup', actionGroupOpen)}
          <span style={{ fontSize: 14, fontWeight: 700, color: actionCount > 0 ? theme.text : theme.textMuted }}>
            Action Required
          </span>
          {actionCount > 0 ? (
            <span style={{
              background: theme.error, color: '#FFF', borderRadius: 8,
              padding: '0 6px', fontSize: 10, fontWeight: 700, lineHeight: '16px',
              minWidth: 18, textAlign: 'center'
            }}>{actionCount}</span>
          ) : (
            <span style={{ fontSize: 10, color: theme.textMuted }}>(0)</span>
          )}
        </button>
        {actionGroupOpen && (
          <div style={{ paddingLeft: 14 }}>
            {actionSections.map(renderTaskSection)}
            {renderDataIssues()}
          </div>
        )}
      </div>

      {/* ── Informational group ── */}
      <div style={{ marginBottom: 8 }}>
        <button
          onClick={function() { toggle('infoGroup'); }}
          title="Context and status information — no immediate action needed"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '7px 4px', border: 'none', background: 'transparent',
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left'
          }}
        >
          {renderToggle('infoGroup', infoGroupOpen)}
          <span style={{ fontSize: 14, fontWeight: 700, color: infoCount > 0 ? theme.text : theme.textMuted }}>
            Informational
          </span>
          {infoCount > 0 ? (
            <span style={{
              background: '#6B7280', color: '#FFF', borderRadius: 8,
              padding: '0 6px', fontSize: 10, fontWeight: 700, lineHeight: '16px',
              minWidth: 18, textAlign: 'center'
            }}>{infoCount}</span>
          ) : (
            <span style={{ fontSize: 10, color: theme.textMuted }}>(0)</span>
          )}
        </button>
        {infoGroupOpen && (
          <div style={{ paddingLeft: 14 }}>
            {infoSections.map(renderTaskSection)}
          </div>
        )}
      </div>
    </div>
  );
}
