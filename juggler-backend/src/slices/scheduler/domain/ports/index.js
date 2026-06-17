/**
 * Scheduler domain ports — barrel re-export (Phase H6 / W2).
 *
 * The five driven-port contracts the scheduler depends on. The domain core
 * depends ONLY on these interfaces; the W2 adapters implement them and the W3
 * `RunScheduleCommand` wires concrete adapters to the ports.
 */

'use strict';

module.exports = {
  TaskProviderPort: require('./TaskProviderPort'),
  CalendarProviderPort: require('./CalendarProviderPort'),
  ScheduleRepositoryPort: require('./ScheduleRepositoryPort'),
  WeatherProviderPort: require('./WeatherProviderPort'),
  ClockPort: require('./ClockPort'),
  ScheduleCachePort: require('./ScheduleCachePort')
};
