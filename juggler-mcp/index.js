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

const server = new McpServer({ name: 'juggler', version: '1.0.0' });

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
    dueAt: z.string().optional().describe('Due date as ISO date string (e.g. "2026-03-15"). Takes precedence over due.'),
    startAfterAt: z.string().optional().describe('Start-after date as ISO date string (e.g. "2026-03-10"). Takes precedence over startAfter.'),
    // Local string fields (convenience)
    due: z.string().optional(),
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
      dueAt: z.string().optional(),
      startAfterAt: z.string().optional(),
      due: z.string().optional(),
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
    dueAt: z.string().optional(),
    startAfterAt: z.string().optional(),
    due: z.string().optional(),
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

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('Juggler MCP server error:', err);
  process.exit(1);
});
