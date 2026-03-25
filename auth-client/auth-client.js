/**
 * Shared Auth Client for Raike Applications
 *
 * Used by Juggler, Resume Optimizer, and future apps to verify JWTs
 * without sharing the private key. Fetches and caches the public key
 * from auth-service's JWKS endpoint.
 *
 * Usage:
 *   const { authenticateJWT } = require('auth-client');
 *   app.use('/api', authenticateJWT('juggler'));
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

/**
 * Create JWT authentication middleware for a specific app
 *
 * @param {string} appId - The application identifier (e.g., 'juggler', 'resume-optimizer')
 * @returns {Function} Express middleware
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

      // Check app authorization
      if (appId && !payload.apps?.includes(appId)) {
        return res.status(403).json({ error: 'No access to this application' });
      }

      // Populate req.user and req.auth
      req.user = {
        id: payload.sub,
        email: payload.email,
        name: payload.name
      };
      req.auth = {
        roles: payload.roles || [],
        apps: payload.apps || [],
        plans: payload.plans || {},
        jti: payload.jti,
        method: 'jwt'
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
 *
 * @param {string} [appId] - Optional application identifier to check
 * @returns {Function} Express middleware
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

      if (appId && !payload.apps?.includes(appId)) {
        return next(); // No access, but continue unauthenticated
      }

      req.user = { id: payload.sub, email: payload.email, name: payload.name };
      req.auth = { roles: payload.roles || [], apps: payload.apps || [], plans: payload.plans || {} };
    } catch (err) {
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
 *
 * @param {string} appId - Application identifier
 * @param {string|string[]} planIds - Required plan identifier(s)
 * @returns {Function} Express middleware
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
