/**
 * MCP Schedule Tools — expose scheduler as MCP tools
 */

const { z } = require('zod');
const { runScheduleAndPersist, getSchedulePlacements } = require('../../scheduler/runSchedule');
const { withLock } = require('../../lib/sync-lock');

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
      // Wrap the run in the per-user sync lock so this MCP path can't race
      // against the REST /schedule/run endpoint or the background queue
      // worker. Retry a few times with backoff if the lock is held, then
      // surface the contention as an MCP error.
      var attempts = 5;
      for (var i = 0; i < attempts; i++) {
        var result = await withLock(userId, function() {
          return runScheduleAndPersist(userId);
        });
        if (result !== null) {
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        await new Promise(function(r) { setTimeout(r, 1000 * (i + 1)); });
      }
      return {
        content: [{ type: 'text', text: 'Error: Scheduler is busy for this user (lock held after ' + attempts + ' retries). Try again in a few seconds.' }],
        isError: true
      };
    }
  );
}

module.exports = { registerScheduleTools };
