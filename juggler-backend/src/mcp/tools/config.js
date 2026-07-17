/**
 * MCP Config Tools — expose user config as MCP tools
 *
 * 999.1404: all 5 tool handlers (get_config, list_projects, create_project,
 * update_project, delete_project) now route through the user-config slice
 * facade instead of calling db() directly. The 11 direct db() call sites are
 * gone — persistence + the tasks_v aggregation live behind the facade's
 * ConfigRepositoryPort adapters.
 */

const { z } = require('zod');
const safeStringify = require('../safeStringify');
// Single source of truth for schedule-affecting keys and the updateConfig facade
// operation — imported from the slice facade (the sanctioned public entry point,
// JUG-HEX-H4/W6) so the MCP tool routes through the same path as the REST
// controller and respects hexagonal boundaries (WARN-1 / 999.464 fix-loop;
// 999.501 facade-routing refactor).
const {
  SCHED_KEYS: schedKeysFromFacade,
  updateConfig: facadeUpdateConfig,
  getAllConfig: facadeGetAllConfig,
  listProjects: facadeListProjects,
  createProject: facadeCreateProject,
  updateProject: facadeUpdateProject,
  deleteProject: facadeDeleteProject
} = require('../../slices/user-config/facade');

function registerConfigTools(server, userId) {

  // ── get_config ──
  server.tool(
    'get_config',
    'Get user configuration including locations, tools, projects, time blocks, tool matrix, location schedules, and preferences.',
    {},
    async () => {
      const result = await facadeGetAllConfig({ userId });

      return { content: [{ type: 'text', text: safeStringify(result.body) }] };
    }
  );

  // ── list_projects ──
  server.tool(
    'list_projects',
    'List all projects, optionally filtered by name. Returns project name, color, icon, and task count.',
    {
      name: z.string().optional().describe('Filter by project name (exact match)')
    },
    async ({ name }) => {
      const result = await facadeListProjects({ userId, name });

      return { content: [{ type: 'text', text: safeStringify(result.body) }] };
    }
  );

  // ── create_project ──
  server.tool(
    'create_project',
    'Create a new project with optional color and icon.',
    {
      name: z.string().describe('Project name (must be unique)'),
      color: z.string().optional().describe('Project color (e.g. "#4A90D9")'),
      icon: z.string().optional().describe('Project icon identifier')
    },
    async ({ name, color, icon }) => {
      const result = await facadeCreateProject({
        userId,
        body: { name, color, icon }
      });

      return { content: [{ type: 'text', text: safeStringify(result.body.project) }] };
    }
  );

  // ── update_project ──
  server.tool(
    'update_project',
    'Update a project name, color, or icon. Renaming a project updates all associated tasks.',
    {
      id: z.number().describe('Project ID'),
      name: z.string().optional().describe('New project name'),
      color: z.string().optional().describe('New project color'),
      icon: z.string().optional().describe('New project icon')
    },
    async ({ id, name, color, icon }) => {
      const result = await facadeUpdateProject({
        userId,
        id,
        body: { name, color, icon }
      });

      return { content: [{ type: 'text', text: safeStringify(result.body) }] };
    }
  );

  // ── delete_project ──
  server.tool(
    'delete_project',
    'Delete a project. Tasks in this project are kept but lose their project association.',
    {
      id: z.number().describe('Project ID to delete')
    },
    async ({ id }) => {
      const result = await facadeDeleteProject({ userId, id });

      return { content: [{ type: 'text', text: safeStringify(result.body) }] };
    }
  );

  // ── update_config ──
  // SCHED_KEYS is the single source of truth for which keys are schedule-affecting
  // (re-exported from the slice facade — WARN-1 fix + boundary fix). The MCP-writable
  // key enum is derived from it so the two lists cannot drift again.
  const schedKeys = schedKeysFromFacade;
  server.tool(
    'update_config',
    'Update a user configuration value. Valid keys: ' + schedKeys.join(', ') + '.',
    {
      key: z.enum(/** @type {[string, ...string[]]} */ (schedKeys.slice())).describe('Configuration key to update'),
      value: z.any().describe('New configuration value (object or array)')
    },
    async ({ key, value }) => {
      // Delegate to the user-config slice facade — the sanctioned cross-slice entry
      // (JUG-HEX-H4/W6, 999.501). The facade's UpdateConfig use-case handles the
      // upsert (via KnexConfigRepository) and cache.invalidateConfig internally
      // (UpdateConfig.js:99). This mirrors config.controller.js:55-66.
      const result = await facadeUpdateConfig({ userId, key, value });

      // If the facade signals a validation error (non-2xx), surface it as an MCP
      // error. The z.enum gate above pre-validates the key, so this branch is
      // defensive — do NOT mask with a fallback.
      if (result.status && result.status >= 400) {
        throw new Error(
          (result.body && result.body.error) || ('update_config failed with status ' + result.status)
        );
      }

      // Trigger reschedule only when the facade instructs it (scheduleAfter present)
      // — mirrors config.controller.js:64-66.
      if (result.scheduleAfter) {
        const { enqueueScheduleRun } = require('../../scheduler/scheduleQueue');
        enqueueScheduleRun(result.scheduleAfter.userId, result.scheduleAfter.source);
      }

      return { content: [{ type: 'text', text: safeStringify({ key, value }) }] };
    }
  );
}

module.exports = { registerConfigTools };