# Calendar Sync: Event-to-Task Propagation — Implementation Handoff

**Status**: Design complete, implementation not started.

## What This Is

The sync controller currently does one-way sync only (Juggler → calendar) for `origin='juggler'` tasks. When a user moves or edits an event on their calendar, nothing flows back to the task. This document is the implementation plan for adding that propagation.

## Test Files Covered

All tests in the following files are currently `test.todo`:

| File | Tests |
|------|-------|
| `14-sync-promotion.test.js` | event moved same day → when=fixed; moved different day → fixed + date_pinned=1; all-day → timed → promoted; backwardsDep warning; prev_when preserved |
| `16-sync-allday.test.js` | duration change reflected; title change reflected |
| `13-sync-conflict.test.js` | last-modified: event newer → task updated; sync_history logs conflict_juggler / conflict_provider |
| `19-sync-multi.test.js` | event changed on GCal → task updated → MSFT updated on next sync |
| `99-sync-e2e.test.js` | step 2: move event on GCal → task promoted to fixed |

`18-sync-recurring.test.js` ("instance with own text uses own text") is a separate data model issue — see below.

---

## Architecture Context

### The decision point: `cal-sync.controller.js` lines 590–634

The critical block in Phase 2 (existing ledger entries):

```javascript
if (task && event) {
    if (ledger.origin === 'juggler' && !isIngestOnly(pid)) {
        // [lines 595-622] hash-based push only
    } else if (isIngestOnly(pid)) {
        // [lines 623-632] always pull event → task
    }
    // else: origin=provider in full-sync mode — nothing (line 633)
    
    // [lines 637-645] Always update ledger cached fields (event_summary, event_start, last_modified_at, etc.)
}
```

The change goes in the `origin='juggler' && !isIngestOnly(pid)` branch (lines 590–622).

### Key fields (all exist in DB schema)

**`cal_sync_ledger` columns used:**
- `last_pushed_hash` — hash of task at last push (`taskHash(task)`)
- `last_pulled_hash` — hash of event as last seen (`pAdapter.eventHash(event)`) — set on create, NOT updated currently
- `last_modified_at` — event's `lastModified` timestamp from provider (updated every sync at line 644)
- `task_updated_at` — task's `_updated_at` as of last sync (updated at line 643)
- `event_start`, `event_end`, `event_summary`, `event_all_day` — cached event fields (updated every sync)

**`task_masters` columns (via tasks-write.js `MASTER_UPDATE_FIELDS`):**
- `when` — "fixed", "morning", "allday", etc. (writable)
- `prev_when` — previous `when` value before promotion (writable)
- `rigid` — 1/0 (writable)

**`task_instances` columns (via tasks-write.js `INSTANCE_UPDATE_FIELDS`):**
- `date_pinned` — 1/0 (writable)
- `scheduled_at` — UTC datetime (writable)
- `dur` — duration in minutes (writable)

### Adapter method: `applyEventToTaskFields(event, tz, currentTask)`

Located in `src/lib/cal-adapters/gcal.adapter.js` lines 140–167. Returns:
```javascript
{
    text: event.title,
    dur: event.durationMinutes,
    updated_at: db.fn.now(),
    scheduled_at: localToUtc(jd.date, jd.time, tz),  // if time exists
    when: 'allday'  // only if isAllDay
}
```

### Adapter method: `eventHash(event)`

Hashes: title, startDateTime, endDateTime, description, isTransparent, isAllDay.
Located in `src/lib/cal-adapters/gcal.adapter.js` lines 172–182.

---

## Detection Mechanism

**Goal**: Detect whether a juggler-owned event was externally modified (i.e., the user edited it on the calendar), as opposed to just reflecting a push we made.

**Chosen approach**: compare `pAdapter.eventHash(event)` with `ledger.last_pulled_hash`.

`last_pulled_hash` is set when the ledger row is created (from the initial push response). It is NOT currently updated on subsequent syncs. We must update it:
1. After a successful push (so `last_pulled_hash` = expected event hash from the normalized creation/update response)
2. After a successful pull (so `last_pulled_hash` = the newly pulled event hash)

**The race condition**: When we push task → event, GCal updates `event.lastModified`. On the NEXT sync, `eventHash(event)` will differ from the pre-push `last_pulled_hash` even though WE made the change. 

