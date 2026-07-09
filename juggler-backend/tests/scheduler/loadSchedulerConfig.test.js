/**
 * Tests for src/scheduler/loadSchedulerConfig.js (999.1187) — the single
 * scheduler-config loader.
 *
 * Regression pinned: user_config keys are SNAKE_CASE ('time_blocks',
 * 'tool_matrix', …). The pre-consolidation schedulerSession.js /
 * schedule.routes.js copies read camelCase keys that never exist in
 * user_config, silently running every stepper/debug request on
 * DEFAULT_TIME_BLOCKS / DEFAULT_TOOL_MATRIX.
 *
 * Pure tests — exercise the parse + assembly halves without a DB.
 */
process.env.NODE_ENV = 'test';

var { parseUserConfigRows, assembleSchedulerCfg } = require('../../src/scheduler/loadSchedulerConfig');
var constants = require('../../src/scheduler/constants');

function row(key, value) {
  return { config_key: key, config_value: JSON.stringify(value) };
}

describe('loadSchedulerConfig (999.1187)', function() {
  var TIME_BLOCKS = { Mon: [{ start: '9:00 AM', end: '5:00 PM', type: 'biz1' }] };
  var TOOL_MATRIX = { computer: { biz1: true } };

  test('parseUserConfigRows: JSON values parsed, snake_case keys preserved', function() {
    var config = parseUserConfigRows([
      row('time_blocks', TIME_BLOCKS),
      row('preferences', { splitMinDefault: 30, splitDefault: true })
    ]);
    expect(config.time_blocks).toEqual(TIME_BLOCKS);
    expect(config.preferences.splitMinDefault).toBe(30);
  });

  test('parseUserConfigRows: corrupt JSON throws (strict — no silent raw-string fallback)', function() {
    expect(function() {
      parseUserConfigRows([{ config_key: 'time_blocks', config_value: '{not json' }]);
    }).toThrow();
  });

  test('assembleSchedulerCfg: snake_case DB keys flow into camelCase cfg fields', function() {
    var cfg = assembleSchedulerCfg(parseUserConfigRows([
      row('time_blocks', TIME_BLOCKS),
      row('tool_matrix', TOOL_MATRIX),
      row('loc_schedules', { home: {} }),
      row('preferences', { splitMinDefault: 30, splitDefault: true })
    ]), []);
    expect(cfg.timeBlocks).toEqual(TIME_BLOCKS);          // NOT the defaults
    expect(cfg.toolMatrix).toEqual(TOOL_MATRIX);          // NOT the defaults
    expect(cfg.locSchedules).toEqual({ home: {} });
    expect(cfg.splitMinDefault).toBe(30);
    expect(cfg.splitDefault).toBe(true);
    expect(cfg.locations).toEqual([]);
  });

  test('assembleSchedulerCfg: unset keys get the scheduler defaults', function() {
    var cfg = assembleSchedulerCfg({}, []);
    expect(cfg.timeBlocks).toBe(constants.DEFAULT_TIME_BLOCKS);
    expect(cfg.toolMatrix).toBe(constants.DEFAULT_TOOL_MATRIX);
    expect(cfg.locSchedules).toEqual({});
    expect(cfg.scheduleTemplates).toBeNull();
    expect(cfg.preferences).toEqual({});
    expect(cfg.splitMinDefault).toBeUndefined();
  });

  test('regression 999.1187: camelCase keys in user_config do NOT populate the cfg', function() {
    // The old drifted copies read cfg.timeBlocks — assert the loader does not
    // resurrect that spelling: a camelCase row is ignored by assembly.
    var cfg = assembleSchedulerCfg(parseUserConfigRows([row('timeBlocks', TIME_BLOCKS)]), []);
    expect(cfg.timeBlocks).toBe(constants.DEFAULT_TIME_BLOCKS);
  });
});
