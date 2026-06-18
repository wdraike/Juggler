import React from 'react';

/**
 * CompletionMetricsWidget (999.256) — a compact task-completion summary for the
 * dashboard header. Pure/derived: computes from the already-loaded tasks +
 * statuses, no extra fetch. Counts schedulable (non-template, non-disabled) tasks.
 *
 * Props:
 *   tasks    — array of task objects (taskState.tasks)
 *   statuses — { [taskId]: statusString }
 *   theme    — theme/colors object (textMuted, text, accent-ish)
 */
export default function CompletionMetricsWidget({ tasks, statuses, theme }) {
  var t = theme || {};
  var list = Array.isArray(tasks) ? tasks : [];
  var st = statuses || {};

  var total = 0, done = 0, open = 0, overdue = 0;
  for (var i = 0; i < list.length; i++) {
    var task = list[i];
    if (!task || task.taskType === 'recurring_template') continue;
    var s = st[task.id] || '';
    if (s === 'disabled') continue;
    total += 1;
    if (s === 'done') done += 1;
    else if (s === '' || s === 'wip') open += 1;
    // overdue = open with a deadline in the past (best-effort, string/date compare)
    if ((s === '' || s === 'wip') && task.deadline) {
      var dl = new Date(task.deadline);
      if (!isNaN(dl.getTime()) && dl.getTime() < Date.now()) overdue += 1;
    }
  }
  var pct = total > 0 ? Math.round((done / total) * 100) : 0;

  var pill = function (label, value, color) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }} title={label}>
        <span style={{ fontWeight: 700, color: color || (t.text || 'inherit') }}>{value}</span>
        <span style={{ fontSize: 10, color: t.textMuted || '#888', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      </span>
    );
  };

  return (
    <div
      aria-label="Task completion metrics"
      style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '4px 10px', fontSize: 13,
        color: t.text || 'inherit'
      }}
    >
      {pill('done', done, '#2D6A4F')}
      {pill('open', open)}
      {overdue > 0 && pill('overdue', overdue, '#C1431E')}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title={done + ' of ' + total + ' complete'}>
        <span style={{ width: 64, height: 6, borderRadius: 3, background: (t.textMuted || '#888') + '33', overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: pct + '%', background: '#2D6A4F' }} />
        </span>
        <span style={{ fontSize: 11, color: t.textMuted || '#888' }}>{pct}%</span>
      </span>
    </div>
  );
}
