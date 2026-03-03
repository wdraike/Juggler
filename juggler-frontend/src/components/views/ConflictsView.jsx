/**
 * ConflictsView — warnings: overdue, blocked, unscheduled, unplaced
 */

import React, { useMemo } from 'react';
import TaskCard from '../tasks/TaskCard';
import { getTheme } from '../../theme/colors';
import { parseDate, formatDateKey } from '../../scheduler/dateHelpers';
import { getDepsStatus } from '../../scheduler/dependencyHelpers';

export default function ConflictsView({ allTasks, statuses, directions, unplaced, onStatusChange, onExpand, darkMode, isMobile }) {
  var theme = getTheme(darkMode);
  var todayKey = formatDateKey(new Date());
  var today = new Date(); today.setHours(0, 0, 0, 0);

  var issues = useMemo(() => {
    var overdue = [];
    var blocked = [];
    var unscheduled = [];

    allTasks.forEach(t => {
      var st = statuses[t.id] || '';
      if (st === 'done' || st === 'cancel' || st === 'skip') return;

      // Overdue: has due date in the past
      if (t.due) {
        var dd = parseDate(t.due);
        if (dd && dd < today) overdue.push(t);
      }

      // Past date (unfinished)
      if (t.date && t.date !== 'TBD') {
        var td = parseDate(t.date);
        if (td && td < today) {
          if (!overdue.includes(t)) overdue.push(t);
        }
      }

      // Blocked by deps
      var deps = getDepsStatus(t, allTasks, statuses);
      if (!deps.satisfied) blocked.push(t);

      // No date assigned
      if (!t.date || t.date === 'TBD') unscheduled.push(t);
    });

    return { overdue, blocked, unscheduled };
  }, [allTasks, statuses, today]);

  var sections = [
    { title: 'Overdue', icon: '\u26A0\uFE0F', tasks: issues.overdue, color: '#EF4444' },
    { title: 'Unplaced (scheduler)', icon: '\u274C', tasks: unplaced || [], color: '#F59E0B' },
    { title: 'Blocked by Dependencies', icon: '\uD83D\uDD17', tasks: issues.blocked, color: '#7C3AED' },
    { title: 'Unscheduled (no date)', icon: '\uD83D\uDCC5', tasks: issues.unscheduled, color: '#6B7280' },
  ];

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? 8 : 12 }}>
      {sections.map(sec => (
        <div key={sec.title} style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: sec.color,
            padding: '4px 0', borderBottom: `1px solid ${sec.color}40`,
            marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6
          }}>
            {sec.icon} {sec.title}
            <span style={{ fontSize: 10, fontWeight: 400, color: theme.textMuted }}>({sec.tasks.length})</span>
          </div>
          {sec.tasks.length === 0 ? (
            <div style={{ fontSize: 12, color: theme.textMuted, padding: '8px 0' }}>None</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sec.tasks.map(t => (
                <div key={t.id}>
                  <TaskCard
                    task={t}
                    status={statuses[t.id] || ''}
                    direction={directions[t.id]}
                    onStatusChange={val => onStatusChange(t.id, val)}
                    onExpand={onExpand}
                    darkMode={darkMode}
                    showDate
                    isMobile={isMobile}
                  />
                  {t._unplacedDetail && (
                    <div style={{ fontSize: 10, color: theme.textMuted, padding: '2px 12px', marginTop: -2 }}>
                      {t._unplacedDetail}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
