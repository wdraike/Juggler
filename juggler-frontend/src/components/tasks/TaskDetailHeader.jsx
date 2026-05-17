import React from 'react';
import { STATUS_OPTIONS } from '../../state/constants';

export default function TaskDetailHeader({
  task, isCreate, isMobile,
  TH, darkMode,
  isDirty, saveStatus, onSave, onCreate, onClose, onDelete, calSyncSettings,
  status, onStatusChange,
  text, onTextChange,
  project, onProjectChange, allProjectNames,
  pri, onPriChange,
  dur,
  notes, onNotesChange,
  url, onUrlChange,
  marker, onMarkerChange,
  scheduledBadge,
  unplacedDetail, whenBlocked, onEnableFlex,
}) {
  var BTN_H = isMobile ? 30 : 26;
  var notesPreview = notes ? notes.split('\n')[0] : '';

  var deleteSlot = null;
  if (!isCreate && onDelete) {
    var css = calSyncSettings || {};
    var isIngestBlocked = (task.gcalEventId && css.gcal && css.gcal.mode === 'ingest')
                       || (task.msftEventId && css.msft && css.msft.mode === 'ingest');
    deleteSlot = isIngestBlocked
      ? <span style={{ fontSize: 10, color: TH.textMuted, fontStyle: 'italic' }}>Calendar event</span>
      : <button onClick={() => onDelete(task.id)} style={{
          fontSize: 10, fontWeight: 600, padding: '4px 10px',
          border: '1px solid #8B2635', borderRadius: 4,
          background: TH.redBg, color: TH.redText, cursor: 'pointer'
        }}>🗑 Delete</button>;
  }

  return (
    <>
      <div style={{
        display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
        background: TH.badgeBg, padding: '8px 12px', borderBottom: '1px solid ' + TH.border
      }}>
        {isCreate ? (
          <button onClick={onCreate} style={{
            fontSize: 10, fontWeight: 700, padding: '4px 14px', border: 'none', borderRadius: 4,
            background: '#2D6A4F', color: '#FDFAF5', cursor: 'pointer'
          }}>✚ Create</button>
        ) : (
          <>
            {isDirty && (
              <button onClick={onSave} style={{
                fontSize: 10, fontWeight: 700, padding: '4px 14px', border: 'none', borderRadius: 4,
                background: TH.accent, color: '#FDFAF5', cursor: 'pointer'
              }}>💾 Save</button>
            )}
            {saveStatus && (
              <span style={{
                fontSize: 10, fontWeight: 600,
                color: saveStatus === 'failed' ? '#8B2635' : saveStatus === 'saving' ? TH.textMuted : '#2D6A4F',
                padding: '4px 8px'
              }}>
                {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'failed' ? '✖ Save failed' : '✔ Saved'}
              </span>
            )}
          </>
        )}
        <div style={{ flex: 1 }} />
        {deleteSlot}
        <button onClick={onClose} style={{
          border: 'none', background: 'transparent', color: TH.textMuted,
          fontSize: isMobile ? 24 : 16, cursor: 'pointer', padding: '2px 6px',
          minWidth: isMobile ? 44 : undefined, minHeight: isMobile ? 44 : undefined
        }}>×</button>
      </div>

      <div style={{ padding: '10px 12px', boxSizing: 'border-box' }}>
        {!isCreate && unplacedDetail && (
          <div style={{
            fontSize: 10, padding: '6px 10px', marginBottom: 8, borderRadius: 4,
            background: TH.amberBg, color: TH.amberText, border: '1px solid ' + TH.amberBorder,
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap'
          }}>
            <span style={{ fontWeight: 600 }}>⚠ Not placed:</span>
            <span>{unplacedDetail}</span>
            {whenBlocked && (
              <button onClick={onEnableFlex} style={{
                fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                border: '1px solid #C8942A', background: '#C8942A18', color: '#C8942A',
                cursor: 'pointer', fontFamily: 'inherit'
              }}>Enable Flex</button>
            )}
          </div>
        )}

        {!isCreate && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: TH.textMuted, fontWeight: 600, marginBottom: 3 }}>Status</div>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {STATUS_OPTIONS.map(function(s) {
                var isActive = (status || '') === s.value;
                var sBg = darkMode ? s.bgDark : s.bg;
                var sColor = darkMode ? s.colorDark : s.color;
                return (
                  <button key={s.value} onClick={() => { if (onStatusChange) onStatusChange(s.value); }}
                    title={s.tip}
                    style={{
                      border: '1px solid ' + (isActive ? sColor : TH.btnBorder),
                      borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
                      background: isActive ? sBg : 'transparent',
                      color: isActive ? sColor : TH.textMuted,
                      fontSize: 10, fontWeight: isActive ? 700 : 500, fontFamily: 'inherit',
                      height: BTN_H, boxSizing: 'border-box'
                    }}>
                    {s.label} {s.tip.split(' — ')[0]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <input
          type="text" value={text} onChange={e => onTextChange && onTextChange(e.target.value)}
          autoFocus={isCreate}
          style={{
            width: '100%', fontSize: 15, fontWeight: 700, background: 'transparent',
            border: 'none', borderBottom: '1px solid ' + TH.border, color: TH.text,
            outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
            marginBottom: 6, padding: '2px 0'
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
          {project && (
            <span style={{
              fontSize: 10, background: TH.projectBadgeBg, color: TH.projectBadgeText,
              borderRadius: 3, padding: '1px 6px', fontWeight: 600
            }}>{project}</span>
          )}
          <select value={pri} onChange={e => onPriChange && onPriChange(e.target.value)}
            style={{
              fontSize: 10, background: TH.badgeBg, color: TH.badgeText,
              borderRadius: 3, padding: '1px 4px', border: '1px solid ' + TH.inputBorder,
              fontFamily: 'inherit', cursor: 'pointer', height: 22
            }}>
            <option value="P1">🔴 P1</option>
            <option value="P2">🟠 P2</option>
            <option value="P3">🔵 P3</option>
            <option value="P4">⚪ P4</option>
          </select>
          {dur > 0 && (
            <span style={{ fontSize: 10, background: TH.badgeBg, color: TH.badgeText, borderRadius: 3, padding: '1px 6px' }}>
              {dur >= 60 ? (Math.round(dur / 60 * 10) / 10) + 'h' : dur + 'm'}
            </span>
          )}
          {scheduledBadge && (
            <span style={{ fontSize: 10, background: TH.accent + '22', color: TH.accent, borderRadius: 3, padding: '1px 6px' }}>
              ⏰ {scheduledBadge}
            </span>
          )}
          {url && /^https?:\/\//i.test(url) && (
            <a href={url} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ fontSize: 10, color: TH.accent }}>🔗</a>
          )}
          <button
            title={marker ? 'Reminder event — does not block time' : 'Make this a non-blocking reminder event'}
            onClick={() => onMarkerChange && onMarkerChange(!marker)}
            style={{
              fontSize: 10, background: marker ? '#4338CA22' : TH.badgeBg,
              color: marker ? '#4338CA' : TH.textMuted,
              border: '1px solid ' + (marker ? '#4338CA' : TH.inputBorder),
              borderRadius: 3, padding: '1px 6px', cursor: 'pointer', fontFamily: 'inherit'
            }}>
            {marker ? '◇ Reminder' : '◇'}
          </button>
        </div>

        {notesPreview && (
          <div style={{
            fontSize: 11, color: TH.textMuted, background: TH.badgeBg,
            borderRadius: 4, padding: '5px 8px', marginBottom: 4,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>
            {notesPreview}
          </div>
        )}
      </div>
    </>
  );
}
