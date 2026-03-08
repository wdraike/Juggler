/**
 * OAuth Dynamic Client Registration (RFC 7591)
 * POST /oauth/register
 *
 * Claude auto-registers as an OAuth client when connecting.
 */

const crypto = require('crypto');
const db = require('../db');

async function register(req, res) {
  try {
    const { client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method } = req.body;

    const clientId = crypto.randomBytes(16).toString('hex');
    const clientSecret = crypto.randomBytes(32).toString('hex');

    await db('oauth_clients').insert({
      client_id: clientId,
      client_secret: clientSecret,
      client_name: client_name || 'MCP Client',
      redirect_uris: JSON.stringify(redirect_uris || [])
    });

    res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret,
      client_name: client_name || 'MCP Client',
      redirect_uris: redirect_uris || [],
      grant_types: grant_types || ['authorization_code', 'refresh_token'],
      response_types: response_types || ['code'],
      token_endpoint_auth_method: token_endpoint_auth_method || 'client_secret_post'
    });
  } catch (error) {
    console.error('Client registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
}

module.exports = { register };
