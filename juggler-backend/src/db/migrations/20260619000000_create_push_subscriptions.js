'use strict';

/**
 * Create push_subscriptions table for Web Push task reminders (backlog 999.252).
 *
 * Stores one row per browser Push API subscription a user has granted. A single
 * user may have many subscriptions (one per browser/device). sendPush() loads a
 * user's subscriptions and POSTs an encrypted payload to each endpoint via
 * web-push; subscriptions that the push service reports as gone (HTTP 410/404)
 * are pruned.
 *
 * Design decisions:
 * - `endpoint` is the canonical subscription identity (the push-service URL).
 *   It is UNIQUE — re-subscribing the same browser upserts rather than dupes.
 *   It can be long (FCM/Apple endpoints exceed 255 chars), so we use TEXT plus a
 *   prefix-indexed unique key (the first 255 chars are unique enough in practice;
 *   web-push always sends to the full stored endpoint).
 * - `p256dh` / `auth` are the subscription's public encryption keys (base64url).
 * - `user_id` is the local users.id (tenancy). FK-less by convention here (the
 *   rest of the schema scopes by user_id string without hard FKs to users).
 * - `created_at` is set by the application (P1: new Date(), never fn.now()).
 * - Collation utf8mb4_unicode_ci explicitly (juggler/CLAUDE.md — MySQL 8 default
 *   utf8mb4_0900_ai_ci silently breaks joins).
 */
exports.up = async function (knex) {
  await knex.schema.createTable('push_subscriptions', function (table) {
    table.string('id', 36).primary(); // uuidv7
    table.string('user_id', 36).notNullable();
    table.text('endpoint').notNullable();
    table.string('p256dh', 255).notNullable()
      .comment('subscription public key (base64url)');
    table.string('auth', 255).notNullable()
      .comment('subscription auth secret (base64url)');
    table.timestamp('created_at', { useTz: false }).notNullable();

    table.index(['user_id'], 'idx_push_subscriptions_user');

    table.collate('utf8mb4_unicode_ci');
  });

  // Unique on endpoint via a 255-char prefix (TEXT columns require a key length
  // in MySQL). Re-subscribing the same browser upserts on this key.
  await knex.raw(
    'ALTER TABLE push_subscriptions ADD UNIQUE INDEX uq_push_subscriptions_endpoint (endpoint(255))'
  );
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('push_subscriptions');
};
