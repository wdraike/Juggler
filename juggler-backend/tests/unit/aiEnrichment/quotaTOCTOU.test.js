// 999.1576 inc.4: fixture inserts are test-context writes — stamp them 'jest'
// (array-aware; explicit fixture attribution wins). See juggler/CLAUDE.md Approved Fallbacks.
const __stampFixture = (rows) => require('../../../src/lib/audit-context').stampInsert(rows);
/**
 * B11 RED regression tests — STEP 0 (pre-fix, must FAIL against current code)
 *
 * Bug: 999.415 — quota TOCTOU (Time-Of-Check Time-Of-Use) atomicity gap.
 *
 * ── CURRENT STATE (post-W1b) ─────────────────────────────────────────────────
 * The quota is a split check/commit:
 *   checkQuota(userId)  — counts ai_command_log rows in the 24h window vs the
 *                         50/day limit. Returns { allowed: bool }. NO insert.
 *   commitQuota(userId) — inserts ONE row. Called ONLY after a successful call.
 *
 * Neither operation is atomic. Two concurrent requests can BOTH:
 *   1. Call checkQuota → both see count=49 → both get { allowed: true }
 *   2. Call commitQuota → both insert → count becomes 51 → cap overshot.
 *
 * This race is real at MySQL level (not a mock artifact) — two concurrent SELECT
 * COUNT + INSERT sequences on the same user produce this exact outcome.
 *
 * ── TARGET CONTRACT (atomic acquire) ─────────────────────────────────────────
 * After the fix, exactly ONE concurrent acquisition must win at count=49.
 * The invariant (expressed as the test assertion, mechanism-agnostic):
 *
 *   AFTER two concurrent "acquire slot" calls both succeed in their checkQuota
 *   phase (both see count=49), the total row count in ai_command_log for the
 *   test user MUST be ≤ 50 (the cap).  At most ONE of the two concurrent paths
 *   was allowed to commit; the other was denied.
 *
 * Bert and cookie choose the atomicity mechanism — any of:
 *   a) SELECT ... FOR UPDATE inside a transaction (row-lock the count query).
 *   b) INSERT gated by a unique-window constraint (DB rejects the 51st insert).
 *   c) Atomic counter table with CASE/UPDATE guard.
 * The test asserts the BEHAVIORAL contract, not the mechanism, so it is robust
 * to whichever approach is chosen.
 *
 * ── TEST INVENTORY ────────────────────────────────────────────────────────────
 *   B11-race  [EXPECT-RED]  — seed user at count=49; fire TWO concurrent
 *                             acquire attempts (checkQuota+commitQuota or the
 *                             eventual atomic path) via Promise.all against
 *                             REAL MySQL 3407; assert count ≤ 50 after both.
 *                             FAILS on current code: both pass checkQuota
 *                             (see count=49) then both commitQuota → count=51.
 *
 *   B11-guard [GUARD-GREEN] — single normal call under the limit; assert exactly
 *                             1 row committed. Happy path must not be broken.
 *                             Currently PASSES (and must stay GREEN after fix).
 *
 *   B11-deny  [DENY-GREEN]  — seed user at EXACTLY the daily limit; call
 *                             commitQuota once; assert (a) resolves without
 *                             throwing, (b) row count stays at limit (no insert).
 *                             Positive assertion for the atomic-DENY branch
 *                             (count >= limit → skip INSERT, commit cleanly).
 *                             999.432.
 *
 * ── WHY REAL DB (not a mock) ──────────────────────────────────────────────────
 * A mock cannot exhibit the TOCTOU race: the mock is synchronous and does not
 * serialize concurrent calls the way MySQL does (or doesn't). The race condition
 * only exists at the real DB level where two concurrent SELECT COUNT() queries
 * return the same snapshot before either INSERT commits.
 *
 * Run against test-bed MySQL 3407 (tmpfs):
 *   cd test-bed && make up && make test-juggler
 *   OR:
 *   DB_HOST=127.0.0.1 DB_PORT=3407 DB_USER=root DB_PASSWORD=rootpass \
 *   DB_NAME=juggler_test NODE_ENV=test \
 *   npx jest --testPathPattern=quotaTOCTOU --verbose
 *
 * Hard-fails via assertDbAvailable() [TEST-FR-001] when test-bed is unavailable — never silently skips.
 *
 * ── TRACEABILITY ──────────────────────────────────────────────────────────────
 *   .planning/kermit/juggler-h5-fixes/TRACEABILITY.md B11
 *   .planning/kermit/quota-denypath-test/ (999.432 — B11-deny)
 *
 * ── MUTATION NOTE ─────────────────────────────────────────────────────────────
 *   B11-race oracle: `count <= 50` after two concurrent acquires.
 *     Mutant: remove atomicity (back to plain checkQuota+commitQuota) → count=51
 *             → `toBeGreaterThan(50)` proves the non-atomic version overshoots.
 *             The post-fix atomic version returns count=50 → assertion passes.
 *   B11-guard oracle: exactly 1 row after a single successful acquire.
 *     Mutant: skip commitQuota (or atomic insert skipped) → 0 rows → `toBe(1)` fails.
 *   B11-deny oracle: count stays === limit after commitQuota when at limit.
 *     Mutant: remove `if (count < limit)` guard so INSERT always runs →
 *             count becomes limit+1 → `toBe(limit)` fails → mutant KILLED.
 */

