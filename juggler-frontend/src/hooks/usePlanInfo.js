/**
 * usePlanInfo — fetches plan name, features, and usage from /api/my-plan.
 * Refreshes on mount and when plan:limit-reached fires (to update counts).
 */

import { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';

const LABELS = {
  'limits.active_tasks': 'Tasks',
  'limits.habit_templates': 'Habits',
  'limits.projects': 'Projects',
  'limits.locations': 'Locations',
  'limits.schedule_templates': 'Schedule Templates',
  'limits.ai_commands_per_month': 'AI Commands',
  'calendar.max_providers': 'Calendar Providers'
};

export default function usePlanInfo() {
  var [planName, setPlanName] = useState('');
  var [features, setFeatures] = useState(null);
  var [usage, setUsage] = useState({});
  var [loading, setLoading] = useState(true);

  var load = useCallback(function() {
    apiClient.get('/my-plan').then(function(res) {
      setPlanName(res.data.plan_name || res.data.plan_id || 'Free');
      setFeatures(res.data.features);
      setUsage(res.data.usage || {});
      setLoading(false);
    }).catch(function() {
      setLoading(false);
    });
  }, []);

  useEffect(function() {
    load();
    // Refresh after a limit is hit (counts may have changed)
    function onLimitHit() { setTimeout(load, 1000); }
    window.addEventListener('plan:limit-reached', onLimitHit);
    // Refresh every 5 minutes
    var interval = setInterval(load, 5 * 60 * 1000);
    return function() {
      window.removeEventListener('plan:limit-reached', onLimitHit);
      clearInterval(interval);
    };
  }, [load]);

  // Build a structured usage summary
  var usageSummary = [];
  Object.keys(usage).forEach(function(key) {
    var u = usage[key];
    usageSummary.push({
      key: key,
      label: LABELS[key] || key.split('.').pop().replace(/_/g, ' '),
      used: u.used,
      limit: u.limit,
      unlimited: u.unlimited,
      resets_at: u.resets_at,
      pct: u.unlimited ? 0 : (u.limit > 0 ? Math.round((u.used / u.limit) * 100) : 0),
      nearLimit: !u.unlimited && u.limit > 0 && u.used >= u.limit * 0.8,
      atLimit: !u.unlimited && u.limit > 0 && u.used >= u.limit
    });
  });

  return { planName, features, usage, usageSummary, loading, refresh: load };
}
