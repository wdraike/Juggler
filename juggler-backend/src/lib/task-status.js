/**
 * Task status library — re-exports from shared/task-status.js
 *
 * The canonical source of truth lives in shared/task-status.js.
 * This file is a back-compat re-export shim so existing importers
 * (require('../lib/task-status')) continue to work without changes.
 */
module.exports = require('juggler-shared/task-status');
