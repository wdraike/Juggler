/**
 * KnexDebugReads — the scheduler slice's two admin/debug reads, moved VERBATIM
 * from scheduler/facade.js (JUG-FACADE-DB-VIOLATIONS stage 1) so the facade
 * carries zero direct db access (adapters are the slice's only DB layer —
 * see eslint.boundaries.config.js DB_DIRECT_SELECTORS).
 *
 * Both are deliberately NOT port methods:
 *  - loadDebugTasks is admin /debug's OWN tasks_v load (schedule.routes.js
 *    ~L90) — deliberately NOT SchedulerTaskProvider.loadSchedulableRows,
 *    which uses a DIFFERENT filter for the live scheduler's working set.
 *  - findStepperSessionOwner is stepper /step/:id/stop's raw ownership read
 *    (schedule.routes.js ~L198), used only when schedulerSession.getSession()
 *    already returned null. NOT ScheduleRepositoryPort (that port is the S5
 *    delta-write seam only); schedulerSession.js is concurrently owned and
 *    untouched.
 */

'use strict';

var libDb = require('../../../lib/db');
function getDb() { return libDb.getDefaultDb(); }

function loadDebugTasks(userId) {
  return getDb()('tasks_v').where({ user_id: userId }).whereNot('status', 'disabled');
}

function findStepperSessionOwner(sessionId) {
  return getDb()('scheduler_sessions').where('session_id', sessionId).first();
}

module.exports = { loadDebugTasks: loadDebugTasks, findStepperSessionOwner: findStepperSessionOwner };
