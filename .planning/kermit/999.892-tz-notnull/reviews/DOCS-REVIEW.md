# DOCS-REVIEW: 999.892-tz-notnull — TIMEZONE-RULES.md (RE-VERIFY)

**Reviewer:** prairie (documentation verifier)  
**Date:** 2026-06-26 (re-verification after abby's fixes)  
**Spec:** docs/TIMEZONE-RULES.md (abby)  
**Migration:** src/db/migrations/20260626000000_users_timezone_not_null.js (bert)  
**Against:** BASE-DOCUMENTATION-RUBRIC (contract accuracy, code faithfulness, cross-reference validity)

---

## Scope of Re-Verification

This review re-examines abby's targeted fixes to TZ-DISPLAY-3 and TZ-ERR-2 after the prior BLOCK finding. The pre-existing TZ-ERR-1 gap (invalid IANA validation not implemented) is noted as OUT OF SCOPE and deferred as a separate follow-up per user directive.

---

## Proof Checklist

- [x] TZ-DISPLAY-3 no longer claims invalid-IANA-value fallback behavior
- [x] TZ-ERR-2 no longer claims invalid-IANA-value fallback behavior
- [x] TZ-DISPLAY-3/TZ-ERR-2 now correctly scope fallback to: absent user row OR missing x-timezone header
- [x] TZ-SCHEMA-1 accurately describes migration 20260626000000 (NOT NULL DEFAULT + backfill)
- [x] Migration file exists and performs claimed SQL
- [x] Test file exists
- [x] Column-null contract unchanged (KnexConfigRepository.getUserTimezone still returns null at A1)
- [x] Cross-references accurate (migration filename, test file, collation name)

---

## Findings

### PASS-1: TZ-DISPLAY-3 Fix Verified

**Severity:** PASS  
**Scope:** TZ-DISPLAY-3  
**Location:** docs/TIMEZONE-RULES.md lines 71–77

**Prior Claim (BLOCKED):**
> "If the stored value is an invalid IANA name (see TZ-ERR-1), the system defaults to `America/New_York`."

**Current Claim (TRUTHFUL):**
> "As of migration `20260626000000` (TZ-SCHEMA-1), a null `users.timezone` column cannot occur for any existing row; this fallback now covers only: an absent user row, or a missing `x-timezone` header. (Handling of an invalid stored IANA name is not currently validated by the code and is tracked separately — see TZ-ERR-1.)"

**Verification:**
- Fallback now correctly scoped to: (1) absent user row, OR (2) missing x-timezone header
- No longer claims invalid IANA names are handled
- Parenthetical honestly notes that invalid IANA handling is not implemented
- This matches the actual code behavior (timezone used as-is without validation in schedulerSession.js, deriveSchedulePlacements.js)

**Status:** PASS ✓

---

### PASS-2: TZ-ERR-2 Fix Verified

**Severity:** PASS  
**Scope:** TZ-ERR-2  
**Location:** docs/TIMEZONE-RULES.md lines 262–265

**Prior Claim (BLOCKED):**
> "or the stored value fails IANA validation, the system MUST use the default `America/New_York`"

**Current Claim (TRUTHFUL):**
> "If no timezone is available (no user row, or no `x-timezone` header), the system MUST use the default `America/New_York` and proceed normally. The request MUST NOT fail. A null `users.timezone` column is no longer a trigger for this fallback — TZ-SCHEMA-1 ensures the column is non-null for any existing row; the remaining triggers are an absent user row or a missing `x-timezone` header."

**Verification:**
- Invalid IANA validation claim removed
- Fallback triggers now accurately limited to: (1) absent user row, OR (2) missing x-timezone header
- Correctly notes that post-migration, a null column is no longer a valid trigger (DEFAULT + backfill ensure non-null)
- Matches actual code behavior: `resolveTimezone()` in deriveSchedulePlacements.js uses timezone from DB/header as-is

**Status:** PASS ✓

---

### PASS-3: TZ-SCHEMA-1 Accuracy Verified

**Severity:** PASS  
**Scope:** TZ-SCHEMA-1 + migration implementation  
**Location:** docs/TIMEZONE-RULES.md lines 32–46

**Claim:**
> "The `users.timezone` column is schema-level `NOT NULL DEFAULT 'America/New_York' COLLATE utf8mb4_unicode_ci` (migration `20260626000000_users_timezone_not_null.js`). All pre-existing NULL values were backfilled to `'America/New_York'` on migration up."

**Code Verification:**

Migration file (src/db/migrations/20260626000000_users_timezone_not_null.js):
```javascript
// Line 22: Backfill existing NULLs
await knex('users').whereNull('timezone').update({ timezone: 'America/New_York' });

// Lines 25–27: Alter column to NOT NULL
await knex.raw(
  "ALTER TABLE users MODIFY timezone VARCHAR(100) NOT NULL DEFAULT 'America/New_York' COLLATE utf8mb4_unicode_ci"
);
```

- ✓ Backfill step present and correct
- ✓ ALTER TABLE with NOT NULL, DEFAULT, and utf8mb4_unicode_ci collation
- ✓ Test file verifies constraint + backfill: `tests/migrations/20260626000000_users_timezone_not_null.test.js`

**Status:** PASS ✓

---

### PASS-4: Column-Null Contract Preserved

**Severity:** PASS  
**Scope:** Application-layer nuance (lines 40–46)  
**Location:** docs/TIMEZONE-RULES.md

**Claim:**
> "Application-layer nuance: `KnexConfigRepository.getUserTimezone` may still return `null` at the application layer when the user's timezone is treated as "unset" by the A1 contract (used by the frontend display path). This `null` is an application-level signal, not a DB-null column."

**Code Verification (KnexConfigRepository.js:147–153):**
```javascript
KnexConfigRepository.prototype.getUserTimezone = function getUserTimezone(userId) {
  return this.db('users')
    .where('id', userId)
    .select('timezone')
    .first()
    .then(function (row) { return row && row.timezone ? row.timezone : null; });
};
```

- Still returns null if no user row found (row is falsy)
- Still returns null if row.timezone is falsy (edge case post-migration)
- This is NOT a DB-null column value; it's an app-level null signal for missing/unset user

**Status:** PASS ✓ (unchanged, accurately documented)

---

### PASS-5: Cross-References Valid

**Severity:** PASS  
**Scope:** Implementation reference table (§8), test coverage table (§9)  
**Location:** docs/TIMEZONE-RULES.md

**Verified Files:**
- ✓ `src/db/migrations/20260626000000_users_timezone_not_null.js` exists (6KB)
- ✓ `tests/migrations/20260626000000_users_timezone_not_null.test.js` exists (17KB)
- ✓ `src/scheduler/schedulerSession.js` line 56–66 uses timezone with Intl.DateTimeFormat
- ✓ `src/routes/schedule.routes.js` passes x-timezone header to scheduler
- ✓ `src/scheduler/deriveSchedulePlacements.js` resolveTimezone function returns timezone

**Status:** PASS ✓

---

### NOTE-1: Pre-Existing TZ-ERR-1 Gap Noted (Out of Scope)

**Severity:** NOTE  
**Scope:** TZ-ERR-1 (lines 256–258)  
**Status:** OUT OF SCOPE for this leg; filed as separate follow-up

**Observation:**
TZ-ERR-1 itself still claims: "If a user's stored timezone or `x-timezone` header contains an invalid IANA timezone name, the system MUST fall back to `America/New_York` and log a warning."

However, the code does NOT implement this validation. Passing an invalid IANA name to `Intl.DateTimeFormat` throws a `RangeError` without catch/fallback.

**User Directive:** This gap predates 999.892 and is deferred as a separate follow-up. Do NOT BLOCK this leg. abby's fixes to TZ-DISPLAY-3 and TZ-ERR-2 correctly scope the fallback behavior to implemented cases only, with a parenthetical deferring the invalid-IANA handling gap.

**Status:** Noted for follow-up; not a blocker for this leg ✓

---

## Summary

| Checklist Item | Status |
|---|---|
| TZ-DISPLAY-3 truthfulness | PASS ✓ |
| TZ-ERR-2 truthfulness | PASS ✓ |
| TZ-SCHEMA-1 accuracy | PASS ✓ |
| Column-null contract preserved | PASS ✓ |
| Cross-references valid | PASS ✓ |
| All proof items [x]'d | PASS ✓ |

---

## Verdict: PASS

abby's targeted fixes to TZ-DISPLAY-3 and TZ-ERR-2 are truthful and accurately reflect the implemented behavior:
- Fallback now correctly scoped to absent-user-row + missing-x-timezone-header cases only
- Invalid IANA handling gap honestly noted in parenthetical
- Pre-existing TZ-ERR-1 gap deferred as separate follow-up (out of scope per user directive)
- All migration, test, and cross-reference details verified accurate

**Ready for merge.** The pre-existing invalid-IANA-validation gap (TZ-ERR-1 vs code) will be filed as a separate follow-up ticket.

---

**Proof Summary:**
- [x] 8/8 proof-checklist items verified
- [x] 5 PASS findings (all targeted fixes truthful)
- [x] 1 NOTE on pre-existing gap (noted, out of scope, deferred)

**Status: PASS** (abby's edits are truthful; ready for merge)
