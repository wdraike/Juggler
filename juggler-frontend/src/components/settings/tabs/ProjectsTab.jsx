/**
 * ProjectsTab — extracted from SettingsPanel (999.965).
 * Stub — full implementation was in SettingsPanel.jsx.
 */
import React, { useState, useMemo } from 'react';
import HelpIcon from '../HelpIcon';
import ConfirmDialog from '../../features/ConfirmDialog';

function ProjectRow({ p, config, theme, onRename, taskCount, canReorder, isFirst, isLast, onMoveUp, onMoveDown, onRequestDelete }) {
  var [editing, setEditing] = useState(false);
  var [editName, setEditName] = useState(p.name);
  var [editColor, setEditColor] = useState(p.color || '#2E4A7A');

  async function handleSave() {
    if (!editName || editName === p.name && editColor === p.color) { setEditing(false); return; }
    try {
      var { default: apiClient } = await import('../../../services/apiClient');
      var oldName = p.name;
      await apiClient.put('/projects/' + p.id, { name: editName, color: editColor, icon: p.icon, oldName: oldName });
      config.setProjects(config.projects.map(function(x) {
        return x.id === p.id ? { ...x, name: editName, color: editColor } : x;
      }));
      if (editName !== oldName && onRename) onRename(oldName, editName);
      setEditing(false);
    } catch (e) { console.error(e); }
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6, fontSize: 13 }}>
        <input type="color" value={editColor} onChange={function(e) { setEditColor(e.target.value); }} style={{ width: 24, height: 24, border: 'none', cursor: 'pointer', padding: 0 }} />
        <input value={editName} onChange={function(e) { setEditName(e.target.value); }} onKeyDown={function(e) { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }} autoFocus
          style={{ flex: 1, padding: '2px 4px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <button onClick={handleSave} style={{ border: 'none', borderRadius: 4, padding: '2px 8px', background: '#2D6A4F', color: '#FDFAF5', fontSize: 11, cursor: 'pointer' }}>Save</button>
        <button onClick={function() { setEditing(false); setEditName(p.name); setEditColor(p.color || '#2E4A7A'); }} style={{ border: 'none', background: 'transparent', color: theme.textMuted, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
      </div>
    );
  }

  var arrowBtn = { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '2px 4px', color: theme.textMuted };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6, fontSize: 13 }}>
      {canReorder && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginRight: -4 }}>
          <button onClick={onMoveUp} disabled={isFirst} title="Move up" style={Object.assign({}, arrowBtn, { opacity: isFirst ? 0.25 : 1, cursor: isFirst ? 'default' : 'pointer' })}>{'▲'}</button>
          <button onClick={onMoveDown} disabled={isLast} title="Move down" style={Object.assign({}, arrowBtn, { opacity: isLast ? 0.25 : 1, cursor: isLast ? 'default' : 'pointer' })}>{'▼'}</button>
        </div>
      )}
      {p.color && <div style={{ width: 12, height: 12, borderRadius: 3, background: p.color }} />}
      <span style={{ color: theme.text, flex: 1 }}>{p.name}</span>
      <span style={{ fontSize: 11, color: theme.textMuted, minWidth: 28, textAlign: 'right' }}>{taskCount}</span>
      <button onClick={function() { setEditing(true); }} title="Edit project" style={{ border: 'none', background: 'transparent', color: theme.textMuted, cursor: 'pointer', fontSize: 12 }}>&#x270E;</button>
      <button onClick={function() { if (!p.id) return; onRequestDelete(p); }} title={'Delete project ' + p.name} style={{ border: 'none', background: 'transparent', color: theme.redText, cursor: 'pointer', fontSize: 14 }}>&times;</button>
    </div>
  );
}

