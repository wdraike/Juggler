// Unit test pinning EventBus's OWN per-subscriber error isolation (H2 / W3).
//
// zoe WARN-1: the task-write error-isolation test only pins the black-box
// combination of EventBus's per-handler try/catch + taskEvents' outer
// `safePublish` catch. A regression that removed EventBus's own isolation would
// stay green (masked by safePublish). This test pins the EventBus layer directly:
// a throwing handler must NOT prevent sibling handlers from running, and publish
// must report it via `failed`, never propagate.

const { createEventBus, EventTypes } = require('../src/lib/events');

describe('EventBus per-subscriber error isolation', () => {
  test('a throwing handler is isolated; siblings still run; publish reports failed', () => {
    const bus = createEventBus();
    const calls = [];

    bus.subscribe(EventTypes.TASK_CREATED, () => {
      calls.push('first');
      throw new Error('boom');
    });
    bus.subscribe(EventTypes.TASK_CREATED, () => {
      calls.push('second');
    });

    let result;
    expect(() => {
      result = bus.publish(EventTypes.TASK_CREATED, { taskId: 't1' });
    }).not.toThrow(); // the throw is isolated, never propagated to the publisher

    // The sibling handler still ran despite the first throwing.
    expect(calls).toEqual(['first', 'second']);
    // publish accounts for exactly one delivered + one failed.
    expect(result).toEqual({ delivered: 1, failed: 1 });
  });

  test('all-clean publish reports zero failed', () => {
    const bus = createEventBus();
    bus.subscribe(EventTypes.TASK_UPDATED, () => {});
    bus.subscribe(EventTypes.TASK_UPDATED, () => {});
    expect(bus.publish(EventTypes.TASK_UPDATED, { taskId: 't2' })).toEqual({
      delivered: 2,
      failed: 0,
    });
  });
});
