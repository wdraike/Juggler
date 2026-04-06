/**
 * Feature Catalog Controller
 *
 * Exposes StriveRS's configurable features in a pricing-agnostic format.
 * The payment service fetches this to know what can be configured
 * when building pricing tiers.
 *
 * ONLY features with actual implementation are listed here.
 * value_order: higher = more prominent in plan cards (100+ headline, 50-99 important, 1-49 secondary)
 */

const { getProductId, PRODUCT_LABEL } = require('../middleware/plan-features.middleware');

const CATALOG = {
  product_id: PRODUCT_LABEL, // Resolved to UUID at request time
  product_name: 'StriveRS',
  catalog_version: '2026-03-22T18:00:00Z',
  groups: [
    {
      key: 'limits',
      label: 'Usage Limits',
      sort_order: 0,
      features: [
        {
          key: 'limits.active_tasks',
          type: 'numeric',
          display_name: 'Active Tasks',
          description: 'Maximum number of tasks you can have active at once',
          value_order: 100,
          constraints: { min: 10, max: 1000, unlimited_value: -1, step: 10 },
          default_unrestricted_value: -1
        },
        {
          key: 'limits.ai_commands_per_month',
          type: 'numeric',
          display_name: 'AI Commands / Month',
          description: 'Monthly AI-powered task creation and management commands',
          value_order: 95,
          constraints: { min: 0, max: 1000, unlimited_value: -1, step: 10 },
          default_unrestricted_value: -1
        },
        {
          key: 'limits.recurring_templates',
          type: 'numeric',
          display_name: 'Recurring Recurrings',
          description: 'Templates for daily, weekly, or custom recurringTasks',
          value_order: 85,
          constraints: { min: 1, max: 100, unlimited_value: -1, step: 1 },
          default_unrestricted_value: -1
        },
        {
          key: 'limits.projects',
          type: 'numeric',
          display_name: 'Projects',
          description: 'Organize tasks into separate projects',
          value_order: 80,
          constraints: { min: 1, max: 100, unlimited_value: -1, step: 1 },
          default_unrestricted_value: -1
        },
        {
          key: 'limits.locations',
          type: 'numeric',
          display_name: 'Locations',
          description: 'Saved locations for travel time scheduling',
          value_order: 50,
          constraints: { min: 1, max: 50, unlimited_value: -1, step: 1 },
          default_unrestricted_value: -1
        },
        {
          key: 'limits.schedule_templates',
          type: 'numeric',
          display_name: 'Schedule Templates',
          description: 'Custom day schedules (weekday, weekend, remote day)',
          value_order: 45,
          constraints: { min: 1, max: 20, unlimited_value: -1, step: 1 },
          default_unrestricted_value: -1
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
          description: 'Connect Google Calendar, Microsoft Outlook, or both',
          value_order: 90,
          constraints: { min: 1, max: 2, unlimited_value: -1, step: 1 },
          default_unrestricted_value: -1
        },
        {
          key: 'calendar.auto_sync',
          type: 'boolean',
          display_name: 'Auto Calendar Sync',
          description: 'Automatic periodic sync with connected calendars',
          value_order: 55,
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
          key: 'scheduling.dependencies',
          type: 'boolean',
          display_name: 'Task Dependencies',
          description: 'Chain tasks so one must complete before another starts',
          value_order: 75,
          default_unrestricted_value: true
        },
        {
          key: 'scheduling.travel_time',
          type: 'boolean',
          display_name: 'Travel Time',
          description: 'Automatic travel buffers between tasks at different locations',
          value_order: 70,
          default_unrestricted_value: true
        }
      ]
    },
    {
      key: 'ai',
      label: 'AI Features',
      sort_order: 3,
      features: [
        {
          key: 'ai.natural_language_commands',
          type: 'boolean',
          display_name: 'AI Commands',
          description: 'Create and manage tasks using natural language',
          value_order: 65,
          default_unrestricted_value: true
        },
        {
          key: 'ai.bulk_project_creation',
          type: 'boolean',
          display_name: 'AI Project Builder',
          description: 'Let AI create entire projects with dependent tasks',
          value_order: 60,
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
          description: 'Export all tasks and configuration',
          value_order: 40,
          default_unrestricted_value: true
        },
        {
          key: 'data.import',
          type: 'boolean',
          display_name: 'Data Import',
          description: 'Import tasks from file',
          value_order: 35,
          default_unrestricted_value: true
        },
        {
          key: 'data.mcp_access',
          type: 'boolean',
          display_name: 'MCP Integration',
          description: 'Connect AI assistants like Claude directly to StriveRS',
          value_order: 30,
          default_unrestricted_value: true
        }
      ]
    },
    {
      key: 'tasks',
      label: 'Task Features',
      sort_order: 5,
      features: [
        {
          key: 'tasks.rigid',
          type: 'boolean',
          display_name: 'Pinned Tasks',
          description: 'Lock tasks to specific times on the calendar',
          value_order: 25,
          default_unrestricted_value: true
        }
      ]
    }
  ]
};

exports.getFeatureCatalog = async (req, res) => {
  const productId = await getProductId();
  res.json({ ...CATALOG, product_id: productId || CATALOG.product_id });
};
