#!/usr/bin/env node

/**
 * Register StriveRS (Juggler) Plans with Payment Service
 *
 * Syncs the full plan catalog to the payment service via:
 *   PUT /api/products/juggler/plans/sync
 *
 * Usage:
 *   node src/scripts/register-plans.js
 *
 * Environment:
 *   PAYMENT_SERVICE_URL  - Payment service base URL (default: http://localhost:5020)
 *   PAYMENT_API_KEY      - Service API key for product authentication
 */

require('dotenv').config();

const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5020';
const PAYMENT_API_KEY = process.env.PAYMENT_API_KEY;

// ─── Plan Catalog ──────────────────────────────────────────────────────

const PLAN_CATALOG = [
  // ── Free ──
  {
    planId: 'free',
    name: 'Free',
    description: 'Basic task management and scheduling',
    price_cents: 0,
    currency: 'USD',
    interval_type: 'month',
    interval_count: 1,
    trial_days: 0,
    sort_order: 0,
    is_visible: true,
    features: {
      limits: {
        active_tasks: 50,
        habit_templates: 5,
        projects: 5,
        locations: 3,
        schedule_templates: 3,
        ai_commands_per_month: 30
      },
      calendar: {
        auto_sync: false,
        max_providers: 1
      },
      scheduling: {
        travel_time: false,
        dependencies: false
      },
      ai: {
        natural_language_commands: true,
        bulk_project_creation: false
      },
      data: {
        import: true,
        export: false,
        mcp_access: false
      },
      tasks: {
        rigid: true
      }
    },
    metadata: {
      display_name: 'Free',
      cta_text: 'Get Started',
      feature_highlights: [
        '50 active tasks',
        '5 projects',
        '30 AI commands/month',
        'Basic scheduling'
      ]
    }
  },

  // ── Pro Monthly ──
  {
    planId: 'pro-monthly',
    name: 'Pro',
    description: 'Full-featured task management with AI and calendar sync',
    price_cents: 1200,
    currency: 'USD',
    interval_type: 'month',
    interval_count: 1,
    trial_days: 7,
    sort_order: 1,
    is_visible: true,
    features: {
      limits: {
        active_tasks: 200,
        habit_templates: 25,
        projects: 20,
        locations: 10,
        schedule_templates: 10,
        ai_commands_per_month: 100
      },
      calendar: {
        auto_sync: true,
        max_providers: 2
      },
      scheduling: {
        travel_time: true,
        dependencies: true
      },
      ai: {
        natural_language_commands: true,
        bulk_project_creation: false
      },
      data: {
        import: true,
        export: true,
        mcp_access: true
      },
      tasks: {
        rigid: true
      }
    },
    metadata: {
      display_name: 'Pro',
      badge: 'Most Popular',
      highlight: true,
      cta_text: 'Start Free Trial',
      feature_highlights: [
        '200 active tasks',
        '20 projects',
        '100 AI commands/month',
        'Calendar sync',
        'Task dependencies',
        'Travel time',
        'Data export + MCP',
        '7-day free trial'
      ]
    }
  },

  // ── Pro Annual ──
  {
    planId: 'pro-annual',
    name: 'Pro (Annual)',
    description: 'Full-featured task management — save with annual billing',
    price_cents: 10800,
    currency: 'USD',
    interval_type: 'year',
    interval_count: 1,
    trial_days: 7,
    sort_order: 2,
    is_visible: true,
    features: {
      limits: {
        active_tasks: 200,
        habit_templates: 25,
        projects: 20,
        locations: 10,
        schedule_templates: 10,
        ai_commands_per_month: 100
      },
      calendar: {
        auto_sync: true,
        max_providers: 2
      },
      scheduling: {
        travel_time: true,
        dependencies: true
      },
      ai: {
        natural_language_commands: true,
        bulk_project_creation: false
      },
      data: {
        import: true,
        export: true,
        mcp_access: true
      },
      tasks: {
        rigid: true
      }
    },
    metadata: {
      display_name: 'Pro',
      badge: 'Save 25%',
      cta_text: 'Start Free Trial',
      feature_highlights: [
        'Everything in Pro',
        'Billed annually at $108/year',
        '$9/month (save $36/year)'
      ]
    }
  },

  // ── Premium Monthly ──
  {
    planId: 'premium-monthly',
    name: 'Premium',
    description: 'Unlimited tasks with advanced AI and team features',
    price_cents: 1900,
    currency: 'USD',
    interval_type: 'month',
    interval_count: 1,
    trial_days: 7,
    sort_order: 3,
    is_visible: true,
    features: {
      limits: {
        active_tasks: -1,
        habit_templates: -1,
        projects: -1,
        locations: -1,
        schedule_templates: -1,
        ai_commands_per_month: -1
      },
      calendar: {
        auto_sync: true,
        max_providers: 5
      },
      scheduling: {
        travel_time: true,
        dependencies: true
      },
      ai: {
        natural_language_commands: true,
        bulk_project_creation: true
      },
      data: {
        import: true,
        export: true,
        mcp_access: true
      },
      tasks: {
        rigid: true
      }
    },
    metadata: {
      display_name: 'Premium',
      cta_text: 'Start Free Trial',
      feature_highlights: [
        'Unlimited tasks & projects',
        'Unlimited AI commands',
        'Bulk project creation',
        '5 calendar providers',
        'Priority support'
      ]
    }
  },

  // ── Premium Annual ──
  {
    planId: 'premium-annual',
    name: 'Premium (Annual)',
    description: 'Unlimited everything — save with annual billing',
    price_cents: 18000,
    currency: 'USD',
    interval_type: 'year',
    interval_count: 1,
    trial_days: 7,
    sort_order: 4,
    is_visible: true,
    features: {
      limits: {
        active_tasks: -1,
        habit_templates: -1,
        projects: -1,
        locations: -1,
        schedule_templates: -1,
        ai_commands_per_month: -1
      },
      calendar: {
        auto_sync: true,
        max_providers: 5
      },
      scheduling: {
        travel_time: true,
        dependencies: true
      },
      ai: {
        natural_language_commands: true,
        bulk_project_creation: true
      },
      data: {
        import: true,
        export: true,
        mcp_access: true
      },
      tasks: {
        rigid: true
      }
    },
    metadata: {
      display_name: 'Premium',
      badge: 'Save 21%',
      cta_text: 'Start Free Trial',
      feature_highlights: [
        'Everything in Premium',
        'Billed annually at $180/year',
        '$15/month (save $48/year)'
      ]
    }
  },

];

// ─── Sync Logic ────────────────────────────────────────────────────────

async function syncPlans() {
  const url = `${PAYMENT_SERVICE_URL}/api/products/juggler/plans/sync`;

  console.log(`Syncing ${PLAN_CATALOG.length} plans to ${url}...`);

  const headers = { 'Content-Type': 'application/json' };
  if (PAYMENT_API_KEY) {
    headers['X-Service-Key'] = PAYMENT_API_KEY;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ plans: PLAN_CATALOG })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sync failed (${response.status}): ${body}`);
  }

  const result = await response.json();
  console.log('Sync results:', JSON.stringify(result.results, null, 2));
  return result;
}

// ─── CLI entry point ───────────────────────────────────────────────────

if (require.main === module) {
  syncPlans()
    .then(() => {
      console.log('Plan registration complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Plan registration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { PLAN_CATALOG, syncPlans };
