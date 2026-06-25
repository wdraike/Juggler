/**
 * Batch-import test helper — wraps the REAL MCP create_task handler per row.
 *
 * There is no dedicated bulk-import use-case in src that returns a per-row
 * { successful, failed, errors } summary; the production batch path
 * (MCP create_tasks) validates the whole array and aborts atomically on the
 * first bad row. To give callers a per-row outcome WITHOUT inventing any new
 * validation, this helper runs each row through the same real create_task
 * handler the MCP server uses (src/mcp/tools/tasks.js) and aggregates the
 * results.
 *
 * Faithfulness: a row "fails" only when the REAL handler returns isError
 * (i.e. the product itself rejected it). The recorded `error` is the product's
 * actual message — no error code (e.g. 'invalid_combination') is synthesized.
 * If the product accepts a row that a test expected it to reject, that row is
 * reported successful here, surfacing the real product behavior rather than
 * masking it.
 */

var mcp = require('./mcp');

async function batchImportTasks(rows, opts) {
  rows = rows || [];
  var result = { successful: 0, failed: 0, errors: [], ids: [] };

  for (var i = 0; i < rows.length; i++) {
    try {
      var created = await mcp.createTask(Object.assign({ _userId: opts && opts.userId }, rows[i]));
      result.successful += 1;
      if (created && created.id) result.ids.push(created.id);
    } catch (e) {
      result.failed += 1;
      // Surface the PRODUCT's real rejection message under both keys so callers
      // can assert on either shape; never a fabricated code.
      result.errors.push({ row: i, error: e.error || e.message });
    }
  }

  return result;
}

module.exports = { batchImportTasks: batchImportTasks };
