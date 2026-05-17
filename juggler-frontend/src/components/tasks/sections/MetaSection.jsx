import React from 'react';

var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function MetaSection({ task, TH }) {
  var created = task.createdAt ? new Date(task.createdAt) : null;
  var createdStr = created
    ? MONTHS[created.getMonth()] + ' ' + created.getDate() + ', ' + created.getFullYear()
    : '—';

  var startStr = null, endStr = null;
  if (task.time) startStr = task.time;
  if (task.time && task.dur) {
    var m = task.time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (m) {
      var hh = parseInt(m[1], 10), mm = parseInt(m[2], 10), ap = (m[3] || '').toUpperCase();
      if (ap === 'PM' && hh < 12) hh += 12;
      if (ap === 'AM' && hh === 12) hh = 0;
      var total = hh * 60 + mm + task.dur;
      if (total < 24 * 60) {
        var eh = Math.floor(total / 60), em = total % 60;
        var eap = eh >= 12 ? 'PM' : 'AM';
        var eh12 = eh % 12 || 12;
        endStr = eh12 + ':' + (em < 10 ? '0' : '') + em + ' ' + eap;
      }
    }
  }

  var s = task.slackMins;
  var slackStr = s == null ? '∞' : s <= 0 ? '0m' : s < 60 ? s + 'm' : Math.floor(s / 60) + 'h ' + (s % 60) + 'm';

  var rowStyle = { display: 'flex', gap: 6, fontSize: 10, color: TH.textMuted, lineHeight: 1.5 };
  var labelStyle = { minWidth: 64, fontWeight: 600, color: TH.textMuted };

  return (
    <div style={{ fontFamily: 'inherit' }}>
      <div style={rowStyle}><span style={labelStyle}>Created</span><span>{createdStr}</span></div>
      <div style={rowStyle}>
        <span style={labelStyle}>Scheduled</span>
        <span>{startStr ? (endStr ? startStr + ' → ' + endStr : startStr) : '—'}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle} title="How much time the scheduler can shift this task before it misses its deadline. ∞ means no deadline constraint.">Slack</span>
        <span>{slackStr}</span>
      </div>
    </div>
  );
}
