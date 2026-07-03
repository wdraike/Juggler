# WBS — h7-driftfix-case-999.1019

## Backlog Item: 999.1019
**Description:** runSchedule.js:1298 drift-fix CASE update writes split_ordinal/split_total/dur alongside the flag fields, but KnexScheduleRepository.writeChanged's batched-CASE bucketing has NO branch for split_ordinal/split_total — a naive port-routing swap would silently DROP those 2 columns from every drift-fix write, desyncing split-chunk metadata for every user.

## Work Items

### W1: Add split_ordinal/split_total to INSTANCE_UPDATE_FIELDS
- **File:** `juggler-backend/src/lib/tasks-write.js`
- **Change:** Add `'split_ordinal', 'split_total'` to INSTANCE_UPDATE_FIELDS array (before 'split_group')
- **Acceptance:** Fields are in the array, positioned correctly
- **Status:** DONE (commit 596a008b9)

### W2: Add CASE branches for split_ordinal/split_total in writeChanged
- **File:** `juggler-backend/src/slices/scheduler/adapters/KnexScheduleRepository.js`
- **Change:** Add forEach loop after dur CASE block that creates CASE expressions for split_ordinal and split_total, mirroring the dur pattern
- **Acceptance:** CASE expressions only include instances where dbUpdate[col] != null; ELSE clause preserves existing value; bindings are parameterized
- **Status:** DONE (commit 596a008b9)

### W3: Integration test — drift-fix delta persists all three columns
- **File:** `juggler-backend/tests/w1-split-ordinal-case.integration.test.js`
- **Change:** New integration test with two cases: (a) drift-fix delta with dur+split_ordinal+split_total persists all three via batched path; (b) split-only delta routes to otherUpdates and persists
- **Acceptance:** Test seeds split_ordinal=1,split_total=2,dur=30; delta updates to 2,3,45; after writeChanged, DB has 2,3,45. Mutation proof documented.
- **Status:** DONE (commit 596a008b9)