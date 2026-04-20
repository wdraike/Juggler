/**
 * DisabledItemsPanel — shows items disabled due to plan limits.
 * Users can re-enable (if space allows) or delete items from here.
 */

import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../../services/apiClient';
import ConfirmDialog from '../features/ConfirmDialog';

export default function DisabledItemsPanel({ theme, onClose, onRefreshTasks }) {
  var [items, setItems] = useState([]);
  var [loading, setLoading] = useState(true);
  var [actionPending, setActionPending] = useState(null);
  var [pendingDelete, setPendingDelete] = useState(null);

  var load = useCallback(function() {
    setLoading(true);
    apiClient.get('/tasks/disabled').then(function(res) {
      setItems(res.data.tasks || []);
      setLoading(false);
    }).catch(function() {
      setLoading(false);
    });
  }, []);

  useEffect(function() { load(); }, [load]);

  function handleReEnable(id) {
    setActionPending(id);
    apiClient.put('/tasks/' + id + '/re-enable').then(function() {
      setItems(function(prev) { return prev.filter(function(t) { return t.id !== id; }); });
      setActionPending(null);
      if (onRefreshTasks) onRefreshTasks();
    }).catch(function(err) {
      setActionPending(null);
      var data = err.response?.data;
      if (data?.code === 'ENTITY_LIMIT_REACHED') {
        alert('Cannot re-enable: you have reached the ' + (data.limit_key || '').replace('limits.', '').replace(/_/g, ' ') + ' limit for your plan (' + data.current_count + '/' + data.limit + ').');
      } else {
        alert(data?.error || 'Failed to re-enable');
      }
    });
  }

  function handleDelete(id, isRecurring) {
    var item = items.find(function(t) { return t.id === id; });
    setPendingDelete({ id: id, isRecurring: isRecurring, text: item && item.text ? item.text : '' });
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    var id = pendingDelete.id;
    var isRecurring = pendingDelete.isRecurring;
    setPendingDelete(null);
    setActionPending(id);
    var url = '/tasks/' + id;
    if (isRecurring) url += '?cascade=recurring';
    apiClient.delete(url).then(function() {
      setItems(function(prev) { return prev.filter(function(t) { return t.id !== id && t.sourceId !== id; }); });
      setActionPending(null);
      if (onRefreshTasks) onRefreshTasks();
    }).catch(function() {
      setActionPending(null);
      alert('Failed to delete');
    });
  }

  // Group by type: recurringTasks first, then tasks
  var recurringTasks = items.filter(function(t) { return t.taskType === 'recurring_template'; });
  var tasks = items.filter(function(t) { return t.taskType !== 'recurring_template' && t.taskType !== 'recurring_instance'; });
  var instances = items.filter(function(t) { return t.taskType === 'recurring_instance'; });
  // Count instances per template for display
  var instanceCounts = {};
  instances.forEach(function(inst) {
    if (inst.sourceId) instanceCounts[inst.sourceId] = (instanceCounts[inst.sourceId] || 0) + 1;
  });

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      <div style={{
        background: theme.bgSecondary, borderRadius: 12, width: 440, maxHeight: '80vh',
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)', border: '1px solid ' + theme.border,
        display: 'flex', flexDirection: 'column'
      }} onClick={function(e) { e.stopPropagation(); }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid ' + theme.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: theme.text }}>Disabled Items</div>
            <div style={{ fontSize: 11, color: theme.textMuted, marginTop: 2 }}>
              Items frozen due to plan limits. Re-enable or delete to manage.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: 18, padding: 4 }}>&times;</button>
        </div>

        {/* Content */}
        <div style={{ padding: '12px 20px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: theme.textMuted, padding: 20, fontSize: 13 }}>Loading...</div>
          ) : items.length === 0 ? (
            <div style={{ textAlign: 'center', color: theme.textMuted, padding: 20, fontSize: 13 }}>No disabled items</div>
          ) : (
            <>
              {recurrings.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                    Recurrings ({recurrings.length})
                  </div>
                  {recurrings.map(function(item) {
                    var instCount = instanceCounts[item.id] || 0;
                    return (
                      <ItemRow
                        key={item.id}
                        item={item}
                        subtitle={instCount > 0 ? instCount + ' instance' + (instCount > 1 ? 's' : '') + ' also disabled' : null}
                        theme={theme}
                        pending={actionPending === item.id}
                        onReEnable={function() { handleReEnable(item.id); }}
                        onDelete={function() { handleDelete(item.id, true); }}
                      />
                    );
                  })}
                </div>
              )}
              {tasks.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                    Tasks ({tasks.length})
                  </div>
                  {tasks.map(function(item) {
                    return (
                      <ItemRow
                        key={item.id}
                        item={item}
                        theme={theme}
                        pending={actionPending === item.id}
                        onReEnable={function() { handleReEnable(item.id); }}
                        onDelete={function() { handleDelete(item.id, false); }}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid ' + theme.border, textAlign: 'right' }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid ' + theme.border,
            background: 'transparent', color: theme.text, fontSize: 12, cursor: 'pointer'
          }}>
            Close
          </button>
        </div>
      </div>

      {pendingDelete && (
        <div onClick={function(e) { e.stopPropagation(); }}>
          <ConfirmDialog
            message={'Permanently delete ' + (pendingDelete.text ? '"' + pendingDelete.text.slice(0, 60) + '"' : ('this ' + (pendingDelete.isRecurring ? 'recurring task' : 'task'))) + '? This cannot be undone.'}
            onConfirm={confirmDelete}
            onCancel={function() { setPendingDelete(null); }}
            darkMode={false}
            isMobile={false}
            zIndex={1100}
          />
        </div>
      )}
    </div>
  );
}

function ItemRow({ item, subtitle, theme, pending, onReEnable, onDelete }) {
  var disabledDate = item.disabledAt
    ? new Date(item.disabledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 10px', marginBottom: 4, borderRadius: 6,
      background: theme.bgPrimary, border: '1px solid ' + theme.border,
      opacity: pending ? 0.5 : 1
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: theme.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.text || 'Untitled'}
        </div>
        <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2 }}>
          {item.project && <span>{item.project}</span>}
          {item.project && disabledDate && <span> &middot; </span>}
          {disabledDate && <span>Disabled {disabledDate}</span>}
          {subtitle && <span> &middot; {subtitle}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginLeft: 8, flexShrink: 0 }}>
        <button
          onClick={onReEnable}
          disabled={pending}
          style={{
            padding: '4px 10px', borderRadius: 4, border: 'none',
            background: theme.accent, color: '#fff', fontSize: 11,
            fontWeight: 600, cursor: pending ? 'default' : 'pointer'
          }}
        >
          Re-enable
        </button>
        <button
          onClick={onDelete}
          disabled={pending}
          style={{
            padding: '4px 10px', borderRadius: 4,
            border: '1px solid ' + theme.border, background: 'transparent',
            color: '#C62828', fontSize: 11, cursor: pending ? 'default' : 'pointer'
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
