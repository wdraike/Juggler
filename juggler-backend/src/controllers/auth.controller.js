/**
 * Auth Controller — Legacy functions kept for MCP OAuth compatibility
 *
 * Login, refresh, logout, and profile are now handled by auth-service.
 * Only findOrCreateGoogleUser remains — used by MCP OAuth authorize flow.
 */

const { v7: uuidv7 } = require('uuid');
const db = require('../db');

/**
 * Find or create a user from Google OAuth profile data.
 * Used by the MCP OAuth callback (oauth/authorize.js).
 */
async function findOrCreateGoogleUser({ googleId, email, name, picture }) {
  let user = await db('users').where('google_id', googleId).first();

  if (!user) {
    user = await db('users').where('email', email).first();

    if (user) {
      await db('users').where('id', user.id).update({
        google_id: googleId,
        picture_url: picture,
        updated_at: db.fn.now()
      });
      user = await db('users').where('id', user.id).first();
    } else {
      const userId = uuidv7();
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
    await db('users').where('id', user.id).update({
      name,
      picture_url: picture,
      updated_at: db.fn.now()
    });
    user = await db('users').where('id', user.id).first();
  }

  return user;
}

module.exports = {
  findOrCreateGoogleUser
};