'use strict';

process.env.NODE_ENV = 'test';

const testDb = require('../../helpers/test-db');
const { assertDbAvailable } = require('../../helpers/requireDB');
const KnexAIUsageRepository = require('../../../src/slices/ai-enrichment/adapters/KnexAIUsageRepository');

// Unique user IDs for this suite — avoids collisions with other suites.
const USER_B11 = 'telly-b11-toctou';       // B11-race, B11-guard, B11-deny share this user;
                                            // each test cleans up in beforeEach.
const USER_DENY = 'telly-b11-deny';        // Dedicated user for the deny-branch test
                                            // (isolated seed so beforeEach wipes only USER_B11).

// Read the daily limit from the repository export — do NOT hardcode.
// KnexAIUsageRepository.AI_DAILY_LIMIT is the single source of truth.
const AI_DAILY_LIMIT = KnexAIUsageRepository.AI_DAILY_LIMIT;

// How many rows to pre-seed (one below the limit — the boundary where TOCTOU fires).
const SEED_COUNT = AI_DAILY_LIMIT - 1; // 49 rows → both concurrent callers see "under limit"

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seed `count` ai_command_log rows for `userId`, all within the 24h window.
 * Uses direct inserts (not via the repository) so we can seed past the check logic.
 */
async function seedRows(userId, count) {
  if (count === 0) return;
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({ user_id: userId });
  }
  // Insert in a single batch for speed; created_at defaults to NOW().
  await testDb('ai_command_log').insert(__stampFixture(rows));
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('B11 — quota TOCTOU: concurrent acquisitions must not overshoot the 50/day cap', () => {
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await testDb.isAvailable();
    if (!dbAvailable) return;

    // Ensure test users exist (ai_command_log.user_id FK → users.id).
    await testDb('users')
      .insert(__stampFixture({
        id: USER_B11,
        email: 'telly-b11-toctou@example.com',
        name: 'Telly B11 TOCTOU Test',
      }))
      .onConflict('id')
      .ignore();

    await testDb('users')
      .insert(__stampFixture({
        id: USER_DENY,
        email: 'telly-b11-deny@example.com',
        name: 'Telly B11 DENY Test',
      }))
      .onConflict('id')
      .ignore();
  });

  afterAll(async () => {
    if (dbAvailable) {
      // FK-safe cleanup: child rows first, then user rows.
      await testDb('ai_command_log').where('user_id', USER_B11).del().catch(() => {});
      await testDb('users').where('id', USER_B11).del().catch(() => {});
      await testDb('ai_command_log').where('user_id', USER_DENY).del().catch(() => {});
      await testDb('users').where('id', USER_DENY).del().catch(() => {});
      await testDb.destroy();
    }
  });

  beforeEach(async () => {
    // Clean slate before each test — wipe all rows for this user.
    // (DB-down tests throw [TEST-FR-001] in-body before reaching any DB call here.)
    if (!dbAvailable) return;
    await testDb('ai_command_log').where('user_id', USER_B11).del();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // B11-race — the TOCTOU race (EXPECT-RED against current code)
  //
  // Setup: seed 49 rows (one below the cap). Two concurrent "acquire" calls:
  //   caller A: checkQuota → sees count=49 (allowed) → commitQuota
  //   caller B: checkQuota → sees count=49 (allowed) → commitQuota
  //
  // On current code (non-atomic):
  //   Both SELECT COUNT queries run before either INSERT commits → both see 49
  //   → both allowed=true → both insert → final count = 51.
  //
  // Post-fix (atomic):
  //   The atomic acquire (transaction+FOR UPDATE, or unique-constraint, etc.)
  //   ensures that when the first INSERT commits, the second acquire re-evaluates
  //   the count and sees 50 → denied → does NOT insert → final count = 50.
  //
  // Assertion: count after both calls MUST be ≤ 50.
  // Fails today: count is 51 (both insert past the cap).
  // ───────────────────────────────────────────────────────────────────────────
  test(
    'B11-race [EXPECT-RED]: two concurrent acquires at count=49 → at most 50 rows total (currently 51 — TOCTOU)',
    async () => {
      // TEST-FR-001: throw loud if the required DB is unreachable (never silent-skip).
      await assertDbAvailable();

      // ── Step 1: Seed 49 rows (one below the cap). ───────────────────────
      await seedRows(USER_B11, SEED_COUNT);

      // Verify pre-condition: exactly 49 rows before the race.
      const rowsBefore = await testDb('ai_command_log').where('user_id', USER_B11);
      expect(rowsBefore).toHaveLength(SEED_COUNT);

      // ── Step 2: Build TWO independent repository instances. ─────────────
      // Each instance uses the same DB pool but executes its own queries.
      // This models two concurrent HTTP requests hitting the same server.
      const repoA = new KnexAIUsageRepository({ db: testDb });
      const repoB = new KnexAIUsageRepository({ db: testDb });

      // ── Step 3: Two concurrent acquire paths via Promise.all. ────────────
      //
      // Each "acquire" path mirrors the controller flow:
      //   1. checkQuota  → { allowed: bool }  (count-only, no insert)
      //   2. if allowed: commitQuota           (insert one row)
      //
      // Promise.all fires BOTH paths simultaneously. MySQL receives:
      //   SELECT COUNT(*) for A  ─┐ both at count=49, both return allowed:true
      //   SELECT COUNT(*) for B  ─┘
      //   INSERT for A           ─┐ both execute their insert
      //   INSERT for B           ─┘
      //
      // Current (non-atomic): both inserts succeed → 51 rows → TOCTOU proven.
      // Post-fix (atomic):    second acquire detects 50 rows → denied → 50 rows.
      //
      // We capture the allowed results to verify that on current code both see
      // allowed=true (proving the TOCTOU, not just proving the count is wrong).
      let allowedA = false;
      let allowedB = false;

      const [resultA, resultB] = await Promise.all([
        (async () => {
          const q = await repoA.checkQuota(USER_B11);
          if (q.allowed) await repoA.commitQuota(USER_B11);
          return q;
        })(),
        (async () => {
          const q = await repoB.checkQuota(USER_B11);
          if (q.allowed) await repoB.commitQuota(USER_B11);
          return q;
        })(),
      ]);

      allowedA = resultA.allowed;
      allowedB = resultB.allowed;

      // ── Step 4: Count rows after both concurrent acquires. ───────────────
      const rowsAfter = await testDb('ai_command_log').where('user_id', USER_B11);
      const finalCount = rowsAfter.length;

      // ── Step 5: RED assertion — must FAIL on current code. ───────────────
      //
      // On current code: both callers see count=49 (allowed=true), both commit
      // → finalCount = 51 → this assertion FAILS (51 > 50).
      //
      // Post-fix: at most ONE concurrent caller commits past the 49th slot.
      // The atomic acquire guarantees finalCount ≤ 50 (exactly 50 if both
      // allowed, which is impossible with correct atomicity).
      //
      // Expected post-fix: finalCount === 50 (one wins, one loses).
      // The assertion is ≤50 (not ===50) to be robust to both mechanisms:
      //   - FOR UPDATE: second caller sees count=50 → denied → doesn't insert → 50
      //   - Unique constraint: second insert rejected → 50
      // Both produce finalCount=50. We assert ≤50 for mechanism safety.
      expect(finalCount).toBeLessThanOrEqual(AI_DAILY_LIMIT);
      // ^^ FAILS on current code: finalCount=51, 51 > 50.
      //    PASSES post-fix: finalCount=50, 50 ≤ 50.

      // Document the TOCTOU proof: on current code, both callers see allowed=true.
      // (This is informational — the count assertion above is the binding one.)
      //
      // When this test is RED: allowedA=true and allowedB=true (both passed checkQuota)
      //   → both committed → 51 rows.
      // When this test is GREEN (post-fix): exactly one allowed=true (the other was
      //   denied by the atomic mechanism) → 50 rows.
      //
      // We do NOT assert on allowedA/allowedB individually because the fix could
      // surface the denial as a rejected promise (constraint violation) rather than
      // returning allowed=false from checkQuota — both are valid implementations.
      // The finalCount ≤ 50 assertion is the sole behavioral gate.
      if (process.env.TELLY_VERBOSE) {
        console.log(`B11-race: allowedA=${allowedA}, allowedB=${allowedB}, finalCount=${finalCount}`);
      }
    },
    15000 // 15s to accommodate test-bed MySQL jitter under parallel load
  );

  // ───────────────────────────────────────────────────────────────────────────
  // B11-guard — happy-path non-regression (GUARD-GREEN)
  //
  // A single normal call under the limit must still succeed + commit exactly
  // ONE row. This test must GREEN on current code and stay GREEN post-fix.
  // Ensures the atomicity fix does not break the happy path.
  // ───────────────────────────────────────────────────────────────────────────
  test(
    'B11-guard [GUARD-GREEN]: single acquire under the limit → exactly 1 row committed',
    async () => {
      // TEST-FR-001: throw loud if the required DB is unreachable (never silent-skip).
      await assertDbAvailable();

      // Start from a clean slate (beforeEach already cleared rows).
      // Seed 48 rows — well under the cap; no risk of denial.
      await seedRows(USER_B11, 48);

      const repo = new KnexAIUsageRepository({ db: testDb });

      // Step 1: check — must return allowed:true.
      const quota = await repo.checkQuota(USER_B11);
      expect(quota.allowed).toBe(true);

      // Step 2: verify checkQuota did NOT insert (split contract).
      const rowsAfterCheck = await testDb('ai_command_log').where('user_id', USER_B11);
      expect(rowsAfterCheck).toHaveLength(48);

      // Step 3: commit — insert one slot.
      await repo.commitQuota(USER_B11);

      // Step 4: assert exactly one new row (48 seed + 1 commit = 49).
      const rowsAfterCommit = await testDb('ai_command_log').where('user_id', USER_B11);
      expect(rowsAfterCommit).toHaveLength(49);
      // ^^ Mutation: skip commitQuota → 48 rows → toBe(49) fails → mutant KILLED.

      // Step 5: verify the committed row is within the 24h window (sanity).
      const lastRow = rowsAfterCommit[rowsAfterCommit.length - 1];
      expect(lastRow.user_id).toBe(USER_B11);
    },
    10000
  );

  // ───────────────────────────────────────────────────────────────────────────
  // B11-deny — atomic DENY branch positive assertion (DENY-GREEN, 999.432)
  //
  // When the 24h window is ALREADY at the daily limit, commitQuota must:
  //   (a) resolve without throwing (fail-open: caller keeps its AI result).
  //   (b) NOT insert a new row (count stays == limit, not limit+1).
  //
  // This is the race-loser path: a caller that passed the advisory checkQuota
  // but, by the time the FOR UPDATE lock is acquired inside commitQuota, the
  // limit is already filled. The transaction commits cleanly (no INSERT, no
  // throw) — the slot is silently denied.
  //
  // The existing B11-race test only asserts finalCount <= 50. B11-deny
  // positively asserts the deny path's idempotency: a fully-saturated user
  // never overshoots.
  //
  // Mutation-meaningful: removing the `if (count < limit)` guard inside
  // commitQuota (so it always inserts) makes this test RED — count becomes
  // limit+1, breaking `toBe(limit)`. The guard is thus pinned to this
  // assertion.
  //
  // Uses a dedicated USER_DENY (not USER_B11) so beforeEach's wipe of
  // USER_B11 does not interfere, and afterAll cleans both.
  // ───────────────────────────────────────────────────────────────────────────
  test(
    'B11-deny [DENY-GREEN]: commitQuota at exactly the daily limit → resolves, no new row inserted',
    async () => {
      // TEST-FR-001: hard-fail if test-bed is unavailable — never silent-skip.
      await assertDbAvailable();

      // ── Step 1: Clean slate for DENY user. ──────────────────────────────
      await testDb('ai_command_log').where('user_id', USER_DENY).del();

      // ── Step 2: Seed EXACTLY `limit` rows within the 24h window. ────────
      // This puts the user at the cap before commitQuota is called.
      // We seed directly (bypassing the repo) so the pre-condition is
      // deterministic regardless of any repo logic.
      await seedRows(USER_DENY, AI_DAILY_LIMIT);

      // Verify pre-condition: exactly `limit` rows before the call.
      const countBefore = await testDb('ai_command_log')
        .where('user_id', USER_DENY)
        .count('id as cnt')
        .first();
      expect(Number(countBefore.cnt)).toBe(AI_DAILY_LIMIT);

      // ── Step 3: Call commitQuota — must resolve without throwing. ────────
      // The FOR UPDATE re-count sees count == limit → skips INSERT.
      // The transaction commits cleanly (fail-open: no throw).
      const repo = new KnexAIUsageRepository({ db: testDb });
      await expect(repo.commitQuota(USER_DENY)).resolves.toBeUndefined();
      // ^^ Assertion (a): resolves without throwing.

      // ── Step 4: Assert row count is STILL exactly `limit`. ──────────────
      const countAfter = await testDb('ai_command_log')
        .where('user_id', USER_DENY)
        .count('id as cnt')
        .first();
      expect(Number(countAfter.cnt)).toBe(AI_DAILY_LIMIT);
      // ^^ Assertion (b): no new row inserted — deny branch skipped INSERT.
      //
      // Mutation-meaningful: if the `if (count < limit)` guard is removed
      // so commitQuota always inserts, this assertion fails:
      //   countAfter.cnt = limit+1 (51) ≠ limit (50) → toBe(limit) RED.
      // The guard is pinned by this assertion.
    },
    10000
  );
});