**Resolution**: Update `last_pulled_hash` in `recordPushSuccess`. The normalized event isn't available there, but we can pass it in. Alternatively, after a successful push, set `last_pulled_hash = null` to signal "unknown, don't detect change" for one sync. Then on the following sync where the event is stable, it resets naturally. Simplest option: after a push, set `last_pulled_hash = taskHash(task)` as a placeholder sentinel, and in the detection logic check `last_pulled_hash !== null && eventHash !== last_pulled_hash`.

**Simpler alternative** (preferred for first pass): use `last_modified_at` comparison instead.

```
event externally modified = (
    event.lastModified is set
    && ledger.last_modified_at is set
    && toDate(event.lastModified) > toDate(ledger.last_modified_at) + 1s  // tolerance
    && taskHash(task) === ledger.last_pushed_hash  // task itself didn't change (its push would have already updated event)
)
```

When `taskHash !== last_pushed_hash`, the task changed → push wins. The event.lastModified comparison is only needed when the task is STABLE (hasn't changed since last push). In that case, if the event's lastModified is more recent than what we recorded, it must be an external edit.

After our own push updates the event, `last_modified_at` gets set to the pre-push `event.lastModified` (the value we fetched BEFORE the push). The post-push event will have a newer `lastModified`. BUT — on the sync immediately following a push, `taskHash !== last_pushed_hash` is FALSE (task didn't change, we just updated `last_pushed_hash` via `recordPushSuccess`). Wait, `last_pushed_hash` IS updated after the push. So:

1. Sync A: task changed → push → `last_pushed_hash = newHash`. `last_modified_at = event.lastModified_before_push`.
2. Sync B: `taskHash === last_pushed_hash` (task stable). `event.lastModified = event.lastModified_after_push > last_modified_at` → DETECTED AS EXTERNAL CHANGE.
3. We pull event → task (same values, no meaningful change), update `task._updated_at`, update `last_modified_at`.
4. Sync C: `taskHash !== last_pushed_hash` (updated_at bumped the in-memory task? No — taskHash doesn't include updated_at). Task hash SAME. event.lastModified hasn't changed → NO detection. Stable. ✓

Wait, `taskHash` does NOT include `updated_at`. So bumping `updated_at` via the pull doesn't change the hash. But it DOES change `task._updated_at`. So:

Actually the false positive in step 2 triggers a pull that writes the SAME values back. This is wasteful but not harmful, and it updates `last_modified_at` to the current event.lastModified, so sync C is clean.

The extra spurious pull only runs once (the sync immediately after a push). Acceptable for v1.

---

## Implementation Plan

### Change 1: Pull from event when externally modified

**File**: `src/controllers/cal-sync.controller.js`  
**Location**: Lines 590–622 (the `origin='juggler' && !isIngestOnly(pid)` branch)

Current structure (simplified):
```javascript
if (ledger.origin === 'juggler' && !isIngestOnly(pid)) {
    if (mergedFollowers[task.id]) {
        // skip
    } else {
        var newHash = taskHash(task);
        if (newHash !== ledger.last_pushed_hash) {
            pendingEventUpdates.push({...});
            pStats.pushed++; stats.pushed++;
        } else {
            pStats.skipped++; stats.skipped++;
        }
    }
}
```

New structure:
```javascript
if (ledger.origin === 'juggler' && !isIngestOnly(pid)) {
    if (mergedFollowers[task.id]) {
        // skip (unchanged)
    } else {
        var newHash = taskHash(task);
        var taskChanged = (newHash !== ledger.last_pushed_hash);
        
        // Detect external event modification via last_modified_at comparison
        var eventModifiedExternally = false;
        if (!taskChanged && event.lastModified && ledger.last_modified_at) {
            var evModMs = new Date(event.lastModified).getTime();
            var recordedModMs = new Date(String(ledger.last_modified_at).replace(' ', 'T') + 'Z').getTime();
            if (!isNaN(evModMs) && !isNaN(recordedModMs)) {
                eventModifiedExternally = evModMs > recordedModMs + 1000; // 1s tolerance
            }
        }
        
        if (taskChanged && !eventModifiedExternally) {
            // Only task changed → push (existing behavior)
            pendingEventUpdates.push({ eventId: ledger.provider_event_id, task, ledgerId: ledger.id, newHash });
            pStats.pushed++; stats.pushed++;
        } else if (taskChanged && eventModifiedExternally) {
            // Both changed — conflict resolution
            var isFixed = (task.when || '').indexOf('fixed') >= 0 || task.rigid;
            if (isFixed) {
                // Fixed always wins → push, log conflict
                pendingEventUpdates.push({ eventId: ledger.provider_event_id, task, ledgerId: ledger.id, newHash });
                pStats.pushed++; stats.pushed++;
                logSyncAction(pid, 'conflict_juggler', {
                    taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
                    detail: 'Conflict: fixed task pushed over calendar edit'
                });
            } else {
                // Last-modified wins
                var evModMsConflict = new Date(event.lastModified).getTime();
                var taskModMsConflict = new Date(String(task._updated_at).replace(' ', 'T') + 'Z').getTime();
                if (!isNaN(evModMsConflict) && !isNaN(taskModMsConflict) && evModMsConflict > taskModMsConflict) {
                    // Event newer → pull
                    var conflictPullFields = _buildPullFields(event, task, tz, pAdapter);
                    taskUpdates.push({ id: task.id, fields: conflictPullFields });
                    pStats.pulled++; stats.pulled++;
                    logSyncAction(pid, 'conflict_provider', {
                        taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
                        oldValues: { text: task.text, when: task.when, dur: task.dur },
                        newValues: { text: event.title, when: conflictPullFields.when || task.when, dur: event.durationMinutes },
                        detail: 'Conflict: calendar edit accepted (newer than task)'
                    });
                } else {
                    // Task newer → push
                    pendingEventUpdates.push({ eventId: ledger.provider_event_id, task, ledgerId: ledger.id, newHash });
                    pStats.pushed++; stats.pushed++;
                    logSyncAction(pid, 'conflict_juggler', {
                        taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
                        detail: 'Conflict: task pushed over calendar edit (task is newer)'
                    });
                }
            }
        } else if (!taskChanged && eventModifiedExternally) {
            // Only event changed → pull from event to task
            var pullFields = _buildPullFields(event, task, tz, pAdapter);
            taskUpdates.push({ id: task.id, fields: pullFields });
            pStats.pulled++; stats.pulled++;
            var isPromotion = pullFields.when === 'fixed';
            logSyncAction(pid, isPromotion ? 'promoted' : 'pulled', {
                taskId: task.id, taskText: task.text, eventId: ledger.provider_event_id,
                oldValues: { when: task.when, scheduled_at: task._scheduled_at, dur: task.dur },
                newValues: { when: pullFields.when || task.when, scheduled_at: pullFields.scheduled_at, dur: pullFields.dur },
                detail: isPromotion ? 'Event moved on calendar — task promoted to fixed' : 'Event edited on calendar — task updated'
            });
        } else {
            // Neither changed → skip (existing behavior)
            pStats.skipped = (pStats.skipped || 0) + 1;
            stats.skipped = (stats.skipped || 0) + 1;
        }
    }
}
```

### Change 2: `_buildPullFields` helper function

Add this helper inside the `sync` function (or as a module-level function):

```javascript
function _buildPullFields(event, task, tz, adapter) {
    // Start with adapter's base mapping
    var fields = adapter.applyEventToTaskFields(event, tz, task);
    
    // Promotion: if time or date changed, set when=fixed
    var newJd = isoToJugglerDate(event.startDateTime, tz);
    var dateChanged = newJd.date && newJd.date !== task.date;
    var timeChanged = newJd.time && newJd.time !== task.time;
    
    if (timeChanged || dateChanged) {
        fields.prev_when = task.when;  // save before overwriting
        fields.when = 'fixed';
        if (dateChanged) {
            fields.date_pinned = 1;
        }
    }
    
    return fields;
}
```

**Note**: `applyEventToTaskFields` already sets `scheduled_at`. The promotion logic adds `when`, `prev_when`, `date_pinned` on top of that.

**Backward dependency check** (for `backwardsDep warning` test): After computing `fields.scheduled_at`, check if any task that `task` depends on is scheduled AFTER the new time. If so, add a warning to the `logSyncAction` detail. This is a warning only — don't block the promotion.

### Change 3: Update `last_modified_at` after push

In `recordPushSuccess`, also schedule a `last_modified_at` update using `db.fn.now()` as a proxy for the push time:

```javascript
function recordPushSuccess(upd) {
    if (upd && upd.ledgerId && upd.newHash) {
        ledgerUpdates.push({ id: upd.ledgerId, fields: { 
            last_pushed_hash: upd.newHash,
            last_modified_at: new Date()  // approximate push time — prevents false-positive pull next sync
        }});
    }
}
```

This writes the current time as `last_modified_at`. On the next sync, even if GCal's `event.lastModified` (set when we pushed) is slightly after this value, the 1-second tolerance check should handle it. If not, increase the tolerance to 5 seconds.

### Change 4: Add `enqueueScheduleRun` for pulls (already handled)

Line 1543 already enqueues a schedule run when `stats.pulled > 0`. No change needed.

---

## The `18-sync-recurring`: Instance Text Override

**This is a separate, unrelated data model issue.**

The `tasks_v` view always returns `m.text` (the master's text). Instance-level text (if stored) is ignored by the view. The test "instance with own text uses own text" expects that when a recurring instance has its own `text` field set, that text (not the template's) appears in the calendar event.

**Root cause**: `tasks_v` selects `m.text` (from `task_masters`), not `i.text_override` or similar. Instance text override is not implemented in the data model.

**To implement this feature:**
1. Add a `text_override` column to `task_instances` (or rename the existing `text` column usage)
2. Update `tasks_v` to: `COALESCE(NULLIF(i.text_override, ''), m.text) AS text`
3. Add `text_override` to `INSTANCE_UPDATE_FIELDS` in `tasks-write.js`
4. Update `makeTask` in test fixtures to write `text_override` for instances

This is a non-trivial schema change and should be tracked separately.

---

## Test-by-test Assertions (for writing the actual tests after TODOs)

### 14-sync-promotion: `event moved same day → when=fixed`
```javascript
// Create task with when='morning', push, then patch event time to later same day
// → task.when === 'fixed'
// → task.scheduled_at matches new event time (within 2 min)
```

### 14-sync-promotion: `event moved different day → fixed + date_pinned=1`
```javascript
// Create task for tomorrow, push, patch event to day-after-tomorrow
// → task.when === 'fixed'
// → task.date_pinned === 1
// → task.scheduled_at matches new date/time
```

### 14-sync-promotion: `prev_when preserved`
```javascript
// Create task with when='morning', push, move event
// → task.prev_when === 'morning'
```

### 14-sync-promotion: `backwardsDep warning`
```javascript
// Create taskA → taskB (B depends on A). Push both.
// Move B's event to BEFORE A's event time.
// Sync → B promoted, logSyncAction detail contains 'before dependency' or similar
```

### 16-sync-allday: `duration change reflected`
```javascript
// Create 30min task, push, patch event end+30min (now 60min)
// → task.dur === 60
```

### 16-sync-allday: `title change reflected`
```javascript
// Create task with text "Foo", push, patch event summary to "Bar"
// → task.text === 'Bar'
```

### 13-sync-conflict: `last-modified: event newer → task updated`
```javascript
// Create task, push, patch event title to "Calendar Version Newer"
// (do NOT touch the task)
// Sync → task.text === 'Calendar Version Newer'
```

### 13-sync-conflict: `sync_history logs conflict_juggler or conflict_provider`
```javascript
// Setup a conflict (both changed), sync
// → sync_history has a row with action='conflict_juggler' or 'conflict_provider'
```

### 19-sync-multi: `event changed on GCal → task updated → MSFT updated on next sync`
```javascript
// Push task to both GCal + MSFT.
// Move GCal event to new time.
// Sync → task promoted (when=fixed, new scheduled_at).
// Sync again → MSFT event updated to new time.
```

### 99-sync-e2e: step 2 (promotion)
```javascript
// Move event to 3:00 PM
// Sync → task.when.includes('fixed')
```

---

## Files to Touch

1. `src/controllers/cal-sync.controller.js` — main change (Phase 2 juggler-origin block, ~lines 590–622; `recordPushSuccess`)
2. `src/lib/cal-adapters/gcal.adapter.js` — verify `applyEventToTaskFields` handles all cases (already good for title/time/dur; may need `when='fixed'` for promotion)
3. `src/lib/cal-adapters/msft.adapter.js` — same check
4. `src/lib/cal-adapters/apple.adapter.js` — same check
5. Test files (all 5 listed above) — remove `test.todo`, add actual test bodies

## Key Constraints

- **Do not change `taskHash`** — it covers task→event push fields. Pull detection uses event timestamps, not taskHash.
- **Ingest-only mode** already works — don't touch the `isIngestOnly(pid)` branch.
- **Fixed tasks always push** — `(task.when || '').indexOf('fixed') >= 0 || task.rigid` → push wins even on conflict.
- **`prev_when` is in `task_masters`** (MASTER_UPDATE_FIELDS), so `tasksWrite.updateTaskById` will route it correctly.
- **`date_pinned` is in `task_instances`** (INSTANCE_UPDATE_FIELDS), routed correctly too.
- **No schema migrations needed** — all fields already exist.
