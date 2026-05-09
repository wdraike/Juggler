# Apple CalDAV LAST-MODIFIED never extracted

**Severity:** medium
**Filed:** 2026-05-09
**Source:** debug session `.planning/debug/cal-sync-afternoon-mess.md` (issue #6)

## Symptom

100% of `cal_sync_ledger` rows for `provider='apple'` have
`last_modified_at = NULL`. As a result, the `eventModifiedExternally` check
that gates pull-detection always evaluates false for Apple events. External
edits made on Apple Calendar (iCloud / iOS / macOS Calendar) are silently
dropped on the next sync — Juggler's pushed state wins by default.

## Investigation

- Wiring is correct: `apple-cal-api.js:137-138` reads
  `vevent.getFirstPropertyValue('last-modified')` and `apple.adapter.js:165`
  passes the value through to the ledger writer.
- 100% null on real traffic suggests iCloud's CalDAV responses don't include
  `LAST-MODIFIED` on the VEVENTs we receive (or include them inconsistently).
- Confirmed by SELECT against `cal_sync_ledger` filtering provider='apple' AND
  last_modified_at IS NOT NULL — zero rows for our test user.

## Candidate fixes

1. **ETag-based change detection.** CalDAV returns ETags per resource via
   `getetag` in calendar-multiget responses. Compare stored ETag to current;
   if changed, treat event as modified. Requires schema add or repurpose of
   `last_pulled_hash`.
2. **DTSTAMP fallback.** Many iCloud VEVENTs do include DTSTAMP (last
   modification timestamp on the calendar component). Use it when
   `LAST-MODIFIED` is absent. Less authoritative than LAST-MODIFIED but
   better than null.
3. **Sequence number.** The `SEQUENCE` property increments on each modify.
   Useful as a tiebreaker but doesn't solve the original-vs-modified question
   alone.

## Recommended path

(1) ETag-based detection. CalDAV-native, works regardless of which optional
properties iCloud chooses to include, and the comparison is exact — no
truncation traps like the MSFT TIMESTAMP(6) issue we just shipped a migration
for.

## Out-of-scope for current fix

This was deferred from the cal-sync 26h stall remediation session because the
session was already shipping two migrations (sync_history.action widen and
last_modified_at precision) and an cal-sync.controller window-narrowing fix.
Apple read-mostly per ingest config, so blast radius of "external edits
silently lost" is bounded for typical use, but the gap should be closed
before any Apple-write-heavy workflow rolls out.
