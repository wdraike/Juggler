/**
 * Shared Auth Client for Raike Applications
 *
 * Verifies JWTs using the auth-service's JWKS public key.
 * Checks Redis for an active session key — if the key doesn't exist,
 * the user has logged out and the token is rejected instantly.
 *
 * Flow:
 *   Login  → auth-service sets  auth:active:<userId> in Redis (TTL = 1h)
 *   Logout → auth-service DELs  auth:active:<userId> from Redis
 *   Request → this client checks EXISTS auth:active:<userId> (<1ms)
 *
 * Falls open: if Redis is unavailable, tokens are still signature-verified.
 *
 * Usage:
 *   const { authenticateJWT } = require('auth-client');
 *   app.use('/api', authenticateJWT(APP_ID));
 */

const { createRemoteJWKSet, jwtVerify } = require('jose');

// Cached JWKS fetcher — auto-refreshes keys
let _jwks = null;

function getJWKS() {
  if (!_jwks) {
    const jwksUrl = process.env.AUTH_JWKS_URL || 'http://localhost:5010/.well-known/jwks.json';
    _jwks = createRemoteJWKSet(new URL(jwksUrl));
  }
  return _jwks;
}

// ─── Redis session check ────────────────────────────────────────

let _redis = null;
let _redisReady = false;

function getRedis() {
  if (_redis) return _redisReady ? _redis : null;
  try {
    const Redis = require('ioredis');
    const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    _redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
      retryStrategy(times) { return times > 3 ? null : Math.min(times * 200, 2000); },
    });
    _redis.on('connect', () => { _redisReady = true; });
    _redis.on('error', () => { _redisReady = false; });
    _redis.on('close', () => { _redisReady = false; });
    return _redisReady ? _redis : null;
  } catch {
    return null;
  }
}

/**
 * Check if user has an active session in Redis.
 * Returns true if active (or Redis unavailable), false if logged out.
 */
async function isSessionActive(userId) {
  if (!userId) return false;
  const redis = getRedis();
  if (!redis) return true; // Fail open — can't check, allow
  try {
    return (await redis.exists(`auth:active:${userId}`)) === 1;
  } catch {
    return true; // Fail open
  }
}

// ─── Middleware ──────────────────────────────────────────────────

/**
 * Create JWT authentication middleware for a specific app
 */
function authenticateJWT(appId) {
  return async (req, res, next) => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    try {
      const { payload } = await jwtVerify(header.substring(7), getJWKS(), {
        issuer: 'raike-auth'
      });

      // Check active session in Redis
      if (!await isSessionActive(payload.sub)) {
        return res.status(401).json({ error: 'Session ended', code: 'SESSION_ENDED' });
      }

      // Check app authorization
      if (appId && !payload.apps?.includes(appId)) {
        return res.status(403).json({ error: 'No access to this application' });
      }

      req.user = { id: payload.sub, email: payload.email, name: payload.name };
      req.auth = {
        roles: payload.roles || [],
        apps: payload.apps || [],
        plans: payload.plans || {},
        jti: payload.jti,
        method: 'jwt',
        actingAsAdmin: payload.acting_as_admin || null,
      };

      next();
    } catch (err) {
      if (err.code === 'ERR_JWT_EXPIRED') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

/**
 * Optional JWT authentication — continues without auth if no token provided
 */
function optionalJWT(appId) {
  return async (req, res, next) => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      return next();
    }

    try {
      const { payload } = await jwtVerify(header.substring(7), getJWKS(), {
        issuer: 'raike-auth'
      });

      if (!await isSessionActive(payload.sub)) {
        return next(); // Logged out — continue unauthenticated
      }

      if (appId && !payload.apps?.includes(appId)) {
        return next();
      }

      req.user = { id: payload.sub, email: payload.email, name: payload.name };
      req.auth = { roles: payload.roles || [], apps: payload.apps || [], plans: payload.plans || {} };
    } catch {
      // Token invalid, continue unauthenticated
    }

    next();
  };
}

/**
 * Require admin role middleware (use after authenticateJWT)
 */
function requireAdmin(req, res, next) {
  if (!req.auth?.roles?.includes('admin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Check if user has a specific subscription plan for an app
 */
function requirePlan(appId, planIds) {
  const plans = Array.isArray(planIds) ? planIds : [planIds];
  return (req, res, next) => {
    const userPlan = req.auth?.plans?.[appId];
    if (!userPlan || !plans.includes(userPlan)) {
      return res.status(403).json({ error: 'Subscription required', required_plans: plans });
    }
    next();
  };
}

module.exports = {
  authenticateJWT,
  optionalJWT,
  requireAdmin,
  requirePlan
};
