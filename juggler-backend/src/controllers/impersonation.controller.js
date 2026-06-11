/**
 * Impersonation Controller — THIN HTTP adapter over the user-config slice facade
 * (Phase H4 / W6).
 *
 * The admin actor-switch (start/stop + targets/log) was extracted into the
 * `slices/user-config` slice (Impersonate / StopImpersonation commands +
 * ListImpersonationTargets / GetImpersonationLog queries over the W3
 * ConfigRepositoryPort + the injected auth-service call). This controller is now
 * THIN: it maps `req` → use-case input, delegates to `slices/user-config/facade`,
 * and maps the `{ status, body }` envelope onto express. ZERO direct DB access (no
 * getDb — W6 acceptance b); no longer requires `src/db.js` (ADR-0002 delta).
 *
 * ── SECURITY (elmo gate) ──
 * The admin-authz gate (impersonation.routes.js authenticateAdmin on /start,
 * /targets, /log) stays at the ROUTE edge — NOT moved here. The /stop route is the
 * any-authenticated-user path (the impersonation-token holder stops their own
 * session), exactly as the legacy routed it. No guard is dropped.
 *
 * ── PAGINATION CLAMP (preserved) ──
 * The legacy clamped limit/offset to `Math.min(Math.max(1, ...), 100)` — that
 * clamp now lives in the ListImpersonationTargets / GetImpersonationLog use-cases
 * (verbatim: `Math.min(` the parsed limit, `, 100)`), so the response shape +
 * caps are byte-identical (golden-master H5-10).
 */

'use strict';

const facade = require('../slices/user-config/facade');
const { createLogger } = require('@raike/lib-logger');
const logger = createLogger('impersonation');

const startImpersonation = async (req, res) => {
  try {
    const { targetUserId, reason } = req.body || {};
    const result = await facade.startImpersonation({
      admin: req.user,
      targetUserId,
      reason,
      audit: { ip: req.ip, userAgent: req.get('User-Agent') }
    });
    // The 503 service-error log line stays at the controller edge (an express/logging
    // concern); the use-case classifies the error and carries the original on _serviceError.
    if (result._serviceError) {
      logger.error('[juggler/impersonation] auth-service call failed:', result._serviceError);
    }
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('[juggler/impersonation] unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const stopImpersonation = async (req, res) => {
  try {
    // With an impersonation token: sub=target, acting_as_admin=admin ID.
    const result = await facade.stopImpersonation({
      user: req.user,
      actingAsAdmin: req.auth?.actingAsAdmin,
      audit: { ip: req.ip, userAgent: req.get('User-Agent') }
    });
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('[juggler/impersonation] stop error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const getImpersonationTargets = async (req, res) => {
  try {
    const result = await facade.getImpersonationTargets({ query: req.query });
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('[juggler/impersonation] targets error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const getImpersonationLog = async (req, res) => {
  try {
    const result = await facade.getImpersonationLog({ query: req.query });
    return res.status(result.status).json(result.body);
  } catch (err) {
    logger.error('[juggler/impersonation] log error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { startImpersonation, stopImpersonation, getImpersonationTargets, getImpersonationLog };
