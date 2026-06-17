# TEST-FR-002 — Credential-Gated Tests Standard

**Status:** Active  
**Governing scope:** All test suites that depend on external API credentials (OAuth tokens, API keys, third-party service accounts)  
**Last updated:** 2026-06-17

---

## 1. Purpose

External-API integration tests (GCal, MSFT Calendar, Apple CalDAV, etc.) require live OAuth tokens or service credentials that are not available in every environment (CI, local dev without `.env.test`, fresh clones). TEST-FR-002 defines the standard for how such tests **must** gate themselves so they:

- **Skip cleanly** when credentials are absent — never fail with cryptic auth errors.
- **Are visible** — a skipped test is distinguishable from a passing one.
- **Are auditable** — the skip reason is logged so a human can act on it.

---

## 2. The Gate Pattern

### 2.1 Credential check helpers

All credential checks live in a single shared helper module. For the Juggler backend this is:

```
juggler-backend/tests/cal-sync/helpers/test-setup.js
```

Each provider exports a predicate function:

```js
function hasGCalCredentials() {
  return liveCalendarTestsEnabled()
    && !!(process.env.TEST_GCAL_REFRESH_TOKEN && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function hasMsftCredentials() {
  return liveCalendarTestsEnabled()
    && !!(process.env.TEST_MSFT_REFRESH_TOKEN && process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

function hasAppleCredentials() {
  return liveCalendarTestsEnabled()
    && !!(process.env.TEST_APPLE_USERNAME && process.env.TEST_APPLE_PASSWORD && process.env.TEST_APPLE_CALENDAR_URL);
}
```

### 2.2 Opt-in flag

A single environment variable gates all live credential tests:

```js
function liveCalendarTestsEnabled() {
  return process.env.RUN_LIVE_CALENDAR_TESTS === '1';
}
```

**Rationale:** Credentials being present in `.env.test` is not sufficient — they may be stale (expired refresh tokens). The opt-in flag decouples "creds present" from "run live tests", preventing `invalid_grant` failures in CI or default local runs.

### 2.3 Test-level gating

Every `it()` or `describe()` that requires a credential **must** check the predicate at the top and return early with a `console.warn` explaining the skip:

```js
beforeAll(async function () {
  await assertDbAvailable();
  if (!hasGCalCredentials()) {
    skip = true;
    console.warn('Skipping GCal adapter tests — no credentials');
    return;
  }
  // ... setup that requires credentials ...
});

it('creates an event on GCal', async function () {
  if (skip) return;
  // ... test body ...
});
```

**Rules:**
1. The `skip` variable is declared at suite scope (`var skip = false;`).
2. The `beforeAll` sets `skip = true` and logs a warning when credentials are absent.
3. Every `it()` checks `if (skip) return;` as its **first line**.
4. The `afterAll` also checks `if (skip) return;` before cleanup.

---

## 3. What TEST-FR-002 Forbids

| Anti-pattern | Why it's forbidden |
|---|---|
| `describe.skip(...)` or `it.skip(...)` based on credential presence | Jest still reports the test as "skipped" but the skip reason is invisible — no log, no trace. |
| Silent `return` without `console.warn` | A human cannot tell whether the suite was skipped intentionally or something broke. |
| Gating on credential presence alone (no opt-in flag) | Stale tokens cause `invalid_grant` failures instead of clean skips. |
| Per-test credential checks that repeat the same logic | Violates DRY; if the check logic changes, every test must be updated. |
| Throwing an error when credentials are absent | Credential-gated tests are optional by design — they should skip, not fail. |

---

## 4. Relationship to TEST-FR-001

| Standard | When resource is unavailable | Behavior |
|---|---|---|
| **TEST-FR-001** (DB reachability) | DB is down | **Fail loud** — throw an error identifying TEST-FR-001 |
| **TEST-FR-002** (Credentials) | Credentials absent or expired | **Skip cleanly** — log a warning, return early |

**Key distinction:** The test database is an infrastructure requirement that should always be available in any test environment. External API credentials are optional — they depend on human-provisioned OAuth tokens that expire and are not available in CI.

---

## 5. Implementation Checklist

When adding a new credential-gated test suite:

- [ ] Add the credential predicate function to the shared helper module.
- [ ] Add the `liveCalendarTestsEnabled()` opt-in check (or equivalent).
- [ ] Declare `var skip = false;` at suite scope.
- [ ] In `beforeAll`: check predicate, set `skip = true`, log `console.warn`.
- [ ] In every `it()`: first line is `if (skip) return;`.
- [ ] In `afterAll`: first line is `if (skip) return;`.
- [ ] Document required env vars in the test file's JSDoc header.

---

## 6. Current Credential-Gated Suites

| Suite | Provider | Helper | Env Vars Required |
|---|---|---|---|
| `01-adapter-gcal.test.js` | Google Calendar | `hasGCalCredentials()` | `TEST_GCAL_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| `03-adapter-apple.test.js` | Apple CalDAV | `hasAppleCredentials()` | `TEST_APPLE_USERNAME`, `TEST_APPLE_PASSWORD`, `TEST_APPLE_CALENDAR_URL` |
| `10-sync-push.test.js` | GCal / MSFT | `hasGCalCredentials()`, `hasMsftCredentials()` | (per provider) |
| `11-sync-pull.test.js` | GCal / MSFT | `hasGCalCredentials()`, `hasMsftCredentials()` | (per provider) |
| `12-sync-deletion.test.js` | GCal | `hasGCalCredentials()` | (per provider) |
| `13-sync-conflict.test.js` | GCal | `hasGCalCredentials()` | (per provider) |
| `15-sync-ingest.test.js` | GCal | `hasGCalCredentials()` | (per provider) |
| `16-sync-allday.test.js` | GCal | `hasGCalCredentials()` | (per provider) |
| `17-sync-split.test.js` | GCal | `hasGCalCredentials()` | (per provider) |
| `18-sync-recurring.test.js` | GCal | `hasGCalCredentials()` | (per provider) |
| `19-sync-multi.test.js` | GCal + MSFT | `hasGCalCredentials()`, `hasMsftCredentials()` | (both providers) |
| `20-sync-lock.test.js` | GCal | `hasGCalCredentials()` | (per provider) |
| `30-sync-performance.test.js` | GCal | `hasGCalCredentials()` | (per provider) |
| `99-sync-e2e.test.js` | GCal | `hasGCalCredentials()` | (per provider) |

All suites require `RUN_LIVE_CALENDAR_TESTS=1` in addition to the provider-specific env vars.

---

## 7. References

- [TEST-FR-001 — DB Reachability Guard](../juggler-backend/tests/helpers/requireDB.js)
- [Credential helper implementation](../juggler-backend/tests/cal-sync/helpers/test-setup.js)
- [TEST-INFRA.md](TEST-INFRA.md) — Test infrastructure documentation
