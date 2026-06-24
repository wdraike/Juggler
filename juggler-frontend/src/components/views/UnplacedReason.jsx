import React from 'react';
import { labelFor } from '../../scheduler/reasonCodes';

/**
 * Reason badge for an unscheduled/unplaced task — a friendly label chip plus the
 * detail string. Shown ANYWHERE a task is surfaced as unscheduled (DailyView
 * Unscheduled section, ListView unplaced filter, Issues tab) so the user always
 * sees WHY it couldn't be placed. Falls back to 'no_slot' when the backend left
 * the reason unset (legacy rows; new rows always carry one).
 *
 * Props: task (carries _unplacedReason/_unplacedDetail), theme, compact (hide detail).
 */
export default function UnplacedReason({ task, theme, compact }) {
  if (!task) return null;
  // Self-gate: only render for genuinely-unplaced tasks (matches derivePlacements'
  // unplaced test) — never put a spurious "No free slot" on a plain backlog task.
  if (!task._unplacedReason && !task._unplacedDetail && !task.unscheduled) return null;
  var reason = task._unplacedReason || 'no_slot';
  var isWeather = reason === 'weather' || reason === 'weather_unavailable';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px 0', flexWrap: 'wrap' }}>
      <span style={{
        fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
        background: theme.amberBg, color: theme.amberText,
        border: '1px solid ' + theme.amberBorder, whiteSpace: 'nowrap'
      }}>
        {isWeather ? '🌤 ' : ''}{labelFor(reason)}
      </span>
      {!compact && task._unplacedDetail && (
        <span style={{ fontSize: 9, color: theme.textMuted }}>{task._unplacedDetail}</span>
      )}
    </div>
  );
}
