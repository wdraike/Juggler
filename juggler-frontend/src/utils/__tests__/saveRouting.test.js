/**
 * 999.15605 — "Next Cycle Starts" could not be changed at all.
 *
 * David, from dev: editing the cycle start date on a recurring task failed with
 *   Update item 0 (t1784…): nextStart ("Next Cycle Starts") is not supported in
 *   batch updates — edit it via the single-task update endpoint
 * and there was no other way to make the change.
 *
 * The message is accurate and the guard is deliberate: PUT /tasks/batch has no
 * anchor validation (resolveNextStartAnchor) and no recurrence redraw
 * (resetRecurringInstances), so persisting next_start there would be silently
 * wrong — BatchUpdateTasks.js fails loud instead. The defect is that the
 * SINGLE-task edit form saves through that same batch endpoint
 * (useTaskState.updateTask → PUT /tasks/batch), so the endpoint the message
 * points at was unreachable from the UI. PUT /tasks/:id has the full wiring.
 */
import { routeUpdates, SINGLE_ONLY_FIELDS, friendlySaveError } from '../saveRouting';

describe('999.15605: updates the batch endpoint refuses are routed to the single-task endpoint', () => {
  test('an update carrying nextStart goes single, not batch', () => {
    var out = routeUpdates([{ id: 't1', nextStart: '2026-09-01' }]);
    expect(out.batch).toEqual([]);
    expect(out.singles).toEqual([{ id: 't1', nextStart: '2026-09-01' }]);
  });

  test('an ordinary update still goes batch', () => {
    var out = routeUpdates([{ id: 't1', text: 'clean bathrooms' }]);
    expect(out.batch).toEqual([{ id: 't1', text: 'clean bathrooms' }]);
    expect(out.singles).toEqual([]);
  });

  test('a mixed update is split BY FIELD — the anchor alone goes single', () => {
    // Sending the whole update single would 400: PUT /tasks/:id is zod-validated
    // with `time: /^\d{2}:\d{2}/` and `date: /^\d{4}-\d{2}-\d{2}/`, while the
    // edit form sends 12-hour text and '' for cleared fields — shapes the batch
    // route accepts. It also lacks the batch path's keep-the-existing-time block
    // and its `_timezone` handling. Peeling the anchor off hands the single
    // endpoint a payload none of that can touch.
    var out = routeUpdates([{ id: 't1', nextStart: '2026-09-01', text: 'renamed', time: '2:00 PM' }]);
    expect(out.batch).toEqual([{ id: 't1', text: 'renamed', time: '2:00 PM' }]);
    expect(out.singles).toEqual([{ id: 't1', nextStart: '2026-09-01' }]);
  });

  test('the single payload carries the anchor and the id, and nothing else', () => {
    var out = routeUpdates([{
      id: 't1', nextStart: '2026-09-01', date: '', time: '2:00 PM',
      text: 'x', url: 'not-a-url', dur: 3,
    }]);
    expect(Object.keys(out.singles[0]).sort()).toEqual(['id', 'nextStart']);
  });

  test('an anchor-only update produces no empty batch write', () => {
    var out = routeUpdates([{ id: 't1', nextStart: '2026-09-01' }]);
    expect(out.batch).toEqual([]);
  });

  test('a recurrence change travels WITH the anchor, never on the batch lane', () => {
    // Leaving `recur` on the batch lane is destructive, not merely untidy: a
    // batch write carrying a template field calls resetRecurringInstances,
    // which hard-deletes every future pending instance — including the row the
    // edit form is targeting — so the follow-up anchor PUT 404s on a row the
    // first write just deleted, losing the anchor edit while the recurrence
    // change stays committed.
    var out = routeUpdates([{
      id: 't1-1', nextStart: '2026-09-07', recur: { type: 'weekly', every: 2 },
      recurStart: '2026-09-07', recurEnd: null, recurring: true, text: 'Haircut',
    }]);
    expect(out.singles[0]).toEqual({
      id: 't1-1', nextStart: '2026-09-07', recur: { type: 'weekly', every: 2 },
      recurStart: '2026-09-07', recurEnd: null, recurring: true,
    });
    expect(out.batch).toEqual([{ id: 't1-1', text: 'Haircut' }]);
  });

  test('a recurrence change WITHOUT an anchor still goes batch, unchanged', () => {
    // The companions only travel when an anchor is actually being written —
    // ordinary recurrence edits keep their existing path.
    var out = routeUpdates([{ id: 't1-1', recur: { type: 'daily' } }]);
    expect(out.batch).toEqual([{ id: 't1-1', recur: { type: 'daily' } }]);
    expect(out.singles).toEqual([]);
  });

  test('a batch of many splits per item, preserving order within each lane', () => {
    var out = routeUpdates([
      { id: 'a', text: 'x' },
      { id: 'b', nextStart: '2026-09-01' },
      { id: 'c', pri: 'P1' },
    ]);
    expect(out.batch.map(function(u) { return u.id; })).toEqual(['a', 'c']);
    expect(out.singles.map(function(u) { return u.id; })).toEqual(['b']);
  });

  test('an explicitly CLEARED anchor (null) still routes single', () => {
    // Clearing is exactly as unsupported by the batch endpoint as setting.
    var out = routeUpdates([{ id: 't1', nextStart: null }]);
    expect(out.singles).toEqual([{ id: 't1', nextStart: null }]);
  });

  test('the refused-field list is the one the backend actually refuses', () => {
    expect(SINGLE_ONLY_FIELDS).toEqual(['nextStart']);
  });

  test('empty input yields empty lanes', () => {
    expect(routeUpdates([])).toEqual({ batch: [], singles: [] });
    expect(routeUpdates(null)).toEqual({ batch: [], singles: [] });
  });
});

describe('999.15605: the raw backend string is never what the user reads', () => {
  test('a batch-refusal is translated into something actionable', () => {
    var raw = 'Update item 0 (t1784633683577dny7-1): nextStart ("Next Cycle Starts") '
      + 'is not supported in batch updates — edit it via the single-task update endpoint';
    var msg = friendlySaveError(raw);
    expect(msg).not.toContain('batch');
    expect(msg).not.toContain('endpoint');
    expect(msg).not.toContain('t1784633683577dny7-1');
    expect(msg).toMatch(/Next Cycle Starts/);
  });

  test('the field name comes FROM the message, so a second refused field names itself', () => {
    var msg = friendlySaveError('Update item 0 (t1): recurEnd ("Series Ends") is not supported in batch updates — edit it via the single-task update endpoint');
    expect(msg).toMatch(/Series Ends/);
    expect(msg).not.toMatch(/Next Cycle Starts/);
  });

  test('the "Update item N (id):" prefix is stripped from any other server error', () => {
    var msg = friendlySaveError('Update item 2 (t99-1): dur must be between 5 and 480');
    expect(msg).toBe('dur must be between 5 and 480');
  });

  test('a plain server message passes through unchanged', () => {
    expect(friendlySaveError('Deadline cannot be before the start date'))
      .toBe('Deadline cannot be before the start date');
  });

  test('a missing message yields a generic one rather than "undefined"', () => {
    expect(friendlySaveError(null)).toMatch(/could not be saved/i);
    expect(friendlySaveError('')).toMatch(/could not be saved/i);
  });
});
