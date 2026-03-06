/**
 * Simplified JWT Authentication Middleware for Juggler
 * No RBAC, no impersonation, no token blacklist — just Google OAuth + JWT
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');

let JWT_SECRET = null;
let secretsLoaded = false;

/**
 * Load JWT secrets at startup
 */
async function loadJWTSecrets() {
  if (process.env.JWT_SECRET) {
    JWT_SECRET = process.env.JWT_SECRET;
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  } else {
    JWT_SECRET = 'local-dev-jwt-secret-juggler';
    console.warn('Using default JWT secret — development only');
  }
  secretsLoaded = true;
  console.log('JWT secret loaded');
}

function getSecret() {
  if (!JWT_SECRET) {
    throw new Error('JWT secrets not loaded — call loadJWTSecrets() first');
  }
  return JWT_SECRET;
}

/**
 * Generate JWT access token
 */
function generateAccessToken(user) {
  const jti = crypto.randomBytes(16).toString('hex');
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
      type: 'access',
      jti
    },
    getSecret(),
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      issuer: 'juggler',
      subject: user.id
    }
  );
}

/**
 * Generate JWT refresh token
 */
function generateRefreshToken(user) {
  const jti = crypto.randomBytes(16).toString('hex');
  return jwt.sign(
    {
      userId: user.id,
      type: 'refresh',
      jti
    },
    getSecret(),
    {
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
      issuer: 'juggler',
      subject: user.id
    }
  );
}

/**
 * Verify a JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    }
    throw new Error('Token verification failed');
  }
}

/**
 * JWT Authentication Middleware — requires valid JWT
 */
const authenticateJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Provide Authorization Bearer token'
      });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (decoded.type !== 'access') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const user = await db('users').where('id', decoded.userId).first();

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    req.auth = { method: 'jwt', tokenData: decoded };

    return next();
  } catch (error) {
    if (error.message === 'Token expired') {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Your session has expired. Please log in again.',
        code: 'TOKEN_EXPIRED'
      });
    } else if (error.message === 'Invalid token') {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'The authentication token is invalid.',
        code: 'INVALID_TOKEN'
      });
    }

    res.status(500).json({
      error: 'Authentication error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Authentication error'
    });
  }
};

/**
 * Validate refresh token middleware
 */
const validateRefreshToken = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    const decoded = verifyToken(refreshToken);

    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid refresh token type' });
    }

    const user = await db('users').where('id', decoded.userId).first();

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    req.refreshTokenData = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      error: 'Invalid refresh token',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Invalid refresh token'
    });
  }
};

module.exports = {
  loadJWTSecrets,
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  authenticateJWT,
  validateRefreshToken
};
