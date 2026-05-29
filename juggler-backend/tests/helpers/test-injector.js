/**
 * DI helper for swapping real DB modules with test doubles.
 *
 * Uses require.cache manipulation to inject test repositories.
 * Call inject() before loading the module under test.
 * Call reset() in afterEach/afterAll to clean up.
 *
 * Usage:
 *   const injector = require('./test-injector');
 *   const InMemoryTaskRepo = require('../test-doubles/InMemoryTaskRepository');
 *
 *   beforeAll(function () {
 *     injector.inject('src/db', new InMemoryTaskRepo());
 *   });
 *
 *   afterAll(function () {
 *     injector.reset();
 *   });
 */

var path = require('path');
var injected = {};

function resolvePath(modulePath) {
  if (path.isAbsolute(modulePath)) {
    return modulePath;
  }
  return path.resolve(process.cwd(), modulePath);
}

function inject(modulePath, double) {
  var resolved = resolvePath(modulePath);
  injected[resolved] = require.cache[resolved];
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: double
  };
}

function injectByName(moduleName, double) {
  var keys = Object.keys(require.cache);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].includes('node_modules' + path.sep + moduleName + path.sep) ||
        keys[i].endsWith(path.sep + moduleName + '.js')) {
      injected[keys[i]] = require.cache[keys[i]];
      require.cache[keys[i]] = {
        id: keys[i],
        filename: keys[i],
        loaded: true,
        exports: double
      };
    }
  }
}

function reset() {
  var keys = Object.keys(injected);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (injected[key]) {
      require.cache[key] = injected[key];
    } else {
      delete require.cache[key];
    }
  }
  injected = {};
}

function clear(modulePath) {
  var resolved = resolvePath(modulePath);
  if (injected[resolved]) {
    require.cache[resolved] = injected[resolved];
    delete injected[resolved];
  }
}

function isInjecting() {
  return Object.keys(injected).length > 0;
}

function injectRepository(modulePath, DoubleConstructor) {
  var double = new DoubleConstructor();
  inject(modulePath, double);
  return double;
}

module.exports = {
  inject: inject,
  injectByName: injectByName,
  reset: reset,
  clear: clear,
  isInjecting: isInjecting,
  injectRepository: injectRepository,
  resolvePath: resolvePath
};