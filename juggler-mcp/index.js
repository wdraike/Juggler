#!/usr/bin/env node
/**
 * Juggler MCP Server — stdio transport for Claude Code
 *
 * Each tool makes HTTP calls to the Juggler backend using a stored JWT.
 * Set JUGGLER_API_URL and JUGGLER_TOKEN env vars (or store token in ~/.juggler-mcp-token).
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');

const API_URL = process.env.JUGGLER_API_URL || 'http://localhost:5002';

function getToken() {
  if (process.env.JUGGLER_TOKEN) return process.env.JUGGLER_TOKEN;
  const tokenPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.juggler-mcp-token');
  try {
    return fs.readFileSync(tokenPath, 'utf-8').trim();
  } catch {
    return null;
  }
}

async function apiCall(method, endpoint, body) {
  const token = getToken();
  if (!token) throw new Error('No JUGGLER_TOKEN set. Set env var or create ~/.juggler-mcp-token');

  const url = `${API_URL}${endpoint}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: ${text}`);
  return JSON.parse(text);
}

const SERVICE_NAME = process.env.SERVICE_NAME || 'strivers';
const server = new McpServer({ name: SERVICE_NAME, version: '1.0.0' });

// ── Task tools ──

server.tool(
  'list_tasks',
  'List tasks. Filter by status, project, date, or limit results.',
  {
    status: z.string().optional().describe('Filter by status'),
    project: z.string().optional().describe('Filter by project name'),
    date: z.string().optional().describe('Filter by date (M/D format)'),
    limit: z.number().optional().describe('Max number of tasks')
  },
  async ({ status, project, date, limit }) => {
    const params = new URLSearchParams();
    if (status !== undefined) params.set('status', status);
    if (project) params.set('project', project);
    if (date) params.set('date', date);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    const data = await apiCall('GET', `/api/tasks${qs ? '?' + qs : ''}`);
    let tasks = data.tasks || [];
    // Client-side filtering since backend GET /api/tasks doesn't support query params
    if (status !== undefined) tasks = tasks.filter(t => t.status === status);
    if (project) tasks = tasks.filter(t => t.project === project);
    if (date) tasks = tasks.filter(t => t.date === date);
    if (limit) tasks = tasks.slice(0, limit);
    return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
  }
);

server.tool(
  'create_task',
  'Create a single task.',
  {
    id: z.string().optional(),
    text: z.string(),
    project: z.string().optional(),
    pri: z.number().optional(),
    dur: z.number().optional(),
    when: z.string().optional(),
    dayReq: z.string().optional(),
    dependsOn: z.array(z.string()).optional(),
    // UTC ISO fields (preferred)
    scheduledAt: z.string().optional().describe('Scheduled date+time as ISO string — UTC ("2026-03-08T22:45:00Z") or with offset ("2026-03-08T18:45:00-04:00"). Takes precedence over date/time.'),
    deadline: z.string().optional().describe('Hard deadline as YYYY-MM-DD. Not negotiable — the scheduler places the task on or before this date.'),
    startAfterAt: z.string().optional().describe('Start-after date as ISO date string (e.g. "2026-03-10"). Takes precedence over startAfter.'),
    // Local string fields (convenience)
    date: z.string().optional(),
    time: z.string().optional(),
    startAfter: z.string().optional(),
    location: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    notes: z.string().optional(),
    habit: z.boolean().optional(),
    rigid: z.boolean().optional(),
    split: z.boolean().optional(),
    splitMin: z.number().optional(),
    recur: z.object({ type: z.string(), days: z.string().optional(), every: z.number().optional() }).optional(),
    datePinned: z.boolean().optional()
  },
  async (params) => {
    if (!params.id) {
      const crypto = require('crypto');
      params.id = crypto.randomUUID();
    }
    const data = await apiCall('POST', '/api/tasks', params);
    return { content: [{ type: 'text', text: JSON.stringify(data.task, null, 2) }] };
  }
);

server.tool(
  'create_tasks',
  'Create multiple tasks at once.',
  {
    tasks: z.array(z.object({
      id: z.string().optional(),
      text: z.string(),
      project: z.string().optional(),
      pri: z.number().optional(),
      dur: z.number().optional(),
      when: z.string().optional(),
      dayReq: z.string().optional(),
      dependsOn: z.array(z.string()).optional(),
      scheduledAt: z.string().optional(),
      deadline: z.string().optional(),
      startAfterAt: z.string().optional(),
      date: z.string().optional(),
      time: z.string().optional(),
      startAfter: z.string().optional(),
      location: z.array(z.string()).optional(),
      tools: z.array(z.string()).optional(),
      notes: z.string().optional(),
      habit: z.boolean().optional(),
      rigid: z.boolean().optional(),
      split: z.boolean().optional(),
      splitMin: z.number().optional(),
      recur: z.object({ type: z.string(), days: z.string().optional(), every: z.number().optional() }).optional(),
      datePinned: z.boolean().optional()
    }))
  },
  async ({ tasks }) => {
    const crypto = require('crypto');
    tasks.forEach(t => { if (!t.id) t.id = crypto.randomUUID(); });
    const data = await apiCall('POST', '/api/tasks/batch', { tasks });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'update_task',
  'Update fields on an existing task.',
  {
    id: z.string(),
    text: z.string().optional(),
    project: z.string().optional(),
    pri: z.number().optional(),
    dur: z.number().optional(),
    when: z.string().optional(),
    dayReq: z.string().optional(),
    dependsOn: z.array(z.string()).optional(),
    scheduledAt: z.string().optional(),
    startAfterAt: z.string().optional(),
    date: z.string().optional(),
    time: z.string().optional(),
    startAfter: z.string().optional(),
    location: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    notes: z.string().optional(),
    habit: z.boolean().optional(),
    rigid: z.boolean().optional(),
    split: z.boolean().optional(),
    splitMin: z.number().optional(),
    datePinned: z.boolean().optional(),
    status: z.string().optional(),
    direction: z.string().optional()
  },
  async ({ id, ...fields }) => {
    const data = await apiCall('PUT', `/api/tasks/${id}`, fields);
    return { content: [{ type: 'text', text: JSON.stringify(data.task, null, 2) }] };
  }
);

server.tool(
  'set_task_status',
  'Set task status and optional direction.',
  {
    id: z.string(),
    status: z.string(),
    direction: z.string().optional()
  },
  async ({ id, status, direction }) => {
    const data = await apiCall('PUT', `/api/tasks/${id}/status`, { status, direction });
    return { content: [{ type: 'text', text: JSON.stringify(data.task, null, 2) }] };
  }
);

server.tool(
  'delete_task',
  'Delete a task. Dependencies are remapped.',
  { id: z.string() },
  async ({ id }) => {
    const data = await apiCall('DELETE', `/api/tasks/${id}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Schedule tools ──

server.tool(
  'get_schedule',
  'Get current schedule placements (read-only).',
  {},
  async () => {
    const data = await apiCall('GET', '/api/schedule/placements');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'run_schedule',
  'Run the scheduler and persist changes.',
  {},
  async () => {
    const data = await apiCall('POST', '/api/schedule/run');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Config tools ──

server.tool(
  'get_config',
  'Get user configuration (locations, tools, projects, time blocks, etc.).',
  {},
  async () => {
    const data = await apiCall('GET', '/api/config');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'list_projects',
  'List all projects, optionally filtered by name. Returns task counts.',
  {
    name: z.string().optional().describe('Filter by project name (exact match)')
  },
  async ({ name }) => {
    const data = await apiCall('GET', '/api/projects');
    let projects = data.projects || [];
    if (name) projects = projects.filter(p => p.name === name);
    return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] };
  }
);

// ── Task tools (additional) ──

server.tool(
  'get_task',
  'Get a single task by ID.',
  { id: z.string().describe('Task ID') },
  async ({ id }) => {
    const data = await apiCall('GET', '/api/tasks');
    const task = (data.tasks || []).find(t => t.id === id);
    if (!task) return { content: [{ type: 'text', text: 'Error: Task not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  }
);

server.tool(
  'search_tasks',
  'Search tasks by text across task names and notes.',
  {
    query: z.string().describe('Search text (case-insensitive)'),
    status: z.string().optional().describe('Filter by status'),
    project: z.string().optional().describe('Filter by project name'),
    limit: z.number().optional().describe('Max results (default 20)')
  },
  async ({ query, status, project, limit }) => {
    const data = await apiCall('GET', '/api/tasks');
    let tasks = data.tasks || [];
    const q = query.toLowerCase();
    tasks = tasks.filter(t =>
      (t.text && t.text.toLowerCase().includes(q)) ||
      (t.notes && t.notes.toLowerCase().includes(q))
    );
    if (status !== undefined) tasks = tasks.filter(t => t.status === status);
    if (project) tasks = tasks.filter(t => t.project === project);
    tasks = tasks.slice(0, limit || 20);
    return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
  }
);

server.tool(
  'batch_update_tasks',
  'Update multiple tasks at once. Each entry needs an id and the fields to change.',
  {
    updates: z.array(z.object({
      id: z.string(),
      text: z.string().optional(),
      project: z.string().optional(),
      pri: z.number().optional(),
      dur: z.number().optional(),
      when: z.string().optional(),
      dayReq: z.string().optional(),
      dependsOn: z.array(z.string()).optional(),
      scheduledAt: z.string().optional(),
      deadline: z.string().optional(),
      startAfterAt: z.string().optional(),
      date: z.string().optional(),
      time: z.string().optional(),
      startAfter: z.string().optional(),
      location: z.array(z.string()).optional(),
      tools: z.array(z.string()).optional(),
      notes: z.string().optional(),
      habit: z.boolean().optional(),
      rigid: z.boolean().optional(),
      split: z.boolean().optional(),
      splitMin: z.number().optional(),
      datePinned: z.boolean().optional(),
      status: z.string().optional(),
      direction: z.string().optional()
    }))
  },
  async ({ updates }) => {
    const data = await apiCall('PUT', '/api/tasks/batch', { updates });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Project tools ──

server.tool(
  'create_project',
  'Create a new project with optional color and icon.',
  {
    name: z.string().describe('Project name (must be unique)'),
    color: z.string().optional().describe('Project color (e.g. "#4A90D9")'),
    icon: z.string().optional().describe('Project icon identifier')
  },
  async ({ name, color, icon }) => {
    const data = await apiCall('POST', '/api/projects', { name, color, icon });
    return { content: [{ type: 'text', text: JSON.stringify(data.project, null, 2) }] };
  }
);

server.tool(
  'update_project',
  'Update a project name, color, or icon. Renaming updates all associated tasks.',
  {
    id: z.number().describe('Project ID'),
    name: z.string().optional().describe('New project name'),
    color: z.string().optional().describe('New project color'),
    icon: z.string().optional().describe('New project icon')
  },
  async ({ id, name, color, icon }) => {
    // Fetch current project to get oldName for rename support
    const allProjects = await apiCall('GET', '/api/projects');
    const current = (allProjects.projects || []).find(p => p.id === id);
    const body = { name, color, icon };
    if (current && name && current.name !== name) body.oldName = current.name;
    const data = await apiCall('PUT', `/api/projects/${id}`, body);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'delete_project',
  'Delete a project. Tasks in this project are kept but lose their project association.',
  {
    id: z.number().describe('Project ID to delete')
  },
  async ({ id }) => {
    const data = await apiCall('DELETE', `/api/projects/${id}`);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'update_config',
  'Update a user configuration value. Valid keys: time_blocks, preferences, loc_schedules, loc_schedule_defaults, loc_schedule_overrides, hour_location_overrides, tool_matrix.',
  {
    key: z.enum(['time_blocks', 'preferences', 'loc_schedules', 'loc_schedule_defaults', 'loc_schedule_overrides', 'hour_location_overrides', 'tool_matrix']).describe('Configuration key to update'),
    value: z.any().describe('New configuration value (object or array)')
  },
  async ({ key, value }) => {
    const data = await apiCall('PUT', `/api/config/${key}`, { value });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Data & Calendar tools ──

server.tool(
  'export_data',
  'Export all user data as JSON (tasks, projects, locations, tools, config). Useful for backups.',
  {},
  async () => {
    const data = await apiCall('GET', '/api/data/export');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  'get_calendar_status',
  'Check Google/Microsoft Calendar connection status and last sync time.',
  {},
  async () => {
    const [gcal, msft] = await Promise.all([
      apiCall('GET', '/api/gcal/status').catch(e => ({ error: e.message })),
      apiCall('GET', '/api/msft-cal/status').catch(e => ({ error: e.message }))
    ]);
    return { content: [{ type: 'text', text: JSON.stringify({ googleCalendar: gcal, microsoftCalendar: msft }, null, 2) }] };
  }
);

server.tool(
  'sync_calendar',
  'Trigger a calendar sync (push and pull). Calls the unified cal-sync endpoint.',
  {},
  async () => {
    const data = await apiCall('POST', '/api/cal-sync/sync');
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('Juggler MCP server error:', err);
  process.exit(1);
});
