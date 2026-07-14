/**
 * Scheduler adapters — barrel re-export (Phase H6 / W2).
 *
 * Concrete implementations of the five scheduler ports plus the in-memory test
 * double. The W3 `RunScheduleCommand` / W4 facade wire these to the ports.
 */

'use strict';

module.exports = {
  SchedulerTaskProvider: require('./SchedulerTaskProvider'),
  SchedulerCalendarProvider: require('./SchedulerCalendarProvider'),
  SchedulerWeatherProvider: require('./SchedulerWeatherProvider'),
  FakeWeatherProvider: require('./FakeWeatherProvider'),
  KnexScheduleRepository: require('./KnexScheduleRepository'),
  InMemoryScheduleRepository: require('./InMemoryScheduleRepository'),
  MysqlClockAdapter: require('./MysqlClockAdapter'),
  FakeClockAdapter: require('./FakeClockAdapter'),
  RedisScheduleCache: require('./RedisScheduleCache'),
  SchedulerQueueRepository: require('./SchedulerQueueRepository'),
  SchedulerSessionRepository: require('./SchedulerSessionRepository')
};
