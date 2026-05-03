const db = require('../db');
const { authServiceUrl } = require('../proxy-config');

async function callAuthServiceImpersonate(adminUserId, targetUserId, reason) {
  const key = process.env.INTERNAL_SERVICE_KEY;
  if (!key) throw new Error('INTERNAL_SERVICE_KEY is not set');

  const url = `${authServiceUrl}/internal/auth/impersonate`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Key': key },
    body: JSON.stringify({ admin_user_id: adminUserId, target_user_id: targetUserId, reason: reason || null }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const err = new Error(payload.error || `auth-service returned ${response.status}`);
    err.status = response.status;
    err.body = payload;
    throw err;
  }
  return payload;
}

async function insertAuditRow(adminUserId, targetUserId, action, req) {
  try {
    await db('impersonation_log').insert({
      admin_user_id: adminUserId,
      target_user_id: targetUserId || null,
      action,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      created_at: new Date(),
      updated_at: new Date(),
    });
  } catch (auditErr) {
    console.warn('[juggler/impersonation] audit insert failed:', auditErr.message);
  }
}

const startImpersonation = async (req, res) => {
  try {
    const { targetUserId, reason } = req.body || {};
    const admin = req.user;

    if (!targetUserId) {
      return res.status(400).json({ error: 'targetUserId is required' });
    }
    if (targetUserId === admin.id) {
      return res.status(400).json({ error: 'Cannot impersonate yourself' });
    }

    let result;
    try {
      result = await callAuthServiceImpersonate(admin.id, targetUserId, reason);
    } catch (err) {
      if (err.status && err.status < 500) {
        return res.status(err.status).json(err.body || { error: err.message });
      }
      console.error('[juggler/impersonation] auth-service call failed:', err);
      return res.status(503).json({ error: 'Impersonation service unavailable' });
    }

    await insertAuditRow(admin.id, targetUserId, 'start_impersonation', req);

    return res.json({
      message: 'Impersonation started',
      accessToken: result.access_token,
      expiresIn: result.expires_in,
      impersonating: result.impersonating,
    });
  } catch (err) {
    console.error('[juggler/impersonation] unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const stopImpersonation = async (req, res) => {
  try {
    // With an impersonation token: sub=target, acting_as_admin=admin ID.
    const actingAsAdmin = req.auth?.actingAsAdmin;
    const adminUserId = actingAsAdmin || req.user.id;
    const targetUserId = actingAsAdmin ? req.user.id : null;
    await insertAuditRow(adminUserId, targetUserId, 'stop_impersonation', req);
    return res.json({ message: 'Impersonation stopped. Discard the impersonation token client-side.' });
  } catch (err) {
    console.error('[juggler/impersonation] stop error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const getImpersonationTargets = async (req, res) => {
  try {
    const { search, limit = 50, offset = 0 } = req.query;
    const parsedLimit = parseInt(limit);
    const lim = Math.min(Math.max(1, Number.isNaN(parsedLimit) ? 50 : parsedLimit), 100);
    const off = Math.max(0, parseInt(offset) || 0);

    let query = db('users').select('id', 'email', 'created_at');
    if (search) {
      query = query.where('email', 'like', `%${search}%`);
    }

    const countQuery = query.clone().clearSelect().count('* as count');
    const [{ count }] = await countQuery;

    const users = await query.orderBy('email').limit(lim).offset(off);

    return res.json({
      users,
      pagination: { total: parseInt(count), limit: lim, offset: off, hasMore: off + lim < parseInt(count) }
    });
  } catch (err) {
    console.error('[juggler/impersonation] targets error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const getImpersonationLog = async (req, res) => {
  try {
    const { limit = 50, offset = 0, adminUserId, targetUserId } = req.query;
    const parsedLimit = parseInt(limit);
    const lim = Math.min(Math.max(1, Number.isNaN(parsedLimit) ? 50 : parsedLimit), 100);
    const off = Math.max(0, parseInt(offset) || 0);

    let query = db('impersonation_log')
      .select(
        'impersonation_log.*',
        'admin_users.email as admin_email'
      )
      .leftJoin('users as admin_users', 'impersonation_log.admin_user_id', 'admin_users.id')
      .orderBy('impersonation_log.created_at', 'desc');

    if (adminUserId) query = query.where('impersonation_log.admin_user_id', adminUserId);
    if (targetUserId) query = query.where('impersonation_log.target_user_id', targetUserId);

    const countQuery = query.clone().clearSelect().clearOrder().count('impersonation_log.id as count');
    const [{ count }] = await countQuery;

    const logs = await query.limit(lim).offset(off);

    return res.json({
      logs,
      pagination: { total: parseInt(count), limit: lim, offset: off, hasMore: off + lim < parseInt(count) }
    });
  } catch (err) {
    console.error('[juggler/impersonation] log error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { startImpersonation, stopImpersonation, getImpersonationTargets, getImpersonationLog };
