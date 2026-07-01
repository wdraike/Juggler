import React from 'react';
import { STATUS_OPTIONS } from '../../state/constants';
import { BRAND } from '../../theme/colors';

var URL_PATTERN = /^https?:\/\//i;

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
  var BTN_H = isMobile ? 36 : 28;
  var lStyle = { fontSize: isMobile ? 12 : 11, color: TH.textMuted, display: 'flex', flexDirection: 'column', gap: 2, fontWeight: 600 };
  var iStyle = {
    fontSize: isMobile ? 13 : 11, padding: isMobile ? '6px 8px' : '3px 4px',
    border: '1px solid ' + TH.inputBorder, borderRadius: 4,
    background: TH.inputBg, color: TH.inputText, fontFamily: 'inherit', boxSizing: 'border-box',
  };

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
                // Same transition rules as StatusToggle — disable current status
                // and invalid transitions. Terminal → reopen only.
                var currentStatus = status || '';
                var transitions = {
                  '':      { 'done': 1, 'cancel': 1, 'skip': 1, 'pause': 1 },
                  'done':  { '': 1 },
                  'cancel': { '': 1 },
                  'skip':  { '': 1 },
                  'pause': { '': 1 },
                };
                var canTransit = !!(transitions[currentStatus] && transitions[currentStatus][s.value]);
                var isDisabled = isActive || !canTransit;
                var sBg = darkMode ? s.bgDark : s.bg;
                var sColor = darkMode ? s.colorDark : s.color;
                return (
                  <button key={s.value} onClick={() => { if (onStatusChange && !isDisabled) onStatusChange(s.value); }}
                    disabled={isDisabled}
                    title={isActive ? 'Current status' : s.tip}
                    style={{
                      border: '1px solid ' + (isActive ? sColor : TH.btnBorder),
                      borderRadius: 4, padding: '3px 8px',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      background: isActive ? sBg : 'transparent',
                      color: isActive ? sColor : TH.textMuted,
                      fontSize: 10, fontWeight: isActive ? 700 : 500, fontFamily: 'inherit',
                      height: BTN_H, boxSizing: 'border-box',
                      opacity: isDisabled ? 0.45 : 1
                    }}>
                    {s.label} {s.tip.split(' — ')[0]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <input
          data-testid="task-title"
          type="text" value={text} onChange={e => onTextChange && onTextChange(e.target.value)}
          autoFocus={isCreate}
          style={{
            width: '100%', fontSize: 15, fontWeight: 700, background: 'transparent',
            border: 'none', borderBottom: '1px solid ' + TH.border, color: TH.text,
            outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
            marginBottom: 6, padding: '2px 0'
          }}
        />

        <label htmlFor='task-project-select' style={{ ...lStyle, marginBottom: 6 }}>
          Project
          <select id='task-project-select' value={project ?? ''} onChange={e => onProjectChange && onProjectChange(e.target.value)}
            style={{ ...iStyle, height: BTN_H, cursor: 'pointer' }}>
            <option value="">No project</option>
            {(allProjectNames || []).map(function(p) { return <option key={p} value={p}>{p}</option>; })}
          </select>
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
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
          <button
            title={marker ? 'Reminder event — does not block time' : 'Make this a non-blocking reminder event'}
            onClick={() => onMarkerChange && onMarkerChange(!marker)}
            style={{
              fontSize: 10, height: 24, boxSizing: 'border-box',
              background: marker ? BRAND.indigo + '22' : TH.badgeBg,
              color: marker ? BRAND.indigo : TH.badgeText,
              border: '1px solid ' + (marker ? BRAND.indigo : TH.inputBorder),
              borderRadius: 3, padding: '1px 6px', cursor: 'pointer', fontFamily: 'inherit'
            }}>
            ◇ Reminder
          </button>
        </div>

        <label style={{ ...lStyle, marginBottom: 6 }}>
          Notes
          <textarea value={notes || ''} onChange={e => onNotesChange && onNotesChange(e.target.value)}
            style={{ ...iStyle, minHeight: 40, resize: 'vertical', width: '100%' }} />
        </label>
        <label style={{ ...lStyle, marginBottom: 4 }}>
          Link
          <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
            <input type="url" value={url || ''} onChange={e => onUrlChange && onUrlChange(e.target.value)}
              placeholder="https://…"
              style={{ ...iStyle, flex: 1, minWidth: 0, height: BTN_H }} />
            {url && URL_PATTERN.test(url.trim()) && (
              <button type="button"
                onClick={function(e) { e.stopPropagation(); window.open(url.trim(), '_blank', 'noopener,noreferrer'); }}
                style={{
                  height: BTN_H, padding: '0 10px', borderRadius: 4,
                  border: '1px solid ' + TH.inputBorder, background: TH.inputBg,
                  color: TH.accent, cursor: 'pointer', fontSize: 11,
                  fontFamily: 'inherit', fontWeight: 600, flexShrink: 0, boxSizing: 'border-box'
                }}>🔗 Open</button>
            )}
          </div>
        </label>
      </div>
    </>
  );
}
