#!/usr/bin/env node
/**
 * Seed a test user and print a 30-day JWT access token.
 * Usage:  node scripts/seed-test-user.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const knexConfig = require('../knexfile');
const knex = require('knex')(knexConfig.development);
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const TEST_USER_ID = 'test-user-00000000-0000-0000-0000';
const TEST_EMAIL = 'test@juggler.local';
const TEST_NAME = 'Test User';

const JWT_SECRET = process.env.JWT_SECRET || 'local-dev-jwt-secret-juggler';

async function main() {
  try {
    // Upsert test user
    const existing = await knex('users').where('id', TEST_USER_ID).first();
    if (existing) {
      await knex('users').where('id', TEST_USER_ID).update({
        email: TEST_EMAIL,
        name: TEST_NAME,
        updated_at: knex.fn.now()
      });
      console.error('Updated existing test user:', TEST_USER_ID);
    } else {
      await knex('users').insert({
        id: TEST_USER_ID,
        email: TEST_EMAIL,
        name: TEST_NAME,
        google_id: 'test-google-id',
        timezone: 'America/New_York',
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });
      console.error('Created test user:', TEST_USER_ID);
    }

    // Generate 30-day access token (same shape as authenticateJWT expects)
    const jti = crypto.randomBytes(16).toString('hex');
    const token = jwt.sign(
      {
        userId: TEST_USER_ID,
        email: TEST_EMAIL,
        name: TEST_NAME,
        type: 'access',
        jti
      },
      JWT_SECRET,
      {
        expiresIn: '30d',
        issuer: 'juggler',
        subject: TEST_USER_ID
      }
    );

    // Print token to stdout (info to stderr so piping works)
    console.error('Token expires in 30 days');
    console.log(token);
  } catch (error) {
    console.error('Seed error:', error.message);
    process.exit(1);
  } finally {
    await knex.destroy();
  }
}

main();
