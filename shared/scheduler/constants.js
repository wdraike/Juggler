'use strict';

/**
 * Shared scheduler constants (999.1426, per 999.1185(e): "move PRI_RANK to
 * shared").
 *
 * PRI_RANK — priority weighting used by slack sorting and priority ranking:
 * P1 > P2 > P3 > P4. Was duplicated between
 * juggler-frontend/src/state/constants.js and
 * juggler-backend/src/slices/scheduler/domain/constants.js. This module is the
 * shared home; the frontend re-exports from here.
 *
 * NOTE (backend half, out of scope for the frontend-only 999.1426 leg): the
 * backend still owns its own frozen copy in
 * juggler-backend/src/slices/scheduler/domain/constants.js — re-pointing that
 * module here is a backend change. Until then the two MUST stay
 * value-identical: { P1: 100, P2: 80, P3: 50, P4: 20 }.
 */
var PRI_RANK = Object.freeze({ P1: 100, P2: 80, P3: 50, P4: 20 });

module.exports = {
  PRI_RANK: PRI_RANK
};
