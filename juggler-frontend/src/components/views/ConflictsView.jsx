/**
 * ConflictsView — two-tier collapsible tree:
 *   Action Required: overdue, unplaced, data issues
 *   Informational: blocked by deps, backlog
 * All nodes default to collapsed; state persists in localStorage.
 */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import TaskCard from '../tasks/TaskCard';
import { getTheme } from '../../theme/colors';
import { parseDate } from '../../scheduler/dateHelpers';
import { getDepsStatus } from '../../scheduler/dependencyHelpers';

var STORAGE_KEY = 'juggler-issues-collapsed';

function loadCollapsed() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch (e) { return {}; }
}

function saveCollapsed(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { /* quota exceeded */ }
}

export default function ConflictsView({ allTasks, statuses, directions, unplaced, schedulerWarnings, onStatusChange, onExpand, onUpdateTask, darkMode, isMobile }) {
  var theme = getTheme(darkMode);
  var today = new Date(); today.setHours(0, 0, 0, 0);

  var [collapsed, setCollapsed] = useState(function() {
    var saved = loadCollapsed();
    var defaults = {
      actionGroup: false, infoGroup: true,
      overdue: true, unplaced: true, dataIssues: true,
      blocked: true, unscheduled: true
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

  var issues = useMemo(() => {
    var overdue = [];
    var blocked = [];
    var unscheduled = [];

    allTasks.forEach(t => {
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'skip') return;

      if (t.due) {
        var dd = parseDate(t.due);
        if (dd && dd < today) overdue.push(t);
      }

      if (t.date && t.date !== 'TBD') {
        var td = parseDate(t.date);
        if (td && td < today) {
          if (!overdue.includes(t)) overdue.push(t);
        }
      }

      var deps = getDepsStatus(t, allTasks, statuses);
      if (!deps.satisfied) blocked.push(t);

      if (!t.date || t.date === 'TBD') {
        if (t.taskType === 'habit_template') return;
        if (t.section && (t.section.indexOf('PARKING') >= 0 || t.section.indexOf('TO BE SCHEDULED') >= 0)) return;
        unscheduled.push(t);
      }
    });

    return { overdue, blocked, unscheduled };
  }, [allTasks, statuses, today]);

  var warnings = schedulerWarnings || [];

  var actionSections = [
    {
      key: 'overdue', title: 'Overdue', tasks: issues.overdue, color: '#EF4444',
      tip: 'Tasks past their due date or scheduled date that haven\'t been completed',
      help: 'These tasks are past their scheduled or due date and still open. Mark them done, reschedule to a new date, or cancel them.'
    },
    {
      key: 'unplaced', title: 'Unplaced', tasks: unplaced || [], color: '#F59E0B',
      tip: 'Tasks the scheduler couldn\'t fit into any available time slot',
      help: 'The scheduler tried to place these tasks but ran out of room. Common causes: the day is too full, time window constraints are too narrow, or a non-splittable task is too long for any available gap. Try shortening the task, enabling splitting, relaxing the time window, or moving other tasks to free up space.'
    },
  ];

  var infoSections = [
    {
      key: 'blocked', title: 'Blocked by Dependencies', tasks: issues.blocked, color: '#7C3AED',
      tip: 'Tasks waiting on other tasks to be completed first',
      help: 'These tasks depend on other tasks that aren\'t done yet. They\'ll become schedulable once their prerequisites are completed.'
    },
    {
      key: 'unscheduled', title: 'Backlog (no date)', tasks: issues.unscheduled, color: '#6B7280',
      tip: 'Tasks with no date assigned \u2014 not on the schedule yet',
      help: 'These tasks have no date set, so they don\'t appear on the schedule. This is normal for backlog items. Assign a date when you\'re ready to work on them.'
    },
  ];

  var actionCount = actionSections.reduce(function(s, sec) { return s + sec.tasks.length; }, 0) + warnings.length;
  var infoCount = infoSections.reduce(function(s, sec) { return s + sec.tasks.length; }, 0);

  var helpStyle = { fontSize: 11, color: theme.textMuted, padding: '2px 0 6px 0', lineHeight: 1.4 };
  var sugBtnStyle = {
    fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
    border: '1px solid #F59E0B', background: '#F59E0B18', color: '#F59E0B',
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
                      direction={directions[t.id]}
                      onStatusChange={onStatusChange}
                      onExpand={onExpand}
                      darkMode={darkMode}
                      showDate
                      isMobile={isMobile}
                      allTasks={allTasks} statuses={statuses}
                    />
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
                              <span style={{ color: theme.textSecondary }}>{sug.text}</span>
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
              <div style={{ fontSize: 11, color: theme.textMuted }}>None</div>
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
                    background: darkMode ? '#78350F20' : '#FEF3C7',
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
              background: '#EF4444', color: '#FFF', borderRadius: 8,
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
          title="Context and status information \u2014 no immediate action needed"
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
