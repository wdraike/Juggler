/**
 * jest `setupFiles` entry — loads .env.test into process.env BEFORE any test
 * file's own top-level `require`s run.
 *
 * 999.1037 root cause: a test file that requires a production DB-backed
 * module (e.g. a controller) ABOVE its own `require('./helpers/test-setup')`
 * triggers src/lib/db/index.js's eager, process-wide getDefaultDb() singleton
 * BEFORE test-setup.js's require('dotenv').config({path: '.env.test'}) call
 * ever runs. The singleton then permanently caches DB_PASSWORD='' (unset) —
 * this jest process's mysql2 connections silently authenticate with NO
 * password for the rest of the run, producing MySQL's own access-denied
 * error ("user 'root'@'<client-ip-as-seen-by-the-docker-mysql-server>',
 * using password: NO") — which reads like a wrong host, but is actually a
 * dropped password. `setupFiles` runs before the test framework/test file is
 * even required, so this guarantees .env.test wins the race regardless of
 * what a given test file requires in what order. dotenv.config() never
 * overrides an already-set process.env var, so an explicit shell export
 * (e.g. `DB_PORT=3407 jest`) still takes precedence.
 */
'use strict';
var path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.test') });
