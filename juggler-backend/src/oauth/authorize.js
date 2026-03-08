/**
 * OAuth Authorization Endpoint + Google Callback
 *
 * Flow:
 * 1. Claude redirects user to GET /oauth/authorize with PKCE params
 * 2. We store params in DB, redirect user to Google OAuth consent
 * 3. Google redirects back to GET /oauth/google-callback
 * 4. We exchange Google code for tokens, find-or-create user
 * 5. Generate our auth code, redirect to Claude's redirect_uri
 */

const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');
const { findOrCreateGoogleUser } = require('../controllers/auth.controller');

function getGoogleClient() {
  const issuer = process.env.MCP_ISSUER_URL || 'http://localhost:5002';
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${issuer}/oauth/google-callback`
  );
}

/**
 * GET /oauth/authorize
 * Claude sends user here to begin the OAuth flow.
 */
async function authorize(req, res) {
  try {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, scope, response_type } = req.query;

    if (!client_id || !redirect_uri) {
      return res.status(400).json({ error: 'client_id and redirect_uri required' });
    }

    // Generate a unique state for our Google OAuth redirect
    const jugglerState = crypto.randomBytes(32).toString('hex');

    // Store the pending authorization in DB
    // We'll use a temporary placeholder code that gets replaced after Google callback
    const tempCode = 'pending_' + crypto.randomBytes(16).toString('hex');
    await db('oauth_auth_codes').insert({
      code: tempCode,
      user_id: 'pending',
      client_id,
      redirect_uri,
      code_challenge: code_challenge || null,
      code_challenge_method: code_challenge_method || 'S256',
      original_state: state || null,
      juggler_state: jugglerState,
      expires_at: new Date(Date.now() + 10 * 60 * 1000), // 10 min
      used: false
    });

    // Redirect to Google OAuth consent
    const googleClient = getGoogleClient();
    const googleAuthUrl = googleClient.generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'email', 'profile'],
      state: jugglerState,
      prompt: 'consent'
    });

    res.redirect(googleAuthUrl);
  } catch (error) {
    console.error('OAuth authorize error:', error);
    res.status(500).json({ error: 'Authorization failed' });
  }
}

/**
 * GET /oauth/google-callback
 * Google redirects back here after user consents.
 */
async function googleCallback(req, res) {
  try {
    const { code: googleCode, state: jugglerState, error: googleError } = req.query;

    if (googleError) {
      return res.status(400).json({ error: `Google OAuth error: ${googleError}` });
    }

    if (!googleCode || !jugglerState) {
      return res.status(400).json({ error: 'Missing code or state from Google' });
    }

    // Look up the pending auth record by juggler_state
    const pending = await db('oauth_auth_codes')
      .where('juggler_state', jugglerState)
      .where('used', false)
      .first();

    if (!pending) {
      return res.status(400).json({ error: 'Invalid or expired state' });
    }

    if (new Date(pending.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Authorization request expired' });
    }

    // Exchange Google auth code for tokens
    const googleClient = getGoogleClient();
    const { tokens } = await googleClient.getToken(googleCode);
    googleClient.setCredentials(tokens);

    // Verify the ID token and extract user info
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const user = await findOrCreateGoogleUser({
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture
    });

    // Generate our auth code
    const authCode = crypto.randomBytes(32).toString('hex');

    // Update the pending record with real user and code
    await db('oauth_auth_codes')
      .where('juggler_state', jugglerState)
      .update({
        code: authCode,
        user_id: user.id,
        used: false
      });

    // Redirect back to Claude's redirect_uri with our auth code
    const redirectUrl = new URL(pending.redirect_uri);
    redirectUrl.searchParams.set('code', authCode);
    if (pending.original_state) {
      redirectUrl.searchParams.set('state', pending.original_state);
    }

    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('Google callback error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

module.exports = { authorize, googleCallback };
