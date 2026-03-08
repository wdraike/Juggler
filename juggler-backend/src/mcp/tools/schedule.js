/**
 * MCP Schedule Tools — expose scheduler as MCP tools
 */

const { z } = require('zod');
const { runScheduleAndPersist, getSchedulePlacements } = require('../../scheduler/runSchedule');

function registerScheduleTools(server, userId) {

  // ── get_schedule ──
  server.tool(
    'get_schedule',
    'Get the current schedule placements (read-only, does not modify tasks). Returns day-by-day placements, unplaced tasks, and deadline misses.',
    {},
    async () => {
      const result = await getSchedulePlacements(userId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── run_schedule ──
  server.tool(
    'run_schedule',
    'Run the scheduler and persist date/time changes to tasks. Returns stats on tasks moved, cleared, and reset.',
    {},
    async () => {
      const result = await runScheduleAndPersist(userId);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { registerScheduleTools };
