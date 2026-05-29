/**
 * Unit tests for lib/events
 *
 * Tests the EventBus and InMemoryEventBus implementations.
 * No database required — pure unit tests.
 */

const {
  EventBus,
  InMemoryEventBus,
  EventTypes,
  createEventBus,
  getEventBus,
  resetEventBus,
} = require('../../../src/lib/events');

describe('lib/events', () => {
  beforeEach(() => {
    resetEventBus();
  });

  afterEach(() => {
    resetEventBus();
  });

  describe('EventTypes', () => {
    test('exports all required event types', () => {
      expect(EventTypes.TASK_CREATED).toBe('task.created');
      expect(EventTypes.TASK_UPDATED).toBe('task.updated');
      expect(EventTypes.TASK_COMPLETED).toBe('task.completed');
      expect(EventTypes.TASK_DELETED).toBe('task.deleted');
      expect(EventTypes.TASK_PLACED).toBe('task.placed');
    });

    test('exports schedule event types', () => {
      expect(EventTypes.SCHEDULE_RAN).toBe('schedule.ran');
      expect(EventTypes.SCHEDULE_SESSION_STARTED).toBe('schedule.session.started');
      expect(EventTypes.SCHEDULE_SESSION_COMPLETED).toBe('schedule.session.completed');
      expect(EventTypes.SCHEDULE_CONFLICT_DETECTED).toBe('schedule.conflict.detected');
    });

    test('exports calendar event types', () => {
      expect(EventTypes.CALENDAR_SYNCED).toBe('calendar.synced');
      expect(EventTypes.CALENDAR_SYNC_STARTED).toBe('calendar.sync.started');
      expect(EventTypes.CALENDAR_SYNC_FAILED).toBe('calendar.sync.failed');
    });

    test('exports cache event types', () => {
      expect(EventTypes.CACHE_INVALIDATED).toBe('cache.invalidated');
      expect(EventTypes.CACHE_ENTRY_EVICTED).toBe('cache.entry.evicted');
    });

    test('exports dependency chain event types', () => {
      expect(EventTypes.CHAIN_BLOCKED).toBe('chain.blocked');
      expect(EventTypes.CHAIN_UNBLOCKED).toBe('chain.unblocked');
    });

    test('exports user event types', () => {
      expect(EventTypes.USER_PREFERENCES_UPDATED).toBe('user.preferences.updated');
      expect(EventTypes.USER_CALENDAR_CONNECTED).toBe('user.calendar.connected');
      expect(EventTypes.USER_CALENDAR_DISCONNECTED).toBe('user.calendar.disconnected');
    });

    test('event types have dot notation format', () => {
      const values = Object.values(EventTypes);
      for (const value of values) {
        expect(value).toMatch(/^[a-z]+\.[a-z.]+$/);
      }
    });
  });

  describe('EventBus', () => {
    let eventBus;

    beforeEach(() => {
      eventBus = new EventBus();
    });

    describe('subscribe', () => {
      test('subscribes to an event type', () => {
        const handler = jest.fn();
        eventBus.subscribe(EventTypes.TASK_CREATED, handler);

        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toMatchObject({
          taskId: '123',
          _eventMeta: {
            type: EventTypes.TASK_CREATED,
            publishedAt: expect.any(Date),
          },
        });
      });

      test('returns an unsubscribe function', () => {
        const handler = jest.fn();
        const unsubscribe = eventBus.subscribe(EventTypes.TASK_CREATED, handler);

        unsubscribe();

        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });
        expect(handler).not.toHaveBeenCalled();
      });

      test('multiple handlers can subscribe to same event', () => {
        const handler1 = jest.fn();
        const handler2 = jest.fn();
        const handler3 = jest.fn();

        eventBus.subscribe(EventTypes.TASK_CREATED, handler1);
        eventBus.subscribe(EventTypes.TASK_CREATED, handler2);
        eventBus.subscribe(EventTypes.TASK_CREATED, handler3);

        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });

        expect(handler1).toHaveBeenCalledTimes(1);
        expect(handler2).toHaveBeenCalledTimes(1);
        expect(handler3).toHaveBeenCalledTimes(1);
      });

      test('accepts optional subscription ID', () => {
        const handler = jest.fn();
        eventBus.subscribe(EventTypes.TASK_CREATED, handler, { id: 'my-subscription' });

        const result = eventBus.unsubscribe(EventTypes.TASK_CREATED, 'my-subscription');
        expect(result).toBe(true);

        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });
        expect(handler).not.toHaveBeenCalled();
      });

      test('throws on invalid eventType', () => {
        expect(() => {
          eventBus.subscribe(null, jest.fn());
        }).toThrow('eventType must be a string');

        expect(() => {
          eventBus.subscribe(123, jest.fn());
        }).toThrow('eventType must be a string');
      });

      test('throws on invalid handler', () => {
        expect(() => {
          eventBus.subscribe(EventTypes.TASK_CREATED, null);
        }).toThrow('handler must be a function');

        expect(() => {
          eventBus.subscribe(EventTypes.TASK_CREATED, 'not-a-function');
        }).toThrow('handler must be a function');
      });
    });

    describe('unsubscribe', () => {
      test('removes a handler by subscription ID', () => {
        const handler = jest.fn();
        eventBus.subscribe(EventTypes.TASK_CREATED, handler, { id: 'sub1' });

        const result = eventBus.unsubscribe(EventTypes.TASK_CREATED, 'sub1');

        expect(result).toBe(true);
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });
        expect(handler).not.toHaveBeenCalled();
      });

      test('returns false for non-existent subscription', () => {
        const result = eventBus.unsubscribe(EventTypes.TASK_CREATED, 'non-existent');
        expect(result).toBe(false);
      });

      test('returns false for event type with no handlers', () => {
        const result = eventBus.unsubscribe('non-existent-event', 'some-id');
        expect(result).toBe(false);
      });
    });

    describe('unsubscribeAll', () => {
      test('removes all handlers for specific event type', () => {
        const createHandler = jest.fn();
        const updateHandler = jest.fn();

        eventBus.subscribe(EventTypes.TASK_CREATED, createHandler);
        eventBus.subscribe(EventTypes.TASK_UPDATED, updateHandler);

        const count = eventBus.unsubscribeAll(EventTypes.TASK_CREATED);

        expect(count).toBe(1);
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });
        eventBus.publish(EventTypes.TASK_UPDATED, { taskId: '123' });

        expect(createHandler).not.toHaveBeenCalled();
        expect(updateHandler).toHaveBeenCalledTimes(1);
      });

      test('removes all handlers for all event types when no argument', () => {
        const handler1 = jest.fn();
        const handler2 = jest.fn();

        eventBus.subscribe(EventTypes.TASK_CREATED, handler1);
        eventBus.subscribe(EventTypes.TASK_UPDATED, handler2);

        const count = eventBus.unsubscribeAll();

        expect(count).toBe(2);
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });
        eventBus.publish(EventTypes.TASK_UPDATED, { taskId: '123' });

        expect(handler1).not.toHaveBeenCalled();
        expect(handler2).not.toHaveBeenCalled();
      });

      test('returns 0 for event type with no handlers', () => {
        const count = eventBus.unsubscribeAll('non-existent');
        expect(count).toBe(0);
      });
    });

    describe('publish', () => {
      test('delivers event to all subscribers', () => {
        const handler1 = jest.fn();
        const handler2 = jest.fn();

        eventBus.subscribe(EventTypes.TASK_CREATED, handler1);
        eventBus.subscribe(EventTypes.TASK_CREATED, handler2);

        const result = eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });

        expect(result).toEqual({ delivered: 2, failed: 0 });
      });

      test('returns empty result when no subscribers', () => {
        const result = eventBus.publish('non-existent-event', { data: 'test' });
        expect(result).toEqual({ delivered: 0, failed: 0 });
      });

      test('enriches payload with _eventMeta', () => {
        const handler = jest.fn();
        eventBus.subscribe(EventTypes.TASK_CREATED, handler);

        const beforePublish = new Date();
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });
        const afterPublish = new Date();

        const receivedPayload = handler.mock.calls[0][0];
        expect(receivedPayload._eventMeta).toBeDefined();
        expect(receivedPayload._eventMeta.type).toBe(EventTypes.TASK_CREATED);
        expect(receivedPayload._eventMeta.publishedAt).toBeInstanceOf(Date);
        expect(receivedPayload._eventMeta.publishedAt.getTime()).
          toBeGreaterThanOrEqual(beforePublish.getTime());
        expect(receivedPayload._eventMeta.publishedAt.getTime()).
          toBeLessThanOrEqual(afterPublish.getTime());
      });

      test('preserves original payload properties', () => {
        const handler = jest.fn();
        eventBus.subscribe(EventTypes.TASK_CREATED, handler);

        eventBus.publish(EventTypes.TASK_CREATED, {
          taskId: 'abc123',
          userId: 'user456',
          title: 'Test Task',
        });

        expect(handler.mock.calls[0][0]).toMatchObject({
          taskId: 'abc123',
          userId: 'user456',
          title: 'Test Task',
        });
      });

      test('does not affect other handlers when one fails', () => {
        const errorHandler = jest.fn(() => {
          throw new Error('Handler failed');
        });
        const goodHandler = jest.fn();

        eventBus.subscribe(EventTypes.TASK_CREATED, errorHandler);
        eventBus.subscribe(EventTypes.TASK_CREATED, goodHandler);

        const result = eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });

        expect(result.delivered).toBe(1);
        expect(result.failed).toBe(1);
        expect(goodHandler).toHaveBeenCalledTimes(1);
      });

      test('logs handler errors when logger configured', () => {
        const mockLogger = jest.fn();
        const busWithLogger = new EventBus({ logger: mockLogger });

        busWithLogger.subscribe(EventTypes.TASK_CREATED, () => {
          throw new Error('Handler failed');
        });

        busWithLogger.publish(EventTypes.TASK_CREATED, { taskId: '123' });

        expect(mockLogger).toHaveBeenCalledWith(
          'error',
          'Event handler failed',
          expect.objectContaining({
            eventType: EventTypes.TASK_CREATED,
            error: 'Handler failed',
          })
        );
      });

      test('throws on invalid eventType', () => {
        expect(() => {
          eventBus.publish(null, { data: 'test' });
        }).toThrow('eventType must be a string');
      });
    });

    describe('publishAsync', () => {
      test('publishes event asynchronously', async () => {
        const handler = jest.fn();
        eventBus.subscribe(EventTypes.TASK_CREATED, handler);

        // Handler should not be called yet
        const promise = eventBus.publishAsync(EventTypes.TASK_CREATED, { taskId: '123' });
        expect(handler).not.toHaveBeenCalled();

        const result = await promise;
        expect(handler).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ delivered: 1, failed: 0 });
      });
    });

    describe('subscriberCount', () => {
      test('returns count for specific event type', () => {
        expect(eventBus.subscriberCount(EventTypes.TASK_CREATED)).toBe(0);

        eventBus.subscribe(EventTypes.TASK_CREATED, jest.fn());
        expect(eventBus.subscriberCount(EventTypes.TASK_CREATED)).toBe(1);

        eventBus.subscribe(EventTypes.TASK_CREATED, jest.fn());
        expect(eventBus.subscriberCount(EventTypes.TASK_CREATED)).toBe(2);
      });

      test('returns total count when no event type specified', () => {
        expect(eventBus.subscriberCount()).toBe(0);

        eventBus.subscribe(EventTypes.TASK_CREATED, jest.fn());
        eventBus.subscribe(EventTypes.TASK_UPDATED, jest.fn());

        expect(eventBus.subscriberCount()).toBe(2);
      });
    });

    describe('getSubscribedEventTypes', () => {
      test('returns empty array when no subscribers', () => {
        expect(eventBus.getSubscribedEventTypes()).toEqual([]);
      });

      test('returns array of event types with subscribers', () => {
        eventBus.subscribe(EventTypes.TASK_CREATED, jest.fn());
        eventBus.subscribe(EventTypes.TASK_UPDATED, jest.fn());

        expect(eventBus.getSubscribedEventTypes()).toEqual(
          expect.arrayContaining([EventTypes.TASK_CREATED, EventTypes.TASK_UPDATED])
        );
        expect(eventBus.getSubscribedEventTypes()).toHaveLength(2);
      });
    });

    describe('hasSubscribers', () => {
      test('returns true when event has subscribers', () => {
        eventBus.subscribe(EventTypes.TASK_CREATED, jest.fn());
        expect(eventBus.hasSubscribers(EventTypes.TASK_CREATED)).toBe(true);
      });

      test('returns false when event has no subscribers', () => {
        expect(eventBus.hasSubscribers(EventTypes.TASK_CREATED)).toBe(false);
      });
    });

    describe('once', () => {
      test('resolves with event payload', async () => {
        const promise = eventBus.once(EventTypes.TASK_CREATED);

        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });

        const payload = await promise;
        expect(payload.taskId).toBe('123');
      });

      test('unsubscribes after event received', async () => {
        const promise = eventBus.once(EventTypes.TASK_CREATED);

        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });

        await promise;

        // Should have unsubscribed
        expect(eventBus.hasSubscribers(EventTypes.TASK_CREATED)).toBe(false);
      });

      test('times out if event not received', async () => {
        const promise = eventBus.once(EventTypes.TASK_CREATED, 10);

        await expect(promise).rejects.toThrow('Timeout waiting for event');
      });

      test('resolves if event already published', async () => {
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: 'early' });

        const promise = eventBus.once(EventTypes.TASK_CREATED);

        // This should resolve immediately with the existing event
        // Note: once() is for future events, so this shouldn't resolve
        // with past events - testing that behavior
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: 'late' });

        const payload = await Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 50))
        ]);
        expect(payload.taskId).toBe('late');
      });
    });
  });

  describe('InMemoryEventBus', () => {
    let eventBus;

    beforeEach(() => {
      eventBus = new InMemoryEventBus();
    });

    describe('history tracking', () => {
      test('tracks published events', () => {
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '1' });
        eventBus.publish(EventTypes.TASK_UPDATED, { taskId: '2' });

        const history = eventBus.getHistory();
        expect(history).toHaveLength(2);
        expect(history[0].eventType).toBe(EventTypes.TASK_CREATED);
        expect(history[1].eventType).toBe(EventTypes.TASK_UPDATED);
      });

      test('tracks event results', () => {
        eventBus.subscribe(EventTypes.TASK_CREATED, jest.fn());
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '1' });

        const history = eventBus.getHistory();
        expect(history[0].result).toEqual({ delivered: 1, failed: 0 });
      });

      test('filters history by event type', () => {
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '1' });
        eventBus.publish(EventTypes.TASK_UPDATED, { taskId: '2' });
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '3' });

        const history = eventBus.getHistory({ eventType: EventTypes.TASK_CREATED });
        expect(history).toHaveLength(2);
        expect(history.every(e => e.eventType === EventTypes.TASK_CREATED)).toBe(true);
      });

      test('filters history by timestamp', () => {
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '1' });
        const afterFirst = new Date();
        
        // Wait a tick to ensure timestamp difference
        const start = Date.now();
        while (Date.now() - start < 2) { /* spin */ }
        
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '2' });
        const afterSecond = new Date();

        // Should have both events
        expect(eventBus.getHistory()).toHaveLength(2);
        
        // Should filter to only events after the first
        const filtered = eventBus.getHistory({ after: afterFirst });
        expect(filtered).toHaveLength(1);
        expect(filtered[0].payload.taskId).toBe('2');
      });

      test('clears history', () => {
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '1' });
        eventBus.clearHistory();

        expect(eventBus.getHistory()).toHaveLength(0);
      });

      test('can disable history tracking', () => {
        const bus = new InMemoryEventBus({ trackHistory: false });

        bus.publish(EventTypes.TASK_CREATED, { taskId: '1' });

        expect(bus.getHistory()).toHaveLength(0);
      });

      test('respects max history size', () => {
        const bus = new InMemoryEventBus({ maxHistorySize: 3 });

        bus.publish(EventTypes.TASK_CREATED, { taskId: '1' });
        bus.publish(EventTypes.TASK_CREATED, { taskId: '2' });
        bus.publish(EventTypes.TASK_CREATED, { taskId: '3' });
        bus.publish(EventTypes.TASK_CREATED, { taskId: '4' });

        const history = bus.getHistory();
        expect(history).toHaveLength(3);
        expect(history[0].payload.taskId).toBe('2');
        expect(history[2].payload.taskId).toBe('4');
      });
    });

    describe('assertPublished', () => {
      test('passes when event was published', () => {
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });

        expect(() => {
          eventBus.assertPublished(EventTypes.TASK_CREATED);
        }).not.toThrow();
      });

      test('throws when event was not published', () => {
        expect(() => {
          eventBus.assertPublished(EventTypes.TASK_CREATED);
        }).toThrow('Expected event "task.created" to be published, but it was not');
      });

      test('throws when count does not match', () => {
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '1' });
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '2' });

        expect(() => {
          eventBus.assertPublished(EventTypes.TASK_CREATED, null, 1);
        }).toThrow('Expected event "task.created" to be published 1 time(s), but was published 2 time(s)');
      });

      test('passes when count matches', () => {
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '1' });
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '2' });

        expect(() => {
          eventBus.assertPublished(EventTypes.TASK_CREATED, null, 2);
        }).not.toThrow();
      });

      test('matches payload partially', () => {
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123', userId: '456' });

        // Should match with partial payload
        expect(() => {
          eventBus.assertPublished(EventTypes.TASK_CREATED, { taskId: '123' });
        }).not.toThrow();
      });

      test('throws when payload does not match', () => {
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });

        expect(() => {
          eventBus.assertPublished(EventTypes.TASK_CREATED, { taskId: '999' });
        }).toThrow('but none matched the expected payload');
      });
    });

    describe('assertNotPublished', () => {
      test('passes when event was not published', () => {
        expect(() => {
          eventBus.assertNotPublished(EventTypes.TASK_CREATED);
        }).not.toThrow();
      });

      test('throws when event was published', () => {
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });

        expect(() => {
          eventBus.assertNotPublished(EventTypes.TASK_CREATED);
        }).toThrow('Expected event "task.created" NOT to be published');
      });
    });

    describe('waitForEvent', () => {
      test('resolves when event published', async () => {
        // Set up subscription first
        const handlerPromise = eventBus.waitForEvent(EventTypes.TASK_CREATED, 100);
        
        // Then publish synchronously
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });

        const event = await handlerPromise;
        expect(event).toBeDefined();
        expect(event.payload.taskId).toBe('123');
      });

      test('rejects on timeout', async () => {
        await expect(eventBus.waitForEvent(EventTypes.TASK_CREATED, 5))
          .rejects.toThrow('Timeout waiting for event');
      });

      test('resolves immediately if event already in history', async () => {
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '123' });

        const event = await eventBus.waitForEvent(EventTypes.TASK_CREATED, 100);
        expect(event.payload.taskId).toBe('123');
      });

      test('matches payload when waiting', async () => {
        // Set up subscription first
        const handlerPromise = eventBus.waitForEvent(EventTypes.TASK_CREATED, 100, { taskId: 'target' });
        
        // Then publish - first wrong, then target
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: 'wrong' });
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: 'target' });

        const event = await handlerPromise;
        expect(event.payload.taskId).toBe('target');
      });

      test('continues waiting if payload does not match', async () => {
        const promise = eventBus.waitForEvent(EventTypes.TASK_CREATED, 50, { taskId: 'target' });

        setTimeout(() => {
          eventBus.publish(EventTypes.TASK_CREATED, { taskId: 'wrong' });
        }, 10);

        await expect(promise).rejects.toThrow('Timeout waiting for event');
      });
    });

    describe('getStats', () => {
      test('returns empty stats when no events', () => {
        expect(eventBus.getStats()).toEqual({});
      });

      test('returns stats by event type', () => {
        eventBus.subscribe(EventTypes.TASK_CREATED, jest.fn());
        eventBus.subscribe(EventTypes.TASK_CREATED, jest.fn());
        eventBus.subscribe(EventTypes.TASK_UPDATED, jest.fn());

        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '1' });
        eventBus.publish(EventTypes.TASK_CREATED, { taskId: '2' });
        eventBus.publish(EventTypes.TASK_UPDATED, { taskId: '3' });

        const stats = eventBus.getStats();
        expect(stats[EventTypes.TASK_CREATED]).toEqual({
          count: 2,
          delivered: 4, // 2 handlers * 2 publishes
          failed: 0,
        });
        expect(stats[EventTypes.TASK_UPDATED]).toEqual({
          count: 1,
          delivered: 1,
          failed: 0,
        });
      });
    });
  });

  describe('event bus factory functions', () => {
    test('createEventBus creates new instance', () => {
      const eb1 = createEventBus();
      const eb2 = createEventBus();

      expect(eb1).toBeInstanceOf(EventBus);
      expect(eb2).toBeInstanceOf(EventBus);
      expect(eb1).not.toBe(eb2);
    });

    test('getEventBus returns shared instance', () => {
      const eb1 = getEventBus();
      const eb2 = getEventBus();

      expect(eb1).toBe(eb2);
    });

    test('resetEventBus clears shared instance', () => {
      const eb1 = getEventBus();
      resetEventBus();
      const eb2 = getEventBus();

      expect(eb1).not.toBe(eb2);
    });
  });

  describe('integration scenarios', () => {
    test('scheduler can notify on task placement', () => {
      const bus = new InMemoryEventBus();
      const notificationHandler = jest.fn();

      // Calendar sync service listening for task placements
      bus.subscribe(EventTypes.TASK_PLACED, notificationHandler);

      // Scheduler publishes event
      bus.publish(EventTypes.TASK_PLACED, {
        taskId: 'task-123',
        userId: 'user-456',
        startTime: new Date('2026-01-20T09:00:00'),
        endTime: new Date('2026-01-20T10:00:00'),
        placementMode: 'suggested',
        timestamp: new Date(),
      });

      expect(notificationHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          placementMode: 'suggested',
          _eventMeta: expect.any(Object),
        })
      );
    });

    test('cache invalidation on task update', () => {
      const bus = new InMemoryEventBus();
      const cacheHandler = jest.fn();

      bus.subscribe(EventTypes.TASK_UPDATED, cacheHandler);

      bus.publish(EventTypes.TASK_UPDATED, {
        taskId: 'task-123',
        userId: 'user-456',
        changes: { title: { old: 'Old Title', new: 'New Title' } },
        timestamp: new Date(),
      });

      expect(cacheHandler).toHaveBeenCalled();
      const payload = cacheHandler.mock.calls[0][0];
      expect(payload.taskId).toBe('task-123');
    });

    test('calendar sync triggers on schedule run', () => {
      const bus = new InMemoryEventBus();
      const syncHandler = jest.fn();

      bus.subscribe(EventTypes.SCHEDULE_RAN, syncHandler);

      bus.publish(EventTypes.SCHEDULE_RAN, {
        userId: 'user-456',
        taskCount: 42,
        placedCount: 38,
        durationMs: 1250,
        timestamp: new Date(),
      });

      expect(syncHandler).toHaveBeenCalled();
      const payload = syncHandler.mock.calls[0][0];
      expect(payload.taskCount).toBe(42);
      expect(payload.placedCount).toBe(38);
    });

    test('multiple slices can react to same event', () => {
      const bus = new InMemoryEventBus();
      const auditHandler = jest.fn();
      const cacheHandler = jest.fn();
      const notificationHandler = jest.fn();

      // Multiple services listening
      bus.subscribe(EventTypes.TASK_CREATED, auditHandler);
      bus.subscribe(EventTypes.TASK_CREATED, cacheHandler);
      bus.subscribe(EventTypes.TASK_CREATED, notificationHandler);

      // Task service publishes event
      bus.publish(EventTypes.TASK_CREATED, {
        taskId: 'abc123',
        userId: '456',
        task: { title: 'New Task' },
        timestamp: new Date(),
      });

      expect(auditHandler).toHaveBeenCalledTimes(1);
      expect(cacheHandler).toHaveBeenCalledTimes(1);
      expect(notificationHandler).toHaveBeenCalledTimes(1);
    });
  });
});
