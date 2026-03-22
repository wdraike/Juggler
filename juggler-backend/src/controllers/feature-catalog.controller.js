/**
 * Feature Catalog Controller
 *
 * Exposes Juggler's configurable features in a pricing-agnostic format.
 * The payment service fetches this to know what can be configured
 * when building pricing tiers.
 *
 * ONLY features with actual implementation are listed here.
 * Removed: limits.active_tasks, limits.ai_commands_per_month, limits.projects,
 *          limits.locations, limits.tools (no enforcement code),
 *          scheduling.task_splitting (schema field exists but no logic),
 *          support.priority (label only, no enforcement)
 */

const CATALOG = {
  product_slug: 'juggler',
  catalog_version: '2026-03-22T00:00:00Z',
  groups: [
    {
      key: 'ai',
      label: 'AI Features',
      sort_order: 0,
      features: [
        {
          key: 'ai.natural_language_commands',
          type: 'boolean',
          display_name: 'Natural Language Commands',
          description: 'AI-powered task creation and management via conversational input',
          default_unrestricted_value: true
        },
        {
          key: 'ai.bulk_project_creation',
          type: 'boolean',
          display_name: 'Bulk Project Creation',
          description: 'Create entire projects with dependent tasks via AI',
          default_unrestricted_value: true
        }
      ]
    },
    {
      key: 'calendar',
      label: 'Calendar Integration',
      sort_order: 1,
      features: [
        {
          key: 'calendar.max_providers',
          type: 'numeric',
          display_name: 'Calendar Providers',
          description: 'Number of calendar providers that can be connected (Google, Microsoft). Free: 1, Pro+: unlimited.',
          constraints: { min: 1, max: 2, unlimited_value: -1, step: 1 },
          default_unrestricted_value: -1
        },
        {
          key: 'calendar.unified_sync',
          type: 'boolean',
          display_name: 'Unified Calendar Sync',
          description: 'Bidirectional sync across all connected calendar providers simultaneously',
          default_unrestricted_value: true
        },
        {
          key: 'calendar.auto_sync',
          type: 'boolean',
          display_name: 'Auto Sync',
          description: 'Automatic periodic calendar synchronization',
          default_unrestricted_value: true
        }
      ]
    },
    {
      key: 'scheduling',
      label: 'Scheduling',
      sort_order: 2,
      features: [
        {
          key: 'scheduling.priority_optimization',
          type: 'boolean',
          display_name: 'Priority Optimization',
          description: 'Hill-climb optimization algorithm for task placement based on priorities',
          default_unrestricted_value: true
        },
        {
          key: 'scheduling.dependencies',
          type: 'boolean',
          display_name: 'Task Dependencies',
          description: 'Define and enforce task dependency chains',
          default_unrestricted_value: true
        },
        {
          key: 'scheduling.travel_time',
          type: 'boolean',
          display_name: 'Travel Time Buffers',
          description: 'Automatic travel time before/after tasks based on location changes',
          default_unrestricted_value: true
        },
        {
          key: 'scheduling.time_blocks',
          type: 'numeric',
          display_name: 'Custom Time Blocks',
          description: 'Maximum number of custom time block configurations per day',
          constraints: { min: 1, max: 20, unlimited_value: -1, step: 1 },
          default_unrestricted_value: -1
        }
      ]
    },
    {
      key: 'tasks',
      label: 'Task Features',
      sort_order: 3,
      features: [
        {
          key: 'tasks.habits',
          type: 'boolean',
          display_name: 'Habit/Recurring Tasks',
          description: 'Create recurring task templates with automatic instances',
          default_unrestricted_value: true
        },
        {
          key: 'tasks.rigid',
          type: 'boolean',
          display_name: 'Rigid Tasks',
          description: 'Pin tasks to specific times that cannot be moved by the scheduler',
          default_unrestricted_value: true
        }
      ]
    },
    {
      key: 'data',
      label: 'Data & Integration',
      sort_order: 4,
      features: [
        {
          key: 'data.export',
          type: 'boolean',
          display_name: 'Data Export',
          description: 'Export all task and configuration data',
          default_unrestricted_value: true
        },
        {
          key: 'data.import',
          type: 'boolean',
          display_name: 'Data Import',
          description: 'Import tasks and configuration from file',
          default_unrestricted_value: true
        },
        {
          key: 'data.mcp_access',
          type: 'boolean',
          display_name: 'MCP Tool Access',
          description: 'Access Juggler via MCP protocol for external AI integrations',
          default_unrestricted_value: true
        }
      ]
    }
  ]
};

exports.getFeatureCatalog = (req, res) => {
  res.json(CATALOG);
};