export default function ProjectsTab({ config, theme, darkMode, isMobile, allProjectNames, allTasks, onRenameProject }) {
  var [newName, setNewName] = useState('');
  var [newColor, setNewColor] = useState('#2E4A7A');
  // 999.1228 — project delete is irreversible AND detaches every task in the
  // project; it was the only destructive settings action MORE severe than the
  // (already-confirmed) single-task delete. Gate it behind ConfirmDialog.
  var [pendingDelete, setPendingDelete] = useState(null); // project object
  var [sortBy, setSortBy] = useState('custom');
  var [sortDir, setSortDir] = useState('asc');
  var [filter, setFilter] = useState('');

  var taskCounts = useMemo(function() {
    var counts = {};
    (allTasks || []).forEach(function(t) { if (t.project) counts[t.project] = (counts[t.project] || 0) + 1; });
    return counts;
  }, [allTasks]);

  var dbProjectNames = new Set(config.projects.map(function(p) { return p.name; }));
  var taskOnlyNames = (allProjectNames || []).filter(function(n) { return !dbProjectNames.has(n); });

  var filterLower = filter.toLowerCase();
  var filteredProjects = config.projects.filter(function(p) { return !filter || p.name.toLowerCase().includes(filterLower); });
  var filteredTaskOnly = taskOnlyNames.filter(function(n) { return !filter || n.toLowerCase().includes(filterLower); });

  var sortedProjects = filteredProjects.slice().sort(function(a, b) {
    if (sortBy === 'custom') { var sa = a.sortOrder != null ? a.sortOrder : 0; var sb = b.sortOrder != null ? b.sortOrder : 0; if (sa !== sb) return sa - sb; return a.name.localeCompare(b.name); }
    var dir = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'tasks') return ((taskCounts[a.name] || 0) - (taskCounts[b.name] || 0)) * dir;
    if (sortBy === 'color') return (a.color || '').localeCompare(b.color || '') * dir;
    return a.name.localeCompare(b.name) * dir;
  });

  async function moveProject(projectId, delta) {
    if (!filter && sortBy === 'custom') {
      var full = config.projects.slice().sort(function(a, b) { var sa = a.sortOrder != null ? a.sortOrder : 0; var sb = b.sortOrder != null ? b.sortOrder : 0; if (sa !== sb) return sa - sb; return a.name.localeCompare(b.name); });
      var idx = full.findIndex(function(p) { return p.id === projectId; });
      if (idx < 0) return;
      var newIdx = idx + delta;
      if (newIdx < 0 || newIdx >= full.length) return;
      var reordered = full.slice();
      var moved = reordered.splice(idx, 1)[0];
      reordered.splice(newIdx, 0, moved);
      var withOrder = reordered.map(function(p, i) { return Object.assign({}, p, { sortOrder: i }); });
      config.setProjects(withOrder);
      try { var { default: apiClient } = await import('../../../services/apiClient'); await apiClient.put('/projects/reorder', { ids: withOrder.map(function(p) { return p.id; }) }); } catch (e) { console.error('reorder failed:', e); }
    }
  }

  var sortedTaskOnly = filteredTaskOnly.slice().sort(function(a, b) { var dir = sortDir === 'asc' ? 1 : -1; if (sortBy === 'tasks') return ((taskCounts[a] || 0) - (taskCounts[b] || 0)) * dir; return a.localeCompare(b) * dir; });

  function toggleSort(field) { if (sortBy === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); else { setSortBy(field); setSortDir('asc'); } }

  async function promoteTaskProject(name) { try { var { default: apiClient } = await import('../../../services/apiClient'); var res = await apiClient.post('/projects', { name: name, color: '#2E4A7A' }); config.setProjects([...config.projects, res.data.project]); } catch (e) { console.error(e); } }

  var sortArrow = sortDir === 'asc' ? ' ▲' : ' ▼';
  var btnStyle = function(active) { return { border: 'none', background: active ? theme.accent + '22' : 'transparent', color: active ? theme.accent : theme.textMuted, cursor: 'pointer', fontSize: 11, fontWeight: active ? 600 : 400, borderRadius: 4, padding: '2px 6px' }; };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <HelpIcon text="Projects — manage project names and colors." theme={theme}><div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>Projects</div></HelpIcon>
        <span style={{ fontSize: 11, color: theme.textMuted }}>({config.projects.length + taskOnlyNames.length})</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <input value={filter} onChange={function(e) { setFilter(e.target.value); }} placeholder="Filter projects…" style={{ flex: 1, padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        {filter && <button onClick={function() { setFilter(''); }} style={{ border: 'none', background: 'transparent', color: theme.textMuted, cursor: 'pointer', fontSize: 14 }}>&times;</button>}
        <span style={{ fontSize: 11, color: theme.textMuted }}>Sort:</span>
        <button onClick={function() { setSortBy('custom'); }} style={btnStyle(sortBy === 'custom')}>Custom</button>
        <button onClick={function() { toggleSort('name'); }} style={btnStyle(sortBy === 'name')}>Name{sortBy === 'name' ? sortArrow : ''}</button>
        <button onClick={function() { toggleSort('tasks'); }} style={btnStyle(sortBy === 'tasks')}>Tasks{sortBy === 'tasks' ? sortArrow : ''}</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {sortedProjects.map(function(p, i) { var canReorder = sortBy === 'custom' && !filter; return <ProjectRow key={p.id || p.name} p={p} config={config} theme={theme} onRename={onRenameProject} taskCount={taskCounts[p.name] || 0} canReorder={canReorder} isFirst={i === 0} isLast={i === sortedProjects.length - 1} onMoveUp={function() { moveProject(p.id, -1); }} onMoveDown={function() { moveProject(p.id, 1); }} onRequestDelete={setPendingDelete} />; })}
        {sortedTaskOnly.map(function(name) { return (<div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: theme.bgTertiary, borderRadius: 6, fontSize: 13, opacity: 0.7 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: theme.textMuted, opacity: 0.3 }} /><span style={{ color: theme.text, flex: 1 }}>{name}</span><span style={{ fontSize: 11, color: theme.textMuted, minWidth: 28, textAlign: 'right' }}>{taskCounts[name] || 0}</span><button onClick={function() { promoteTaskProject(name); }} title="Add as managed project" style={{ border: 'none', background: 'transparent', color: theme.accent, cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>+ Add</button><span style={{ fontSize: 10, color: theme.textMuted }}>from tasks</span></div>); })}
      </div>
      {/* 999.1235 (3): state + action — point at the Add row directly below. */}
      {config.projects.length === 0 && taskOnlyNames.length === 0 && (<div style={{ fontSize: 12, color: theme.textMuted, marginBottom: 12 }}>No projects yet — type a name below and press Add to color-code and group your tasks.</div>)}
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} style={{ width: 32, height: 28, border: 'none', cursor: 'pointer' }} />
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Project name" onKeyDown={function(e) { if (e.key === 'Enter') document.getElementById('add-project-btn').click(); }} style={{ flex: 1, padding: '4px 6px', border: '1px solid ' + theme.inputBorder, borderRadius: 4, background: theme.input, color: theme.text, fontSize: 12 }} />
        <button id="add-project-btn" onClick={async () => { if (!newName) return; try { var { default: apiClient } = await import('../../../services/apiClient'); var res = await apiClient.post('/projects', { name: newName, color: newColor }); config.setProjects([...config.projects, res.data.project]); setNewName(''); } catch (e) { console.error(e); } }} style={{ border: 'none', borderRadius: 4, padding: '4px 12px', background: theme.accent, color: '#FDFAF5', fontSize: 12, cursor: 'pointer' }}>Add</button>
      </div>
      {pendingDelete && (
        <ConfirmDialog
          title="Delete project?"
          message={'Delete project "' + pendingDelete.name + '"? This cannot be undone.'}
          onConfirm={async function() {
            var p = pendingDelete;
            setPendingDelete(null);
            try {
              var { default: apiClient } = await import('../../../services/apiClient');
              await apiClient.delete('/projects/' + p.id);
              config.setProjects(config.projects.filter(function(x) { return x.id !== p.id; }));
            } catch (e) { console.error(e); }
          }}
          onCancel={function() { setPendingDelete(null); }}
          darkMode={darkMode}
          isMobile={isMobile}
        />
      )}
    </div>
  );
}
