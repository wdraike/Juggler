/**
 * Auth Controller — Google OAuth + JWT for Juggler
 */

const { OAuth2Client } = require('google-auth-library');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { generateAccessToken, generateRefreshToken, validateRefreshToken } = require('../middleware/jwt-auth');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * POST /api/auth/google
 * Receive Google ID token, verify, find-or-create user, return JWT
 */
async function googleLogin(req, res) {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'Google ID token required' });
    }

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Find or create user
    let user = await db('users').where('google_id', googleId).first();

    if (!user) {
      // Check if user exists by email (might have been created differently)
      user = await db('users').where('email', email).first();

      if (user) {
        // Update with Google ID
        await db('users').where('id', user.id).update({
          google_id: googleId,
          picture_url: picture,
          updated_at: db.fn.now()
        });
        user = await db('users').where('id', user.id).first();
      } else {
        // Create new user
        const userId = uuidv4();
        await db('users').insert({
          id: userId,
          email,
          name,
          picture_url: picture,
          google_id: googleId,
          timezone: 'America/New_York'
        });
        user = await db('users').where('id', userId).first();
      }
    } else {
      // Update name/picture if changed
      await db('users').where('id', user.id).update({
        name,
        picture_url: picture,
        updated_at: db.fn.now()
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Set refresh token as HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    res.json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture_url,
        timezone: user.timezone
      }
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(401).json({
      error: 'Authentication failed',
      message: error.message
    });
  }
}

/**
 * POST /api/auth/refresh
 * Validate refresh token, issue new access token
 */
async function refresh(req, res) {
  try {
    // req.user is set by validateRefreshToken middleware
    const user = req.user;
    const accessToken = generateAccessToken(user);

    res.json({ accessToken });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({
      error: 'Refresh failed',
      message: error.message
    });
  }
}

/**
 * POST /api/auth/logout
 * Clear refresh token cookie
 */
async function logout(req, res) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
  res.json({ message: 'Logged out' });
}

/**
 * GET /api/auth/me
 * Return current user profile
 */
async function getMe(req, res) {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      picture: req.user.picture_url,
      timezone: req.user.timezone
    }
  });
}

module.exports = {
  googleLogin,
  refresh,
  logout,
  getMe
};
