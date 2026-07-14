/**
 * Scheduler domain ports — barrel re-export (Phase H6 / W2, extended H7 —
 * 999.1532).
 *
 * The driven-port contracts the scheduler depends on. The domain core
 * depends ONLY on these interfaces; the adapters implement them and the
 * application layer (`RunScheduleCommand` / the legacy `src/scheduler/*.js`
 * entry points) wires concrete adapters to the ports.
 */

'use strict';

module.exports = {
  TaskProviderPort: require('./TaskProviderPort'),
  CalendarProviderPort: require('./CalendarProviderPort'),
  ScheduleRepositoryPort: require('./ScheduleRepositoryPort'),
  WeatherProviderPort: require('./WeatherProviderPort'),
  ClockPort: require('./ClockPort'),
  ScheduleCachePort: require('./ScheduleCachePort'),
  ScheduleQueuePort: require('./ScheduleQueuePort'),
  SchedulerSessionPort: require('./SchedulerSessionPort')
};
