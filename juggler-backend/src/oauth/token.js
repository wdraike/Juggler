/**
 * OAuth Token Endpoint
 * POST /oauth/token
 *
 * Supports:
 * - grant_type=authorization_code (with PKCE)
 * - grant_type=refresh_token
 */

const crypto = require('crypto');
const db = require('../db');
const { generateAccessToken, generateRefreshToken, verifyToken } = require('../middleware/jwt-auth');

/**
 * Verify PKCE code_verifier against stored code_challenge (S256)
 */
function verifyPKCE(codeVerifier, codeChallenge) {
  const hash = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return hash === codeChallenge;
}

async function tokenEndpoint(req, res) {
  try {
    const { grant_type } = req.body;

    if (grant_type === 'authorization_code') {
      return await handleAuthorizationCode(req, res);
    } else if (grant_type === 'refresh_token') {
      return await handleRefreshToken(req, res);
    } else {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }
  } catch (error) {
    console.error('Token endpoint error:', error);
    res.status(500).json({ error: 'server_error', error_description: 'Internal server error' });
  }
}

async function handleAuthorizationCode(req, res) {
  const { code, code_verifier, redirect_uri } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'code is required' });
  }

  // Look up the auth code
  const authCode = await db('oauth_auth_codes')
    .where('code', code)
    .where('used', false)
    .first();

  if (!authCode) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' });
  }

  if (new Date(authCode.expires_at) < new Date()) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code expired' });
  }

  // Verify redirect_uri matches
  if (redirect_uri && authCode.redirect_uri !== redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
  }

  // Verify PKCE if code_challenge was stored
  if (authCode.code_challenge) {
    if (!code_verifier) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'code_verifier required' });
    }
    if (!verifyPKCE(code_verifier, authCode.code_challenge)) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }
  }

  // Mark code as used
  await db('oauth_auth_codes').where('code', code).update({ used: true });

  // Load user
  const user = await db('users').where('id', authCode.user_id).first();
  if (!user) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'User not found' });
  }

  // Issue tokens
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 604800, // 7 days in seconds
    refresh_token: refreshToken
  });
}

async function handleRefreshToken(req, res) {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token is required' });
  }

  let decoded;
  try {
    decoded = verifyToken(refresh_token);
  } catch (e) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
  }

  if (decoded.type !== 'refresh') {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Not a refresh token' });
  }

  const user = await db('users').where('id', decoded.userId).first();
  if (!user) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'User not found' });
  }

  const accessToken = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken(user);

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 604800,
    refresh_token: newRefreshToken
  });
}

module.exports = { tokenEndpoint };
