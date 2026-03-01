/**
 * useConfig — manages locations, tools, matrix, time blocks, schedules, preferences
 */

import { useState, useCallback } from 'react';
import apiClient from '../services/apiClient';
import {
  DEFAULT_LOCATIONS, DEFAULT_TOOLS, DEFAULT_TOOL_MATRIX,
  DEFAULT_TIME_BLOCKS, DEFAULT_WEEKDAY_BLOCKS, DEFAULT_WEEKEND_BLOCKS
} from '../state/constants';

export default function useConfig() {
  const [locations, setLocations] = useState(DEFAULT_LOCATIONS);
  const [tools, setTools] = useState(DEFAULT_TOOLS);
  const [toolMatrix, setToolMatrix] = useState(DEFAULT_TOOL_MATRIX);
  const [timeBlocks, setTimeBlocks] = useState(DEFAULT_TIME_BLOCKS);
  const [projects, setProjects] = useState([]);
  const [locSchedules, setLocSchedules] = useState(function() {
    var weekdayHours = {}, weekendHours = {};
    DEFAULT_WEEKDAY_BLOCKS.forEach(function(b) {
      for (var m = b.start; m < b.end; m += 15) weekdayHours[m] = b.loc || "home";
    });
    DEFAULT_WEEKEND_BLOCKS.forEach(function(b) {
      for (var m = b.start; m < b.end; m += 15) weekendHours[m] = b.loc || "home";
    });
    return {
      weekday: { name: "Weekday", icon: "\uD83C\uDFE2", system: true, hours: weekdayHours },
      weekend: { name: "Weekend", icon: "\uD83C\uDFE0", system: true, hours: weekendHours },
    };
  });
  const [locScheduleDefaults, setLocScheduleDefaults] = useState({
    Mon: "weekday", Tue: "weekday", Wed: "weekday", Thu: "weekday", Fri: "weekday",
    Sat: "weekend", Sun: "weekend",
  });
  const [locScheduleOverrides, setLocScheduleOverrides] = useState({});
  const [hourLocationOverrides, setHourLocationOverrides] = useState({});
  const [splitDefault, setSplitDefault] = useState(false);
  const [splitMinDefault, setSplitMinDefault] = useState(15);
  const [gridZoom, setGridZoom] = useState(60);
  const [schedFloor, setSchedFloor] = useState(480);
  const [fontSize, setFontSize] = useState(100);

  // Initialize from API response
  const initFromConfig = useCallback((config) => {
    if (!config) return;
    if (config.locations?.length > 0) setLocations(config.locations);
    if (config.tools?.length > 0) setTools(config.tools);
    if (config.projects) setProjects(config.projects);
    if (config.toolMatrix) setToolMatrix(config.toolMatrix);
    if (config.timeBlocks) setTimeBlocks(config.timeBlocks);
    if (config.locSchedules) setLocSchedules(config.locSchedules);
    if (config.locScheduleDefaults) setLocScheduleDefaults(config.locScheduleDefaults);
    if (config.locScheduleOverrides) setLocScheduleOverrides(config.locScheduleOverrides);
    if (config.hourLocationOverrides) setHourLocationOverrides(config.hourLocationOverrides);
    if (config.preferences) {
      var p = config.preferences;
      if (p.splitDefault !== undefined) setSplitDefault(p.splitDefault);
      if (p.splitMinDefault !== undefined) setSplitMinDefault(p.splitMinDefault);
      if (p.gridZoom !== undefined) setGridZoom(p.gridZoom);
      if (p.schedFloor !== undefined) setSchedFloor(p.schedFloor);
      if (p.fontSize !== undefined) setFontSize(p.fontSize);
    }
  }, []);

  // Save a config key to backend
  const saveConfig = useCallback(async (key, value) => {
    try {
      await apiClient.put(`/config/${key}`, { value });
    } catch (error) {
      console.error(`Failed to save config ${key}:`, error);
    }
  }, []);

  // Wrapped setters that auto-persist
  const updateToolMatrix = useCallback((val) => {
    setToolMatrix(val);
    saveConfig('tool_matrix', val);
  }, [saveConfig]);

  const updateTimeBlocks = useCallback((val) => {
    setTimeBlocks(val);
    saveConfig('time_blocks', val);
  }, [saveConfig]);

  const updateLocSchedules = useCallback((val) => {
    setLocSchedules(val);
    saveConfig('loc_schedules', val);
  }, [saveConfig]);

  const updateLocScheduleDefaults = useCallback((val) => {
    setLocScheduleDefaults(val);
    saveConfig('loc_schedule_defaults', val);
  }, [saveConfig]);

  const updateLocScheduleOverrides = useCallback((val) => {
    setLocScheduleOverrides(val);
    saveConfig('loc_schedule_overrides', val);
  }, [saveConfig]);

  const updateHourLocationOverrides = useCallback((val) => {
    setHourLocationOverrides(val);
    saveConfig('hour_location_overrides', val);
  }, [saveConfig]);

  const updatePreferences = useCallback((prefs) => {
    saveConfig('preferences', prefs);
  }, [saveConfig]);

  const updateLocations = useCallback(async (locs) => {
    setLocations(locs);
    try {
      await apiClient.put('/locations', { locations: locs });
    } catch (error) {
      console.error('Failed to save locations:', error);
    }
  }, []);

  const updateTools = useCallback(async (tls) => {
    setTools(tls);
    try {
      await apiClient.put('/tools', { tools: tls });
    } catch (error) {
      console.error('Failed to save tools:', error);
    }
  }, []);

  return {
    locations, tools, toolMatrix, timeBlocks, projects,
    locSchedules, locScheduleDefaults, locScheduleOverrides,
    hourLocationOverrides, splitDefault, splitMinDefault,
    gridZoom, schedFloor, fontSize,
    setLocations, setTools, setToolMatrix, setTimeBlocks, setProjects,
    setLocSchedules, setLocScheduleDefaults, setLocScheduleOverrides,
    setHourLocationOverrides, setSplitDefault, setSplitMinDefault,
    setGridZoom, setSchedFloor, setFontSize,
    initFromConfig,
    updateToolMatrix, updateTimeBlocks,
    updateLocSchedules, updateLocScheduleDefaults,
    updateLocScheduleOverrides, updateHourLocationOverrides,
    updatePreferences, updateLocations, updateTools
  };
}
