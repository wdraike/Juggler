/**
 * MCP test helper — wraps the REAL MCP task tool handlers.
 *
 * These helpers do NOT reimplement task logic. They register the production
 * tool handlers from src/mcp/tools/tasks.js against a capturing fake server
 * (the same pattern tests/mcp-create-task-boundary.test.js uses), then invoke
 * the captured handler with the test's params. The handler runs against the
 * real test-bed DB (src/db resolves to the `test` knex env on 3407) and the
 * real validation / write path.
 *
 * Faithful surfacing of product behavior:
 *  - The MCP tool contract returns { content:[{text}], isError? } rather than
 *    throwing. A handler that returns isError:true is the product's way of
 *    REJECTING. We translate that into a rejected promise so tests can use
 *    `.rejects` — but the rejection carries the REAL handler message and the
 *    parsed result, never a fabricated error code. If the product does not
 *    reject a given input, this helper does not either.
 *  - On success we parse the JSON payload the handler emits and return the
 *    task object, mirroring what an MCP client would receive.
 */

var { registerTaskTools } = require('../src/mcp/tools/tasks');

var DEFAULT_USER_ID = '1';

function captureHandlers(userId) {
  var handlers = {};
  var fakeServer = {
    tool: function (name, _desc, _schema, handler) {
      handlers[name] = handler;
    }
  };
  registerTaskTools(fakeServer, userId || DEFAULT_USER_ID);
  return handlers;
}

// Extract the text payload an MCP tool handler returns.
function resultText(result) {
  if (result && Array.isArray(result.content) && result.content[0]) {
    return result.content[0].text;
  }
  return '';
}

// Parse the JSON body a successful handler emits (handlers JSON-stringify the
// task / summary object). Returns the raw text if it is not JSON.
function parseResult(result) {
  var text = resultText(result);
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

// Translate an isError result into a rejection. The thrown object exposes the
// real handler message as both `message` and `error` so tests asserting
// `.rejects.toMatchObject({ error: ... })` see the PRODUCT's actual output and
// `.rejects.toThrow(...)` works too. No error code is invented here.
function rejectionFrom(result) {
  var text = resultText(result);
  var err = new Error(text);
  err.error = text;
  err.isError = true;
  err.result = result;
  return err;
}

async function createTask(params) {
  var handlers = captureHandlers(params && params._userId);
  var handler = handlers['create_task'];
  if (!handler) throw new Error('create_task handler not registered');
  var result = await handler(Object.assign({}, params));
  if (result && result.isError) {
    throw rejectionFrom(result);
  }
  return parseResult(result);
}

async function updateTask(id, fields) {
  var handlers = captureHandlers(fields && fields._userId);
  var handler = handlers['update_task'];
  if (!handler) throw new Error('update_task handler not registered');
  var result = await handler(Object.assign({ id: id }, fields));
  if (result && result.isError) {
    throw rejectionFrom(result);
  }
  return parseResult(result);
}

async function createTasks(tasks, opts) {
  var handlers = captureHandlers(opts && opts.userId);
  var handler = handlers['create_tasks'];
  if (!handler) throw new Error('create_tasks handler not registered');
  var result = await handler({ tasks: tasks });
  if (result && result.isError) {
    throw rejectionFrom(result);
  }
  return parseResult(result);
}

module.exports = {
  createTask: createTask,
  updateTask: updateTask,
  createTasks: createTasks,
  // Lower-level access for suites that want to inspect the raw handler result.
  captureHandlers: captureHandlers,
  parseResult: parseResult
};
