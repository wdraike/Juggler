'use strict';

/**
 * push-subscriptions — data access for the push_subscriptions table (999.252).
 *
 * Thin knex repository. The push-service is storage-agnostic (it takes
 * loadSubscriptions/deleteSubscription callbacks); these functions are the
 * production wiring of those callbacks.
 */

const { v7: uuidv7 } = require('uuid');
const db = require('../db');

/**
 * Upsert a subscription for a user. Endpoint is the unique identity — re-subscribing
 * the same browser updates the keys (and re-owners it to the current user) rather
 * than creating a duplicate row.
 *
 * @param {string} userId
 * @param {{endpoint:string, keys:{p256dh:string, auth:string}}} subscription
 * @returns {Promise<{id:string, created:boolean}>}
 */
async function upsertSubscription(userId, subscription) {
  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys.p256dh;
  const auth = subscription.keys.auth;

  const existing = await db('push_subscriptions').where('endpoint', endpoint).first();
  if (existing) {
    await db('push_subscriptions')
      .where('id', existing.id)
      .update({ user_id: userId, p256dh, auth });
    return { id: existing.id, created: false };
  }

  const id = uuidv7();
  await db('push_subscriptions').insert({
    id,
    user_id: userId,
    endpoint,
    p256dh,
    auth,
    created_at: new Date(),
  });
  return { id, created: true };
}

/**
 * Remove a subscription by endpoint, scoped to the owning user (tenancy guard —
 * a user can only delete their own subscriptions).
 *
 * @returns {Promise<number>} rows deleted (0 or 1)
 */
async function removeSubscription(userId, endpoint) {
  return db('push_subscriptions')
    .where({ user_id: userId, endpoint })
    .del();
}

/** Load all subscriptions for a user. */
async function loadSubscriptions(userId) {
  return db('push_subscriptions')
    .where('user_id', userId)
    .select('id', 'endpoint', 'p256dh', 'auth');
}

/** Delete a subscription by primary key (used by sendPush to prune dead endpoints). */
async function deleteById(id) {
  return db('push_subscriptions').where('id', id).del();
}

module.exports = {
  upsertSubscription,
  removeSubscription,
  loadSubscriptions,
  deleteById,
};
