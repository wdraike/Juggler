/**
 * OAuth Token Endpoint for MCP
 *
 * Proxies token requests to auth-service, which issues RS256 JWTs.
 * The MCP client (Claude/Cursor) exchanges auth codes here,
 * and we forward to auth-service for actual token issuance.
 */

const crypto = require('crypto');
const db = require('../db');
const { APP_ID } = require('../service-identity');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5010';

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

  if (redirect_uri && authCode.redirect_uri !== redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
  }

  if (authCode.code_challenge) {
    if (!code_verifier) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'code_verifier required' });
    }
    if (!verifyPKCE(code_verifier, authCode.code_challenge)) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
    }
  }

  await db('oauth_auth_codes').where('code', code).update({ used: true });

  // Issue tokens via auth-service internal endpoint (service-to-service)
  try {
    const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || '';
    const response = await fetch(`${AUTH_SERVICE_URL}/internal/tokens/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': INTERNAL_SERVICE_KEY
      },
      body: JSON.stringify({ user_id: authCode.user_id })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Auth-service token issue failed:', response.status, errBody);
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Token exchange failed' });
    }

    const data = await response.json();
    res.json({
      access_token: data.access_token,
      token_type: 'Bearer',
      expires_in: data.expires_in || 3600,
      refresh_token: data.refresh_token
    });
  } catch (fetchError) {
    console.error('Auth-service token exchange failed:', fetchError);
    return res.status(500).json({ error: 'server_error', error_description: 'Auth service unavailable' });
  }
}

async function handleRefreshToken(req, res) {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token is required' });
  }

  // Proxy refresh to auth-service
  try {
    const response = await fetch(`${AUTH_SERVICE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refresh_token })
    });

    if (!response.ok) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
    }

    const data = await response.json();
    res.json({
      access_token: data.tokens.accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: data.tokens.refreshToken
    });
  } catch (fetchError) {
    console.error('Auth-service refresh failed:', fetchError);
    return res.status(500).json({ error: 'server_error', error_description: 'Auth service unavailable' });
  }
}

module.exports = { tokenEndpoint };
