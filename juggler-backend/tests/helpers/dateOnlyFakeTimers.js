/**
 * Date-ONLY fake timers (999.2157).
 *
 * jest.setSystemTime without installed fake timers throws (_checkFakeTimers)
 * — the a2dd4aaf sweep left 44 files on that bare pattern. This installs
 * modern fake timers with every timer API excluded, so ONLY Date is frozen:
 * the async/retry/DB hangs the bare pattern tried to avoid cannot happen.
 * Later jest.setSystemTime(...) calls in a file remain legal for time travel.
 */
global.installDateOnlyFakeTimers = (now) => {
  jest.useFakeTimers({
    now: now instanceof Date ? now : new Date(now),
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask',
      'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback',
      'setImmediate', 'clearImmediate',
      'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout',
    ],
  });
};
