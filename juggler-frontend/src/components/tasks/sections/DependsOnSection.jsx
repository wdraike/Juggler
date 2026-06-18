import React from 'react';
import { getTaskDeps, getDependents } from '../../../scheduler/dependencyHelpers';

/** One unlink chip — task name + ✕. `kind` toggles wording for the title/aria. */
function DepChip({ label, title, color, onUnlink }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '2px 4px 2px 6px',
      borderRadius: 4, background: color + '18', color: color, fontWeight: 500, maxWidth: '100%'
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{label}</span>
      <button
        type="button"
        title={title}
        aria-label={title}
        onClick={onUnlink}
        style={{
          border: 'none', background: 'transparent', color: color, cursor: 'pointer',
          fontSize: 11, lineHeight: 1, padding: '0 2px', fontFamily: 'inherit', flexShrink: 0
        }}
      >{'✕'}</button>
    </span>
  );
}

export default function DependsOnSection({ task, onShowChain, TH, isMobile, allTasks, onUpdate }) {
  if (task.recurring) return null;

  var BTN_H = isMobile ? 30 : 26;
  var deps = getTaskDeps(task);
  var depCount = deps.length;

  // Symmetric break (999.672): list both sides and allow unlinking from either.
  // Upstream  = tasks THIS task depends on (edit THIS task's dependsOn).
  // Downstream = tasks that depend on THIS task (edit the OTHER task's dependsOn).
  var canEdit = Array.isArray(allTasks) && typeof onUpdate === 'function';
  var upstream = canEdit
    ? deps.map(function(id) { return allTasks.find(function(t) { return t.id === id; }); }).filter(Boolean)
    : [];
  var downstream = canEdit ? getDependents(task.id, allTasks) : [];

  function nameOf(t) { return t.text || t.title || t.id; }

  function unlinkUpstream(depTask) {
    onUpdate(task.id, { dependsOn: getTaskDeps(task).filter(function(d) { return d !== depTask.id; }) });
  }
  function unlinkDownstream(otherTask) {
    onUpdate(otherTask.id, { dependsOn: getTaskDeps(otherTask).filter(function(d) { return d !== task.id; }) });
  }

  var hasLists = canEdit && (upstream.length > 0 || downstream.length > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <button onClick={onShowChain} style={{
        border: '1px solid #0EA5E9', borderRadius: 4, padding: '4px 10px',
        background: 'transparent', color: '#0EA5E9', fontSize: 10, fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit', width: '100%',
        height: BTN_H, boxSizing: 'border-box'
      }}>
        🔗 Dependencies{depCount > 0 ? ' (' + depCount + ')' : ''}
      </button>

      {hasLists && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {upstream.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 600, color: TH.textMuted, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                Depends on
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {upstream.map(function(u) {
                  return (
                    <DepChip key={u.id} label={nameOf(u)} color="#D97706"
                      title={'Remove dependency on “' + nameOf(u) + '”'}
                      onUnlink={function() { unlinkUpstream(u); }} />
                  );
                })}
              </div>
            </div>
          )}
          {downstream.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 600, color: TH.textMuted, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                Depended on by
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {downstream.map(function(d) {
                  return (
                    <DepChip key={d.id} label={nameOf(d)} color="#0EA5E9"
                      title={'Remove dependency from “' + nameOf(d) + '”'}
                      onUnlink={function() { unlinkDownstream(d); }} />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
