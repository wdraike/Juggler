'use strict';

/**
 * 999.5277 — drop juggler's dead oauth_clients / oauth_auth_codes tables,
 * but ONLY where they are empty.
 *
 * WHY THEY ARE DEAD. Both were created 2026-03-08 by
 * 20260308000000_add_oauth_tables.js ("Add OAuth tables for MCP Custom
 * Connectors") for a self-hosted-OAuth design that was later superseded by the
 * proxy-to-auth-service pattern. Verified during 999.5276: NO controller,
 * service or route under juggler-backend/src/ references either table outside
 * the migrations that create them. app.js mounts createOAuthProxyRoutes() from
 * the shared auth-client/mcp-auth.js, but that only proxies HTTP to
 * auth-service's own /oauth/* endpoints and performs zero local DB access
 * (auth-service/shared/mcp-auth.js touches only db('users')). The single
 * remaining reference anywhere is test cleanup in tests/helpers/test-db.js,
 * which deletes CHILD rows by user_id. app.js also already carries a
 * "RETIREMENT CANDIDATE 999.1579" comment; 999.1579 closed having done docs
 * only, never the schema.
 *
 * NOTE these are juggler's OWN tables in the `juggler` database. auth-service
 * has SAME-NAMED but physically distinct tables in `auth_service` (confirmed
 * via each service's knexfile DB_NAME). This migration must never touch those.
 *
 * WHY THE EMPTY GUARD, rather than an unconditional DROP. Dropping a table is
 * irreversible, and row counts were verified on dev-bed ONLY (0 and 0) —
 * production was never queried. So the guard IS the verification: if any row
 * exists in any environment, this migration REFUSES to drop, logs loudly, and
 * leaves the table in place for a human to investigate. That makes it safe to
 * run everywhere without a prior per-environment census.
 *
 * `down` is a deliberate NO-OP, per the established repo precedent for
 * conditional repairs (see resume-optimizer's 999.4834 note): `up` no-ops
 * wherever the object is absent or non-empty, so a symmetric `down` would have
 * to RECREATE tables this migration may never have dropped — and a
 * migrate:rollback aimed at some other migration in the same batch would then
 * resurrect dead schema. Recreating them is a deliberate act, not a rollback.
 */

const DEAD_TABLES = ['oauth_auth_codes', 'oauth_clients']; // child first — FK order

exports.up = async function up(knex) {
  for (const table of DEAD_TABLES) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;

    const [{ count }] = await knex(table).count({ count: '*' });
    const rows = Number(count);

    if (rows > 0) {
      // Fail-loud-but-non-fatal: refusing is the correct outcome, and the
      // migration must still complete so it does not block the chain.
      // eslint-disable-next-line no-console
      console.warn(
        `[999.5277] REFUSING to drop \`${table}\`: it holds ${rows} row(s). ` +
        'This table was believed dead (no application-code consumers). ' +
        'Investigate what wrote these rows before dropping it by hand.'
      );
      continue;
    }

    await knex.schema.dropTableIfExists(table);
    // eslint-disable-next-line no-console
    console.log(`[999.5277] dropped dead table \`${table}\` (0 rows).`);
  }
};

exports.down = async function down() {};
