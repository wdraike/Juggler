/**
 * Tests for service worker registration guards (backlog 999.258).
 *
 * The critical contract: register() must be opt-in-safe. It must do NOTHING
 * (never register a SW) outside a production build, so a bad SW can never brick
 * dev. We verify the guard by stubbing navigator.serviceWorker and asserting it
 * is left untouched in non-production, and used only in production.
 */

describe('serviceWorkerRegistration.register', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;
  let registerMock;
  let addLoadListener;

  beforeEach(() => {
    jest.resetModules();
    registerMock = jest.fn(() => Promise.resolve({ onupdatefound: null }));
    // Stub navigator.serviceWorker (jsdom does not provide it).
    Object.defineProperty(global.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: registerMock,
        addEventListener: jest.fn(),
        ready: Promise.resolve({ unregister: jest.fn() }),
      },
    });
    // Capture the window 'load' handler so we can fire it deterministically.
    addLoadListener = jest
      .spyOn(window, 'addEventListener')
      .mockImplementation((type, handler) => {
        if (type === 'load') addLoadListener.handler = handler;
      });
  });

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
    delete global.navigator.serviceWorker;
    jest.restoreAllMocks();
  });

  it('does NOT register the service worker outside production (opt-in safe)', () => {
    process.env.NODE_ENV = 'development';
    const { register } = require('./serviceWorkerRegistration');
    register();
    // No load listener registered, no SW registration attempted.
    expect(addLoadListener.handler).toBeUndefined();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('does NOT register when test env (the suite itself runs as test)', () => {
    process.env.NODE_ENV = 'test';
    const { register } = require('./serviceWorkerRegistration');
    register();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('registers /service-worker.js on window load in production', () => {
    process.env.NODE_ENV = 'production';
    const { register } = require('./serviceWorkerRegistration');
    register();
    // It defers to window 'load'; fire it.
    expect(typeof addLoadListener.handler).toBe('function');
    addLoadListener.handler();
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock.mock.calls[0][0]).toMatch(/\/service-worker\.js$/);
  });

  it('never throws when serviceWorker is unsupported', () => {
    process.env.NODE_ENV = 'production';
    delete global.navigator.serviceWorker;
    const { register } = require('./serviceWorkerRegistration');
    expect(() => register()).not.toThrow();
  });
});
